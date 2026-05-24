const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const jwt = require('jsonwebtoken');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { createNotification } = require('../services/campusFeedService');
const {
  asyncHandler,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError
} = require('../middleware/errorHandler');
const dashboardRoutes = require('./dashboard');
const { publishRealtimeEvent, subscribeRealtime } = require('../services/realtimeBus');

const router = express.Router();

let schemaPromise = null;
let seededPromise = null;

const DEFAULT_HOST_WINDOW_MINUTES = Math.max(5, Number(process.env.LIVE_SESSION_HOST_WINDOW_MINUTES || 30));
const DEFAULT_SESSION_IDLE_MINUTES = Math.max(10, Number(process.env.LIVE_SESSION_IDLE_END_MINUTES || 45));
const DEFAULT_PRESENCE_POLL_SECONDS = Math.max(10, Number(process.env.LIVE_SESSION_PRESENCE_POLL_SECONDS || 20));
const DEFAULT_JITSI_DOMAIN = String(process.env.JITSI_DOMAIN || 'meet.jit.si').trim() || 'meet.jit.si';
const DEFAULT_PROVIDER = String(process.env.LIVE_SESSION_PROVIDER || 'jitsi').trim().toLowerCase() === 'agora' ? 'agora' : 'jitsi';
const LIVE_SESSION_TOKEN_SECRET = String(process.env.LIVE_SESSION_TOKEN_SECRET || process.env.SESSION_SECRET || 'unsafe-dev-secret');

function createHostFlowError(message, code, statusCode = 400, details = {}) {
  const error = new ValidationError(message, details);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nowIso() {
  return new Date().toISOString();
}

function generateSessionId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const token = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `LS-${stamp}-${token}`;
}

function generateHostCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  return `HC-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 10)}`;
}

function slugify(value, fallback = 'live-session') {
  const cleaned = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function deriveStatus(row) {
  const stored = normalizeLower(row?.status);
  if (stored === 'cancelled') return 'cancelled';
  if (stored === 'ended' || stored === 'completed') return 'ended';
  if (stored === 'live' || stored === 'active') return 'live';

  const start = parseDate(row?.scheduled_start || row?.scheduledStart);
  const end = parseDate(row?.scheduled_end || row?.scheduledEnd);
  const actualStart = parseDate(row?.actual_start || row?.actualStart);
  const actualEnd = parseDate(row?.actual_end || row?.actualEnd);
  const current = new Date();

  if (actualEnd) return 'ended';
  if (actualStart && !actualEnd) return 'live';
  if (start && current < start) return 'scheduled';
  if (end && current > end) return 'ended';
  return 'scheduled';
}

function statusLabel(status) {
  switch (normalizeLower(status)) {
    case 'live': return 'live';
    case 'ended': return 'ended';
    case 'cancelled': return 'cancelled';
    case 'scheduled':
    default: return 'scheduled';
  }
}

function normalizeProvider(value) {
  return normalizeLower(value) === 'agora' ? 'agora' : 'jitsi';
}

function mentorIdentityTokens(user) {
  return [user?.email, user?.full_name, user?.fullName, user?.uid, user?.id]
    .map((item) => normalizeLower(item))
    .filter(Boolean);
}

function computeMeetingRoom(row) {
  const sessionId = normalizeText(row.session_id || row.sessionId || generateSessionId());
  const title = normalizeText(row.title || 'Live Session');
  const existing = normalizeText(row.room_name || row.roomName || row.channel_name || row.channelName);
  if (existing) return existing;
  return `${slugify(title)}-${sessionId.toLowerCase()}`.slice(0, 96);
}

function liveSessionEventPayload(row, action, extra = {}) {
  return {
    action,
    sessionId: row?.session_id || row?.sessionId || null,
    session: row ? serializeSession(row) : null,
    participantCount: Number(row?.active_participant_count || row?.participant_count || 0),
    at: nowIso(),
    ...extra
  };
}

function signSessionToken(row, viewer, role = 'participant', expiresIn = '45m') {
  const sessionId = row?.session_id || row?.sessionId;
  if (!sessionId) return null;
  return jwt.sign(
    {
      sid: sessionId,
      uid: viewer?.id || null,
      role,
      purpose: 'live-session-join'
    },
    LIVE_SESSION_TOKEN_SECRET,
    {
      expiresIn,
      issuer: 'college-os',
      audience: 'live-session'
    }
  );
}

function verifySessionToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, LIVE_SESSION_TOKEN_SECRET, { issuer: 'college-os', audience: 'live-session' });
  } catch {
    return null;
  }
}

async function resolveAssignedHost(payload = {}, existingRow = null, { allowFallback = false } = {}) {
  const explicitHostReference = Boolean(
    payload.assignedHostUserRef
    || payload.assignedHostEmail
    || payload.assignedHostUserId
    || payload.mentorEmail
    || payload.mentorProfileKey
  );

  if (existingRow && !explicitHostReference) {
    return {
      assignedHostUserId: existingRow.assigned_host_user_id || existingRow.mentor_id || null,
      assignedHostEmail: existingRow.assigned_host_email || existingRow.mentor_email || null,
      assignedHostName: existingRow.mentor_name || 'College Mentor'
    };
  }

  const rawReference = normalizeText(
    payload.assignedHostUserRef
    || payload.assignedHostEmail
    || payload.assignedHostUserId
    || payload.mentorEmail
    || payload.mentorProfileKey
    || existingRow?.assigned_host_email
    || existingRow?.mentor_email
    || ''
  );

  if (!rawReference) {
    if (existingRow) {
      return {
        assignedHostUserId: existingRow.assigned_host_user_id || existingRow.mentor_id || null,
        assignedHostEmail: existingRow.assigned_host_email || existingRow.mentor_email || null,
        assignedHostName: existingRow.mentor_name || 'College Mentor'
      };
    }
    if (allowFallback) {
      return {
        assignedHostUserId: null,
        assignedHostEmail: null,
        assignedHostName: normalizeText(payload.mentorName) || 'College Mentor'
      };
    }
    throw createHostFlowError('assignedHostUserRef is required', 'ASSIGNED_HOST_REQUIRED', 400);
  }

  const lookup = await pool.query(
    `SELECT id, email, full_name, uid, role
     FROM users
     WHERE id = $1
        OR lower(email) = lower($2)
        OR lower(uid) = lower($2)
     LIMIT 1`,
    [Number(rawReference) || -1, rawReference]
  );

  const user = lookup.rows[0];
  if (!user) {
    if (allowFallback) {
      return {
        assignedHostUserId: null,
        assignedHostEmail: rawReference,
        assignedHostName: normalizeText(payload.mentorName) || 'College Mentor'
      };
    }
    throw createHostFlowError('Assigned host user not found.', 'ASSIGNED_HOST_NOT_FOUND', 404);
  }

  return {
    assignedHostUserId: user.id,
    assignedHostEmail: user.email,
    assignedHostName: user.full_name || payload.mentorName || 'College Mentor',
    assignedHostUid: user.uid || null,
    assignedHostRole: user.role || null
  };
}

function publishLiveSessionEvent(action, row, extra = {}) {
  const normalizedAction = normalizeLower(action) || 'changed';
  const payload = liveSessionEventPayload(row, action, extra);

  // Legacy event names kept for backward compatibility.
  publishRealtimeEvent('live_session_changed', payload);
  publishRealtimeEvent(`live_session_${normalizedAction}`, payload);

  // Startup-grade explicit lifecycle names.
  const modernActionMap = {
    started: 'started',
    ended: 'ended',
    updated: 'updated',
    rescheduled: 'updated',
    cancelled: 'updated',
    host_unlocked: 'host.unlocked'
  };
  const modernAction = modernActionMap[normalizedAction] || normalizedAction.replace(/_/g, '.');
  publishRealtimeEvent(`session.${modernAction}`, payload);

  // Always emit a generic updated signal so student list UIs can refresh safely.
  if (modernAction !== 'updated') {
    publishRealtimeEvent('session.updated', payload);
  }
}

async function notifyLiveSessionAudience(row, kind, message, { includeMentor = true, includeParticipants = true } = {}) {
  if (!row) return;

  const recipientIds = new Set();
  if (includeMentor && row.mentor_id) {
    recipientIds.add(Number(row.mentor_id));
  }

  if (includeParticipants) {
    const { rows } = await pool.query(
      `SELECT DISTINCT user_id
       FROM live_session_participants
       WHERE live_session_id = $1
         AND left_at IS NULL
         AND user_id IS NOT NULL`,
      [row.id]
    );

    for (const participant of rows) {
      if (participant.user_id) {
        recipientIds.add(Number(participant.user_id));
      }
    }
  }

  await Promise.allSettled(
    [...recipientIds]
      .filter(Boolean)
      .map((userId) => createNotification(userId, kind, message))
  );
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS live_sessions (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        session_id VARCHAR(120) NOT NULL UNIQUE,
        title VARCHAR(220) NOT NULL,
        description TEXT,
        assigned_host_user_id INTEGER REFERENCES users(id),
        assigned_host_email VARCHAR(180),
        mentor_id INTEGER REFERENCES users(id),
        mentor_email VARCHAR(180),
        mentor_name VARCHAR(180) NOT NULL,
        session_type VARCHAR(40) NOT NULL DEFAULT 'mentorship',
        provider VARCHAR(20) NOT NULL DEFAULT 'jitsi',
        room_name VARCHAR(180) NOT NULL,
        channel_name VARCHAR(180) NOT NULL,
        mentor_live_code_hash VARCHAR(255),
        mentor_live_code_last4 VARCHAR(8),
        host_code_plain VARCHAR(120),
        host_code_generated_at TIMESTAMP,
        host_code_hash VARCHAR(255) NOT NULL,
        host_code_last4 VARCHAR(8),
        host_code_attempts INTEGER NOT NULL DEFAULT 0,
        host_code_locked_until TIMESTAMP,
        scheduled_start TIMESTAMP NOT NULL,
        scheduled_end TIMESTAMP NOT NULL,
        actual_start TIMESTAMP,
        actual_end TIMESTAMP,
        status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
        mentor_status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
        created_by_admin INTEGER REFERENCES users(id),
        max_participants INTEGER NOT NULL DEFAULT 100,
        participant_count INTEGER NOT NULL DEFAULT 0,
        cancelled_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        cancelled_at TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_live_sessions_status_start
        ON live_sessions (status, scheduled_start);
      CREATE INDEX IF NOT EXISTS idx_live_sessions_mentor_email
        ON live_sessions (mentor_email, scheduled_start);
      CREATE INDEX IF NOT EXISTS idx_live_sessions_mentor_id
        ON live_sessions (mentor_id, scheduled_start);
      CREATE INDEX IF NOT EXISTS idx_live_sessions_assigned_host_user_id
        ON live_sessions (assigned_host_user_id, scheduled_start);
      CREATE INDEX IF NOT EXISTS idx_live_sessions_assigned_host_email
        ON live_sessions (assigned_host_email, scheduled_start);
      CREATE INDEX IF NOT EXISTS idx_live_sessions_room_name
        ON live_sessions (room_name);

      CREATE TABLE IF NOT EXISTS live_session_participants (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        live_session_id INTEGER NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id),
        user_email VARCHAR(180),
        user_name VARCHAR(180),
        role VARCHAR(20) NOT NULL DEFAULT 'student',
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        left_at TIMESTAMP,
        connection_state VARCHAR(20) NOT NULL DEFAULT 'joined',
        meta JSONB,
        UNIQUE (live_session_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_live_session_participants_session
        ON live_session_participants (live_session_id, left_at);
      CREATE INDEX IF NOT EXISTS idx_live_session_participants_user
        ON live_session_participants (user_id, joined_at);

      CREATE TABLE IF NOT EXISTS live_session_presence (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        live_session_id INTEGER NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_email VARCHAR(180),
        user_name VARCHAR(180),
        status VARCHAR(20) NOT NULL DEFAULT 'online',
        is_typing BOOLEAN NOT NULL DEFAULT FALSE,
        is_present BOOLEAN NOT NULL DEFAULT TRUE,
        device_info JSONB,
        meta JSONB,
        last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (live_session_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_live_session_presence_session
        ON live_session_presence (live_session_id, status, last_seen_at DESC);

      CREATE TABLE IF NOT EXISTS live_session_messages (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        live_session_id INTEGER NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        user_email VARCHAR(180),
        user_name VARCHAR(180),
        role VARCHAR(20) NOT NULL DEFAULT 'student',
        message_type VARCHAR(20) NOT NULL DEFAULT 'message',
        body TEXT NOT NULL,
        reaction VARCHAR(40),
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        meta JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_live_session_messages_session
        ON live_session_messages (live_session_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_live_session_messages_user
        ON live_session_messages (user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS live_session_logs (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        live_session_id INTEGER NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
        actor_user_id INTEGER REFERENCES users(id),
        actor_role VARCHAR(30),
        action VARCHAR(50) NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_live_session_logs_session
        ON live_session_logs (live_session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_live_session_logs_action
        ON live_session_logs (action, created_at DESC);

      CREATE TABLE IF NOT EXISTS live_session_recordings (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        live_session_id INTEGER NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
        provider VARCHAR(20) NOT NULL DEFAULT 'jitsi',
        recording_url TEXT,
        recording_status VARCHAR(20) NOT NULL DEFAULT 'pending',
        metadata JSONB,
        started_at TIMESTAMP,
        ended_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_live_session_recordings_session
        ON live_session_recordings (live_session_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS live_session_tokens (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        live_session_id INTEGER NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
        jti VARCHAR(128) NOT NULL UNIQUE,
        user_id INTEGER REFERENCES users(id),
        purpose VARCHAR(60) NOT NULL DEFAULT 'join',
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN NOT NULL DEFAULT FALSE,
        used_by_user_id INTEGER REFERENCES users(id),
        used_at TIMESTAMP,
        meta JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_live_session_tokens_session
        ON live_session_tokens (live_session_id, expires_at DESC);
    `);

    await pool.query(`ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS assigned_host_user_id INTEGER REFERENCES users(id)`);
    await pool.query(`ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS assigned_host_email VARCHAR(180)`);
    await pool.query(`ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS mentor_live_code_hash VARCHAR(255)`);
    await pool.query(`ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS mentor_live_code_last4 VARCHAR(8)`);
    await pool.query(`ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS host_code_plain VARCHAR(120)`);
    await pool.query(`ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS host_code_generated_at TIMESTAMP`);
    await pool.query(`ALTER TABLE live_session_tokens ADD COLUMN IF NOT EXISTS used_by_user_id INTEGER REFERENCES users(id)`);
    await pool.query(`ALTER TABLE live_session_tokens ADD COLUMN IF NOT EXISTS used_at TIMESTAMP`);
    await pool.query(`ALTER TABLE live_session_tokens ADD COLUMN IF NOT EXISTS used_by_meta JSONB`);
  }

  await schemaPromise;
}

async function readExperienceConfig() {
  if (typeof dashboardRoutes.readStudentExperienceConfig === 'function') {
    return dashboardRoutes.readStudentExperienceConfig();
  }

  const result = await pool.query("SELECT value_json FROM platform_settings WHERE key = 'student_experience_config' LIMIT 1");
  return result.rows[0]?.value_json || {};
}

async function ensureSeeded() {
  if (seededPromise) return seededPromise;

  seededPromise = (async () => {
    await ensureSchema();
    const existing = await pool.query('SELECT COUNT(*)::int AS total FROM live_sessions');
    if (existing.rows[0]?.total > 0) return;

    const config = await readExperienceConfig();
    const sessions = Array.isArray(config?.liveHub?.sessions) ? config.liveHub.sessions : [];
    if (!sessions.length) return;

    for (const session of sessions) {
      const sessionId = normalizeText(session.id) || generateSessionId();
      const title = normalizeText(session.title) || 'Live Session';
      const mentorName = normalizeText(session.mentorName) || 'College Mentor';
      const mentorEmail = normalizeText(session.assignedHostEmail || session.mentorEmail || session.mentorProfileKey || '');
      const provider = normalizeProvider(session.provider || config?.liveHub?.defaultProvider || DEFAULT_PROVIDER);
      const scheduledStart = parseDate(session.startAt || session.scheduledStart) || new Date();
      const durationMinutes = Math.max(15, toInt(session.durationMinutes || 60, 60));
      const scheduledEnd = parseDate(session.endAt || session.scheduledEnd) || new Date(scheduledStart.getTime() + durationMinutes * 60000);
      const roomName = computeMeetingRoom({ session_id: sessionId, title, room_name: session.roomId || session.roomName || session.channelName });
      const hostCode = normalizeText(session.mentorAccessId || session.hostCode || generateHostCode());
      const hash = await bcrypt.hash(hostCode, 10);
      const hostCodeLast4 = hostCode.slice(-4);
      const mentorIdResult = mentorEmail ? await pool.query('SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1', [mentorEmail]) : { rows: [] };
      const mentorId = mentorIdResult.rows[0]?.id || null;
      await pool.query(
        `INSERT INTO live_sessions (
          session_id, title, description, assigned_host_user_id, assigned_host_email, mentor_id, mentor_email, mentor_name, session_type,
          provider, room_name, channel_name, mentor_live_code_hash, mentor_live_code_last4, host_code_hash, host_code_last4,
          scheduled_start, scheduled_end, status, mentor_status, created_by_admin, max_participants, participant_count,
          created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,
          $10,$11,$12,$13,$14,$15,$16,
          $17,$18,$19,$20,$21,$22,$23,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT (session_id) DO NOTHING`,
        [
          sessionId,
          title,
          normalizeText(session.summary || session.description || ''),
          mentorId,
          mentorEmail || null,
          mentorId,
          mentorEmail || null,
          mentorName,
          normalizeText(session.type || 'mentorship'),
          provider,
          roomName,
          roomName,
          hash,
          hostCodeLast4,
          hash,
          hostCodeLast4,
          scheduledStart,
          scheduledEnd,
          normalizeLower(session.status || 'scheduled'),
          normalizeLower(session.status || 'scheduled'),
          null,
          Math.max(10, toInt(session.maxParticipants || 100, 100)),
          0
        ]
      );
    }
  })();

  return seededPromise;
}

async function getUserContext(userId) {
  const { rows } = await pool.query(
    'SELECT id, role, email, full_name, uid, admin_role FROM users WHERE id = $1 LIMIT 1',
    [userId]
  );
  return rows[0] || null;
}

async function getSessionRecord(sessionId) {
  await ensureSeeded();
  const { rows } = await pool.query(
    `SELECT
      ls.*,
      COALESCE(participants.active_count, 0)::int AS active_participant_count,
      COALESCE(presence.active_count, 0)::int AS active_presence_count,
      COALESCE(messages.message_count, 0)::int AS live_message_count,
      COALESCE(activity.event_count, 0)::int AS live_activity_count
     FROM live_sessions ls
     LEFT JOIN (
       SELECT live_session_id, COUNT(*)::int AS active_count
       FROM live_session_participants
       WHERE left_at IS NULL
       GROUP BY live_session_id
     ) participants ON participants.live_session_id = ls.id
     LEFT JOIN (
       SELECT live_session_id, COUNT(*)::int AS active_count
       FROM live_session_presence
       WHERE is_present = TRUE
       GROUP BY live_session_id
     ) presence ON presence.live_session_id = ls.id
     LEFT JOIN (
       SELECT live_session_id, COUNT(*)::int AS message_count
       FROM live_session_messages
       GROUP BY live_session_id
     ) messages ON messages.live_session_id = ls.id
     LEFT JOIN (
       SELECT live_session_id, COUNT(*)::int AS event_count
       FROM live_session_logs
       GROUP BY live_session_id
     ) activity ON activity.live_session_id = ls.id
     WHERE ls.session_id = $1
     LIMIT 1`,
    [sessionId]
  );
  return rows[0] || null;
}

function serializeSession(row, viewer = null, options = {}) {
  if (!row) return null;
  const status = deriveStatus(row);
  const scheduledStart = row.scheduled_start || row.scheduledStart;
  const scheduledEnd = row.scheduled_end || row.scheduledEnd;
  const actualStart = row.actual_start || row.actualStart || null;
  const actualEnd = row.actual_end || row.actualEnd || null;
  const isHostAssigned = Boolean(viewer) && (
    normalizeLower(viewer.role) === 'admin' ||
    normalizeLower(viewer.role) === 'super_admin' ||
    mentorIdentityTokens(viewer).includes(normalizeLower(row.assigned_host_email || row.mentor_email)) ||
    String(viewer.id || '') === String(row.assigned_host_user_id || row.mentor_id || '')
  );
  const isAdmin = Boolean(viewer) && (normalizeLower(viewer.role) === 'admin' || normalizeLower(viewer.role) === 'super_admin');
  const hostUnlocked = Boolean(options.hostUnlocked);
  const canControl = isAdmin || (isHostAssigned && hostUnlocked);
  const canUnlockHostMode = !isAdmin && isHostAssigned && !hostUnlocked;
  const hostCode = isAdmin ? normalizeText(row.host_code_plain || row.mentor_live_code_plain || '') : '';
  const hostCodePreview = isAdmin ? (hostCode || (row.host_code_last4 ? `••••${row.host_code_last4}` : '')) : (row.host_code_last4 ? `••••${row.host_code_last4}` : '');
  const codeGenerated = Boolean(row.host_code_plain || row.host_code_hash || row.mentor_live_code_hash);
  return {
    id: row.session_id,
    sessionId: row.session_id,
    title: row.title,
    description: row.description || '',
    assignedHostUserId: row.assigned_host_user_id || null,
    assignedHostEmail: row.assigned_host_email || '',
    mentorId: row.mentor_id || null,
    mentorEmail: row.mentor_email || '',
    mentorName: row.mentor_name || '',
    sessionType: row.session_type || 'mentorship',
    provider: normalizeProvider(row.provider),
    roomName: row.room_name,
    channelName: row.channel_name,
    scheduledStart,
    scheduledEnd,
    actualStart,
    actualEnd,
    status,
    statusLabel: statusLabel(status),
    hostStarted: Boolean(actualStart),
    meetingStarted: status === 'live',
    isLive: status === 'live',
    mentorStatus: row.mentor_status || status,
    createdByAdmin: row.created_by_admin || null,
    maxParticipants: Number(row.max_participants || 0),
    participantCount: Number(row.active_participant_count || row.participant_count || 0),
    presenceCount: Number(row.active_presence_count || 0),
    liveMessageCount: Number(row.live_message_count || 0),
    liveActivityCount: Number(row.live_activity_count || 0),
    mentorLiveCodeLast4: row.mentor_live_code_last4 || row.host_code_last4 || '',
    hostCodeLast4: row.host_code_last4 || '',
    mentorLiveCode: hostCode,
    assignedHostCode: hostCode,
    hostCode,
    hostCodePreview,
    codeGenerated,
    lastGeneratedAt: row.host_code_generated_at || null,
    canControl,
    hostModeAvailable: isHostAssigned,
    hostUnlocked,
    canUnlockHostMode,
    joinWindowMinutes: DEFAULT_HOST_WINDOW_MINUTES,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancelledAt: row.cancelled_at || null,
    cancelledReason: row.cancelled_reason || '',
    jitsiDomain: DEFAULT_JITSI_DOMAIN
  };
}

function hostUnlockStore(req) {
  if (!req?.session) return {};
  if (!req.session.liveHostUnlock) {
    req.session.liveHostUnlock = {};
  }
  return req.session.liveHostUnlock;
}

function isHostSessionUnlocked(req, sessionId, viewer) {
  if (!req?.session || !sessionId || !viewer?.id) return false;
  const store = hostUnlockStore(req);
  const record = store[sessionId];
  if (!record) return false;
  if (String(record.userId || '') !== String(viewer.id || '')) return false;
  const unlockedAt = parseDate(record.unlockedAt);
  if (!unlockedAt) return false;
  const staleMs = 2 * 60 * 60 * 1000;
  if ((Date.now() - unlockedAt.getTime()) > staleMs) {
    delete store[sessionId];
    return false;
  }
  return true;
}

function markHostSessionUnlocked(req, sessionId, viewer) {
  if (!req?.session || !sessionId || !viewer?.id) return;
  const store = hostUnlockStore(req);
  store[sessionId] = {
    userId: viewer.id,
    unlockedAt: nowIso()
  };
}

function clearHostSessionUnlocked(req, sessionId) {
  if (!req?.session || !sessionId) return;
  const store = hostUnlockStore(req);
  delete store[sessionId];
}

function serializeSessionForRequest(row, viewer, req) {
  const unlocked = isHostSessionUnlocked(req, row?.session_id || row?.sessionId || '', viewer);
  return serializeSession(row, viewer, { hostUnlocked: unlocked });
}

function assertRoleCanManage(user, row) {
  const role = normalizeLower(user?.role);
  if (role === 'admin' || role === 'super_admin') return true;
  return Boolean(
    row && (
      normalizeLower(row.assigned_host_email || row.mentor_email) === normalizeLower(user?.email) ||
      String(row.assigned_host_user_id || row.mentor_id || '') === String(user?.id || '')
    )
  );
}

function assertMentorAssignment(user, row) {
  if (!row) return false;
  if (normalizeLower(user?.role) === 'admin' || normalizeLower(user?.role) === 'super_admin') return true;
  const tokens = mentorIdentityTokens(user);
  return tokens.includes(normalizeLower(row.assigned_host_email || row.mentor_email)) || String(user?.id || '') === String(row.assigned_host_user_id || row.mentor_id || '');
}

async function writeLog(sessionDbId, actor, action, metadata = {}) {
  await pool.query(
    `INSERT INTO live_session_logs (live_session_id, actor_user_id, actor_role, action, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [sessionDbId, actor?.id || null, actor?.role || null, action, JSON.stringify(metadata)]
  );
}

async function recordSessionMessage(row, viewer, payload = {}, { isSystem = false } = {}) {
  const body = normalizeText(payload.body || payload.message || payload.text || '');
  if (!body) {
    throw createHostFlowError('Message body is required.', 'MESSAGE_REQUIRED', 400);
  }

  const message = {
    live_session_id: row.id,
    user_id: viewer?.id || null,
    user_email: normalizeText(viewer?.email || ''),
    user_name: normalizeText(viewer?.full_name || viewer?.fullName || viewer?.email || 'Participant'),
    role: payload.role || (assertMentorAssignment(viewer, row) ? 'host' : 'participant'),
    message_type: normalizeText(payload.messageType || 'message').toLowerCase() || 'message',
    body,
    reaction: normalizeText(payload.reaction || ''),
    is_system: Boolean(isSystem || payload.isSystem),
    meta: JSON.stringify(payload.meta || {})
  };

  const { rows } = await pool.query(
    `INSERT INTO live_session_messages (
      live_session_id, user_id, user_email, user_name, role, message_type, body, reaction, is_system, meta
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
    RETURNING *`,
    [
      message.live_session_id,
      message.user_id,
      message.user_email || null,
      message.user_name,
      message.role,
      message.message_type,
      message.body,
      message.reaction || null,
      message.is_system,
      message.meta
    ]
  );

  const stored = rows[0];
  await writeLog(row.id, viewer, 'chat_message', { messageType: message.message_type, reaction: message.reaction || null });
  publishLiveSessionEvent('chat_message', row, { message: stored, userId: viewer?.id || null });
  return stored;
}

async function recordPresence(row, viewer, payload = {}) {
  const status = normalizeLower(payload.status || 'online') === 'offline' ? 'offline' : 'online';
  const isTyping = Boolean(payload.isTyping);
  const isPresent = payload.isPresent !== false;
  const deviceInfo = payload.deviceInfo || payload.device || null;
  const meta = payload.meta || {};

  const { rows } = await pool.query(
    `INSERT INTO live_session_presence (
      live_session_id, user_id, user_email, user_name, status, is_typing, is_present, device_info, meta, last_seen_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT (live_session_id, user_id)
    DO UPDATE SET
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
    [
      row.id,
      viewer?.id || null,
      normalizeText(viewer?.email || ''),
      normalizeText(viewer?.full_name || viewer?.fullName || viewer?.email || 'Participant'),
      status,
      isTyping,
      isPresent,
      JSON.stringify(deviceInfo),
      JSON.stringify(meta)
    ]
  );

  const stored = rows[0];
  await writeLog(row.id, viewer, 'presence_update', { status, isTyping, isPresent });
  publishLiveSessionEvent('presence', row, { presence: stored, userId: viewer?.id || null });
  return stored;
}

async function fetchSessionPresence(row) {
  const { rows } = await pool.query(
    `SELECT user_id, user_email, user_name, status, is_typing, is_present, last_seen_at, updated_at
     FROM live_session_presence
     WHERE live_session_id = $1
     ORDER BY is_present DESC, last_seen_at DESC`,
    [row.id]
  );
  return rows;
}

async function fetchSessionMessages(row, limit = 50) {
  const { rows } = await pool.query(
    `SELECT id, user_id, user_email, user_name, role, message_type, body, reaction, is_system, created_at
     FROM live_session_messages
     WHERE live_session_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [row.id, Math.max(1, Math.min(200, limit))]
  );
  return rows.reverse();
}

async function fetchSessionActivity(row, limit = 100) {
  const { rows } = await pool.query(
    `SELECT id, actor_user_id, actor_role, action, metadata, created_at
     FROM live_session_logs
     WHERE live_session_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [row.id, Math.max(1, Math.min(200, limit))]
  );
  return rows.reverse();
}

async function computeEngagementScore(row) {
  const { rows } = await pool.query(
    `SELECT
      COALESCE(COUNT(*) FILTER (WHERE left_at IS NULL), 0)::int AS active_participants,
      COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(left_at, CURRENT_TIMESTAMP) - joined_at))), 0)::int AS attendance_seconds
     FROM live_session_participants
     WHERE live_session_id = $1`,
    [row.id]
  );
  const activeParticipants = Number(rows[0]?.active_participants || 0);
  const attendanceSeconds = Number(rows[0]?.attendance_seconds || 0);
  const durationMinutes = Math.max(1, Math.round((attendanceSeconds / 60) || 1));
  return Math.min(100, Math.round((activeParticipants * 24) + Math.min(40, durationMinutes / 4)));
}

async function refreshDerivedSessionMetrics(row) {
  if (!row) return null;
  const engagementScore = await computeEngagementScore(row);
  const timelineCount = await pool.query('SELECT COUNT(*)::int AS total FROM live_session_logs WHERE live_session_id = $1', [row.id]);
  const presence = await pool.query('SELECT COUNT(*)::int AS total FROM live_session_presence WHERE live_session_id = $1 AND is_present = TRUE', [row.id]);
  return {
    engagementScore,
    timelineEvents: Number(timelineCount.rows[0]?.total || 0),
    activePresence: Number(presence.rows[0]?.total || 0)
  };
}

async function autoResolveSessions() {
  await ensureSeeded();
  const { rows } = await pool.query(
    `SELECT *
     FROM live_sessions
     WHERE status = 'live'
       AND actual_start IS NOT NULL
       AND (actual_end IS NULL OR actual_end > actual_start)
       AND COALESCE(actual_end, CURRENT_TIMESTAMP) < CURRENT_TIMESTAMP - INTERVAL '${DEFAULT_SESSION_IDLE_MINUTES} minutes'
       AND participant_count = 0`
  );

  for (const row of rows) {
    await pool.query(
      `UPDATE live_sessions
       SET status = 'ended', mentor_status = 'ended', actual_end = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [row.id]
    );
    await writeLog(row.id, { id: null, role: 'system' }, 'auto_end_inactive', { idleMinutes: DEFAULT_SESSION_IDLE_MINUTES });
    publishLiveSessionEvent('ended', row, { system: true, autoEnded: true });
    await notifyLiveSessionAudience(row, 'live_session_ended', `${row.title} ended automatically after inactivity.`, { includeParticipants: true });
  }
  // Cleanup expired tokens older than 1 day and write audit logs
  try {
    const { rows: expired } = await pool.query(
      `SELECT id, live_session_id, jti, user_id, expires_at FROM live_session_tokens WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day'`);
    if (expired && expired.length) {
      for (const t of expired) {
        await pool.query(`INSERT INTO live_session_logs (live_session_id, actor_user_id, actor_role, action, metadata) VALUES ($1, $2, $3, 'token_expired_cleanup', $4::jsonb)`, [t.live_session_id, t.user_id || null, null, JSON.stringify({ jti: t.jti, expiresAt: t.expires_at })]);
      }
      await pool.query(`DELETE FROM live_session_tokens WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day'`);
    }
  } catch (e) {
    console.warn('[Live Session Maintenance] token cleanup failed', e && e.message);
  }
}

async function refreshParticipantCount(sessionDbId) {
  const result = await pool.query(
    `UPDATE live_sessions
     SET participant_count = COALESCE((
       SELECT COUNT(*)
       FROM live_session_participants
       WHERE live_session_id = $1 AND left_at IS NULL
     ), 0), updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [sessionDbId]
  );
  return result.rows[0] || null;
}

async function fetchSessionList(viewer, { includeEnded = true, scope = 'student', serialize = true } = {}) {
  await ensureSeeded();
  const role = normalizeLower(viewer?.role);
  const conditions = ['1=1'];
  const params = [];

  // Student portals must receive global live/upcoming sessions.
  // Scope=host narrows to assigned host sessions for convenience.
  if (role !== 'admin' && role !== 'super_admin' && normalizeLower(scope) === 'host') {
    if (viewer?.email || viewer?.id) {
      params.push(String(viewer?.email || '').toLowerCase());
      params.push(viewer?.id || -1);
      conditions.push(`(lower(COALESCE(assigned_host_email, mentor_email)) = $${params.length - 1} OR COALESCE(assigned_host_user_id, mentor_id) = $${params.length})`);
    }
  }

  if (!includeEnded) {
    conditions.push("status <> 'ended'");
    conditions.push("status <> 'cancelled'");
  }

  const { rows } = await pool.query(
    `SELECT
      ls.*,
      COALESCE(participants.active_count, 0)::int AS active_participant_count
     FROM live_sessions ls
     LEFT JOIN (
       SELECT live_session_id, COUNT(*)::int AS active_count
       FROM live_session_participants
       WHERE left_at IS NULL
       GROUP BY live_session_id
     ) participants ON participants.live_session_id = ls.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY ls.scheduled_start ASC, ls.created_at DESC`,
    params
  );

  return serialize ? rows.map((row) => serializeSession(row, viewer)) : rows;
}

async function ensureNoTimeConflict({ scheduledStart, scheduledEnd, sessionId = null, mentorEmail = '', mentorId = null }) {
  const { rows } = await pool.query(
    `SELECT session_id, title
     FROM live_sessions
     WHERE status <> 'cancelled'
       AND ($1::timestamp < scheduled_end AND $2::timestamp > scheduled_start)
       AND ($3::text IS NULL OR session_id <> $3)
       AND (COALESCE(assigned_host_email, mentor_email) IS NULL OR lower(COALESCE(assigned_host_email, mentor_email)) = lower($4) OR COALESCE(assigned_host_user_id, mentor_id) IS NULL OR COALESCE(assigned_host_user_id, mentor_id) = $5)` ,
    [scheduledStart, scheduledEnd, sessionId, mentorEmail || '', mentorId || null]
  );

  if (rows.length) {
    throw new ConflictError('Duplicate live session detected for the same schedule window.');
  }
}

async function saveSessionFromPayload(payload, actor, existingRow = null, { isCreate = false } = {}) {
  const title = normalizeText(payload.title);
  if (!title) throw new ValidationError('title is required');

  const description = normalizeText(payload.description || payload.summary || '');
  const mentorName = normalizeText(payload.mentorName) || 'College Mentor';
  const hostAssignment = await resolveAssignedHost(payload, existingRow, { allowFallback: Boolean(payload.allowUnresolvedHost) });
  const mentorEmail = normalizeText(hostAssignment.assignedHostEmail || payload.mentorEmail || '');
  const mentorId = hostAssignment.assignedHostUserId || (payload.mentorId ? toInt(payload.mentorId, null) : null);
  const provider = normalizeProvider(payload.provider || DEFAULT_PROVIDER);
  const sessionType = normalizeText(payload.sessionType || payload.type || 'mentorship').toLowerCase() === 'lab' ? 'lab' : 'mentorship';
  const maxParticipants = Math.max(1, toInt(payload.maxParticipants || 100, 100));
  const scheduledStart = parseDate(payload.scheduledStart || payload.startAt || payload.startDate);
  const scheduledEnd = parseDate(payload.scheduledEnd || payload.endAt || payload.endDate);
  if (!scheduledStart || !scheduledEnd) throw new ValidationError('scheduledStart and scheduledEnd are required');
  if (scheduledEnd <= scheduledStart) throw new ValidationError('scheduledEnd must be after scheduledStart');

  const roomName = computeMeetingRoom({
    session_id: existingRow?.session_id || payload.sessionId || generateSessionId(),
    title,
    room_name: payload.roomName || payload.channelName || payload.roomId || ''
  });

  const channelName = normalizeText(payload.channelName || payload.roomName || payload.roomId || roomName) || roomName;
  const sessionId = normalizeText(payload.sessionId || existingRow?.session_id || generateSessionId()) || generateSessionId();
  const status = normalizeLower(payload.status || existingRow?.status || 'scheduled');
  const mentorStatus = status === 'live' ? 'live' : status === 'ended' ? 'ended' : status === 'cancelled' ? 'cancelled' : 'scheduled';
  const existingHostCode = normalizeText(existingRow?.host_code_plain || '');
  const incomingHostCode = normalizeText(payload.hostCode || payload.hostCodePlain || payload.mentorLiveCode || '');
  const hostCode = incomingHostCode || existingHostCode || generateHostCode();
  const shouldRotateHostCode = Boolean(incomingHostCode) || !existingHostCode || isCreate;
  const liveCodeHash = shouldRotateHostCode ? await bcrypt.hash(hostCode, 10) : (existingRow?.mentor_live_code_hash || existingRow?.host_code_hash || null);
  const liveCodeLast4 = shouldRotateHostCode ? hostCode.slice(-4) : (existingRow?.mentor_live_code_last4 || existingRow?.host_code_last4 || null);
  const hostCodeGeneratedAt = shouldRotateHostCode ? nowIso() : (existingRow?.host_code_generated_at || null);

  await ensureNoTimeConflict({
    scheduledStart,
    scheduledEnd,
    sessionId: isCreate ? null : sessionId,
    mentorEmail,
    mentorId
  });

  if (isCreate) {
    const inserted = await pool.query(
      `INSERT INTO live_sessions (
        session_id, title, description, assigned_host_user_id, assigned_host_email, mentor_id, mentor_email, mentor_name, session_type, provider,
        room_name, channel_name, mentor_live_code_hash, mentor_live_code_last4, host_code_plain, host_code_generated_at, host_code_hash, host_code_last4, scheduled_start, scheduled_end,
        actual_start, actual_end, status, mentor_status, created_by_admin, max_participants,
        participant_count, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,
        0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *`,
      [
        sessionId,
        title,
        description,
        mentorId,
        mentorEmail || null,
        mentorId,
        mentorEmail || null,
        hostAssignment.assignedHostName || mentorName,
        sessionType,
        provider,
        roomName,
        channelName,
        liveCodeHash || (await bcrypt.hash(generateHostCode(), 10)),
        liveCodeLast4 || null,
        hostCode,
        hostCodeGeneratedAt,
        liveCodeHash || (await bcrypt.hash(generateHostCode(), 10)),
        liveCodeLast4 || null,
        scheduledStart,
        scheduledEnd,
        null,
        null,
        status,
        mentorStatus,
        actor?.role === 'admin' || actor?.role === 'super_admin' ? actor.id : null,
        maxParticipants
      ]
    );
    await writeLog(inserted.rows[0].id, actor, 'create', { provider, sessionId, scheduledStart, scheduledEnd });
    await notifyLiveSessionAudience(inserted.rows[0], 'live_session_scheduled', `${title} has been scheduled for ${scheduledStart.toLocaleString('en-IN')}.`, { includeParticipants: false });
    return { row: inserted.rows[0], hostCode: hostCode || null };
  }

  const updated = await pool.query(
    `UPDATE live_sessions
     SET title = $2,
         description = $3,
         assigned_host_user_id = $4,
         assigned_host_email = $5,
         mentor_id = $4,
         mentor_email = $5,
         mentor_name = $6,
         session_type = $7,
         provider = $8,
         room_name = $9,
         channel_name = $10,
         mentor_live_code_hash = COALESCE($11, mentor_live_code_hash),
         mentor_live_code_last4 = COALESCE($12, mentor_live_code_last4),
         host_code_plain = COALESCE($13, host_code_plain),
         host_code_generated_at = COALESCE($14, host_code_generated_at),
         host_code_hash = COALESCE($15, host_code_hash),
         host_code_last4 = COALESCE($16, host_code_last4),
         scheduled_start = $17,
         scheduled_end = $18,
         status = $19,
         mentor_status = $20,
         max_participants = $21,
         updated_at = CURRENT_TIMESTAMP
     WHERE session_id = $1
     RETURNING *`,
    [
      sessionId,
      title,
      description,
      mentorId || existingRow?.assigned_host_user_id || existingRow?.mentor_id || null,
      mentorEmail || existingRow?.assigned_host_email || existingRow?.mentor_email || null,
      hostAssignment.assignedHostName || mentorName,
      sessionType,
      provider,
      roomName,
      channelName,
      liveCodeHash || null,
      liveCodeLast4 || null,
      hostCode,
      hostCodeGeneratedAt,
      liveCodeHash || null,
      liveCodeLast4 || null,
      scheduledStart,
      scheduledEnd,
      status,
      mentorStatus,
      maxParticipants
    ]
  );

  if (!updated.rows[0]) throw new NotFoundError('Live session');
  await writeLog(updated.rows[0].id, actor, 'update', { provider, sessionId, scheduledStart, scheduledEnd });
  await notifyLiveSessionAudience(updated.rows[0], 'live_session_updated', `${title} has been updated and now starts at ${scheduledStart.toLocaleString('en-IN')}.`, { includeParticipants: false });
  return { row: updated.rows[0], hostCode: hostCode || null };
}

async function verifyHostCode(row, hostCode) {
  if (!hostCode) {
    throw createHostFlowError('Host code is required.', 'HOST_CODE_REQUIRED', 400);
  }
  const lockedUntil = parseDate(row.host_code_locked_until);
  if (lockedUntil && lockedUntil > new Date()) {
    throw createHostFlowError('Host code is temporarily locked due to repeated failures.', 'HOST_CODE_LOCKED', 423);
  }
  const hash = row.mentor_live_code_hash || row.host_code_hash;
  const matches = hash ? await bcrypt.compare(hostCode, hash) : false;
  if (!matches) {
    const attempts = (row.host_code_attempts || 0) + 1;
    const locked = attempts >= 5 ? new Date(Date.now() + 10 * 60 * 1000) : null;
    await pool.query(
      `UPDATE live_sessions
       SET host_code_attempts = $2,
           host_code_locked_until = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [row.id, attempts, locked]
    );
    await writeLog(row.id, { id: null, role: 'system' }, 'host_code_failed', { attempts });
    throw createHostFlowError('Invalid host code.', 'INVALID_HOST_CODE', 400);
  }

  await pool.query(
    `UPDATE live_sessions
     SET host_code_attempts = 0,
         host_code_locked_until = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [row.id]
  );
  return true;
}

function buildJoinContext(row, viewer, roleOverride = null) {
  const role = roleOverride || (normalizeLower(viewer?.role) === 'admin' || normalizeLower(viewer?.role) === 'super_admin' || assertMentorAssignment(viewer, row) ? 'host' : 'participant');
  const provider = normalizeProvider(row.provider);
  const meetingBase = process.env.BACKEND_URL || process.env.FRONTEND_URL || '';
  const joinToken = signSessionToken(row, viewer, role, '45m');
  const meetingUrl = provider === 'jitsi'
    ? `https://${DEFAULT_JITSI_DOMAIN}/${encodeURIComponent(row.room_name)}`
    : '';

  return {
    provider,
    role,
    jitsiDomain: DEFAULT_JITSI_DOMAIN,
    roomName: row.room_name,
    channelName: row.channel_name,
    meetingUrl,
    joinToken,
    signedJoinUrl: meetingBase ? `${meetingBase.replace(/\/$/, '')}/live-hub.html?sessionId=${encodeURIComponent(row.session_id)}&joinToken=${encodeURIComponent(joinToken || '')}` : '',
    agora: null,
    backendUrl: meetingBase
  };
}

async function buildAgoraJoinContext(row, viewer, role) {
  const appId = String(process.env.AGORA_APP_ID || '').trim();
  const appCertificate = String(process.env.AGORA_APP_CERTIFICATE || '').trim();
  if (!appId || !appCertificate) {
    throw new ValidationError('Agora is not configured on this server');
  }

  const uid = Number(viewer?.id || 0) || 0;
  const joinToken = signSessionToken(row, viewer, role, '45m');
  const agoraRole = role === 'host'
    ? (RtcRole.PUBLISHER ?? RtcRole.Role_Publisher ?? 1)
    : (RtcRole.SUBSCRIBER ?? RtcRole.Role_Subscriber ?? 2);
  const expireAt = Math.floor(Date.now() / 1000) + 3600;
  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    row.channel_name,
    uid,
    agoraRole,
    expireAt
  );

  return {
    provider: 'agora',
    role,
    agora: {
      appId,
      channelName: row.channel_name,
      uid,
      token,
      role: role === 'host' ? 'publisher' : 'subscriber',
      canPublish: role === 'host'
    },
    roomName: row.room_name,
    channelName: row.channel_name,
    meetingUrl: '',
    joinToken,
    signedJoinUrl: joinToken ? `${process.env.FRONTEND_URL || ''}/live-hub.html?sessionId=${encodeURIComponent(row.session_id)}&joinToken=${encodeURIComponent(joinToken)}` : ''
  };
}

async function recordParticipant(row, viewer, role, action = 'join') {
  const userEmail = normalizeText(viewer?.email || '');
  const userName = normalizeText(viewer?.full_name || viewer?.fullName || userEmail || 'Participant');
  await pool.query(
    `INSERT INTO live_session_participants (
      live_session_id, user_id, user_email, user_name, role, joined_at, left_at, connection_state, meta
    ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, NULL, 'joined', $6::jsonb)
    ON CONFLICT (live_session_id, user_id)
    DO UPDATE SET
      user_email = EXCLUDED.user_email,
      user_name = EXCLUDED.user_name,
      role = EXCLUDED.role,
      joined_at = CURRENT_TIMESTAMP,
      left_at = NULL,
      connection_state = 'joined',
      meta = EXCLUDED.meta`,
    [row.id, viewer?.id || null, userEmail || null, userName, role, JSON.stringify({ action, provider: row.provider, sessionId: row.session_id })]
  );
  const nextRow = await refreshParticipantCount(row.id);
  await writeLog(row.id, viewer, action, { role, provider: row.provider, sessionId: row.session_id });
  publishLiveSessionEvent(action, nextRow || row, { role, userId: viewer?.id || null });
}

async function closeParticipant(row, viewer, action = 'leave') {
  await pool.query(
    `UPDATE live_session_participants
     SET left_at = CURRENT_TIMESTAMP,
         connection_state = 'left'
     WHERE live_session_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [row.id, viewer?.id || null]
  );
  const nextRow = await refreshParticipantCount(row.id);
  await writeLog(row.id, viewer, action, { provider: row.provider, sessionId: row.session_id });
  publishLiveSessionEvent(action, nextRow || row, { userId: viewer?.id || null });
}

async function markPresenceOffline(row, viewer, meta = {}) {
  if (!viewer?.id) return null;
  const { rows } = await pool.query(
    `UPDATE live_session_presence
     SET status = 'offline',
         is_present = FALSE,
         is_typing = FALSE,
         meta = COALESCE(meta, '{}'::jsonb) || $3::jsonb,
         last_seen_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE live_session_id = $1 AND user_id = $2
     RETURNING *`,
    [row.id, viewer.id, JSON.stringify(meta || {})]
  );
  return rows[0] || null;
}

async function getEffectiveRow(sessionId) {
  const row = await getSessionRecord(sessionId);
  if (!row) throw new NotFoundError('Live session');
  return row;
}

router.post('/create', requireAuth, asyncHandler(async (req, res) => {
  const actor = await getUserContext(req.session.userId);
  const role = normalizeLower(actor?.role);
  if (!(role === 'admin' || role === 'super_admin')) {
    throw new ForbiddenError('Admin access required to create live sessions.');
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const desiredSessionId = normalizeText(payload.sessionId) || generateSessionId();
  const hostCode = normalizeText(payload.hostCode) || generateHostCode();
  const { row, hostCode: generatedHostCode } = await saveSessionFromPayload({ ...payload, sessionId: desiredSessionId, hostCode }, actor, null, { isCreate: true });

  res.status(201).json({
    message: 'Live session created successfully',
    hostCode: generatedHostCode || hostCode,
    session: serializeSession(row, actor)
  });
  console.info('[Live Session] created', { sessionId: row.session_id, actorUserId: actor?.id || null, actorRole: actor?.role || null });
  publishLiveSessionEvent('created', row, { actorId: actor?.id || null });
}));

router.get('/upcoming', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const includeEnded = String(req.query?.includeEnded || 'true').toLowerCase() !== 'false';
  const scope = String(req.query?.scope || 'student');
  const sessions = await fetchSessionList(viewer, { includeEnded, scope, serialize: false });
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({
    sessions: sessions.map((session) => serializeSessionForRequest(session, viewer, req))
  });
}));

router.get('/stream', requireAuth, asyncHandler(async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ at: nowIso() })}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\n`);
    res.write(`data: ${JSON.stringify({ at: nowIso() })}\n\n`);
  }, 20000);

  const unsubscribe = subscribeRealtime((evt) => {
    if (!evt?.type) return;
    const eventType = String(evt.type);
    if (!eventType.startsWith('live_session_') && !eventType.startsWith('session.')) return;
    res.write(`event: ${evt.type}\n`);
    res.write(`data: ${JSON.stringify(evt.payload || {})}\n\n`);
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const row = await getSessionRecord(req.params.id);
  if (!row) throw new NotFoundError('Live session');
  if (!assertRoleCanManage(viewer, row) && normalizeLower(viewer?.role) !== 'student') {
    throw new ForbiddenError('You are not allowed to view this live session.');
  }
  res.json({ session: serializeSessionForRequest(row, viewer, req) });
}));

router.post('/:id/validate-host-code', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const row = await getEffectiveRow(req.params.id);
  const role = normalizeLower(viewer?.role);
  if (role === 'admin' || role === 'super_admin') {
    await writeLog(row.id, viewer, 'validate_host_code', { adminOverride: true });
    return res.json({ valid: true, session: serializeSession(row, viewer) });
  }
  if (deriveStatus(row) === 'cancelled' || deriveStatus(row) === 'ended') {
    throw createHostFlowError('Session already ended.', 'SESSION_ALREADY_ENDED', 409);
  }
  if (!row.scheduled_start || !row.scheduled_end) {
    throw createHostFlowError('Session is not scheduled.', 'SESSION_NOT_SCHEDULED', 409);
  }
  if (!assertMentorAssignment(viewer, row)) {
    throw createHostFlowError('Host code is not assigned to your account.', 'HOST_CODE_NOT_ASSIGNED', 403);
  }
  const hostCode = normalizeText(req.body?.hostCode);
  if (!hostCode) throw createHostFlowError('Host code is required.', 'HOST_CODE_REQUIRED', 400);
  await verifyHostCode(row, hostCode);
  markHostSessionUnlocked(req, row.session_id, viewer);
  await writeLog(row.id, viewer, 'validate_host_code', {});
  publishLiveSessionEvent('validated', row, { userId: viewer?.id || null });
  res.json({ valid: true, session: serializeSessionForRequest(row, viewer, req) });
}));

router.post('/:id/start', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const row = await getEffectiveRow(req.params.id);
  console.info('[Live Session] start request', { sessionId: row.session_id, actorUserId: viewer?.id || null, actorRole: viewer?.role || null });
  if (deriveStatus(row) === 'cancelled' || deriveStatus(row) === 'ended') throw createHostFlowError('Session already ended.', 'SESSION_ALREADY_ENDED', 409);
  if (!assertRoleCanManage(viewer, row)) {
    throw createHostFlowError('Host code is not assigned to your account.', 'HOST_CODE_NOT_ASSIGNED', 403);
  }

  const isAdmin = normalizeLower(viewer?.role) === 'admin' || normalizeLower(viewer?.role) === 'super_admin';
  const hostUnlocked = isHostSessionUnlocked(req, row.session_id, viewer);
  if (!isAdmin) {
    if (!hostUnlocked) {
      const hostCode = normalizeText(req.body?.hostCode);
      if (!row.scheduled_start || !row.scheduled_end) {
        throw createHostFlowError('Session is not scheduled.', 'SESSION_NOT_SCHEDULED', 409);
      }
      await verifyHostCode(row, hostCode);
      markHostSessionUnlocked(req, row.session_id, viewer);
    }
    const scheduledStart = parseDate(row.scheduled_start);
    const scheduledEnd = parseDate(row.scheduled_end);
    const windowStart = new Date(scheduledStart.getTime() - DEFAULT_HOST_WINDOW_MINUTES * 60000);
    const windowEnd = new Date(scheduledEnd.getTime() + DEFAULT_HOST_WINDOW_MINUTES * 60000);
    const current = new Date();
    if (current < windowStart || current > windowEnd) {
      throw createHostFlowError('Session is outside the allowed start window.', 'SESSION_OUTSIDE_START_WINDOW', 403);
    }
  }

  if (deriveStatus(row) === 'ended') {
    throw createHostFlowError('Session already ended.', 'SESSION_ALREADY_ENDED', 409);
  }

  await pool.query(
    `UPDATE live_sessions
     SET status = 'live',
         mentor_status = 'live',
         actual_start = COALESCE(actual_start, CURRENT_TIMESTAMP),
         actual_end = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [row.id]
  );

  const updatedRow = await getSessionRecord(row.session_id);
  console.info('[Live Session] start', { sessionId: row.session_id, actorUserId: viewer?.id || null, actorRole: viewer?.role || null });
  console.info('[Live Session] live status', { sessionId: row.session_id, status: 'live', updatedAt: updatedRow?.updated_at || row.updated_at || null });
  await writeLog(row.id, viewer, 'start', { provider: row.provider, roomName: row.room_name });
  await recordPresence(updatedRow || row, viewer, { status: 'online', isPresent: true, meta: { action: 'start', role: 'host' } });
  await notifyLiveSessionAudience(updatedRow || row, 'live_session_started', `${row.title} is now live. Join the session from the portal.`);
  publishLiveSessionEvent('started', updatedRow || row, { userId: viewer?.id || null });
  res.json({
    message: 'Live session started successfully',
    session: serializeSessionForRequest(updatedRow, viewer, req),
    meeting: buildJoinContext(updatedRow, viewer, 'host'),
    presence: await fetchSessionPresence(updatedRow || row),
    activity: await fetchSessionActivity(updatedRow || row, 25)
  });
}));

router.post('/:id/unlock-host', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const row = await getEffectiveRow(req.params.id);

  if (!assertRoleCanManage(viewer, row)) {
    throw createHostFlowError('Host code is not assigned to your account.', 'HOST_CODE_NOT_ASSIGNED', 403);
  }

  if (deriveStatus(row) === 'cancelled' || deriveStatus(row) === 'ended') {
    throw createHostFlowError('Session already completed.', 'SESSION_ALREADY_COMPLETED', 409);
  }

  const role = normalizeLower(viewer?.role);
  const isAdmin = role === 'admin' || role === 'super_admin';
  const hostCode = normalizeText(req.body?.hostCode);

  if (!isAdmin) {
    if (!row.scheduled_start || !row.scheduled_end) {
      throw createHostFlowError('Session is not scheduled.', 'SESSION_NOT_SCHEDULED', 409);
    }
    await verifyHostCode(row, hostCode);
    const scheduledStart = parseDate(row.scheduled_start);
    const scheduledEnd = parseDate(row.scheduled_end);
    const windowStart = new Date(scheduledStart.getTime() - DEFAULT_HOST_WINDOW_MINUTES * 60000);
    const windowEnd = new Date(scheduledEnd.getTime() + DEFAULT_HOST_WINDOW_MINUTES * 60000);
    const current = new Date();
    if (current < windowStart || current > windowEnd) {
      throw createHostFlowError('Session is outside the allowed start window.', 'SESSION_OUTSIDE_START_WINDOW', 403);
    }
  }

  markHostSessionUnlocked(req, row.session_id, viewer);
  await writeLog(row.id, viewer, 'host_unlock', { provider: row.provider, roomName: row.room_name });
  await recordPresence(row, viewer, { status: 'online', isPresent: true, meta: { action: 'host_unlock', role: 'host' } });

  console.info('[Live Session] host unlock', {
    sessionId: row.session_id,
    actorUserId: viewer?.id || null,
    actorRole: viewer?.role || null,
    becameLive: deriveStatus(row) === 'live'
  });

  publishLiveSessionEvent('host_unlocked', row, { userId: viewer?.id || null });

  res.json({
    ok: true,
    hostMode: true,
    hostModeUnlocked: true,
    message: 'Host mode unlocked',
    session: serializeSessionForRequest(row, viewer, req),
    meeting: buildJoinContext(row, viewer, 'host'),
    presence: await fetchSessionPresence(row),
    activity: await fetchSessionActivity(row, 25)
  });
}));

router.post('/:id/join', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const row = await getEffectiveRow(req.params.id);
  const status = deriveStatus(row);
  console.info('[Live Session] join attempt', { sessionId: row.session_id, actorUserId: viewer?.id || null, actorRole: viewer?.role || null, status });
  const role = normalizeLower(viewer?.role);
  const isMentorAssigned = assertMentorAssignment(viewer, row);
  const isAdmin = role === 'admin' || role === 'super_admin';
  const hostUnlocked = isHostSessionUnlocked(req, row.session_id, viewer);
  const isMentor = isAdmin || (isMentorAssigned && hostUnlocked);
  const refreshToken = Boolean(req.body?.refreshToken);

  if (status === 'cancelled') throw new ConflictError('Session has been cancelled.');
  if (status === 'ended') throw new ConflictError('Session already ended.');
  if (!isAdmin && !isMentor && status !== 'live') {
    console.warn('[Live Session] join denied', { sessionId: row.session_id, actorUserId: viewer?.id || null, reason: 'session_not_live' });
    throw new ConflictError('Session not started yet.');
  }

  const participantRole = isMentor || isAdmin ? 'mentor' : 'student';
  if (!refreshToken) {
    await recordParticipant(row, viewer, participantRole, 'join');
  }
  await recordPresence(row, viewer, { status: 'online', isPresent: true, meta: { action: 'join', role: participantRole } });

  let meeting;
  if (normalizeProvider(row.provider) === 'agora') {
    meeting = await buildAgoraJoinContext(row, viewer, isMentor || isAdmin ? 'host' : 'participant');
  } else {
    meeting = buildJoinContext(row, viewer, isMentor || isAdmin ? 'host' : 'participant');
  }

  const refreshedRow = await getSessionRecord(row.session_id);
  publishLiveSessionEvent('joined', refreshedRow || row, { userId: viewer?.id || null, role: participantRole });
  console.info('[Live Session] join success', { sessionId: row.session_id, actorUserId: viewer?.id || null, role: participantRole });

  if (isMentor || isAdmin) {
    await notifyLiveSessionAudience(refreshedRow || row, 'live_session_joined', `${viewer?.full_name || viewer?.email || 'A mentor'} joined ${row.title}.`, { includeMentor: true, includeParticipants: false });
  }

  res.json({
    session: serializeSessionForRequest(refreshedRow || row, viewer, req),
    meeting,
    presence: await fetchSessionPresence(refreshedRow || row),
    activity: await fetchSessionActivity(refreshedRow || row, 25),
    chatMessages: await fetchSessionMessages(refreshedRow || row, 25),
    canJoin: true
  });
}));

router.post('/:id/leave', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const row = await getEffectiveRow(req.params.id);
  await closeParticipant(row, viewer, 'leave');
  await markPresenceOffline(row, viewer, { action: 'leave' });
  res.json({ message: 'Left live session successfully' });
}));

router.get('/:id/presence', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const row = await getEffectiveRow(req.params.id);
  if (!assertRoleCanManage(viewer, row) && !assertMentorAssignment(viewer, row) && normalizeLower(viewer?.role) !== 'student') {
    throw new ForbiddenError('You are not allowed to view this live session presence data.');
  }
  res.json({
    presence: await fetchSessionPresence(row),
    metrics: await refreshDerivedSessionMetrics(row)
  });
}));

router.post('/:id/presence', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const row = await getEffectiveRow(req.params.id);
  if (!assertRoleCanManage(viewer, row) && !assertMentorAssignment(viewer, row) && normalizeLower(viewer?.role) !== 'student') {
    throw new ForbiddenError('You are not allowed to update this live session presence.');
  }
  const presence = await recordPresence(row, viewer, req.body || {});
  res.json({ presence, metrics: await refreshDerivedSessionMetrics(row) });
}));

router.get('/:id/activity', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const row = await getEffectiveRow(req.params.id);
  if (!assertRoleCanManage(viewer, row) && !assertMentorAssignment(viewer, row) && normalizeLower(viewer?.role) !== 'student') {
    throw new ForbiddenError('You are not allowed to view this live session activity.');
  }
  res.json({
    activity: await fetchSessionActivity(row, toInt(req.query?.limit || 100, 100))
  });
}));

router.post('/:id/activity', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const row = await getEffectiveRow(req.params.id);
  const action = normalizeText(req.body?.action || req.body?.type || 'activity');
  await writeLog(row.id, viewer, action, req.body?.meta || {});
  publishLiveSessionEvent('activity', row, { action, userId: viewer?.id || null, meta: req.body?.meta || {} });
  res.json({ message: 'Activity recorded successfully' });
}));

router.get('/:id/chat', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const row = await getEffectiveRow(req.params.id);
  if (!assertRoleCanManage(viewer, row) && !assertMentorAssignment(viewer, row) && normalizeLower(viewer?.role) !== 'student') {
    throw new ForbiddenError('You are not allowed to view this live session chat.');
  }
  res.json({
    messages: await fetchSessionMessages(row, toInt(req.query?.limit || 100, 100))
  });
}));

router.post('/:id/chat', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const row = await getEffectiveRow(req.params.id);
  const message = await recordSessionMessage(row, viewer, req.body || {});
  res.status(201).json({ message, messages: await fetchSessionMessages(row, 100) });
}));

router.post('/:id/reactions', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const row = await getEffectiveRow(req.params.id);
  const reaction = normalizeText(req.body?.reaction || req.body?.emoji || '');
  if (!reaction) throw createHostFlowError('Reaction is required.', 'REACTION_REQUIRED', 400);
  const stored = await recordSessionMessage(row, viewer, { body: reaction, reaction, messageType: 'reaction', role: assertMentorAssignment(viewer, row) ? 'host' : 'participant' });
  res.status(201).json({ reaction: stored });
}));

router.post('/:id/join-token', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const row = await getEffectiveRow(req.params.id);
  const role = assertMentorAssignment(viewer, row) || assertRoleCanManage(viewer, row) ? 'host' : 'participant';
  const joinToken = signSessionToken(row, viewer, role, req.body?.expiresIn || '45m');
  res.json({
    joinToken,
    signedJoinUrl: joinToken ? `${process.env.FRONTEND_URL || ''}/live-hub.html?sessionId=${encodeURIComponent(row.session_id)}&joinToken=${encodeURIComponent(joinToken)}` : '',
    expiresIn: req.body?.expiresIn || '45m'
  });
}));

router.post('/:id/issue-join-token', requireAuth, asyncHandler(async (req, res) => {
  // Issue a server-persisted join token (JWT) tied to a jti stored in DB to prevent replay.
  const { v4: uuidv4 } = require('uuid');
  const viewer = await getUserContext(req.session.userId);
  const row = await getEffectiveRow(req.params.id);
  if (!assertRoleCanManage(viewer, row)) {
    throw new ForbiddenError('Only assigned host or admins can issue persistent join tokens.');
  }

  const expiresIn = String(req.body?.expiresIn || '15m');
  const expireSeconds = (() => {
    const m = expiresIn.match(/(\d+)(m|s|h)?/);
    if (!m) return 15 * 60;
    const val = Number(m[1]);
    const unit = m[2] || 'm';
    switch (unit) { case 's': return val; case 'h': return val * 3600; default: return val * 60; }
  })();

  const jti = uuidv4();
  const payload = {
    sid: row.session_id,
    uid: viewer?.id || null,
    role: 'host',
    purpose: 'live-session-join'
  };
  const token = jwt.sign(payload, LIVE_SESSION_TOKEN_SECRET, { expiresIn, issuer: 'college-os', audience: 'live-session', jwtid: jti });

  const expiresAt = new Date(Date.now() + (expireSeconds * 1000));
  await pool.query(`INSERT INTO live_session_tokens (live_session_id, jti, user_id, purpose, expires_at, meta) VALUES ((SELECT id FROM live_sessions WHERE session_id = $1 LIMIT 1), $2, $3, $4, $5, $6::jsonb)`, [row.session_id, jti, viewer?.id || null, 'join', expiresAt, JSON.stringify({ issuedBy: viewer?.id || null })]);

  res.json({ joinToken: token, signedJoinUrl: token ? `${process.env.FRONTEND_URL || ''}/live-hub.html?sessionId=${encodeURIComponent(row.session_id)}&joinToken=${encodeURIComponent(token)}` : '', expiresIn });
}));

router.post('/:id/end', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const row = await getEffectiveRow(req.params.id);
  if (!assertRoleCanManage(viewer, row)) {
    throw createHostFlowError('Host code is not assigned to your account.', 'HOST_CODE_NOT_ASSIGNED', 403);
  }
  const isAdmin = normalizeLower(viewer?.role) === 'admin' || normalizeLower(viewer?.role) === 'super_admin';
  const hostUnlocked = isHostSessionUnlocked(req, row.session_id, viewer);
  if (!isAdmin) {
    if (!hostUnlocked) {
      const hostCode = normalizeText(req.body?.hostCode);
      await verifyHostCode(row, hostCode);
      markHostSessionUnlocked(req, row.session_id, viewer);
    }
  }

  await pool.query(
    `UPDATE live_sessions
     SET status = 'ended',
         mentor_status = 'ended',
         actual_end = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [row.id]
  );
  const refreshedRow = await refreshParticipantCount(row.id);
  await markPresenceOffline(refreshedRow || row, viewer, { action: 'end' });
  await writeLog(row.id, viewer, 'end', { provider: row.provider, roomName: row.room_name });
  console.info('[Live Session] end', { sessionId: row.session_id, actorUserId: viewer?.id || null, actorRole: viewer?.role || null });
  await notifyLiveSessionAudience(refreshedRow || (await getSessionRecord(row.session_id)) || row, 'live_session_ended', `${row.title} has ended. Session materials and notes can now be reviewed.`, { includeParticipants: true });
  publishLiveSessionEvent('ended', refreshedRow || (await getSessionRecord(row.session_id)) || row, { userId: viewer?.id || null });
  clearHostSessionUnlocked(req, row.session_id);
  res.json({ message: 'Live session ended successfully', session: serializeSessionForRequest(await getSessionRecord(row.session_id), viewer, req) });
}));

router.patch('/:id/reschedule', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const row = await getEffectiveRow(req.params.id);
  if (!assertRoleCanManage(viewer, row)) {
    throw new ForbiddenError('You are not allowed to reschedule this session.');
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const merged = {
    sessionId: row.session_id,
    title: payload.title ?? row.title,
    description: payload.description ?? row.description,
    assignedHostUserRef: payload.assignedHostUserRef ?? payload.assignedHostEmail ?? payload.assignedHostUserId ?? row.assigned_host_email ?? row.mentor_email,
    mentorId: payload.mentorId ?? row.assigned_host_user_id ?? row.mentor_id,
    mentorEmail: payload.mentorEmail ?? row.assigned_host_email ?? row.mentor_email,
    mentorName: payload.mentorName ?? row.mentor_name,
    sessionType: payload.sessionType ?? row.session_type,
    provider: payload.provider ?? row.provider,
    roomName: payload.roomName ?? row.room_name,
    channelName: payload.channelName ?? row.channel_name,
    scheduledStart: payload.scheduledStart ?? row.scheduled_start,
    scheduledEnd: payload.scheduledEnd ?? row.scheduled_end,
    status: payload.status ?? row.status,
    maxParticipants: payload.maxParticipants ?? row.max_participants,
    hostCode: normalizeText(payload.hostCode || payload.mentorLiveCode || '')
  };

  const result = await saveSessionFromPayload(merged, viewer, row, { isCreate: false });
  await writeLog(row.id, viewer, 'reschedule', {
    scheduledStart: merged.scheduledStart,
    scheduledEnd: merged.scheduledEnd
  });
  await notifyLiveSessionAudience(result.row, 'live_session_rescheduled', `${result.row.title} has been rescheduled to ${new Date(result.row.scheduled_start).toLocaleString('en-IN')}.`);
  publishLiveSessionEvent('rescheduled', result.row, { userId: viewer?.id || null });
  res.json({ message: 'Live session rescheduled successfully', session: serializeSession(result.row, viewer) });
}));

router.delete('/:id/cancel', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const row = await getEffectiveRow(req.params.id);
  if (!assertRoleCanManage(viewer, row)) {
    throw new ForbiddenError('You are not allowed to cancel this session.');
  }

  await pool.query(
    `UPDATE live_sessions
     SET status = 'cancelled',
         mentor_status = 'cancelled',
         cancelled_at = CURRENT_TIMESTAMP,
         cancelled_reason = COALESCE($2, cancelled_reason),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [row.id, normalizeText(req.body?.reason || req.query?.reason || '') || null]
  );
  await writeLog(row.id, viewer, 'cancel', { reason: normalizeText(req.body?.reason || req.query?.reason || '') });
  await notifyLiveSessionAudience(await getSessionRecord(row.session_id) || row, 'live_session_cancelled', `${row.title} has been cancelled.`, { includeParticipants: true });
  publishLiveSessionEvent('cancelled', await getSessionRecord(row.session_id) || row, { userId: viewer?.id || null });
  clearHostSessionUnlocked(req, row.session_id);
  res.json({ message: 'Live session cancelled successfully', session: serializeSessionForRequest(await getSessionRecord(row.session_id), viewer, req) });
}));

router.post('/admin/sync', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const role = normalizeLower(viewer?.role);
  if (!(role === 'admin' || role === 'super_admin')) {
    throw new ForbiddenError('Admin access required.');
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const summary = [];

  for (const [index, item] of sessions.entries()) {
    const sessionId = normalizeText(item.sessionId || item.id) || generateSessionId();
    const existing = await getSessionRecord(sessionId);
    const result = await saveSessionFromPayload({ ...item, sessionId }, viewer, existing, { isCreate: !existing });
    summary.push(serializeSession(result.row, viewer));
    if (item.hostCode) {
      await writeLog(result.row.id, viewer, existing ? 'host_code_rotated' : 'host_code_generated', { index });
    }
    publishLiveSessionEvent(existing ? 'updated' : 'created', result.row, { userId: viewer?.id || null, index });
  }

  res.json({ message: 'Live sessions synchronized successfully', sessions: summary });
}));

module.exports = router;
module.exports.ensureLiveSessionSchema = ensureSchema;
module.exports.ensureLiveSessionSeeded = ensureSeeded;
module.exports.fetchLiveSessions = fetchSessionList;
module.exports.runLiveSessionMaintenance = autoResolveSessions;
module.exports.verifySessionToken = verifySessionToken;

// Admin endpoint: revoke token by jti
router.post('/:id/revoke-token', requireAuth, asyncHandler(async (req, res) => {
  const viewer = await getUserContext(req.session.userId);
  const role = normalizeLower(viewer?.role);
  if (!(role === 'admin' || role === 'super_admin')) throw new ForbiddenError('Admin access required.');
  const jti = String(req.body?.jti || '').trim();
  if (!jti) throw new ValidationError('jti is required');
  await pool.query('UPDATE live_session_tokens SET used = TRUE, used_at = CURRENT_TIMESTAMP WHERE jti = $1', [jti]);
  await pool.query('INSERT INTO live_session_logs (live_session_id, actor_user_id, actor_role, action, metadata) VALUES (NULL, $1, $2, $3, $4::jsonb)', [viewer?.id || null, viewer?.role || null, 'token_revoked', JSON.stringify({ jti })]);
  res.json({ message: 'Token revoked' });
}));
