(function () {
  const STORAGE_KEY = 'collegeos_live_hub_ui_state';
  const CHAT_PREFIX = 'collegeos_live_hub_chat:';
  const CHANNEL_PREFIX = 'collegeos_live_hub_channel:';
  const JITSI_SCRIPT_ID = 'collegeos-jitsi-external-api';
  const LEGACY_ACTIVE_SESSION_KEYS = [
    'activeLiveSession',
    'currentLiveSession',
    'lastLiveSession',
    'selectedLiveSession',
    'hostModeSession',
    'collegeos_live_hub_active_session',
    'collegeos_live_hub_selected_session'
  ];

  const state = {
    ready: false,
    config: null,
    sessions: [],
    tab: 'live',
    open: false,
    activeSessionId: null,
    activeSession: null,
    videoApi: null,
    agoraClient: null,
    agoraLocalTracks: [],
    videoMode: 'iframe',
    refreshTimer: null,
    pollTimer: null,
    chatChannel: null,
    chatMessages: [],
    presence: [],
    activityFeed: [],
    joinContext: null,
    user: null,
    mounted: false,
    waitingRoomActive: false,
    refreshPromise: null,
    refreshQueued: false,
    liveEventSource: null,
    liveEventRetryMs: 2500,
    liveEventRetryTimer: null,
    reconnectState: 'connected',
    heartbeatTimer: null,
    beforeUnloadBound: false,
    reminderTimers: new Map(),
    notifiedSessionKeys: new Set(),
    hostModeUnlockedSessionIds: new Set()
  };

  function isLiveHubEnabled() {
    return state.config?.liveHub?.enabled !== false;
  }

  function toast(message, tone = 'info') {
    const hostId = 'collegeOsLiveHubToasts';
    let host = document.getElementById(hostId);
    if (!host) {
      host = document.createElement('div');
      host.id = hostId;
      host.className = 'live-hub-toast-host';
      document.body.appendChild(host);
    }

    const item = document.createElement('div');
    item.className = `live-hub-toast ${tone}`;
    item.textContent = message;
    host.appendChild(item);
    window.setTimeout(() => {
      item.classList.add('is-hiding');
      window.setTimeout(() => item.remove(), 240);
    }, 3400);
  }

  function notifyBrowser(message) {
    if (typeof window.Notification !== 'function' || window.Notification.permission !== 'granted') return;
    try {
      new window.Notification('College OS Live Session', { body: message });
    } catch {
      // Ignore browser notification failures.
    }
  }

  function notify(message, tone = 'info') {
    toast(message, tone);
    notifyBrowser(message);
  }

  async function requestNotificationsIfAvailable() {
    if (typeof window.Notification !== 'function' || window.Notification.permission !== 'default') return;
    if (!window.confirm('Enable browser notifications for live-session reminders?')) return;
    try {
      await window.Notification.requestPermission();
    } catch {
      // Ignore permission failures.
    }
  }

  function liveNoticeKey(sessionId, kind) {
    return `collegeos_live_session_notice:${kind}:${sessionId}`;
  }

  async function withRetry(operation, attempts = 2) {
    let lastError = null;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (i < attempts - 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 300 + (i * 200)));
        }
      }
    }
    throw lastError;
  }

  function clearReminderTimers() {
    for (const timer of state.reminderTimers.values()) {
      window.clearTimeout(timer);
    }
    state.reminderTimers.clear();
  }

  function clearLiveStream() {
    if (state.liveEventRetryTimer) {
      window.clearTimeout(state.liveEventRetryTimer);
      state.liveEventRetryTimer = null;
    }
    if (state.liveEventSource) {
      try {
        state.liveEventSource.close();
      } catch {
        // Ignore close failures.
      }
      state.liveEventSource = null;
    }
  }

  function disposeSessionRuntime({ keepRefreshTimer = true } = {}) {
    clearLiveStream();
    if (state.heartbeatTimer) {
      window.clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
    if (state.chatChannel) {
      try {
        state.chatChannel.close();
      } catch {
        // Ignore close failures.
      }
      state.chatChannel = null;
    }
    clearReminderTimers();
    destroyVideo();
    if (!keepRefreshTimer && state.refreshTimer) {
      window.clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
  }

  function scheduleSessionReminder(session) {
    if (!session || deriveStatus(session) === 'live' || deriveStatus(session) === 'ended' || deriveStatus(session) === 'cancelled') return;
    const start = sessionStart(session);
    if (!start) return;
    const key = liveNoticeKey(session.id, 'reminder');
    if (state.notifiedSessionKeys.has(key) || window.localStorage.getItem(key) === 'sent') return;

    const leadMs = 15 * 60000;
    const delay = start.getTime() - Date.now() - leadMs;
    if (delay > 0) {
      const timer = window.setTimeout(() => {
        state.notifiedSessionKeys.add(key);
        try { window.localStorage.setItem(key, 'sent'); } catch { /* ignore */ }
        notify(`Reminder: ${session.title} starts in about 15 minutes.`, 'info');
      }, delay);
      state.reminderTimers.set(session.id, timer);
      return;
    }

    if (start.getTime() > Date.now()) {
      state.notifiedSessionKeys.add(key);
      try { window.localStorage.setItem(key, 'sent'); } catch { /* ignore */ }
      notify(`Reminder: ${session.title} starts soon.`, 'info');
    }
  }

  function scheduleSessionReminders(sessions) {
    clearReminderTimers();
    (Array.isArray(sessions) ? sessions : []).forEach(scheduleSessionReminder);
  }

  function handleLiveSessionNotification(action, session) {
    if (!session) return;
    const isMentor = canControlSession(session);
    const status = deriveStatus(session);
    if (action === 'started' || status === 'live') {
      notify(`${session.title} is live now.`, isMentor ? 'success' : 'info');
      return;
    }
    if (action === 'ended' || status === 'ended') {
      notify(`${session.title} has ended.`, 'info');
      return;
    }
    if (action === 'cancelled') {
      notify(`${session.title} was cancelled.`, 'warning');
      return;
    }
    if (action === 'joined' && isMentor) {
      notify(`Mentor joined ${session.title}.`, 'success');
    }
  }

  function queueRefresh() {
    if (state.refreshQueued) return;
    state.refreshQueued = true;
    window.setTimeout(() => {
      state.refreshQueued = false;
      refresh().catch(() => null);
    }, 200);
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function text(value, fallback = '-') {
    const cleaned = String(value ?? '').trim();
    return cleaned || fallback;
  }

  function normalizeIdentityToken(value) {
    return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDateTime(value) {
    const date = parseDate(value);
    if (!date) return 'Schedule not set';
    return date.toLocaleString('en-IN', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function pad(value) {
    return String(Math.max(0, Math.floor(value))).padStart(2, '0');
  }

  function formatCountdown(targetDate) {
    const target = parseDate(targetDate);
    if (!target) return 'TBD';
    const diff = target.getTime() - Date.now();
    if (diff <= 0) return '00h 00m 00s';
    const seconds = Math.floor(diff / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${pad(hours)}h ${pad(minutes)}m ${pad(secs)}s`;
  }

  function loadUiState() {
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function saveUiState(next) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures.
    }
  }

  function clearLegacyLiveSessionKeys() {
    LEGACY_ACTIVE_SESSION_KEYS.forEach((key) => {
      try { window.localStorage.removeItem(key); } catch { /* ignore */ }
      try { window.sessionStorage.removeItem(key); } catch { /* ignore */ }
    });
  }

  function clearActiveSessionPersistence() {
    clearLegacyLiveSessionKeys();
    try {
      const stored = loadUiState();
      stored.activeSessionId = '';
      stored.open = false;
      saveUiState(stored);
    } catch {
      // Ignore persistence cleanup failures.
    }
  }

  function now() {
    return new Date();
  }

  function sessionProvider(session) {
    return String(session?.provider || state.config?.liveHub?.defaultProvider || 'jitsi').toLowerCase();
  }

  function sessionStart(session) {
    return parseDate(session?.startAt || session?.scheduledStart || session?.startsAt || session?.dateTime);
  }

  function sessionEnd(session) {
    const end = parseDate(session?.endAt || session?.scheduledEnd || session?.endsAt);
    if (end) return end;
    const start = sessionStart(session);
    if (!start) return null;
    const duration = Number(session?.durationMinutes || session?.durationMins || 60);
    return new Date(start.getTime() + Math.max(15, duration) * 60000);
  }

  function deriveStatus(session) {
    const forced = String(session?.status || '').toLowerCase();
    if (forced === 'cancelled') return 'cancelled';
    if (forced === 'ended' || forced === 'completed') return 'ended';
    if (forced === 'live' || forced === 'active') return 'live';
    if (forced === 'ready' || forced === 'ready_to_go_live' || forced === 'ready-to-go-live') return 'ready';
    if (forced === 'scheduled') return 'upcoming';

    const start = sessionStart(session);
    const end = sessionEnd(session);
    const current = now();
    if (start && current > end) return 'ended';
    return 'upcoming';
  }

  function sessionStatusLabel(session) {
    const status = deriveStatus(session);
    if (status === 'live') return 'Live Now';
    if (status === 'ready') return 'Ready to Go Live';
    if (status === 'cancelled') return 'Cancelled';
    if (status === 'ended') return 'Completed';
    return 'Scheduled';
  }

  function isTerminalStatus(session) {
    const status = deriveStatus(session);
    return status === 'ended' || status === 'cancelled';
  }

  function liveBadgeClass(session) {
    const status = deriveStatus(session);
    if (status === 'live') return 'live';
    if (status === 'ready') return 'ready';
    if (status === 'cancelled') return 'ended';
    if (status === 'ended') return 'ended';
    return 'upcoming';
  }

  function cycleWindow(type) {
    const hub = state.config?.liveHub || {};
    const days = type === 'lab' ? Number(hub.labCycleDays || 7) : Number(hub.mentorshipCycleDays || 15);
    const limit = Number.isFinite(days) && days > 0 ? days : (type === 'lab' ? 7 : 15);
    const start = new Date();
    start.setDate(start.getDate() - 2);
    const end = new Date();
    end.setDate(end.getDate() + limit);
    return { start, end };
  }

  function inCycleWindow(session) {
    const start = sessionStart(session);
    if (!start) return true;
    const bounds = cycleWindow(String(session.type || '').toLowerCase());
    return start >= bounds.start && start <= bounds.end;
  }

  function normalizeSession(raw, index) {
    const type = String(raw?.type || raw?.sessionType || '').toLowerCase() === 'lab' ? 'lab' : 'mentorship';
    const id = String(raw?.id || raw?.sessionId || `${type}-${index + 1}`).trim();
    const title = text(raw?.title || raw?.sessionTitle || raw?.topic || raw?.name, type === 'lab' ? 'Hands-on Lab' : 'Mentorship Session');
    const mentorName = text(raw?.mentorName || raw?.mentor || raw?.facilitator, 'College Mentor');
    const roomId = text(raw?.roomId || raw?.roomName || raw?.channelName || raw?.channelId || raw?.meetingId || `${id}-room`, `${id}-room`).replace(/\s+/g, '-');
    const provider = String(raw?.provider || raw?.videoProvider || state.config?.liveHub?.defaultProvider || 'jitsi').toLowerCase();
    const startAt = raw?.scheduledStart || raw?.startAt || raw?.startsAt || raw?.dateTime || '';
    const endAt = raw?.scheduledEnd || raw?.endAt || raw?.endsAt || '';
    const status = String(raw?.status || '').toLowerCase();
    return {
      id,
      type,
      title,
      mentorName,
      mentorProfileKey: text(raw?.mentorProfileKey || raw?.mentorUid || raw?.mentorEmail || raw?.mentorId || '', ''),
      mentorAccessId: text(raw?.mentorAccessId || raw?.hostCode || raw?.hostCodeHint || raw?.liveAccessId || raw?.accessId, ''),
      roomId,
      provider,
      startAt,
      endAt,
      durationMinutes: Number(raw?.durationMinutes || raw?.durationMins || 60),
      status,
      summary: text(raw?.summary || raw?.description || raw?.topic || raw?.subtitle, ''),
      roomLabel: text(raw?.roomLabel || raw?.roomName || raw?.channelName, roomId),
      ctaLabel: text(raw?.ctaLabel || '', type === 'lab' ? 'Join Lab' : 'Join Session'),
      participantCount: Number(raw?.participantCount || raw?.participant_count || 0),
      presenceCount: Number(raw?.presenceCount || raw?.active_presence_count || 0),
      jitsiDomain: text(raw?.jitsiDomain || '', ''),
      channelName: text(raw?.channelName || raw?.roomName || roomId, roomId),
      assignedHostUserId: raw?.assignedHostUserId || raw?.assigned_host_user_id || raw?.mentorId || null,
      assignedHostEmail: text(raw?.assignedHostEmail || raw?.assigned_host_email || raw?.mentorEmail || '', ''),
      assignedHostUserRef: text(raw?.assignedHostUserRef || raw?.assignedHostEmail || raw?.mentorProfileKey || raw?.mentorEmail || raw?.mentorUid || '', ''),
      mentorEmail: text(raw?.mentorEmail || raw?.assignedHostEmail || '', ''),
      actualStart: raw?.actualStart || raw?.actual_start || null,
      actualEnd: raw?.actualEnd || raw?.actual_end || null,
      canControl: Boolean(raw?.canControl),
      hostUnlocked: Boolean(raw?.hostUnlocked),
      canUnlockHostMode: Boolean(raw?.canUnlockHostMode),
      isLive: Boolean(raw?.isLive)
    };
  }

  function normalizeConfig(payload) {
    const config = payload?.config || payload || {};
    const hub = config.liveHub || {};
    const sessions = Array.isArray(hub.sessions) ? hub.sessions.map(normalizeSession) : [];
    return {
      ...config,
      liveHub: {
        enabled: hub.enabled !== false,
        title: text(hub.title, 'Unified Live Hub'),
        subtitle: text(hub.subtitle, 'Mentorship sessions and hands-on labs in one place.'),
        mentorshipCycleDays: Number(hub.mentorshipCycleDays || 15),
        labCycleDays: Number(hub.labCycleDays || 7),
        defaultProvider: text(hub.defaultProvider, 'jitsi').toLowerCase(),
        sidebarLabel: text(hub.sidebarLabel, 'Live Hub'),
        sessions,
        activeSessionId: text(hub.activeSessionId, '')
      }
    };
  }

  function ensurePanel() {
    let panel = document.getElementById('liveHubPanel');
    if (panel) return panel;

    panel = document.createElement('aside');
    panel.id = 'liveHubPanel';
    panel.className = 'live-hub-panel';
    panel.setAttribute('aria-label', 'Live Hub');
    panel.innerHTML = `
      <div class="live-hub-shell">
        <header class="live-hub-head">
          <div>
            <p class="live-hub-kicker">Live Learning</p>
            <h3 id="liveHubTitle">Unified Live Hub</h3>
            <p class="live-hub-subtitle" id="liveHubSubtitle">Mentorship sessions and hands-on labs in one place.</p>
          </div>
          <button type="button" class="live-hub-close" data-live-hub-close aria-label="Close Live Hub"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <div class="live-hub-status-row">
          <span class="live-hub-status-chip" id="liveHubStatusChip">Syncing sessions...</span>
          <span class="live-hub-status-chip soft" id="liveHubCountChip">0 live</span>
        </div>
        <div class="live-hub-tabs" role="tablist" aria-label="Live Hub tabs">
          <button type="button" class="live-hub-tab is-active" data-live-hub-tab="live" role="tab">Live</button>
          <button type="button" class="live-hub-tab" data-live-hub-tab="upcoming" role="tab">Upcoming</button>
          <button type="button" class="live-hub-tab" data-live-hub-tab="history" role="tab">Completed</button>
        </div>
        <div class="live-hub-content" id="liveHubContent"></div>
      </div>
    `;
    document.body.appendChild(panel);
    return panel;
  }

  function renderWorkInProgressState() {
    const content = document.getElementById('liveHubContent');
    const title = document.getElementById('liveHubTitle');
    const subtitle = document.getElementById('liveHubSubtitle');
    const statusChip = document.getElementById('liveHubStatusChip');
    const countChip = document.getElementById('liveHubCountChip');
    const tabs = document.querySelectorAll('#liveHubPanel .live-hub-tabs .live-hub-tab');
    const tabsWrap = document.querySelector('#liveHubPanel .live-hub-tabs');

    if (title) title.textContent = state.config?.liveHub?.title || 'Unified Live Hub';
    if (subtitle) subtitle.textContent = state.config?.liveHub?.subtitle || 'Mentorship sessions and hands-on labs in one place.';
    if (statusChip) statusChip.textContent = 'Work in Progress';
    if (countChip) countChip.textContent = 'Hidden';
    if (tabsWrap) tabsWrap.hidden = true;
    tabs.forEach((tab) => { tab.hidden = true; });

    if (!content) return;
    content.innerHTML = `
      <div style="display:grid;place-items:center;min-height:360px;padding:12px;">
        <div style="width:min(100%, 520px);background:linear-gradient(180deg, rgba(255,255,255,.98), rgba(244,249,255,.98));border:1px solid rgba(148,163,184,.25);border-radius:22px;box-shadow:0 20px 44px rgba(15,23,42,.10);padding:28px 24px;text-align:center;display:grid;gap:14px;">
          <div style="width:72px;height:72px;margin:0 auto;border-radius:20px;display:grid;place-items:center;background:linear-gradient(135deg, rgba(15,118,110,.14), rgba(14,165,233,.12));color:#0f766e;font-size:1.8rem;box-shadow:inset 0 1px 0 rgba(255,255,255,.7);"><i class="fa-solid fa-satellite-dish"></i></div>
          <div>
            <p style="margin:0;color:#0f766e;font-size:0.78rem;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;">Work in Progress</p>
            <h4 style="margin:10px 0 8px;font-size:1.8rem;line-height:1.12;letter-spacing:-0.03em;color:#0f172a;">Live Hub is coming soon.</h4>
            <p style="margin:0;color:#53657d;font-size:0.98rem;line-height:1.7;">We are improving live sessions for a better learning experience.</p>
          </div>
          <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
            <button type="button" class="btn primary" data-live-hub-back-to-dashboard>Back to Dashboard</button>
          </div>
        </div>
      </div>
    `;
  }

  function ensureStage() {
    const contentMount = document.getElementById('contentMount');
    if (!contentMount) return null;
    let stage = document.getElementById('liveHubStage');
    if (stage) return stage;

    stage = document.createElement('section');
    stage.id = 'liveHubStage';
    stage.className = 'live-hub-stage';
    stage.hidden = true;
    stage.innerHTML = `
      <div class="live-hub-stage-shell">
        <div class="live-hub-stage-head">
          <div>
            <p class="live-hub-kicker">Session Live</p>
            <h2 id="liveHubStageTitle">Live Session</h2>
            <p class="live-hub-subtitle" id="liveHubStageSubtitle">Join the embedded video and chat without leaving College OS.</p>
          </div>
          <button type="button" class="live-hub-close" data-live-hub-stage-close aria-label="Close live session"><i class="fa-solid fa-chevron-left"></i> Back</button>
        </div>
        <div class="live-hub-status-row" style="margin-bottom:12px;">
          <span class="live-hub-status-chip" id="liveHubNetworkChip">Network checking...</span>
          <span class="live-hub-status-chip soft" id="liveHubPresenceChip">Presence syncing...</span>
          <span class="live-hub-status-chip soft" id="liveHubReconnectChip">Connected</span>
        </div>
        <div class="live-hub-stage-grid">
          <article class="live-hub-video-card">
            <div class="live-hub-stage-meta" id="liveHubStageMeta"></div>
            <div class="live-hub-activity-rail" id="liveHubActivityRail"></div>
            <div class="live-hub-waiting-room" id="liveHubWaitingRoom" hidden>
              <div class="live-hub-waiting-hero">
                <div class="live-hub-live-dot">Waiting Room</div>
                <h3 id="liveHubWaitingTitle">Session waiting room</h3>
                <p id="liveHubWaitingSubtitle">The mentor has not started this session yet.</p>
              </div>
              <div class="live-hub-waiting-grid">
                <div class="live-hub-skeleton-card shimmer"></div>
                <div class="live-hub-skeleton-card shimmer"></div>
                <div class="live-hub-skeleton-card shimmer"></div>
              </div>
              <div class="live-hub-waiting-actions">
                <button type="button" class="btn primary" id="liveHubWaitingCheckPermissions">Check Mic / Camera</button>
                <button type="button" class="btn secondary" id="liveHubWaitingRefresh">Refresh Status</button>
              </div>
              <p class="live-hub-waiting-note" id="liveHubWaitingNote">You will be moved into the live room automatically when the session starts.</p>
            </div>
            <div class="live-hub-video-mount" id="liveHubVideoMount"></div>
          </article>
          <aside class="live-hub-chat-card">
            <div class="live-hub-chat-head">
              <div>
                <h3>Chat</h3>
                <p>Basic real-time discussion for the active room.</p>
              </div>
              <span class="live-hub-status-chip soft" id="liveHubChatRoomLabel">Room</span>
            </div>
            <div class="live-hub-chat-list" id="liveHubChatList"></div>
            <form class="live-hub-chat-form" id="liveHubChatForm">
              <input type="text" id="liveHubChatInput" placeholder="Send a message" autocomplete="off" maxlength="280" />
              <button type="submit" class="btn primary">Send</button>
            </form>
          </aside>
        </div>
      </div>
    `;
    contentMount.appendChild(stage);
    return stage;
  }

  function currentUserName() {
    const user = state.user || window.collegeOsCurrentUser || {};
    return text(user.fullName || user.full_name || user.name || 'You', 'You');
  }

  function currentUserRole() {
    const user = state.user || window.collegeOsCurrentUser || {};
    return String(user.role || 'student').toLowerCase();
  }

  function currentUserIdentityTokens() {
    const user = state.user || window.collegeOsCurrentUser || {};
    return [
      user.id,
      user.uid,
      user.email,
      user.fullName,
      user.full_name,
      user.name,
      user.username,
      user.handle
    ].map(normalizeIdentityToken).filter(Boolean);
  }

  function isAssignedHostSession(session) {
    if (!session) return false;
    const role = currentUserRole();
    if (role === 'admin' || role === 'super_admin') return true;
    const sessionMentorKey = normalizeIdentityToken(
      session.assignedHostUserRef
      || session.assignedHostEmail
      || session.assignedHostUserId
      || session.mentorProfileKey
      || session.mentorUid
      || session.mentorEmail
      || session.mentorUserId
    );
    if (!sessionMentorKey) return false;
    return currentUserIdentityTokens().includes(sessionMentorKey);
  }

  function hostModeUnlockKey(sessionId) {
    return `collegeos_live_hub_unlocked:${sessionId}`;
  }

  function isHostModeUnlockedLocal(sessionId) {
    if (!sessionId) return false;
    try {
      return window.localStorage.getItem(hostModeUnlockKey(sessionId)) === '1';
    } catch {
      return false;
    }
  }

  function markHostModeUnlockedLocal(sessionId) {
    if (!sessionId) return;
    try {
      window.localStorage.setItem(hostModeUnlockKey(sessionId), '1');
    } catch {
      // Ignore storage failures.
    }
  }

  function clearHostModeUnlockedLocal(sessionId) {
    if (!sessionId) return;
    try {
      window.localStorage.removeItem(hostModeUnlockKey(sessionId));
    } catch {
      // Ignore storage failures.
    }
  }

  function canControlSession(session) {
    if (!session) return false;
    const role = currentUserRole();
    if (role === 'admin' || role === 'super_admin') return true;
    return Boolean(session.hostUnlocked) || isHostModeUnlockedLocal(session.id);
  }

  function formatSessionSummary(session) {
    const status = sessionStatusLabel(session);
    const start = sessionStart(session);
    const end = sessionEnd(session);
    const timer = deriveStatus(session) === 'live'
      ? `Ends in ${formatCountdown(end)}`
      : `Starts in ${formatCountdown(start)}`;
    return `${status} · ${timer}`;
  }

  function filteredSessions(type) {
    const sessions = state.sessions.filter((session) => session.type === type && inCycleWindow(session));
    sessions.sort((a, b) => {
      const aStart = sessionStart(a)?.getTime() || 0;
      const bStart = sessionStart(b)?.getTime() || 0;
      return aStart - bStart;
    });
    return sessions;
  }

  function sessionsByTab(tab) {
    const rows = state.sessions.filter((session) => inCycleWindow(session));
    if (tab === 'history') {
      return rows.filter((session) => isTerminalStatus(session));
    }
    if (tab === 'upcoming') {
      return rows.filter((session) => {
        const status = deriveStatus(session);
        return status === 'upcoming' || status === 'ready';
      });
    }
    return rows.filter((session) => deriveStatus(session) === 'live');
  }

  function messageKey(sessionId) {
    return `${CHAT_PREFIX}${sessionId}`;
  }

  function readMessages(sessionId) {
    try {
      const raw = window.localStorage.getItem(messageKey(sessionId));
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeMessages(sessionId, messages) {
    try {
      window.localStorage.setItem(messageKey(sessionId), JSON.stringify(messages));
    } catch {
      // Ignore storage failures.
    }
  }

  async function loadRemoteMessages(sessionId) {
    if (!window.CollegeOSApi?.liveSessionChatMessages) return readMessages(sessionId);
    try {
      const payload = await window.CollegeOSApi.liveSessionChatMessages(sessionId, { limit: 50 });
      const messages = Array.isArray(payload?.messages) ? payload.messages.map((message) => ({
        id: message.id,
        sender: message.user_name || message.userEmail || 'Participant',
        role: message.role || 'student',
        text: message.body || message.text || '',
        time: message.created_at || new Date().toISOString(),
        reaction: message.reaction || null,
        isSystem: Boolean(message.is_system)
      })) : [];
      if (messages.length) writeMessages(sessionId, messages);
      return messages.length ? messages : readMessages(sessionId);
    } catch {
      return readMessages(sessionId);
    }
  }

  async function loadRemotePresence(sessionId) {
    if (!window.CollegeOSApi?.liveSessionPresence) return [];
    try {
      const payload = await window.CollegeOSApi.liveSessionPresence(sessionId);
      return Array.isArray(payload?.presence) ? payload.presence : [];
    } catch {
      return [];
    }
  }

  async function loadRemoteActivity(sessionId) {
    if (!window.CollegeOSApi?.liveSessionActivity) return [];
    try {
      const payload = await window.CollegeOSApi.liveSessionActivity(sessionId, { limit: 25 });
      return Array.isArray(payload?.activity) ? payload.activity : [];
    } catch {
      return [];
    }
  }

  async function loadCollaborationState(session) {
    if (!session?.id) return;
    const [messages, presence, activity] = await Promise.all([
      loadRemoteMessages(session.id),
      loadRemotePresence(session.id),
      loadRemoteActivity(session.id)
    ]);
    state.chatMessages = messages;
    state.presence = presence;
    state.activityFeed = activity;
    renderChatMessages();
    renderActivityRail();
    renderPresenceChip();
  }

  async function sendPresenceHeartbeat(extra = {}) {
    if (!state.activeSession || !window.CollegeOSApi?.liveSessionPresenceUpdate) return;
    try {
      const payload = await window.CollegeOSApi.liveSessionPresenceUpdate(state.activeSession.id, {
        status: 'online',
        isPresent: true,
        isTyping: Boolean(extra.isTyping),
        deviceInfo: {
          fullscreen: document.fullscreenElement ? true : false,
          visibility: document.hidden ? 'hidden' : 'visible',
          userAgent: navigator.userAgent,
          connection: navigator.connection?.effectiveType || 'unknown'
        },
        meta: {
          action: extra.action || 'heartbeat',
          role: canControlSession(state.activeSession) ? 'host' : 'participant'
        }
      });
      if (payload?.presence) {
        state.presence = payload.presence;
        renderPresenceChip();
      }
    } catch {
      // Presence heartbeat failures are non-fatal.
    }
  }

  function renderPresenceChip() {
    const chip = document.getElementById('liveHubPresenceChip');
    if (!chip) return;
    const online = Array.isArray(state.presence) ? state.presence.filter((item) => String(item.status || '').toLowerCase() !== 'offline') : [];
    chip.textContent = online.length ? `${online.length} online` : 'No active presence';
  }

  function renderActivityRail() {
    const rail = document.getElementById('liveHubActivityRail');
    if (!rail) return;
    const items = Array.isArray(state.activityFeed) ? state.activityFeed.slice(-5).reverse() : [];
    if (!items.length) {
      rail.innerHTML = '<div class="live-hub-activity-pill">Session activity will appear here.</div>';
      return;
    }
    rail.innerHTML = items.map((item) => `
      <div class="live-hub-activity-pill">
        <strong>${esc(item.action || 'event')}</strong>
        <span>${esc(new Date(item.created_at || Date.now()).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }))}</span>
      </div>
    `).join('');
  }

  function mentorAccessKey(sessionId) {
    return `collegeos_live_hub_access:${sessionId}`;
  }

  function rememberMentorAccess(sessionId, accessId) {
    if (!sessionId || !accessId) return;
    try {
      window.localStorage.setItem(mentorAccessKey(sessionId), String(accessId));
    } catch {
      // Ignore storage failures.
    }
  }

  function readMentorAccess(sessionId) {
    try {
      return window.localStorage.getItem(mentorAccessKey(sessionId)) || '';
    } catch {
      return '';
    }
  }

  function renderChatMessages() {
    const list = document.getElementById('liveHubChatList');
    if (!list || !state.activeSession) return;

    const messages = state.chatMessages.length ? state.chatMessages : [{
      id: 'welcome',
      sender: 'System',
      role: 'system',
      text: 'This room is ready. Say hello when the session starts.',
      time: new Date().toISOString()
    }];

    list.innerHTML = messages.map((message) => `
      <article class="live-hub-message ${message.role || 'student'}">
        <div class="live-hub-message-head">
          <strong>${esc(message.sender || 'Student')}</strong>
          <span>${new Date(message.time || Date.now()).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>
        </div>
        <p>${esc(message.text || '')}</p>
      </article>
    `).join('');
    list.scrollTop = list.scrollHeight;
  }

  function renderNetworkChip() {
    const chip = document.getElementById('liveHubNetworkChip');
    if (!chip) return;
    const effective = navigator.connection?.effectiveType || 'online';
    chip.textContent = state.reconnectState === 'reconnecting' ? 'Reconnecting...' : `Network ${effective}`;
  }

  function renderReconnectChip() {
    const chip = document.getElementById('liveHubReconnectChip');
    if (!chip) return;
    chip.textContent = state.reconnectState === 'reconnecting' ? 'Reconnecting' : 'Connected';
  }

  function broadcastMessage(message) {
    try {
      if (!state.chatChannel) return;
      state.chatChannel.postMessage({ type: 'message', sessionId: state.activeSessionId, message });
    } catch {
      // Ignore broadcast failures.
    }
  }

  function setupChatChannel(session) {
    if (state.chatChannel) {
      state.chatChannel.close();
      state.chatChannel = null;
    }

    const channelId = session?.roomId || session?.id;
    if (typeof window.BroadcastChannel !== 'function' || !channelId) return;

    const channel = new BroadcastChannel(`${CHANNEL_PREFIX}${channelId}`);
    channel.onmessage = (event) => {
      if (!event.data || event.data.sessionId !== state.activeSessionId) return;
      if (event.data.type === 'message') {
        state.chatMessages = readMessages(state.activeSessionId);
        renderChatMessages();
      }
      if (event.data.type === 'presence' && Array.isArray(event.data.presence)) {
        state.presence = event.data.presence;
        renderPresenceChip();
      }
      if (event.data.type === 'activity' && Array.isArray(event.data.activity)) {
        state.activityFeed = event.data.activity;
        renderActivityRail();
      }
      if (event.data.type === 'session-updated') {
        refresh().catch(() => null);
      }
    };

    state.chatChannel = channel;
  }

  function addChatMessage(textValue) {
    if (!state.activeSession) return;
    const text = textValue.trim();
    if (!text) return;
    const optimistic = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sender: currentUserName(),
      role: currentUserRole() === 'admin' || currentUserRole() === 'super_admin' || canControlSession(state.activeSession) ? 'host' : 'student',
      text,
      time: new Date().toISOString()
    };
    const messages = [...readMessages(state.activeSessionId), optimistic];
    writeMessages(state.activeSessionId, messages);
    state.chatMessages = messages;
    renderChatMessages();
    broadcastMessage(optimistic);
    if (window.CollegeOSApi?.liveSessionPostChatMessage) {
      window.CollegeOSApi.liveSessionPostChatMessage(state.activeSessionId, { body: text, messageType: 'message' })
        .then((payload) => {
          if (payload?.message) {
            const nextMessages = messages.map((item) => (item.id === optimistic.id ? {
              id: payload.message.id,
              sender: payload.message.user_name || optimistic.sender,
              role: payload.message.role || optimistic.role,
              text: payload.message.body || optimistic.text,
              time: payload.message.created_at || optimistic.time,
              reaction: payload.message.reaction || null
            } : item));
            writeMessages(state.activeSessionId, nextMessages);
            state.chatMessages = nextMessages;
            renderChatMessages();
          }
        })
        .catch(() => null);
    }
  }

  function startHeartbeat() {
    if (state.heartbeatTimer) {
      window.clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
    state.heartbeatTimer = window.setInterval(() => {
      if (!state.activeSessionId || document.hidden) return;
      sendPresenceHeartbeat({ action: 'heartbeat' }).catch(() => null);
    }, 15000);
  }

  async function loadJitsiScript(domain) {
    const jitsiDomain = String(domain || state.joinContext?.jitsiDomain || state.config?.liveHub?.jitsiDomain || 'meet.jit.si').trim() || 'meet.jit.si';
    if (window.JitsiMeetExternalAPI) return window.JitsiMeetExternalAPI;
    if (document.getElementById(JITSI_SCRIPT_ID)) {
      return new Promise((resolve) => {
        const poll = () => {
          if (window.JitsiMeetExternalAPI) resolve(window.JitsiMeetExternalAPI);
          else window.setTimeout(poll, 50);
        };
        poll();
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.id = JITSI_SCRIPT_ID;
      script.src = `https://${jitsiDomain}/external_api.js`;
      script.async = true;
      script.onload = () => resolve(window.JitsiMeetExternalAPI || null);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function loadAgoraScript() {
    if (window.AgoraRTC) return window.AgoraRTC;
    if (document.getElementById('collegeos-agora-sdk')) {
      return new Promise((resolve) => {
        const poll = () => {
          if (window.AgoraRTC) resolve(window.AgoraRTC);
          else window.setTimeout(poll, 50);
        };
        poll();
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.id = 'collegeos-agora-sdk';
      script.src = 'https://download.agora.io/sdk/release/AgoraRTC_N.js';
      script.async = true;
      script.onload = () => resolve(window.AgoraRTC || null);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function loadAgoraToken(session, forceRefresh = false) {
    if (!forceRefresh && state.joinContext?.agora) return state.joinContext.agora;

    const response = await window.CollegeOSApi.liveSessionJoin(session.id, { refreshToken: Boolean(forceRefresh) });
    state.joinContext = response.meeting || null;
    return state.joinContext?.agora || null;
  }

  async function cleanupAgoraSession() {
    try {
      if (Array.isArray(state.agoraLocalTracks)) {
        state.agoraLocalTracks.forEach((track) => {
          try {
            track?.stop?.();
            track?.close?.();
          } catch {
            // Ignore track cleanup failures.
          }
        });
      }
      state.agoraLocalTracks = [];
      if (state.agoraClient) {
        try {
          await state.agoraClient.leave();
        } catch {
          // Ignore leave failures.
        }
      }
    } finally {
      state.agoraClient = null;
    }
  }

  async function mountAgoraSession(session) {
    const mount = document.getElementById('liveHubVideoMount');
    if (!mount || !session) return;

    mount.innerHTML = `
      <div class="live-hub-video-fallback">
        <div>
          <strong>${esc(session.title)}</strong>
          <p>Connecting to the Agora room ${esc(session.roomId || session.id)}...</p>
        </div>
      </div>
    `;

    try {
      const AgoraRTC = await loadAgoraScript();
      if (!AgoraRTC) throw new Error('Agora SDK unavailable');
      const tokenInfo = await loadAgoraToken(session);
      if (!tokenInfo) throw new Error('Missing Agora join context');

      await cleanupAgoraSession();
      mount.innerHTML = '<div class="live-hub-agora-stage" id="liveHubAgoraStage"></div>';
      const stage = document.getElementById('liveHubAgoraStage');
      if (!stage) return;

      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      state.agoraClient = client;
      const remoteTrackNodes = new Map();

      client.on('user-published', async (user, mediaType) => {
        await client.subscribe(user, mediaType);
        const remoteId = `agora-remote-${user.uid}-${mediaType}`;
        let node = remoteTrackNodes.get(remoteId);
        if (!node) {
          node = document.createElement('div');
          node.className = 'live-hub-agora-remote';
          node.dataset.remoteId = remoteId;
          stage.appendChild(node);
          remoteTrackNodes.set(remoteId, node);
        }

        if (mediaType === 'video') {
          node.innerHTML = '';
          user.videoTrack.play(node);
        }
        if (mediaType === 'audio') {
          user.audioTrack.play();
        }
      });

      client.on('user-unpublished', (user, mediaType) => {
        const remoteId = `agora-remote-${user.uid}-${mediaType}`;
        const node = remoteTrackNodes.get(remoteId);
        if (node) {
          node.remove();
          remoteTrackNodes.delete(remoteId);
        }
      });

      await client.join(tokenInfo.appId, tokenInfo.channelName, tokenInfo.token || null, tokenInfo.uid || null);

      const publishMode = tokenInfo.canPublish || currentUserRole() === 'admin' || currentUserRole() === 'super_admin';
      if (publishMode && AgoraRTC.createMicrophoneAndCameraTracks) {
        const tracks = await AgoraRTC.createMicrophoneAndCameraTracks({ microphoneConfig: {} }, { cameraConfig: {} });
        state.agoraLocalTracks = tracks;
        const localContainer = document.createElement('div');
        localContainer.className = 'live-hub-agora-local';
        localContainer.id = 'liveHubAgoraLocal';
        stage.prepend(localContainer);
        tracks[1]?.play(localContainer);
        await client.publish(tracks);
      }

      if (!publishMode) {
        stage.insertAdjacentHTML('afterbegin', '<div class="live-hub-agora-banner">Watching live Agora session.</div>');
      }

      client.on('token-privilege-will-expire', async () => {
        try {
          const refreshed = await loadAgoraToken(session, true);
          if (refreshed?.token) {
            await client.renewToken(refreshed.token);
          }
        } catch {
          // Ignore refresh failures and let the session fall back naturally.
        }
      });
    } catch (error) {
      mount.innerHTML = `
        <div class="live-hub-video-fallback">
          <div>
            <strong>${esc(session.title)}</strong>
            <p>Agora could not start, so the room is falling back to the embedded web view.</p>
          </div>
        </div>
      `;
      await cleanupAgoraSession();
      throw error;
    }
  }

  function destroyVideo() {
    try {
      if (state.videoApi && typeof state.videoApi.dispose === 'function') {
        state.videoApi.dispose();
      }
    } catch {
      // Ignore cleanup failures.
    }
    state.videoApi = null;
    cleanupAgoraSession().catch(() => null);
    const mount = document.getElementById('liveHubVideoMount');
    if (mount) mount.innerHTML = '';
  }

  async function mountVideo(session) {
    const mount = document.getElementById('liveHubVideoMount');
    if (!mount || !session) return;
    destroyVideo();

    const roomName = session.roomId || session.id;
    const provider = sessionProvider(session);

    mount.innerHTML = `<div class="live-hub-video-fallback"><div><strong>${esc(session.title)}</strong><p>Loading ${esc(provider.toUpperCase())} room ${esc(roomName)}...</p></div></div>`;

    if (provider === 'agora') {
      try {
        await mountAgoraSession(session);
        state.videoMode = 'agora';
        return;
      } catch {
        // Fall through to the Jitsi embed fallback below.
      }
    }

    if (provider === 'jitsi') {
      try {
        const ExternalAPI = await loadJitsiScript(session.jitsiDomain);
        if (ExternalAPI) {
          mount.innerHTML = '';
          state.videoMode = 'jitsi';
          state.videoApi = new ExternalAPI(session.jitsiDomain || state.joinContext?.jitsiDomain || 'meet.jit.si', {
            roomName,
            parentNode: mount,
            width: '100%',
            height: '100%',
            configOverwrite: {
              prejoinPageEnabled: false,
              startWithVideoMuted: false,
              startWithAudioMuted: false,
              disableInviteFunctions: true,
              enableNoisyMicDetection: false
            },
            interfaceConfigOverwrite: {
              TOOLBAR_BUTTONS: ['microphone', 'camera', 'chat', 'desktop', 'fullscreen', 'hangup', 'tileview'],
              SHOW_JITSI_WATERMARK: false,
              SHOW_WATERMARK_FOR_GUESTS: false,
              DEFAULT_REMOTE_DISPLAY_NAME: 'Participant'
            }
          });
          return;
        }
      } catch {
        // Fall back to iframe embed below.
      }
    }

    state.videoMode = 'iframe';
    const jitsiDomain = session.jitsiDomain || state.joinContext?.jitsiDomain || state.config?.liveHub?.jitsiDomain || 'meet.jit.si';
    mount.innerHTML = `
      <iframe
        class="live-hub-iframe"
        src="https://${esc(jitsiDomain)}/${encodeURIComponent(roomName)}#config.prejoinPageEnabled=false&interfaceConfig.toolbarButtons=%5B%22microphone%22,%22camera%22,%22chat%22,%22desktop%22,%22fullscreen%22,%22hangup%22%5D"
        allow="camera; microphone; fullscreen; display-capture; autoplay"
        referrerpolicy="no-referrer"
        title="Embedded live session"
      ></iframe>
    `;
  }

  function updateSidebarPulse() {
    const button = document.querySelector('[data-live-hub-toggle]');
    if (!button) return;
    const hasLive = state.sessions.some((session) => deriveStatus(session) === 'live');
    button.classList.toggle('has-live', hasLive);
    button.dataset.liveState = hasLive ? 'live' : 'idle';
  }

  function renderStageHeader(session) {
    const title = document.getElementById('liveHubStageTitle');
    const subtitle = document.getElementById('liveHubStageSubtitle');
    const meta = document.getElementById('liveHubStageMeta');
    const room = document.getElementById('liveHubChatRoomLabel');

    if (title) title.textContent = session.title;
    if (subtitle) subtitle.textContent = `${session.type === 'lab' ? 'Hands-on Lab' : 'Mentorship Session'} with ${session.mentorName}`;
    if (meta) {
      meta.innerHTML = `
        <span class="live-hub-meta-pill"><i class="fa-solid fa-user-tie"></i> ${esc(session.mentorName)}</span>
        <span class="live-hub-meta-pill"><i class="fa-solid fa-calendar-days"></i> ${esc(formatDateTime(session.startAt))}</span>
        <span class="live-hub-meta-pill"><i class="fa-solid fa-video"></i> ${esc(sessionProvider(session).toUpperCase())}</span>
        <span class="live-hub-meta-pill"><i class="fa-solid fa-circle-${deriveStatus(session) === 'live' ? 'play' : 'clock'}"></i> ${esc(sessionStatusLabel(session))}</span>
        <span class="live-hub-meta-pill"><i class="fa-solid fa-users"></i> ${Number(session.presenceCount || 0)} present</span>
        <span class="live-hub-meta-pill accent">Mentor control</span>
      `;
    }
    if (room) room.textContent = session.roomLabel || session.roomId || 'Room';
  }

  function renderWaitingRoom(session) {
    const waitingRoom = document.getElementById('liveHubWaitingRoom');
    const waitingTitle = document.getElementById('liveHubWaitingTitle');
    const waitingSubtitle = document.getElementById('liveHubWaitingSubtitle');
    const waitingNote = document.getElementById('liveHubWaitingNote');
    const stageMeta = document.getElementById('liveHubStageMeta');
    const videoMount = document.getElementById('liveHubVideoMount');

    if (waitingRoom) waitingRoom.hidden = false;
    if (waitingTitle) waitingTitle.textContent = `${session.title} is waiting to start`;
    if (waitingSubtitle) waitingSubtitle.textContent = `Starts ${formatDateTime(session.startAt)} · ${session.mentorName}`;
    if (waitingNote) waitingNote.textContent = canControlSession(session)
      ? 'You can start this session from the control panel once you validate the host code.'
      : 'You will be moved into the live room automatically when the mentor starts the session.';
    if (stageMeta) {
      stageMeta.innerHTML = `
        <span class="live-hub-meta-pill"><i class="fa-solid fa-user-tie"></i> ${esc(session.mentorName)}</span>
        <span class="live-hub-meta-pill"><i class="fa-solid fa-calendar-days"></i> ${esc(formatDateTime(session.startAt))}</span>
        <span class="live-hub-meta-pill"><i class="fa-solid fa-clock"></i> ${esc(formatCountdown(sessionStart(session)))}</span>
        <span class="live-hub-meta-pill accent">Waiting room</span>
      `;
    }
    if (videoMount) videoMount.innerHTML = '';
  }

  async function checkWaitingRoomDevices() {
    if (!navigator.mediaDevices?.getUserMedia) {
      notify('Your browser does not support camera and microphone checks.', 'warning');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach((track) => track.stop());
      notify('Camera and microphone permissions are ready.', 'success');
    } catch (error) {
      notify(error?.message || 'Camera or microphone permission is required for this session.', 'warning');
    }
  }

  function renderStage() {
    const stage = ensureStage();
    if (!stage || !state.activeSession) return;
    if (isTerminalStatus(state.activeSession)) {
      clearActiveSessionPersistence();
      hideStage();
      return;
    }
    stage.hidden = false;
    stage.classList.add('is-visible');
    const contentMount = document.getElementById('contentMount');
    if (contentMount) contentMount.classList.add('live-session-active');
    const status = deriveStatus(state.activeSession);
    const canControl = canControlSession(state.activeSession);
    const waitingRoom = document.getElementById('liveHubWaitingRoom');
    const videoMount = document.getElementById('liveHubVideoMount');

    if (waitingRoom) waitingRoom.hidden = status === 'live';
    if (typeof state.activeSession.waitingRoom === 'boolean') {
      state.waitingRoomActive = state.activeSession.waitingRoom;
    }

    if (status !== 'live') {
      state.waitingRoomActive = true;
      renderWaitingRoom(state.activeSession);
      destroyVideo();
      if (videoMount) videoMount.innerHTML = '';
      state.chatMessages = readMessages(state.activeSessionId);
      setupChatChannel(state.activeSession);
      renderChatMessages();
      loadCollaborationState(state.activeSession).catch(() => null);
      startHeartbeat();
      return;
    }

    state.waitingRoomActive = false;
    if (waitingRoom) waitingRoom.hidden = true;
    renderStageHeader(state.activeSession);
    state.chatMessages = readMessages(state.activeSessionId);
    setupChatChannel(state.activeSession);
    renderChatMessages();
    loadCollaborationState(state.activeSession).catch(() => null);
    startHeartbeat();
    mountVideo(state.activeSession).catch(() => null);
  }

  function hideStage() {
    if (state.activeSessionId) {
      window.CollegeOSApi?.liveSessionLeave?.(state.activeSessionId).catch(() => null);
    }
    state.waitingRoomActive = false;
    disposeSessionRuntime({ keepRefreshTimer: true });
    state.joinContext = null;
    state.activeSessionId = null;
    state.activeSession = null;
    clearActiveSessionPersistence();
    const stage = document.getElementById('liveHubStage');
    if (stage) {
      stage.hidden = true;
      stage.classList.remove('is-visible');
    }
    const contentMount = document.getElementById('contentMount');
    if (contentMount) contentMount.classList.remove('live-session-active');
    renderNetworkChip();
    renderReconnectChip();
  }

  function openPanel() {
    const panel = ensurePanel();
    panel.classList.add('is-open');
    document.body.classList.add('live-hub-panel-open');
    state.open = true;
    const stored = loadUiState();
    stored.open = true;
    saveUiState(stored);
  }

  function closePanel() {
    const panel = ensurePanel();
    panel.classList.remove('is-open');
    document.body.classList.remove('live-hub-panel-open');
    state.open = false;
    const stored = loadUiState();
    stored.open = false;
    saveUiState(stored);
  }

  function togglePanel() {
    if (state.open) closePanel();
    else openPanel();
  }

  function selectTab(tab) {
    state.tab = tab === 'upcoming' || tab === 'history' ? tab : 'live';
    const stored = loadUiState();
    stored.tab = state.tab;
    saveUiState(stored);
    renderPanel();
  }

  function renderSessionCard(session) {
    const status = deriveStatus(session);
    const live = status === 'live';
    const ended = status === 'ended';
    const terminal = isTerminalStatus(session);
    const primaryLabel = live
      ? (session.type === 'lab' ? 'Join Lab' : 'Join Session')
      : (terminal ? 'View Details' : 'Join Waiting Room');
    const canControl = canControlSession(session);
    const canUnlockHostMode = isAssignedHostSession(session) && !canControl;
    const cancelled = status === 'cancelled';
    const controlLabel = live ? 'End Session' : 'Start Session';
    const timerLabel = live ? `Ends in ${formatCountdown(sessionEnd(session))}` : `Starts in ${formatCountdown(sessionStart(session))}`;
    const joinDisabled = false;
    const hostModeLabel = canControl ? 'Host Mode Available' : 'Student Join Only';
    const showUnlock = canUnlockHostMode && !terminal;
    const showControl = canControl && !terminal;
    const primaryBtnClass = terminal ? 'btn secondary sm' : 'btn primary sm';
    const completedSummary = terminal
      ? `<div class="live-hub-session-complete-note">Session Completed. View details only.</div>`
      : '';

    return `
      <article class="live-hub-session-card ${liveBadgeClass(session)}${state.activeSessionId === session.id ? ' is-selected' : ''}">
        <div class="live-hub-session-head">
          <span class="live-hub-session-type">${esc(session.type === 'lab' ? 'Hands-on Lab' : 'Mentorship')}</span>
          <span class="live-hub-session-status ${status}">${esc(sessionStatusLabel(session))}</span>
        </div>
        <h4>${esc(session.title)}</h4>
        <p>${esc(session.summary || session.mentorName)}</p>
        <div class="live-hub-session-meta-row">
          <span><i class="fa-solid fa-user-tie"></i> ${esc(session.mentorName)}</span>
          <span><i class="fa-solid fa-calendar-days"></i> ${esc(formatDateTime(session.startAt))}</span>
        </div>
        <div class="live-hub-session-operator-row">
          <span class="live-hub-session-operator">${esc(hostModeLabel)}</span>
          <span class="live-hub-session-operator-note">${canControl ? 'Signed-in host can validate the code and start or end the session from this portal.' : 'Students can only join when the session is live.'}</span>
        </div>
        <div class="live-hub-session-timer">${esc(timerLabel)}</div>
        ${completedSummary}
        <div class="live-hub-session-actions">
          <button type="button" class="${primaryBtnClass}" data-live-hub-join="${esc(session.id)}"${joinDisabled ? ' disabled' : ''}>${esc(primaryLabel)}</button>
          ${showUnlock ? `<button type="button" class="btn secondary sm" data-live-hub-unlock="${esc(session.id)}">Unlock Host Mode</button>` : ''}
          ${showControl ? `<button type="button" class="btn secondary sm" data-live-hub-control="${esc(session.id)}" data-live-hub-control-action="${live ? 'end' : 'start'}">${esc(controlLabel)}</button>` : ''}
        </div>
      </article>
    `;
  }

  function renderPanel() {
    const panel = ensurePanel();
    const title = document.getElementById('liveHubTitle');
    const subtitle = document.getElementById('liveHubSubtitle');
    const content = document.getElementById('liveHubContent');
    const statusChip = document.getElementById('liveHubStatusChip');
    const countChip = document.getElementById('liveHubCountChip');

    if (!panel || !content) return;
    if (title) title.textContent = state.config?.liveHub?.title || 'Unified Live Hub';
    if (subtitle) subtitle.textContent = state.config?.liveHub?.subtitle || 'Mentorship sessions and hands-on labs in one place.';

    const enabled = isLiveHubEnabled();
    const tabsWrap = panel.querySelector('.live-hub-tabs');
    if (tabsWrap) tabsWrap.hidden = !enabled;
    if (!enabled) {
      renderWorkInProgressState();
      return;
    }

    const tabs = panel.querySelectorAll('[data-live-hub-tab]');
    tabs.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.liveHubTab === state.tab));

    const liveSessions = sessionsByTab('live');
    const upcomingSessions = sessionsByTab('upcoming');
    const historySessions = sessionsByTab('history');
    const liveCount = state.sessions.filter((session) => deriveStatus(session) === 'live').length;

    if (statusChip) statusChip.textContent = liveCount ? `${liveCount} session${liveCount === 1 ? '' : 's'} live` : 'No session live right now';
    if (countChip) countChip.textContent = `${liveCount} live`;
    if (tabsWrap) tabsWrap.hidden = false;
    tabs.forEach((tab) => { tab.hidden = false; });

    const activeSessions = sessionsByTab(state.tab);
    if (!state.ready) {
      content.innerHTML = `
        <div class="live-hub-skeleton-list">
          <div class="live-hub-session-card live-hub-skeleton-card shimmer"></div>
          <div class="live-hub-session-card live-hub-skeleton-card shimmer"></div>
          <div class="live-hub-session-card live-hub-skeleton-card shimmer"></div>
        </div>
      `;
      return;
    }
    if (!state.sessions.length) {
      content.innerHTML = '<div class="live-hub-empty">No live sessions are scheduled right now. Check back later or ask an admin to publish a session.</div>';
      return;
    }
    if (!activeSessions.length) {
      const copy = state.tab === 'live'
        ? 'No sessions are live right now.'
        : (state.tab === 'upcoming' ? 'No upcoming sessions in the current window.' : 'No completed sessions yet.');
      content.innerHTML = `<div class="live-hub-empty">${copy}</div>`;
      return;
    }

    content.innerHTML = activeSessions.map(renderSessionCard).join('');
  }

  async function refreshFromServer() {
    if (!window.CollegeOSApi?.getStudentExperienceConfig || !window.CollegeOSApi?.liveSessionsUpcoming) return null;
    const [response, sessionsResponse] = await Promise.all([
      window.CollegeOSApi.getLiveHubStatus ? window.CollegeOSApi.getLiveHubStatus().catch(() => null) : Promise.resolve(null),
      window.CollegeOSApi.getStudentExperienceConfig(),
      window.CollegeOSApi.liveSessionsUpcoming({ includeEnded: true, scope: 'student' })
    ]);
    state.config = normalizeConfig(response?.config || response || {});
    if (response && typeof response.enabled === 'boolean') {
      state.config.liveHub.enabled = response.enabled;
    }
    state.sessions = Array.isArray(sessionsResponse?.sessions)
      ? sessionsResponse.sessions.map((session, index) => normalizeSession(session, index))
      : [];

    state.sessions.forEach((session) => {
      const status = deriveStatus(session);
      if (status === 'ended' || status === 'cancelled') {
        clearHostModeUnlockedLocal(session.id);
      }
      if (session.hostUnlocked) {
        markHostModeUnlockedLocal(session.id);
      }
    });
    state.ready = true;
    updateSidebarPulse();
    scheduleSessionReminders(state.sessions);
    renderPanel();
    if (state.activeSessionId) {
      const nextActive = state.sessions.find((session) => session.id === state.activeSessionId);
      if (!nextActive) {
        state.activeSessionId = null;
        state.activeSession = null;
        hideStage();
      } else if (isTerminalStatus(nextActive)) {
        clearActiveSessionPersistence();
        hideStage();
      } else {
        state.activeSession = nextActive;
        if (deriveStatus(nextActive) === 'live' && state.waitingRoomActive) {
          notify(`${nextActive.title} is live now. Joining automatically.`, 'success');
          await joinSession(nextActive);
        } else {
          renderStage();
          loadCollaborationState(nextActive).catch(() => null);
        }
      }
    }
    renderNetworkChip();
    renderReconnectChip();
    return state.config;
  }

  async function refresh() {
    if (state.refreshPromise) return state.refreshPromise;
    state.refreshPromise = (async () => {
      try {
        await refreshFromServer();
      } catch (error) {
        console.warn('Live Hub refresh failed:', error?.message || error);
      } finally {
        state.refreshPromise = null;
      }
    })();
    return state.refreshPromise;
  }

  function setActiveSession(session, joinContext = null) {
    if (!session || isTerminalStatus(session)) {
      clearActiveSessionPersistence();
      hideStage();
      return;
    }
    state.activeSessionId = session.id;
    state.activeSession = session;
    state.joinContext = joinContext;
    const stored = loadUiState();
    stored.activeSessionId = session.id;
    saveUiState(stored);
    renderStage();
    openPanel();
  }

  async function callSessionAction(action, session, providedAccessId) {
    let accessId = '';
    if (providedAccessId) accessId = providedAccessId;
    const isAdmin = currentUserRole() === 'admin' || currentUserRole() === 'super_admin';
    const hostUnlocked = canControlSession(session);
    if (!isAdmin && !hostUnlocked && !accessId && (action === 'start' || action === 'end')) {
      openMentorHostCodeScreen(session, 'unlock', async (enteredCode) => {
        if (!enteredCode) return;
        await unlockHostMode(session, enteredCode);
        await callSessionAction(action, session);
      });
      return;
    }

    if (action === 'end') {
      await window.CollegeOSApi.liveSessionEnd(session.id, isAdmin ? {} : { hostCode: accessId || '' });
    } else {
      await window.CollegeOSApi.liveSessionStart(session.id, isAdmin ? {} : { hostCode: accessId || '' });
    }
    if (action === 'start' && accessId) {
      rememberMentorAccess(session.id, accessId);
    }
    await refresh();
    if (action === 'start') {
      await joinSession(session);
    } else if (state.activeSessionId === session.id) {
      await hideStage();
    }
  }

  async function unlockHostMode(session, providedAccessId) {
    const isAdmin = currentUserRole() === 'admin' || currentUserRole() === 'super_admin';
    let accessId = providedAccessId || '';

    if (!isAdmin && !accessId) {
      openMentorHostCodeScreen(session, 'unlock', async (enteredCode) => {
        if (!enteredCode) return;
        await unlockHostMode(session, enteredCode);
      });
      return;
    }

    try {
      const payload = await window.CollegeOSApi.liveSessionUnlockHost(session.id, isAdmin ? {} : { hostCode: accessId });
      if (accessId) rememberMentorAccess(session.id, accessId);
      markHostModeUnlockedLocal(session.id);
      state.hostModeUnlockedSessionIds.add(session.id);
      notify(payload?.message || 'Host mode unlocked.', 'success');
      const nextSession = normalizeSession(payload?.session || session, 0);
      setActiveSession(nextSession, payload?.meeting || null);
      await refresh();
    } catch (error) {
      notify(describeHostUnlockError(error), 'warning');
      throw error;
    }
  }

  async function joinSession(session) {
    if (!isLiveHubEnabled()) {
      openPanel();
      renderPanel();
      return;
    }
    const currentStatus = deriveStatus(session);
    if (isTerminalStatus(session)) {
      clearActiveSessionPersistence();
      notify('Session completed. Open details from history.', 'info');
      return;
    }
    if (currentStatus !== 'live') {
      state.activeSessionId = session.id;
      state.activeSession = session;
      state.waitingRoomActive = true;
      setActiveSession(session, null);
      renderStage();
      notify(`${session.title} is not live yet. This is the waiting room.`, 'info');
      return;
    }

    try {
      const response = await withRetry(() => window.CollegeOSApi.liveSessionJoin(session.id, {}), 2);
      const nextSession = normalizeSession(response.session || session, 0);
      setActiveSession(nextSession, response.meeting || null);
      notify(`Joined ${nextSession.title}.`, 'success');
    } catch (error) {
      notify(error?.message || 'Unable to join the live session.', 'warning');
    }
  }

  function connectLiveSessionStream() {
    if (!window.EventSource || state.liveEventSource) return;
    const streamUrl = typeof window.CollegeOSApi?.getLiveSessionRealtimeStreamUrl === 'function'
      ? window.CollegeOSApi.getLiveSessionRealtimeStreamUrl()
      : '/api/live-sessions/stream';

    const openStream = () => {
      try {
        if (state.liveEventSource) {
          state.liveEventSource.close();
        }
        const source = new EventSource(streamUrl, { withCredentials: true });
        state.liveEventSource = source;

        const onLiveEvent = (event) => {
          try {
            const payload = JSON.parse(event.data || '{}');
            const eventType = String(event.type || '').toLowerCase();
            const action = String(payload.action || eventType || '').toLowerCase();
            const sessionId = String(payload.sessionId || payload.session?.id || '');
            const nextSession = state.sessions.find((item) => item.id === sessionId) || normalizeSession(payload.session || {}, 0);
            if (payload.session) {
              const normalized = normalizeSession(payload.session, 0);
              if (normalized.hostUnlocked) {
                markHostModeUnlockedLocal(normalized.id);
              }
              const existingIdx = state.sessions.findIndex((session) => session.id === normalized.id);
              if (existingIdx >= 0) {
                state.sessions = state.sessions.map((session) => session.id === normalized.id ? normalized : session);
              } else if (normalized.id) {
                state.sessions = [...state.sessions, normalized];
              }
            }
            if (eventType === 'session.host.unlocked' || action === 'host_unlocked') {
              if (sessionId) state.hostModeUnlockedSessionIds.add(sessionId);
              if (sessionId) markHostModeUnlockedLocal(sessionId);
            }
            if ((eventType === 'session.ended' || action === 'ended' || action === 'cancelled') && state.activeSessionId && state.activeSessionId === sessionId) {
              clearActiveSessionPersistence();
              hideStage();
            }
            if (action === 'chat_message' && payload.message) {
              const nextMessages = [...readMessages(sessionId), {
                id: payload.message.id,
                sender: payload.message.user_name || 'Participant',
                role: payload.message.role || 'student',
                text: payload.message.body || '',
                time: payload.message.created_at || new Date().toISOString(),
                reaction: payload.message.reaction || null
              }];
              writeMessages(sessionId, nextMessages);
              if (state.activeSessionId === sessionId) {
                state.chatMessages = nextMessages;
                renderChatMessages();
              }
            }
            if (action === 'presence' && Array.isArray(payload.presence)) {
              state.presence = payload.presence;
              renderPresenceChip();
            }
            if (action === 'activity' && Array.isArray(payload.activity)) {
              state.activityFeed = payload.activity;
              renderActivityRail();
            }
            handleLiveSessionNotification(action, nextSession);
            queueRefresh();
          } catch (error) {
            console.warn('Live session event parse failed:', error?.message || error);
          }
        };

        source.addEventListener('live_session_changed', onLiveEvent);
        source.addEventListener('live_session_created', onLiveEvent);
        source.addEventListener('live_session_started', onLiveEvent);
        source.addEventListener('live_session_ended', onLiveEvent);
        source.addEventListener('live_session_joined', onLiveEvent);
        source.addEventListener('live_session_left', onLiveEvent);
        source.addEventListener('live_session_cancelled', onLiveEvent);
        source.addEventListener('live_session_rescheduled', onLiveEvent);
        source.addEventListener('session.started', onLiveEvent);
        source.addEventListener('session.updated', onLiveEvent);
        source.addEventListener('session.ended', onLiveEvent);
        source.addEventListener('session.host.unlocked', onLiveEvent);

        source.onopen = () => {
          state.reconnectState = 'connected';
          state.liveEventRetryMs = 2500;
          renderNetworkChip();
          renderReconnectChip();
        };

        source.onerror = () => {
          state.reconnectState = 'reconnecting';
          renderNetworkChip();
          renderReconnectChip();
          try {
            source.close();
          } catch {
            // Ignore close failures.
          }
          state.liveEventSource = null;
          if (state.liveEventRetryTimer) {
            window.clearTimeout(state.liveEventRetryTimer);
          }
          state.liveEventRetryTimer = window.setTimeout(() => {
            state.liveEventRetryMs = Math.min(state.liveEventRetryMs * 2, 30000);
            openStream();
          }, state.liveEventRetryMs);
        };
      } catch (error) {
        console.warn('Live session stream unavailable:', error?.message || error);
      }
    };

    openStream();
    if (!state.beforeUnloadBound) {
      state.beforeUnloadBound = true;
      window.addEventListener('beforeunload', () => {
        disposeSessionRuntime({ keepRefreshTimer: false });
      });
      window.addEventListener('pagehide', () => {
        disposeSessionRuntime({ keepRefreshTimer: false });
      });
    }
  }

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-live-hub-toggle]');
      if (toggle) {
        event.preventDefault();
        togglePanel();
        return;
      }

      const closeButton = event.target.closest('[data-live-hub-close]');
      if (closeButton) {
        event.preventDefault();
        closePanel();
        return;
      }

      const backToDashboard = event.target.closest('[data-live-hub-back-to-dashboard]');
      if (backToDashboard) {
        event.preventDefault();
        try {
          if (/\/dashboard(\.html)?$/i.test(window.location.pathname)) {
            closePanel();
          } else {
            window.location.assign('/dashboard');
          }
        } catch {
          window.location.assign('/dashboard');
        }
        return;
      }

      const stageClose = event.target.closest('[data-live-hub-stage-close]');
      if (stageClose) {
        event.preventDefault();
        hideStage();
        return;
      }

      const tabButton = event.target.closest('[data-live-hub-tab]');
      if (tabButton) {
        event.preventDefault();
        selectTab(tabButton.dataset.liveHubTab || 'live');
        return;
      }

      const joinButton = event.target.closest('[data-live-hub-join]');
      if (joinButton) {
        event.preventDefault();
        const session = state.sessions.find((item) => item.id === joinButton.dataset.liveHubJoin);
        if (session) joinSession(session);
        return;
      }

      const unlockButton = event.target.closest('[data-live-hub-unlock]');
      if (unlockButton) {
        event.preventDefault();
        const session = state.sessions.find((item) => item.id === unlockButton.dataset.liveHubUnlock);
        if (session) {
          unlockHostMode(session).catch(() => null);
        }
        return;
      }

      const controlButton = event.target.closest('[data-live-hub-control]');
      if (controlButton) {
        event.preventDefault();
        const session = state.sessions.find((item) => item.id === controlButton.dataset.liveHubControl);
        if (!session) return;
        const action = controlButton.dataset.liveHubControlAction || 'start';
        const isAdmin = currentUserRole() === 'admin' || currentUserRole() === 'super_admin';
        const hostUnlocked = canControlSession(session);
        if ((action === 'start' || action === 'end') && !isAdmin && !hostUnlocked) {
          openMentorHostCodeScreen(session, action, (entered) => {
            if (!entered) return;
            callSessionAction(action, session, entered).catch(() => null);
          });
        } else {
          callSessionAction(action, session).catch(() => null);
        }
      }

      const waitingCheck = event.target.closest('#liveHubWaitingCheckPermissions');
      if (waitingCheck) {
        event.preventDefault();
        checkWaitingRoomDevices().catch(() => null);
        return;
      }

      const waitingRefresh = event.target.closest('#liveHubWaitingRefresh');
      if (waitingRefresh) {
        event.preventDefault();
        notify('Refreshing session status...', 'info');
        refresh().catch(() => null);
      }
    });

    const chatForm = document.getElementById('liveHubChatForm');
    if (chatForm) {
      chatForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const input = document.getElementById('liveHubChatInput');
        if (!input || !input.value.trim()) return;
        addChatMessage(input.value);
        input.value = '';
      });
    }

    window.addEventListener('storage', (event) => {
      if (!event.key) return;
      if (event.key === STORAGE_KEY || event.key.startsWith(CHAT_PREFIX)) {
        const stored = loadUiState();
        state.tab = stored.tab === 'upcoming' || stored.tab === 'history' ? stored.tab : 'live';
        renderPanel();
        if (state.activeSessionId) {
          state.chatMessages = readMessages(state.activeSessionId);
          renderChatMessages();
        }
      }
    });

    window.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.ready) {
        renderNetworkChip();
        refresh().catch(() => null);
        sendPresenceHeartbeat({ action: 'visible' }).catch(() => null);
      }
    });

    window.addEventListener('online', () => {
      state.reconnectState = 'connected';
      renderNetworkChip();
      renderReconnectChip();
      refresh().catch(() => null);
    });

    window.addEventListener('offline', () => {
      state.reconnectState = 'reconnecting';
      renderNetworkChip();
      renderReconnectChip();
    });
  }

  function ensureMentorModal() {
    let modal = document.getElementById('liveHubMentorModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'liveHubMentorModal';
    modal.className = 'live-hub-modal';
    modal.innerHTML = `
      <div class="live-hub-modal-shell live-hub-host-screen">
        <div class="live-hub-host-hero">
          <p class="live-hub-kicker">Mentor access</p>
          <h4 id="liveHubMentorTitle">Enter Mentor ID / Host Code</h4>
          <p class="muted" id="liveHubMentorDescription">Validate the assigned host code against your logged-in account, then open the session as host.</p>
        </div>
        <div class="live-hub-host-details">
          <div class="live-hub-host-meta">
            <span><strong>Session</strong><small id="liveHubMentorSessionTitle">-</small></span>
            <span><strong>Session ID</strong><small id="liveHubMentorSessionId">-</small></span>
            <span><strong>Provider</strong><small id="liveHubMentorProvider">-</small></span>
            <span><strong>Schedule</strong><small id="liveHubMentorSchedule">-</small></span>
          </div>
          <label class="live-hub-host-field">
            <span>Host code</span>
            <input id="liveHubMentorInput" placeholder="Enter mentor live code" autocomplete="one-time-code" />
          </label>
          <p id="liveHubMentorError" class="muted" style="min-height:1.2em;color:#dc2626;"></p>
        </div>
        <div class="live-hub-host-actions">
          <button id="liveHubMentorCancel" class="btn secondary">Cancel</button>
          <button id="liveHubMentorSubmit" class="btn primary">Validate and Continue</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  function openMentorHostCodeScreen(session, action, onSubmit) {
    const modal = ensureMentorModal();
    const input = modal.querySelector('#liveHubMentorInput');
    const submit = modal.querySelector('#liveHubMentorSubmit');
    const cancel = modal.querySelector('#liveHubMentorCancel');
    const title = modal.querySelector('#liveHubMentorTitle');
    const description = modal.querySelector('#liveHubMentorDescription');
    const sessionTitle = modal.querySelector('#liveHubMentorSessionTitle');
    const sessionId = modal.querySelector('#liveHubMentorSessionId');
    const provider = modal.querySelector('#liveHubMentorProvider');
    const schedule = modal.querySelector('#liveHubMentorSchedule');
    const errorNode = modal.querySelector('#liveHubMentorError');
    modal.style.display = 'grid';
    if (title) title.textContent = action === 'end' ? 'Enter Mentor ID / Host Code to End' : 'Enter Mentor ID / Host Code to Start';
    if (description) description.textContent = action === 'end'
      ? 'Validate the assigned host code before closing the live session.'
      : (action === 'unlock'
      ? 'Validate your unique Host ID / Live Code to unlock Host Mode and go live instantly.'
      : 'Validate the assigned host code, then start the live session.');
    if (title && action === 'unlock') title.textContent = 'Unlock Host Mode';
    if (sessionTitle) sessionTitle.textContent = session?.title || '-';
    if (sessionId) sessionId.textContent = session?.id || '-';
    if (provider) provider.textContent = String(sessionProvider(session || {}) || 'jitsi').toUpperCase();
    if (schedule) schedule.textContent = `${formatDateTime(session?.startAt)} → ${formatDateTime(session?.endAt)}`;
    input.value = readMentorAccess(session.id) || '';
    if (errorNode) errorNode.textContent = '';
    input.focus();

    function cleanup() {
      submit.removeEventListener('click', onClick);
      cancel.removeEventListener('click', onCancel);
      modal.style.display = 'none';
    }

    async function onClick(e) {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) {
        if (errorNode) errorNode.textContent = 'Host code is required.';
        return;
      }
      try {
        await onSubmit(val);
        cleanup();
      } catch (error) {
        if (errorNode) errorNode.textContent = error?.message || 'Unable to validate host code.';
      }
    }

    function onCancel(e) {
      e.preventDefault();
      cleanup();
      onSubmit('');
    }

    submit.addEventListener('click', onClick);
    cancel.addEventListener('click', onCancel);
  }

  function openMentorAccessModal(session, onSubmit) {
    openMentorHostCodeScreen(session, 'start', onSubmit);
  }

  function describeHostUnlockError(error) {
    const status = Number(error?.status || 0);
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '').toLowerCase();

    if (status === 404) {
      if (code === 'NOT_FOUND' || message.includes('not found')) return 'Session not found.';
      return 'Session unlock endpoint missing.';
    }
    if (status === 403 || code === 'HOST_CODE_NOT_ASSIGNED') return 'You are not assigned as host.';
    if (status === 409 || code === 'SESSION_ALREADY_COMPLETED' || code === 'SESSION_ALREADY_ENDED') return 'Session already completed.';
    if (status === 400 || code === 'INVALID_HOST_CODE' || code === 'HOST_CODE_REQUIRED' || code === 'HOST_CODE_LOCKED') return 'Invalid host code.';
    return error?.message || 'Unable to unlock host mode.';
  }

  function restoreUiState() {
    const stored = loadUiState();
    state.tab = stored.tab === 'upcoming' || stored.tab === 'history' ? stored.tab : 'live';
    // Never auto-open or auto-resume from persisted state.
    state.open = false;
    state.activeSessionId = '';
    clearActiveSessionPersistence();
  }

  async function waitForUser() {
    if (typeof window.collegeOsCurrentUser !== 'undefined') {
      return window.collegeOsCurrentUser;
    }

    return new Promise((resolve) => {
      const start = Date.now();
      const poll = () => {
        if (typeof window.collegeOsCurrentUser !== 'undefined') {
          resolve(window.collegeOsCurrentUser);
          return;
        }
        if (Date.now() - start > 4000) {
          resolve(null);
          return;
        }
        window.setTimeout(poll, 30);
      };
      poll();
    });
  }

  async function boot() {
    if (state.mounted) return;
    const user = await waitForUser();
    state.user = user;
    state.mounted = true;
    ensurePanel();
    ensureStage();
    bindEvents();
    restoreUiState();

    if (!user) {
      const button = document.querySelector('[data-live-hub-toggle]');
      if (button) button.hidden = true;
      const panel = document.getElementById('liveHubPanel');
      if (panel) panel.hidden = true;
      return;
    }

    await refresh();
    connectLiveSessionStream();
    // Live Hub opens only when the user explicitly clicks it.

    if (!state.refreshTimer) {
      state.refreshTimer = window.setInterval(() => {
        refresh().catch(() => null);
      }, 20000);
    }
  }

  const api = {
    boot,
    refresh,
    open: openPanel,
    close: closePanel,
    toggle: togglePanel,
    joinSession,
    getState: () => ({ ...state })
  };

  window.CollegeOSLiveHub = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      boot().catch((error) => console.warn('Live Hub boot failed:', error));
    }, { once: true });
  } else {
    boot().catch((error) => console.warn('Live Hub boot failed:', error));
  }
})();
