const { EventEmitter } = require('events');
const { getCacheService } = require('./cache');
const { invalidateCache: invalidateMemoryCache } = require('../db/cache');

const bus = new EventEmitter();
bus.setMaxListeners(200);
let broadcaster = null;

function normalizeEventType(type, payload = {}) {
  const rawType = String(type || '').trim();
  const contentType = String(payload.contentType || '').trim().toLowerCase();

  if (rawType === 'student_updated' || contentType === 'students' || contentType === 'student') {
    return 'student_updated';
  }

  if (rawType === 'certificate_updated' || contentType === 'certificates' || contentType === 'certificate') {
    return 'certificate_updated';
  }

  if (rawType === 'membership_updated' || contentType === 'membership' || contentType === 'memberships') {
    return 'membership_updated';
  }

  if (rawType === 'support_updated' || contentType.startsWith('support_')) {
    return 'support_updated';
  }

  if (rawType === 'live_session_updated' || rawType.startsWith('live_session_') || rawType.startsWith('session.')) {
    return 'live_session_updated';
  }

  if (rawType === 'notification_created') {
    return 'notification_created';
  }

  if (rawType === 'notification_changed') {
    return 'notification_updated';
  }

  if (rawType === 'content_changed') {
    return 'content_changed';
  }

  return rawType || 'event';
}

function invalidateRealtimeCaches(type, payload = {}) {
  const cache = getCacheService();
  const normalizedType = normalizeEventType(type, payload);
  const userId = Number(payload.userId || payload.actorUserId || payload.targetUserId || 0) || null;

  const invalidatePattern = (pattern) => {
    if (cache.useRedis) {
      return cache.invalidatePattern(pattern);
    }
    invalidateMemoryCache(pattern);
    return Promise.resolve();
  };

  const tasks = [invalidatePattern('admin:*')];

  if (userId) {
    tasks.push(cache.delete(`user:${userId}`));
  }

  if (normalizedType === 'notification_created' || normalizedType === 'notification_updated') {
    if (userId) {
      tasks.push(invalidatePattern(`notifications:${userId}:*`));
    } else {
      tasks.push(invalidatePattern('notifications:*'));
    }
  }

  if (normalizedType === 'student_updated' || normalizedType === 'membership_updated') {
    if (userId) {
      tasks.push(invalidatePattern(`student:${userId}:*`));
    }
    tasks.push(invalidatePattern('search:*'));
    tasks.push(invalidatePattern('leaderboard:*'));
  }

  if (normalizedType === 'certificate_updated') {
    tasks.push(invalidatePattern('certificates:*'));
  }

  if (normalizedType === 'support_updated') {
    tasks.push(invalidatePattern('support:*'));
  }

  if (normalizedType === 'live_session_updated') {
    tasks.push(invalidatePattern('live-session:*'));
  }

  if (normalizedType === 'content_changed') {
    tasks.push(invalidatePattern('content:*'));
    tasks.push(invalidatePattern('search:*'));
  }

  return Promise.allSettled(tasks);
}

function publishRealtimeEvent(type, payload = {}) {
  const normalizedType = normalizeEventType(type, payload);
  const eventPayload = {
    ...payload,
    type: normalizedType,
    rawType: String(type || '').trim() || normalizedType
  };
  bus.emit('event', {
    type: normalizedType,
    payload: eventPayload,
    at: new Date().toISOString()
  });
  invalidateRealtimeCaches(normalizedType, payload).catch(() => {});
  try {
    if (typeof broadcaster === 'function') {
      broadcaster(normalizedType, eventPayload);
    }
  } catch (e) {
    // swallow
  }
}

function publishContentChanged(contentType, action, contentId = null, extra = {}) {
  publishRealtimeEvent('content_changed', {
    contentType,
    action,
    contentId,
    ...extra
  });
}

function subscribeRealtime(handler) {
  bus.on('event', handler);
  return () => bus.off('event', handler);
}

module.exports = {
  publishRealtimeEvent,
  publishContentChanged,
  subscribeRealtime,
  normalizeEventType,
  invalidateRealtimeCaches
  ,
  setBroadcaster: (fn) => { broadcaster = fn; }
};
