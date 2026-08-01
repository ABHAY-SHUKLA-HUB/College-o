const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const cookie = require('cookie');
const jwt = require('jsonwebtoken');
const { verifySessionToken } = require('./../middleware/socketAuth');
const { pool } = require('../db/pool');
const { setBroadcaster } = require('../services/realtimeBus');

let ioInstance = null;
let schemaReady = null;
const userPresence = new Map();

async function maybeSetupRedis(io) {
  const redisUrl = process.env.REDIS_URL || process.env.REDIS_CONNECTION || null;
  if (!redisUrl) return false;
  try {
    const pubClient = createClient({ url: redisUrl });
    const subClient = pubClient.duplicate();
    await pubClient.connect();
    await subClient.connect();
    io.adapter(createAdapter(pubClient, subClient));
    console.log('[Socket Manager] Redis adapter configured');
    return true;
  } catch (err) {
    console.warn('[Socket Manager] Redis adapter init failed:', err && err.message);
    return false;
  }
}

function safeJson(value) {
  try { return JSON.stringify(value || {}); } catch (e) { return '{}'; }
}

function nowTs() { return new Date(); }

async function ensurePresenceSchema() {
  if (schemaReady) return schemaReady;

  schemaReady = pool.query(`
    CREATE TABLE IF NOT EXISTS user_presence (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'offline',
      connected_device JSONB,
      active_session_id VARCHAR(120),
      socket_count INTEGER NOT NULL DEFAULT 0,
      last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `).then(() => true).catch((error) => {
    schemaReady = null;
    console.warn('[Socket Manager] presence schema init failed:', error && error.message);
    return false;
  });

  return schemaReady;
}

function getSocketUser(socket) {
  return socket.user || null;
}

function getSessionIdFromSocket(socket) {
  return socket.handshake.query && socket.handshake.query.sessionId
    || socket.data?.sessionId
    || null;
}

function isAdminRole(role) {
  const normalized = String(role || '').toLowerCase();
  return normalized === 'admin' || normalized === 'super_admin';
}

function deriveRooms(user, sessionId) {
  const rooms = [];
  if (user?.id) {
    rooms.push(`user:${user.id}`);
    rooms.push(`notifications:${user.id}`);
    rooms.push(`presence:user:${user.id}`);
    rooms.push(isAdminRole(user?.role) ? 'admins' : 'students');
    rooms.push(`role:${String(user?.role || 'student').toLowerCase()}`);
    if (user.subscription_tier) rooms.push(`membership:${String(user.subscription_tier).toLowerCase()}`);
  }
  if (sessionId) {
    rooms.push(`session:${sessionId}`);
    rooms.push(`live-session:${sessionId}`);
  }
  return [...new Set(rooms.filter(Boolean))];
}

function normalizeSocketEvent(type, payload = {}) {
  const rawType = String(type || '').trim();
  const contentType = String(payload.contentType || '').trim().toLowerCase();

  if (rawType === 'content_changed') {
    if (contentType === 'notifications') return 'notification_created';
    if (contentType === 'certificates') return 'certificate_updated';
    if (contentType === 'membership' || contentType === 'memberships') return 'membership_updated';
    if (contentType.startsWith('support_')) return 'support_updated';
    if (contentType === 'students' || contentType === 'student') return 'student_updated';
    if (contentType === 'live_sessions' || contentType === 'live_session') return 'live_session_updated';
    return 'content_changed';
  }

  if (rawType === 'notification_changed') {
    return payload.action === 'created' ? 'notification_created' : 'notification_updated';
  }

  if (rawType.startsWith('live_session_') || rawType.startsWith('session.')) {
    return 'live_session_updated';
  }

  if (rawType === 'student_updated' || rawType === 'membership_updated' || rawType === 'certificate_updated' || rawType === 'support_updated' || rawType === 'notification_created') {
    return rawType;
  }

  return rawType || 'event';
}

async function upsertPresence(user, socket, status, extra = {}) {
  if (!user?.id) return null;
  const device = extra.deviceInfo || extra.device || {
    userAgent: socket.request?.headers?.['user-agent'] || null,
    platform: extra.platform || null
  };
  const sessionId = extra.activeSessionId || getSessionIdFromSocket(socket) || null;
  const socketCount = extra.socketCount || 1;

  userPresence.set(Number(user.id), {
    online: status !== 'offline',
    lastSeenAt: new Date().toISOString(),
    connectedDevice: device,
    activeSessionId: sessionId,
    socketCount
  });

  await ensurePresenceSchema();
  return pool.query(
    `INSERT INTO user_presence (user_id, status, connected_device, active_session_id, socket_count, last_seen_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO UPDATE SET
       status = EXCLUDED.status,
       connected_device = EXCLUDED.connected_device,
       active_session_id = EXCLUDED.active_session_id,
       socket_count = EXCLUDED.socket_count,
       last_seen_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [user.id, status, safeJson(device), sessionId, socketCount]
  ).then((result) => result.rows[0] || null).catch(() => null);
}

async function refreshSessionCounters(sessionId) {
  if (!sessionId) return null;
  const result = await pool.query(
    `UPDATE live_sessions
     SET participant_count = COALESCE((
       SELECT COUNT(*)
       FROM live_session_participants
       WHERE live_session_id = id AND left_at IS NULL
     ), 0),
         updated_at = CURRENT_TIMESTAMP
     WHERE session_id = $1
     RETURNING *`,
    [sessionId]
  ).catch(() => null);

  return result?.rows?.[0] || null;
}

function emitCanonical(io, type, payload = {}) {
  const eventType = normalizeSocketEvent(type, payload);
  io.emit(eventType, { payload });
  io.of('/live-session').emit(eventType, { payload });
  return eventType;
}

function persistChatMessage(sessionId, user, message) {
  if (!sessionId) return Promise.resolve(null);
  const body = String(message.text || message.body || '') || '';
  if (!body) return Promise.resolve(null);
  return pool.query(
    `INSERT INTO live_session_messages (live_session_id, user_id, user_email, user_name, role, message_type, body, reaction, is_system, meta)
     VALUES (
       (SELECT id FROM live_sessions WHERE session_id = $1 LIMIT 1), $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb
     ) RETURNING *`,
    [sessionId, user?.id || null, String(user?.email || ''), String(user?.full_name || user?.fullName || user?.email || 'Participant'), user?.role || 'participant', 'message', body, null, false, safeJson({ socket: true })]
  ).then(r => r.rows[0]).catch(() => null);
}

function persistPresence(sessionId, user, payload) {
  if (!sessionId || !user || !user.id) return Promise.resolve(null);
  const status = String(payload.status || 'online');
  const isTyping = Boolean(payload.isTyping);
  const isPresent = payload.isPresent !== false;
  const device = payload.deviceInfo || payload.device || null;
  return pool.query(
    `INSERT INTO live_session_presence (live_session_id, user_id, user_email, user_name, status, is_typing, is_present, device_info, meta, last_seen_at, updated_at)
     VALUES ((SELECT id FROM live_sessions WHERE session_id = $1 LIMIT 1), $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (live_session_id, user_id) DO UPDATE SET
       user_email = EXCLUDED.user_email,
       user_name = EXCLUDED.user_name,
       status = EXCLUDED.status,
       is_typing = EXCLUDED.is_typing,
       is_present = EXCLUDED.is_present,
       device_info = EXCLUDED.device_info,
       meta = EXCLUDED.meta,
       last_seen_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [sessionId, user.id, String(user.email || ''), String(user.full_name || user.fullName || user.email || 'Participant'), status, isTyping, isPresent, safeJson(device), safeJson(payload.meta || {})]
  ).then(r => r.rows[0]).catch(() => null);
}

function persistReaction(sessionId, user, payload) {
  if (!sessionId) return Promise.resolve(null);
  const reaction = String(payload.reaction || payload.emoji || '');
  if (!reaction) return Promise.resolve(null);
  return pool.query(
    `INSERT INTO live_session_messages (live_session_id, user_id, user_email, user_name, role, message_type, body, reaction, is_system, meta)
     VALUES ((SELECT id FROM live_sessions WHERE session_id = $1 LIMIT 1), $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     RETURNING *`,
    [sessionId, user?.id || null, String(user?.email || ''), String(user?.full_name || user?.fullName || user?.email || 'Participant'), user?.role || 'participant', 'reaction', reaction, reaction, false, safeJson({ socket: true })]
  ).then(r => r.rows[0]).catch(() => null);
}

async function initSocket(server, options = {}) {
  if (ioInstance) return ioInstance;

  const allowedOrigins = new Set(Array.isArray(options.allowedOrigins) ? options.allowedOrigins : []);

  const io = new Server(server, {
    path: '/socket.io',
    cors: {
      origin: (origin, cb) => {
        if (!origin) {
          return cb(null, true);
        }
        if (!allowedOrigins.size) {
          return cb(null, true);
        }
        return cb(null, allowedOrigins.has(origin));
      },
      credentials: true
    },
    pingInterval: 25000,
    pingTimeout: 60000,
    maxHttpBufferSize: 1e6
  });

  await maybeSetupRedis(io);

  // register broadcaster so publishRealtimeEvent will also be emitted to socket clients
  try {
    setBroadcaster((type, payload) => {
      try {
        emitCanonical(io, type, payload);
      } catch (e) {
        // swallow
      }
    });
  } catch (e) {}

  // Auth middleware
  io.use(async (socket, next) => {
    try {
      const { headers } = socket.request;
      const rawCookie = headers.cookie || '';
      const cookies = cookie.parse(rawCookie || '');
      const token = socket.handshake.query && socket.handshake.query.joinToken || socket.handshake.query && socket.handshake.query.token;
      const identity = await verifySessionToken({ token, cookies });
      socket.user = identity.user || null;
      socket.authInfo = identity.authInfo || {};
      return next();
    } catch (err) {
      return next();
    }
  });

  const liveNS = io.of('/live-session');

  liveNS.on('connection', async (socket) => {
    const user = socket.user || { id: null };
    const sid = socket.handshake.query && socket.handshake.query.sessionId;
    const clientId = socket.id;
    socket.data = socket.data || {};
    socket.data.sessionId = sid || socket.data.sessionId || null;
    socket.data.rooms = deriveRooms(user, sid);

    for (const room of socket.data.rooms) {
      socket.join(room);
    }

    await upsertPresence(user, socket, 'online', { activeSessionId: sid, socketCount: 1 });
    const sessionRow = sid ? await refreshSessionCounters(sid) : null;

    if (user?.id) {
      io.to(`user:${user.id}`).emit('student_updated', { userId: user.id, status: 'online', lastSeenAt: new Date().toISOString(), activeSessionId: sid || null });
      io.to(`role:${String(user.role || 'student').toLowerCase()}`).emit('student_updated', { userId: user.id, status: 'online', lastSeenAt: new Date().toISOString(), activeSessionId: sid || null });
      if (String(user.subscription_tier || '').toLowerCase()) {
        io.to(`membership:${String(user.subscription_tier).toLowerCase()}`).emit('membership_updated', { userId: user.id, subscriptionTier: user.subscription_tier, status: 'online' });
      }
    }

    // Token single-use enforcement and validation
    try {
      const tokenRow = socket.authInfo && socket.authInfo.tokenRow;
      if (tokenRow) {
        // if token expired, reject
        if (socket.authInfo.expired) {
          return socket.disconnect(true);
        }
        if (!tokenRow.used) {
          // mark used with audit
          pool.query(`UPDATE live_session_tokens SET used = TRUE, used_by_user_id = $1, used_at = CURRENT_TIMESTAMP, used_by_meta = $2::jsonb WHERE id = $3`, [user?.id || null, safeJson({ socketId: clientId }), tokenRow.id]).catch(() => {});
          pool.query(`INSERT INTO live_session_logs (live_session_id, actor_user_id, actor_role, action, metadata) VALUES ((SELECT id FROM live_sessions WHERE session_id = $1 LIMIT 1), $2, $3, 'token_used', $4::jsonb)`, [tokenRow.live_session_id, user?.id || null, user?.role || null, safeJson({ jti: tokenRow.id, socketId: clientId })]).catch(() => {});
        } else {
          // token already used: allow if user already present in participants table for the session
          pool.query(
            `SELECT 1 FROM live_session_participants WHERE live_session_id = $1 AND user_id = $2 AND left_at IS NULL LIMIT 1`,
            [tokenRow.live_session_id, user?.id || null]
          )
            .then(({ rows }) => {
              if (!rows.length) {
                socket.disconnect(true);
                return;
              }
              // otherwise allow reconnect; record reuse audit
              pool.query(
                `INSERT INTO live_session_logs (live_session_id, actor_user_id, actor_role, action, metadata) VALUES ($1, $2, $3, 'token_reused_allowed', $4::jsonb)`,
                [tokenRow.live_session_id, user?.id || null, user?.role || null, safeJson({ socketId: clientId })]
              ).catch(() => {});
            })
            .catch(() => {
              socket.disconnect(true);
            });
        }
      }
    } catch (e) {
      // swallow and continue; don't break connection flow
    }

    if (sid) {
      socket.join(`session:${sid}`);
      socket.join(`live-session:${sid}`);
      // log join
      pool.query(`INSERT INTO live_session_logs (live_session_id, actor_user_id, actor_role, action, metadata) VALUES ((SELECT id FROM live_sessions WHERE session_id = $1 LIMIT 1), $2, $3, 'socket_join', $4::jsonb)`, [sid, user?.id || null, user?.role || null, safeJson({ socketId: clientId })]).catch(() => {});
      const joinPayload = { userId: user?.id || null, socketId: clientId, timestamp: Date.now(), sessionId: sid, activeSessionId: sid, session: sessionRow || null };
      liveNS.to(`session:${sid}`).emit('participant.joined', joinPayload);
      liveNS.to(`session:${sid}`).emit('live_session_updated', { ...joinPayload, action: 'joined' });
    }

    const heartbeatTimer = setInterval(() => {
      if (socket.connected) {
        socket.emit('heartbeat', { ts: Date.now(), sessionId: sid || null });
      }
    }, 25000);

    socket.on('presence.update', (payload = {}) => {
      const room = sid ? `session:${sid}` : null;
      persistPresence(sid, user, payload).then(async (stored) => {
        await upsertPresence(user, socket, payload.status || 'online', { activeSessionId: sid, deviceInfo: payload.deviceInfo || payload.device || null });
        if (room) {
          const nextPayload = { userId: user?.id || null, payload: stored || payload, sessionId: sid, lastSeenAt: Date.now() };
          liveNS.to(room).emit('presence.updated', nextPayload);
          liveNS.to(room).emit('live_session_updated', { action: 'presence', ...nextPayload });
        }
      });
    });

    socket.on('typing', (payload = {}) => {
      const room = sid ? `session:${sid}` : null;
      if (room) liveNS.to(room).emit('participant.typing', { userId: user?.id || null, payload });
    });

    socket.on('chat.message', (message) => {
        const room = sid ? `session:${sid}` : null;
        // Basic payload validation & sanitization
        const text = String((message && (message.text || message.body)) || '').slice(0, 2000).replace(/<[^>]*>/g, '');
        if (!text) return;
        const safeMessage = { text };
        persistChatMessage(sid, user, { text: safeMessage.text }).then((stored) => {
          if (room) {
            const nextPayload = { userId: user?.id || null, message: stored || { body: safeMessage.text }, timestamp: Date.now(), sessionId: sid };
            liveNS.to(room).emit('chat.message', nextPayload);
            liveNS.to(room).emit('live_session_updated', { action: 'chat', ...nextPayload });
          }
        });
    });

    socket.on('reaction', (payload) => {
      const room = sid ? `session:${sid}` : null;
      persistReaction(sid, user, payload).then((stored) => {
        if (room) {
          const nextPayload = { userId: user?.id || null, payload: stored || payload, sessionId: sid };
          liveNS.to(room).emit('participant.reaction', nextPayload);
          liveNS.to(room).emit('live_session_updated', { action: 'reaction', ...nextPayload });
        }
      });
    });

    socket.on('raise.hand', (payload) => {
      const room = sid ? `session:${sid}` : null;
      pool.query(`INSERT INTO live_session_logs (live_session_id, actor_user_id, actor_role, action, metadata) VALUES ((SELECT id FROM live_sessions WHERE session_id = $1 LIMIT 1), $2, $3, 'raise_hand', $4::jsonb)`, [sid, user?.id || null, user?.role || null, safeJson(payload)]).catch(() => {});
      if (room) {
        const nextPayload = { userId: user?.id || null, payload, sessionId: sid };
        liveNS.to(room).emit('participant.raised_hand', nextPayload);
        liveNS.to(room).emit('live_session_updated', { action: 'raised_hand', ...nextPayload });
      }
    });

    socket.on('disconnect', (reason) => {
      clearInterval(heartbeatTimer);
      if (sid) {
        pool.query(`INSERT INTO live_session_logs (live_session_id, actor_user_id, actor_role, action, metadata) VALUES ((SELECT id FROM live_sessions WHERE session_id = $1 LIMIT 1), $2, $3, 'socket_disconnect', $4::jsonb)`, [sid, user?.id || null, user?.role || null, safeJson({ socketId: clientId, reason })]).catch(() => {});
        const leavePayload = { userId: user?.id || null, socketId: clientId, reason, timestamp: Date.now(), sessionId: sid };
        liveNS.to(`session:${sid}`).emit('participant.left', leavePayload);
        liveNS.to(`session:${sid}`).emit('live_session_updated', { action: 'left', ...leavePayload });
      }
      if (user?.id) {
        const presence = userPresence.get(Number(user.id));
        const socketCount = Math.max(0, Number(presence?.socketCount || 1) - 1);
        if (socketCount <= 0) {
          userPresence.delete(Number(user.id));
          upsertPresence(user, socket, 'offline', { activeSessionId: sid, socketCount: 0 }).catch(() => {});
          io.to(`user:${user.id}`).emit('student_updated', { userId: user.id, status: 'offline', lastSeenAt: new Date().toISOString(), activeSessionId: sid || null });
        } else {
          userPresence.set(Number(user.id), { ...presence, socketCount });
        }
      }
    });

    socket.on('reconnect.check', () => {
      socket.emit('reconnect.pong', { ts: Date.now(), sessionId: sid || null });
    });

    socket.on('ping', () => {
      socket.emit('pong', { ts: Date.now(), sessionId: sid || null });
    });

    socket.on('heartbeat.ping', () => {
      socket.emit('heartbeat.pong', { ts: Date.now(), sessionId: sid || null });
    });
  });

  ioInstance = io;
  console.log('[Socket Manager] initialized');
  return io;
}

module.exports = {
  initSocket,
  _getIo: () => ioInstance
};
