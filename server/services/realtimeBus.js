const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(200);

function publishRealtimeEvent(type, payload = {}) {
  bus.emit('event', {
    type,
    payload,
    at: new Date().toISOString()
  });
}

function subscribeRealtime(handler) {
  bus.on('event', handler);
  return () => bus.off('event', handler);
}

module.exports = {
  publishRealtimeEvent,
  subscribeRealtime
};
