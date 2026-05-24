(function (global) {
  function ChatManager(socket, containerEl, opts = {}) {
    const messages = [];

    socket.on('chat.message', (data) => {
      messages.push(data);
      if (opts.onMessage) opts.onMessage(data);
    });

    function send(text) {
      const msg = { text, ts: Date.now() };
      socket.sendChat(msg);
      messages.push({ ...msg, self: true });
      if (opts.onMessage) opts.onMessage({ ...msg, self: true });
    }

    return { send, getAll: () => messages };
  }

  global.ChatManager = ChatManager;
})(window);
