const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const cookie = require('cookie');
const jwt = require('jsonwebtoken');
const { verifySessionToken } = require('./../middleware/socketAuth');
const { pool } = require('../db/pool');
const { setBroadcaster } = require('../services/realtimeBus');

let ioInstance = null;

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
        // emit globally and to live-session namespace
        io.emit(type, { payload });
        io.of('/live-session').emit(type, { payload });
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
      // log join
      pool.query(`INSERT INTO live_session_logs (live_session_id, actor_user_id, actor_role, action, metadata) VALUES ((SELECT id FROM live_sessions WHERE session_id = $1 LIMIT 1), $2, $3, 'socket_join', $4::jsonb)`, [sid, user?.id || null, user?.role || null, safeJson({ socketId: clientId })]).catch(() => {});
      liveNS.to(`session:${sid}`).emit('participant.joined', { userId: user?.id || null, socketId: clientId, timestamp: Date.now() });
    }

    socket.on('presence.update', (payload = {}) => {
      const room = sid ? `session:${sid}` : null;
      persistPresence(sid, user, payload).then((stored) => {
        if (room) liveNS.to(room).emit('presence.updated', { userId: user?.id || null, payload: stored || payload });
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
          if (room) liveNS.to(room).emit('chat.message', { userId: user?.id || null, message: stored || { body: safeMessage.text }, timestamp: Date.now() });
        });
    });

    socket.on('reaction', (payload) => {
      const room = sid ? `session:${sid}` : null;
      persistReaction(sid, user, payload).then((stored) => {
        if (room) liveNS.to(room).emit('participant.reaction', { userId: user?.id || null, payload: stored || payload });
      });
    });

    socket.on('raise.hand', (payload) => {
      const room = sid ? `session:${sid}` : null;
      pool.query(`INSERT INTO live_session_logs (live_session_id, actor_user_id, actor_role, action, metadata) VALUES ((SELECT id FROM live_sessions WHERE session_id = $1 LIMIT 1), $2, $3, 'raise_hand', $4::jsonb)`, [sid, user?.id || null, user?.role || null, safeJson(payload)]).catch(() => {});
      if (room) liveNS.to(room).emit('participant.raised_hand', { userId: user?.id || null, payload });
    });

    socket.on('disconnect', (reason) => {
      if (sid) {
        pool.query(`INSERT INTO live_session_logs (live_session_id, actor_user_id, actor_role, action, metadata) VALUES ((SELECT id FROM live_sessions WHERE session_id = $1 LIMIT 1), $2, $3, 'socket_disconnect', $4::jsonb)`, [sid, user?.id || null, user?.role || null, safeJson({ socketId: clientId, reason })]).catch(() => {});
        liveNS.to(`session:${sid}`).emit('participant.left', { userId: user?.id || null, socketId: clientId, reason, timestamp: Date.now() });
      }
    });

    socket.on('reconnect.check', () => {
      socket.emit('reconnect.pong', { ts: Date.now() });
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
