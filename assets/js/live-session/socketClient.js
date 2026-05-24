// Lightweight socket client wrapper. Requires socket.io-client to be loaded as `io`.
(function (global) {
  function LiveSocket({ url, sessionId, token, path = '/socket.io' } = {}) {
    if (!global.io) {
      console.warn('[LiveSocket] socket.io-client not loaded (io is undefined)');
      return null;
    }

    // reuse existing instance per session to prevent duplicate listeners
    global.__LiveSocketInstancesBySession = global.__LiveSocketInstancesBySession || {};
    if (sessionId && global.__LiveSocketInstancesBySession[sessionId]) {
      return global.__LiveSocketInstancesBySession[sessionId];
    }

    const socketUrl = url
      || global.CollegeOSApiClient?.getSocketBaseUrl?.()
      || global.API_URL
      || global.VITE_API_URL
      || 'https://college-o.onrender.com';

    const socket = global.io(socketUrl, {
      path,
      transports: ['websocket', 'polling'],
      query: { sessionId, token },
      reconnectionAttempts: 10,
      reconnectionDelay: 500,
      transportsOptions: {
        polling: { extraHeaders: {} }
      }
    });

    const listeners = new Map();

    function emitLocal(event, payload) {
      const arr = listeners.get(event) || [];
      for (const cb of arr) cb(payload);
    }

    // socket event forwarding
    socket.on('connect', () => emitLocal('connect', { id: socket.id }));
    socket.on('disconnect', (reason) => emitLocal('disconnect', { reason }));
    socket.on('connect_error', (err) => emitLocal('connect_error', { message: err && err.message }));
    socket.on('participant.joined', (data) => emitLocal('participant.joined', data));
    socket.on('participant.left', (data) => emitLocal('participant.left', data));
    socket.on('participant.typing', (data) => emitLocal('participant.typing', data));
    socket.on('chat.message', (data) => emitLocal('chat.message', data));
    socket.on('presence.updated', (data) => emitLocal('presence.updated', data));
    socket.on('participant.raised_hand', (data) => emitLocal('participant.raised_hand', data));
    socket.on('participant.reaction', (data) => emitLocal('participant.reaction', data));

    const instance = {
      on(event, cb) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(cb);
      },
      off(event, cb) {
        if (!listeners.has(event)) return;
        const arr = listeners.get(event).filter((f) => f !== cb);
        listeners.set(event, arr);
      },
      sendPresence(payload) {
        socket.emit('presence.update', payload);
      },
      sendTyping(payload) {
        socket.emit('typing', payload);
      },
      sendChat(message) {
        socket.emit('chat.message', message);
      },
      sendReaction(payload) {
        socket.emit('reaction', payload);
      },
      raiseHand(payload) {
        socket.emit('raise.hand', payload);
      },
      close() {
        try { socket.close(); } catch (e) {}
      },
      _raw: socket
    };

    if (sessionId) global.__LiveSocketInstancesBySession[sessionId] = instance;
    return instance;
  }

  global.LiveSocket = LiveSocket;
})(window);
