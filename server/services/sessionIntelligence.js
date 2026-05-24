const { pool } = require('../db/pool');

// Lightweight in-memory trackers - replace with durable store (Redis / Postgres) in prod
const sessions = new Map();

function ensureSessionState(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      participants: new Map(),
      activityLog: []
    });
  }
  return sessions.get(sessionId);
}

async function trackJoin({ sessionId, userId, socketId }) {
  const state = ensureSessionState(sessionId);
  state.participants.set(socketId, { userId, joinedAt: Date.now(), lastSeen: Date.now() });
  state.activityLog.push({ type: 'join', userId, socketId, ts: Date.now() });
  // TODO: persist lightweight event to DB for audit
}

async function trackLeave({ sessionId, userId, socketId, reason }) {
  const state = ensureSessionState(sessionId);
  if (state.participants.has(socketId)) {
    const p = state.participants.get(socketId);
    p.leftAt = Date.now();
    p.reason = reason;
  }
  state.activityLog.push({ type: 'leave', userId, socketId, reason, ts: Date.now() });
  state.participants.delete(socketId);
  // TODO: persist event and compute attendance duration
}

async function recordActivity({ sessionId, userId, type, payload }) {
  const state = ensureSessionState(sessionId);
  state.activityLog.push({ type, userId, payload, ts: Date.now() });
  // update lastSeen for all sockets for this user
  for (const [sockId, meta] of state.participants.entries()) {
    if (meta.userId === userId) meta.lastSeen = Date.now();
  }
}

async function computeEngagement(sessionId) {
  const state = sessions.get(sessionId);
  if (!state) return { score: 0, reason: 'no-data' };
  // Simple heuristic: messages + reactions + active duration
  const messages = state.activityLog.filter(a => a.type === 'chat').length;
  const reactions = state.activityLog.filter(a => a.type === 'reaction').length;
  const activeDurations = Array.from(state.participants.values()).map(p => ((p.leftAt || Date.now()) - p.joinedAt));
  const avgActive = activeDurations.length ? Math.max(0, Math.floor(activeDurations.reduce((s, v) => s + v, 0) / activeDurations.length)) : 0;
  const score = Math.min(100, messages * 2 + reactions + Math.round(avgActive / 1000));
  return { score, messages, reactions, avgActive };
}

async function autoEndInactiveSessions(timeoutMs = 1000 * 60 * 60) {
  // example: find sessions with no participants for > timeoutMs
  const now = Date.now();
  const ended = [];
  for (const [sessionId, state] of sessions.entries()) {
    if (!state.participants.size) {
      const lastEvent = state.activityLog.length ? state.activityLog[state.activityLog.length - 1].ts : 0;
      if (now - lastEvent > timeoutMs) {
        // mark ended
        sessions.delete(sessionId);
        ended.push(sessionId);
        // TODO: persist session end state to DB
      }
    }
  }
  return ended;
}

module.exports = {
  trackJoin,
  trackLeave,
  recordActivity,
  computeEngagement,
  autoEndInactiveSessions
};
