(function () {
  function renderWorkInProgressPage() {
    document.body.innerHTML = `
      <main style="min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(160deg,#edf4fb 0%,#f8fbff 50%,#eef5fb 100%);font-family:'Plus Jakarta Sans','Segoe UI',sans-serif;">
        <section style="width:min(100%, 760px);background:rgba(255,255,255,.96);border:1px solid rgba(180,198,220,.65);border-radius:24px;box-shadow:0 24px 54px rgba(15,23,42,.12);padding:32px 24px;text-align:center;display:grid;gap:16px;">
          <div style="width:76px;height:76px;margin:0 auto;border-radius:22px;display:grid;place-items:center;background:linear-gradient(135deg,rgba(15,118,110,.14),rgba(14,165,233,.12));color:#0f766e;font-size:2rem;"><i class="fa-solid fa-satellite-dish"></i></div>
          <div>
            <p style="margin:0;color:#0f766e;font-size:0.78rem;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;">Work in Progress</p>
            <h1 style="margin:10px 0 8px;font-size:clamp(1.8rem,3vw,2.4rem);line-height:1.1;letter-spacing:-0.03em;color:#0f172a;">Live Hub is coming soon.</h1>
            <p style="margin:0;color:#53657d;font-size:1rem;line-height:1.7;">We are improving live sessions for a better learning experience.</p>
          </div>
          <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
            <button type="button" id="backToDashboardBtn" style="appearance:none;border:0;border-radius:14px;padding:14px 22px;background:linear-gradient(135deg,#0f766e,#1d8d86);color:#fff;font:inherit;font-weight:800;cursor:pointer;box-shadow:0 12px 24px rgba(15,118,110,.22);">Back to Dashboard</button>
          </div>
        </section>
      </main>
    `;
    const button = document.getElementById('backToDashboardBtn');
    if (button) {
      button.addEventListener('click', () => {
        window.location.assign('/dashboard');
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const loadStatus = async () => {
      try {
        const response = await (window.CollegeOSApi?.getLiveHubStatus
          ? window.CollegeOSApi.getLiveHubStatus()
          : fetch('/api/dashboard/live-hub/status', { credentials: 'include' }).then((result) => result.json()));
        if (response && response.enabled === false) {
          renderWorkInProgressPage();
          return false;
        }
      } catch {
        // If the status check fails, keep the existing live page behavior.
      }
      return true;
    };

    loadStatus().then((allowed) => {
      if (!allowed) return;
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
    }).catch(() => null);
  });
})();
