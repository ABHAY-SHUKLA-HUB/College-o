(function () {
  document.addEventListener('DOMContentLoaded', () => {
    if (!window.LiveSocket) return;

    const qs = new URLSearchParams(window.location.search);
    const sessionId = qs.get('sessionId') || document.querySelector('[data-live-session-id]')?.dataset.liveSessionId || null;
    const joinToken = qs.get('joinToken') || null;
    const backendUrl = window.CollegeOSApiClient?.getSocketBaseUrl?.()
      || window.API_URL
      || window.VITE_API_URL
      || 'https://college-o.onrender.com';
    if (!sessionId) return;

    const socket = LiveSocket({ url: backendUrl, sessionId, token: joinToken });
    if (!socket) return;
    let presenceTimer = null;

    // Presence count
    const presenceCountEl = document.querySelector('.live-hub-presence-count');
    socket.on('presence.updated', (data) => {
      if (presenceCountEl && typeof data === 'object' && data.payload && Array.isArray(data.payload)) {
        presenceCountEl.textContent = String(data.payload.length || '0');
      }
      // Also update a small activity feed
      const feed = document.querySelector('.live-hub-activity-feed');
      if (feed && data && data.userId) {
        const item = document.createElement('div');
        item.className = 'activity-item';
        item.textContent = `User ${data.userId} updated presence`;
        feed.prepend(item);
      }
    });

    // Chat
    const chatList = document.querySelector('.live-hub-chat-list');
    const chatInput = document.querySelector('.live-hub-chat-input-field');
    socket.on('chat.message', (payload) => {
      if (!chatList) return;
      const li = document.createElement('div');
      li.className = 'chat-line';
      const who = payload.userId ? `User ${payload.userId}` : (payload.message && payload.message.user_name) || 'Someone';
      const text = (payload.message && payload.message.body) || (payload.message && payload.message.text) || '';
      li.innerHTML = `<strong>${who}:</strong> <span>${text}</span>`;
      chatList.appendChild(li);
      chatList.scrollTop = chatList.scrollHeight;
    });
    chatInput?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && chatInput.value.trim()) {
        socket.sendChat({ text: chatInput.value.trim() });
        chatInput.value = '';
      }
    });

    // Typing indicator
    const typingEl = document.querySelector('.live-hub-typing');
    let typingTimeout = null;
    chatInput?.addEventListener('input', () => {
      socket.sendTyping({ isTyping: true });
      if (typingTimeout) clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => socket.sendTyping({ isTyping: false }), 2000);
    });
    socket.on('participant.typing', (data) => {
      if (!typingEl) return;
      typingEl.textContent = data && data.payload && data.payload.isTyping ? 'Someone is typing…' : '';
    });

    // Raise hand
    const raiseBtn = document.querySelector('.live-hub-raise-hand');
    raiseBtn?.addEventListener('click', () => {
      socket.raiseHand({ ts: Date.now() });
      showToast('Hand raised');
    });

    // Reactions
    document.querySelectorAll('.live-hub-reaction-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const reaction = btn.dataset.reaction || btn.textContent.trim();
        socket.sendReaction({ reaction });
      });
    });
    socket.on('participant.reaction', (data) => {
      showToast(`Reaction ${data.payload && data.payload.reaction || ''}`);
    });

    // Reconnect/loading indicator
    const statusEl = document.querySelector('.live-hub-status-badge');
    socket.on('connect', () => { if (statusEl) statusEl.textContent = 'Connected'; });
    socket.on('disconnect', () => { if (statusEl) statusEl.textContent = 'Disconnected'; });
    socket.on('connect_error', () => { if (statusEl) statusEl.textContent = 'Network'; });

    // simple toast
    function showToast(text) {
      const t = document.createElement('div');
      t.className = 'live-hub-toast is-showing';
      t.textContent = text;
      document.body.appendChild(t);
      setTimeout(() => t.classList.add('is-hiding'), 3500);
      setTimeout(() => t.remove(), 4200);
    }

    // wire presence ping periodically (throttled)
    presenceTimer = window.setInterval(() => {
      try { socket.sendPresence({ status: 'online', ts: Date.now() }); } catch (e) {}
    }, 20 * 1000);

    window.addEventListener('beforeunload', () => {
      if (presenceTimer) {
        clearInterval(presenceTimer);
        presenceTimer = null;
      }
      try { socket.dispose?.(); } catch (e) { try { socket.close?.(); } catch {} }
    }, { once: true });

    // Expose for debugging
    window.__LiveSocketInstance = socket;
  });
})();
