const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(200);
let broadcaster = null;

function publishRealtimeEvent(type, payload = {}) {
  bus.emit('event', {
    type,
    payload,
    at: new Date().toISOString()
  });
  try {
    if (typeof broadcaster === 'function') {
      broadcaster(type, payload);
    }
  } catch (e) {
    // swallow
  }
}

function subscribeRealtime(handler) {
  bus.on('event', handler);
  return () => bus.off('event', handler);
}

module.exports = {
  publishRealtimeEvent,
  subscribeRealtime
  ,
  setBroadcaster: (fn) => { broadcaster = fn; }
};
