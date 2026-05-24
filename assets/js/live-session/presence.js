(function (global) {
  function PresenceManager(socket, opts = {}) {
    let myId = null;
    socket.on('connect', ({ id }) => { myId = id; });

    function update(status) {
      socket.sendPresence({ status, ts: Date.now() });
    }

    function onUpdate(cb) {
      socket.on('presence.updated', cb);
    }

    return { update, onUpdate };
  }

  global.PresenceManager = PresenceManager;
})(window);
