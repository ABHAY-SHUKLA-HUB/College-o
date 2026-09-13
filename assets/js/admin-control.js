function cById(id) {
  return document.getElementById(id);
}

const DASHBOARD_VISIBILITY_KEYS = [
  { key: 'learningStats', label: 'Learning Stats' },
  { key: 'aiSuggestions', label: 'AI Suggestions' },
  { key: 'recommendedNotes', label: 'Recommended Notes' },
  { key: 'recommendedQuizzes', label: 'Recommended Quizzes' },
  { key: 'recommendedMockTests', label: 'Recommended Mock Tests' },
  { key: 'achievements', label: 'Achievements' },
  { key: 'analyticsCharts', label: 'Analytics Charts' },
  { key: 'studyPlan', label: 'Study Plan' },
  { key: 'activityTimeline', label: 'Activity Timeline' },
  { key: 'continueLearning', label: 'Continue Learning' },
  { key: 'weakTopics', label: 'Weak Topics' }
];

const FEATURE_FLAG_KEYS = [
  { key: 'aiTools', label: 'AI Tools' },
  { key: 'mockTests', label: 'Mock Tests' },
  { key: 'roadmapSystem', label: 'Roadmap System' },
  { key: 'certificates', label: 'Certificates' },
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'analytics', label: 'Analytics' }
];

const AUTH_MODULE_KEYS = [
  { key: 'leftPanel', label: 'Auth Left Panel' },
  { key: 'loginForm', label: 'Login Form' },
  { key: 'signupForm', label: 'Signup Form' },
  { key: 'supportModal', label: 'Support Modal' },
  { key: 'otpLogin', label: 'OTP Login Option' },
  { key: 'legalFooter', label: 'Terms And Privacy Footer' }
];

const AUTH_SIGNUP_FIELD_KEYS = [
  { key: 'mobile', label: 'Mobile Field' },
  { key: 'category', label: 'Learning Path Field' },
  { key: 'branch', label: 'Branch Field' },
  { key: 'university', label: 'University Field' },
  { key: 'semester', label: 'Semester Field' },
  { key: 'targetCareerInterest', label: 'Career Interest Field' }
];

const DASHBOARD_SECTION_ORDER_OPTIONS = [
  { key: 'hero', label: 'Hero Section' },
  { key: 'stats', label: 'Learning Stats Cards' },
  { key: 'continue-learning', label: 'Continue Learning' },
  { key: 'recommended-for-you', label: 'Recommended For You' },
  { key: 'weekly-analytics', label: 'Weekly Analytics' },
  { key: 'weak-topics', label: 'Weak Topics' },
  { key: 'recommended-content', label: 'Recommended Content' },
  { key: 'study-plan', label: 'Study Plan' },
  { key: 'activity-timeline', label: 'Activity Timeline' },
  { key: 'ai-suggestions', label: 'AI Suggestions Card' },
  { key: 'quick-access', label: 'Quick Access' },
  { key: 'achievements', label: 'Achievements' }
];

function asStatusBadge(value) {
  const text = String(value || 'unknown').toLowerCase();
  const tone = text.includes('approved') || text.includes('published') || text.includes('active') || text.includes('resolved')
    ? 'ok'
    : (text.includes('pending') || text.includes('suspend') || text.includes('warn')
      ? 'warn'
      : 'info');
  return `<span class="status-badge ${tone}">${text}</span>`;
}

function selectedStudentIds() {
  return Array.from(document.querySelectorAll('.student-row-checkbox:checked'))
    .map((el) => Number(el.value))
    .filter((id) => Number.isFinite(id));
}

function parseIdList(value) {
  return String(value || '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x > 0);
}

function parseLines(value, fallback = []) {
  const rows = String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return rows.length ? rows : fallback;
}

function getLiveDefaultProvider() {
  const provider = String(cById('settingLiveDefaultProvider')?.value || '').toLowerCase();
  return provider === 'agora' ? 'agora' : 'jitsi';
}

function setLiveHubVisibilityStatus(enabled, note = '') {
  const statusNode = cById('liveHubVisibilityStatus');
  if (!statusNode) return;
  const active = Boolean(enabled);
  statusNode.className = `status-badge ${active ? 'ok' : 'warn'}`;
  statusNode.textContent = note || (active
    ? 'Live Hub is enabled for students'
    : 'Live Hub is hidden behind Work in Progress message');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function escapeCssValue(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function toDateTimeLocalValue(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function makeLiveHubSessionId(type, index) {
  const stamp = Date.now().toString(36);
  return `${type}-${index + 1}-${stamp}`;
}

function generateGoLiveAccessId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const randomChars = [];
  const length = 14;
  if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(length);
    window.crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i += 1) {
      randomChars.push(alphabet[bytes[i] % alphabet.length]);
    }
  } else {
    for (let i = 0; i < length; i += 1) {
      randomChars.push(alphabet[Math.floor(Math.random() * alphabet.length)]);
    }
  }
  return `GL-${randomChars.join('').replace(/(.{4})/g, '$1-').replace(/-$/, '')}`;
}

function normalizeGoLiveStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'live' || raw === 'active') return 'live';
  if (raw === 'ended' || raw === 'completed') return 'ended';
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled';
  return 'scheduled';
}

function isActiveGoLiveStatus(status) {
  const normalized = normalizeGoLiveStatus(status);
  return normalized === 'live';
}

function dateRangeOverlaps(aStart, aEnd, bStart, bEnd) {
  const aStartMs = aStart ? new Date(aStart).getTime() : NaN;
  const aEndMs = aEnd ? new Date(aEnd).getTime() : NaN;
  const bStartMs = bStart ? new Date(bStart).getTime() : NaN;
  const bEndMs = bEnd ? new Date(bEnd).getTime() : NaN;
  if (!Number.isFinite(aStartMs) || !Number.isFinite(aEndMs) || !Number.isFinite(bStartMs) || !Number.isFinite(bEndMs)) return true;
  return aStartMs < bEndMs && bStartMs < aEndMs;
}

function goLiveStatusView(session) {
  const status = normalizeGoLiveStatus(session?.status);
  if (status === 'live') return { key: 'live', label: 'Live' };
  if (status === 'ended') return { key: 'ended', label: 'Ended' };
  if (status === 'cancelled') return { key: 'ended', label: 'Cancelled' };
  return { key: 'scheduled', label: 'Scheduled' };
}

function validateLiveHubSessions(sessions) {
  const rows = Array.isArray(sessions) ? sessions : [];
  const errors = [];
  const activeByAccessId = new Map();

  rows.forEach((session, index) => {
    const row = index + 1;
    const status = normalizeGoLiveStatus(session.status);
    const hostRef = String(session.assignedHostUserRef || session.assignedHostEmail || session.mentorProfileKey || '').trim();
    if (status === 'live' && !hostRef) {
      errors.push(`Session ${row}: Assigned Host User is required so the host code is mapped to the logged-in user.`);
    }
    const accessId = String(session.mentorAccessId || '').trim();
    if (!isActiveGoLiveStatus(status) || !accessId) return;
    const key = accessId.toUpperCase();
    if (!activeByAccessId.has(key)) activeByAccessId.set(key, []);
    activeByAccessId.get(key).push({ row, session });
  });

  activeByAccessId.forEach((group, accessId) => {
    if (group.length < 2) return;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const left = group[i];
        const right = group[j];
        if (dateRangeOverlaps(left.session.startAt, left.session.endAt, right.session.startAt, right.session.endAt)) {
          errors.push(`Go Live ID ${accessId} conflicts between sessions ${left.row} and ${right.row} (active windows overlap).`);
        }
      }
    }
  });

  return errors;
}

function liveHubSeedSessions() {
  const now = new Date();
  const plusDays = (days, hours = 0) => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    date.setHours(date.getHours() + hours, 0, 0, 0);
    return date.toISOString();
  };

  return [
    {
      id: makeLiveHubSessionId('mentorship', 0),
      type: 'mentorship',
      title: 'Resume Review and Interview Prep',
      mentorName: 'Ananya Sharma',
      mentorAccessId: 'MENTOR-RESUME-001',
      mentorProfileKey: 'ananya.sharma@collegeos.in',
      startAt: plusDays(1, 2),
      endAt: plusDays(1, 3),
      durationMinutes: 60,
      provider: 'jitsi',
      roomId: 'resume-review-room',
      status: 'scheduled',
      summary: 'Live feedback on resumes, projects, and interview confidence.'
    },
    {
      id: makeLiveHubSessionId('mentorship', 1),
      type: 'mentorship',
      title: 'Placement Strategy Office Hours',
      mentorName: 'Rohit Verma',
      mentorAccessId: 'MENTOR-PLACEMENT-002',
      mentorProfileKey: 'rohit.verma@collegeos.in',
      startAt: plusDays(4, 1),
      endAt: plusDays(4, 2),
      durationMinutes: 75,
      provider: 'jitsi',
      roomId: 'placement-office-hours',
      status: 'scheduled',
      summary: 'Career planning and placement strategy for the next hiring cycle.'
    },
    {
      id: makeLiveHubSessionId('lab', 2),
      type: 'lab',
      title: 'AZ-900 Cloud Fundamentals Lab',
      mentorName: 'Priya Nair',
      mentorAccessId: 'LAB-AZ900-003',
      mentorProfileKey: 'priya.nair@collegeos.in',
      startAt: plusDays(2, 5),
      endAt: plusDays(2, 6),
      durationMinutes: 90,
      provider: 'jitsi',
      roomId: 'az900-lab-room',
      status: 'scheduled',
      summary: 'Hands-on walkthrough of cloud concepts, pricing, and lab exercises.'
    },
    {
      id: makeLiveHubSessionId('lab', 3),
      type: 'lab',
      title: 'AI-900 Applied AI Lab',
      mentorName: 'Kunal Mehta',
      mentorAccessId: 'LAB-AI900-004',
      mentorProfileKey: 'kunal.mehta@collegeos.in',
      startAt: plusDays(6, 4),
      endAt: plusDays(6, 5),
      durationMinutes: 90,
      provider: 'jitsi',
      roomId: 'ai900-lab-room',
      status: 'scheduled',
      summary: 'Practical AI-900 walkthrough with prompt, vision, and language demos.'
    }
  ];
}

function liveHubSessionCardHtml(session, index) {
  const type = String(session.type || 'mentorship').toLowerCase() === 'lab' ? 'lab' : 'mentorship';
  const typeLabel = type === 'lab' ? 'Hands-on Lab' : 'Mentorship';
  const statusView = goLiveStatusView(session);
  const codeGenerated = Boolean(session.codeGenerated || session.mentorAccessId);
  const codeLabel = codeGenerated ? 'Code generated' : 'Code not generated';
  const copyDisabled = !session.mentorAccessId;
  return `
    <article class="live-hub-admin-card" data-live-hub-session data-live-hub-index="${index}">
      <input type="hidden" class="live-hub-session-id" value="${escapeHtml(session.id || '')}" />
      <div class="live-hub-admin-head">
        <span class="live-hub-admin-status ${statusView.key}"><span class="dot"></span>${statusView.label}</span>
        <span class="live-hub-admin-type">${typeLabel}</span>
      </div>
      <div class="live-hub-admin-grid">
        <div>
          <label>Session Type</label>
          <select class="live-hub-session-type">
            <option value="mentorship"${type === 'mentorship' ? ' selected' : ''}>Mentorship</option>
            <option value="lab"${type === 'lab' ? ' selected' : ''}>Hands-on Lab</option>
          </select>
        </div>
        <div>
          <label>Status Indicator</label>
          <select class="live-hub-session-status">
            <option value="scheduled"${normalizeGoLiveStatus(session.status) === 'scheduled' ? ' selected' : ''}>Scheduled</option>
            <option value="live"${normalizeGoLiveStatus(session.status) === 'live' ? ' selected' : ''}>Live</option>
            <option value="ended"${normalizeGoLiveStatus(session.status) === 'ended' ? ' selected' : ''}>Ended</option>
            <option value="cancelled"${normalizeGoLiveStatus(session.status) === 'cancelled' ? ' selected' : ''}>Cancelled</option>
          </select>
        </div>
        <div class="full">
          <label>Title / Topic</label>
          <input class="live-hub-session-title" value="${escapeHtml(session.title || '')}" placeholder="${typeLabel} title" />
        </div>
        <div>
          <label>Mentor Name</label>
          <input class="live-hub-session-mentor" value="${escapeHtml(session.mentorName || '')}" placeholder="Mentor name" />
        </div>
        <div>
          <label>Assigned Host User (UID / Email / User ID)</label>
          <input class="live-hub-session-host-user" value="${escapeHtml(session.assignedHostUserRef || session.assignedHostEmail || session.mentorProfileKey || '')}" placeholder="student.uid or student@email.com" />
        </div>
        <div class="full">
          <label>Unique Mentor Go Live ID</label>
          <div class="muted" style="margin-bottom: 8px;">${escapeHtml(codeLabel)}${session.lastGeneratedAt ? ` · Last generated ${escapeHtml(new Date(session.lastGeneratedAt).toLocaleString('en-IN'))}` : ''}</div>
          <div class="live-hub-admin-inline-actions">
            <input class="live-hub-session-access" value="${escapeHtml(session.mentorAccessId || '')}" placeholder="Auto-generate secure key" />
            <button class="btn secondary sm" type="button" data-live-hub-generate-id>Auto-Generate</button>
            <button class="btn secondary sm" type="button" data-live-hub-copy-id${copyDisabled ? ' disabled' : ''}>Copy Code</button>
            <button class="btn secondary sm" type="button" data-live-hub-regenerate-id>Regenerate Code</button>
          </div>
        </div>
        <div>
          <label>Start Date &amp; Time</label>
          <input class="live-hub-session-start" type="datetime-local" value="${toDateTimeLocalValue(session.startAt)}" />
        </div>
        <div>
          <label>End Date &amp; Time</label>
          <input class="live-hub-session-end" type="datetime-local" value="${toDateTimeLocalValue(session.endAt)}" />
        </div>
        <div>
          <label>Duration (mins)</label>
          <input class="live-hub-session-duration" type="number" min="15" value="${Number(session.durationMinutes || 60)}" />
        </div>
        <div>
          <label>Provider</label>
          <select class="live-hub-session-provider">
            <option value="jitsi"${String(session.provider || '').toLowerCase() !== 'agora' ? ' selected' : ''}>Jitsi</option>
            <option value="agora"${String(session.provider || '').toLowerCase() === 'agora' ? ' selected' : ''}>Agora</option>
          </select>
        </div>
        <div>
          <label>Room / Channel ID</label>
          <input class="live-hub-session-room" value="${escapeHtml(session.roomId || '')}" placeholder="room-id" />
        </div>
        <div class="full">
          <label>Room Label</label>
          <input class="live-hub-session-room-label" value="${escapeHtml(session.roomLabel || '')}" placeholder="Optional room label" />
        </div>
        <div class="full">
          <label>Summary</label>
          <textarea class="live-hub-session-summary" rows="2" placeholder="Short session description">${escapeHtml(session.summary || '')}</textarea>
        </div>
      </div>
      <div class="control-actions" style="margin-top: 0; justify-content: flex-end;">
        <button class="btn primary sm" type="button" data-live-hub-save-session>Save Session</button>
        <button class="btn warn sm" type="button" data-live-hub-start-session>Start Session</button>
        <button class="btn secondary sm" type="button" data-live-hub-end-session>End Session</button>
        <button class="btn secondary sm" type="button" data-live-hub-cancel-session>Cancel Session</button>
        <button class="btn secondary sm" type="button" data-live-hub-duplicate>Duplicate</button>
        <button class="btn danger sm" type="button" data-live-hub-delete>Delete</button>
      </div>
    </article>
  `;
}

function liveSessionStatusLabel(status) {
  const normalized = normalizeGoLiveStatus(status);
  if (normalized === 'live') return 'Live';
  if (normalized === 'ended') return 'Ended';
  if (normalized === 'cancelled') return 'Cancelled';
  return 'Scheduled';
}

function liveSessionStatusTone(status) {
  const normalized = normalizeGoLiveStatus(status);
  if (normalized === 'live') return 'ok';
  if (normalized === 'ended' || normalized === 'cancelled') return 'warn';
  return 'info';
}

function formatLiveSessionSchedule(session) {
  const start = session.startAt ? new Date(session.startAt) : null;
  const end = session.endAt ? new Date(session.endAt) : null;
  const startText = start && !Number.isNaN(start.getTime()) ? start.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
  const endText = end && !Number.isNaN(end.getTime()) ? end.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
  return `${startText} → ${endText}`;
}

function renderLiveSessionMonitor(sessions = []) {
  const rows = Array.isArray(sessions) ? sessions : [];
  const totalNode = cById('liveSessionTotalCount');
  const scheduledNode = cById('liveSessionScheduledCount');
  const liveNode = cById('liveSessionLiveCount');
  const participantNode = cById('liveSessionParticipantCount');
  const tbody = cById('liveSessionMonitorBody');

  const counts = rows.reduce((accumulator, session) => {
    const status = normalizeGoLiveStatus(session.status);
    accumulator.total += 1;
    accumulator.participants += Number(session.participantCount || 0);
    if (status === 'live') accumulator.live += 1;
    if (status === 'scheduled') accumulator.scheduled += 1;
    return accumulator;
  }, { total: 0, scheduled: 0, live: 0, participants: 0 });

  if (totalNode) totalNode.textContent = String(counts.total);
  if (scheduledNode) scheduledNode.textContent = String(counts.scheduled);
  if (liveNode) liveNode.textContent = String(counts.live);
  if (participantNode) participantNode.textContent = String(counts.participants);

  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="co-admin-table-empty">No live sessions loaded.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((session) => {
    const status = normalizeGoLiveStatus(session.status);
    const statusView = goLiveStatusView(session);
    const canStart = status !== 'live' && status !== 'ended' && status !== 'cancelled';
    const canEnd = status === 'live';
    const canCancel = status !== 'cancelled' && status !== 'ended';
    return `
      <tr data-live-session-monitor-row data-session-id="${escapeHtml(session.id || '')}">
        <td>
          <strong>${escapeHtml(session.title || '')}</strong>
          <div class="muted mono">${escapeHtml(session.id || '')}</div>
        </td>
        <td>
          <div><strong>${escapeHtml(session.mentorName || '-')}</strong></div>
          <div class="muted mono">${escapeHtml(session.assignedHostEmail || session.assignedHostUserRef || session.mentorProfileKey || session.mentorEmail || '-')}</div>
        </td>
        <td>${escapeHtml(String(session.provider || 'jitsi').toUpperCase())}</td>
        <td><span class="status-badge ${liveSessionStatusTone(status)}">${escapeHtml(statusView.label || liveSessionStatusLabel(status))}</span></td>
        <td>${escapeHtml(formatLiveSessionSchedule(session))}</td>
        <td><strong>${Number(session.participantCount || 0)}</strong></td>
        <td>
          <div class="control-actions" style="justify-content:flex-start;flex-wrap:wrap;gap:8px;">
            <button class="btn secondary sm" type="button" data-live-session-edit="${escapeHtml(session.id || '')}">Edit</button>
            <button class="btn primary sm" type="button" data-live-session-save="${escapeHtml(session.id || '')}">Save</button>
            <button class="btn warn sm" type="button" data-live-session-start="${escapeHtml(session.id || '')}"${canStart ? '' : ' disabled'}>Start</button>
            <button class="btn secondary sm" type="button" data-live-session-end="${escapeHtml(session.id || '')}"${canEnd ? '' : ' disabled'}>End</button>
            <button class="btn danger sm" type="button" data-live-session-cancel="${escapeHtml(session.id || '')}"${canCancel ? '' : ' disabled'}>Cancel</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

let liveSessionRealtimeSource = null;
let liveSessionRealtimeRetryTimer = null;
let liveSessionRealtimeRetryMs = 2500;

function bindLiveSessionRealtime() {
  if (typeof window.EventSource !== 'function') return;
  const streamUrl = window.CollegeOSApi.getLiveSessionRealtimeStreamUrl
    ? window.CollegeOSApi.getLiveSessionRealtimeStreamUrl()
    : '/api/live-sessions/stream';

  const connect = () => {
    try {
      if (liveSessionRealtimeSource) {
        liveSessionRealtimeSource.close();
      }
      liveSessionRealtimeSource = new EventSource(streamUrl, { withCredentials: true });
      const refresh = () => loadLiveSessionControl().catch(() => null);

      ['live_session_updated', 'live_session_changed', 'live_session_created', 'live_session_started', 'live_session_ended', 'live_session_joined', 'live_session_left', 'live_session_cancelled', 'live_session_rescheduled']
        .forEach((eventName) => liveSessionRealtimeSource.addEventListener(eventName, refresh));

      liveSessionRealtimeSource.onopen = () => {
        liveSessionRealtimeRetryMs = 2500;
      };

      liveSessionRealtimeSource.onerror = () => {
        try {
          liveSessionRealtimeSource?.close();
        } catch {
          // Ignore close failures.
        }
        liveSessionRealtimeSource = null;
        if (liveSessionRealtimeRetryTimer) {
          window.clearTimeout(liveSessionRealtimeRetryTimer);
        }
        liveSessionRealtimeRetryTimer = window.setTimeout(() => {
          liveSessionRealtimeRetryMs = Math.min(liveSessionRealtimeRetryMs * 2, 30000);
          connect();
        }, liveSessionRealtimeRetryMs);
      };
    } catch {
      // Realtime is best-effort.
    }
  };

  connect();
  window.addEventListener('beforeunload', () => {
    try {
      liveSessionRealtimeSource?.close();
    } catch {
      // no-op
    }
    if (liveSessionRealtimeRetryTimer) {
      window.clearTimeout(liveSessionRealtimeRetryTimer);
    }
  });
}

async function persistLiveHubSessionFromCard(session) {
  if (!session?.id) throw new Error('Missing session id');
  const response = await window.CollegeOSApi.liveSessionReschedule(session.id, {
    title: session.title,
    description: session.summary || '',
    mentorName: session.mentorName || '',
    assignedHostUserRef: session.assignedHostUserRef || session.mentorProfileKey || '',
    assignedHostEmail: session.assignedHostUserRef || session.assignedHostEmail || session.mentorProfileKey || '',
    sessionType: session.type || 'mentorship',
    provider: session.provider || getLiveDefaultProvider(),
    roomName: session.roomId || '',
    channelName: session.roomId || '',
    scheduledStart: session.startAt,
    scheduledEnd: session.endAt,
    status: session.status,
    maxParticipants: Number(session.maxParticipants || 100),
    hostCode: session.mentorAccessId || undefined
  });
  return response?.session || null;
}

async function openLiveSessionAction(sessionId, action) {
  const response = await window.CollegeOSApi.liveSessionGet(sessionId);
  const session = response?.session;
  if (!session) throw new Error('Live session not found');

  if (action === 'save') {
    await persistLiveHubSessionFromCard(mapLiveSessionApiToCard(session));
  } else if (action === 'start') {
    await window.CollegeOSApi.liveSessionStart(sessionId, {});
  } else if (action === 'end') {
    await window.CollegeOSApi.liveSessionEnd(sessionId, {});
  } else if (action === 'cancel') {
    await window.CollegeOSApi.liveSessionCancel(sessionId, { reason: 'Cancelled from admin live session dashboard' });
  }

  await loadLiveSessionControl();
}

function normalizeLiveHubSessionFromCard(card, index) {
  const type = card.querySelector('.live-hub-session-type')?.value === 'lab' ? 'lab' : 'mentorship';
  const mentorAccessId = card.querySelector('.live-hub-session-access')?.value.trim() || '';
  const assignedHostUserRef = card.querySelector('.live-hub-session-host-user')?.value.trim() || '';
  const status = normalizeGoLiveStatus(card.querySelector('.live-hub-session-status')?.value || 'scheduled');
  return {
    id: card.querySelector('.live-hub-session-id')?.value.trim() || makeLiveHubSessionId(type, index),
    type,
    title: card.querySelector('.live-hub-session-title')?.value.trim() || (type === 'lab' ? 'Hands-on Lab' : 'Mentorship Session'),
    mentorName: card.querySelector('.live-hub-session-mentor')?.value.trim() || 'College Mentor',
    assignedHostUserRef,
    assignedHostEmail: assignedHostUserRef,
    mentorProfileKey: assignedHostUserRef,
    mentorAccessId,
    startAt: fromDateTimeLocalValue(card.querySelector('.live-hub-session-start')?.value || ''),
    endAt: fromDateTimeLocalValue(card.querySelector('.live-hub-session-end')?.value || ''),
    durationMinutes: Number(card.querySelector('.live-hub-session-duration')?.value || 60),
    provider: card.querySelector('.live-hub-session-provider')?.value || 'jitsi',
    roomId: card.querySelector('.live-hub-session-room')?.value.trim() || '',
    roomLabel: card.querySelector('.live-hub-session-room-label')?.value.trim() || '',
    status,
    summary: card.querySelector('.live-hub-session-summary')?.value.trim() || ''
  };
}

function renderLiveHubSessions(sessions = []) {
  const list = cById('liveHubSessionList');
  if (!list) return;

  const rows = Array.isArray(sessions) ? sessions : [];
  if (!rows.length) {
    list.innerHTML = '<div class="co-admin-table-empty" style="padding:14px;border-radius:12px;border:1px dashed #cbd5e1;background:#fff;">No live sessions configured yet. Use Create Session or Seed Demo Sessions.</div>';
    return;
  }

  list.innerHTML = rows.map((session, index) => liveHubSessionCardHtml(session, index)).join('');

  list.querySelectorAll('[data-live-hub-delete]').forEach((button) => {
    button.addEventListener('click', () => {
      button.closest('[data-live-hub-session]')?.remove();
    });
  });

  list.querySelectorAll('[data-live-hub-duplicate]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('[data-live-hub-session]');
      if (!card) return;
      const nextIndex = list.querySelectorAll('[data-live-hub-session]').length;
      const data = normalizeLiveHubSessionFromCard(card, nextIndex);
      const clone = document.createElement('div');
      clone.innerHTML = liveHubSessionCardHtml({
        ...data,
        id: `${data.id}-copy`
      }, nextIndex).trim();
      card.insertAdjacentElement('afterend', clone.firstElementChild);
      renderLiveHubSessions(readLiveHubSessions());
    });
  });

  list.querySelectorAll('[data-live-hub-save-session]').forEach((button) => {
    button.addEventListener('click', async () => {
      const card = button.closest('[data-live-hub-session]');
      if (!card) return;
      const session = normalizeLiveHubSessionFromCard(card, Number(card.dataset.liveHubIndex || 0));
      try {
        await persistLiveHubSessionFromCard(session);
        await loadLiveSessionControl();
      } catch (error) {
        window.alert(error?.message || 'Unable to save this session.');
      }
    });
  });

  list.querySelectorAll('[data-live-hub-start-session]').forEach((button) => {
    button.addEventListener('click', async () => {
      const card = button.closest('[data-live-hub-session]');
      if (!card) return;
      const session = normalizeLiveHubSessionFromCard(card, Number(card.dataset.liveHubIndex || 0));
      try {
        await persistLiveHubSessionFromCard(session);
        await window.CollegeOSApi.liveSessionStart(session.id, {});
        await loadLiveSessionControl();
      } catch (error) {
        window.alert(error?.message || 'Unable to start this session.');
      }
    });
  });

  list.querySelectorAll('[data-live-hub-end-session]').forEach((button) => {
    button.addEventListener('click', async () => {
      const card = button.closest('[data-live-hub-session]');
      if (!card) return;
      const session = normalizeLiveHubSessionFromCard(card, Number(card.dataset.liveHubIndex || 0));
      try {
        await window.CollegeOSApi.liveSessionEnd(session.id, {});
        await loadLiveSessionControl();
      } catch (error) {
        window.alert(error?.message || 'Unable to end this session.');
      }
    });
  });

  list.querySelectorAll('[data-live-hub-cancel-session]').forEach((button) => {
    button.addEventListener('click', async () => {
      const card = button.closest('[data-live-hub-session]');
      if (!card) return;
      const session = normalizeLiveHubSessionFromCard(card, Number(card.dataset.liveHubIndex || 0));
      try {
        await window.CollegeOSApi.liveSessionCancel(session.id, { reason: 'Cancelled from admin live session dashboard' });
        await loadLiveSessionControl();
      } catch (error) {
        window.alert(error?.message || 'Unable to cancel this session.');
      }
    });
  });

  list.querySelectorAll('[data-live-hub-generate-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('[data-live-hub-session]');
      const input = card?.querySelector('.live-hub-session-access');
      if (!input) return;
      input.value = generateGoLiveAccessId();
      renderLiveHubSessions(readLiveHubSessions());
    });
  });

  list.querySelectorAll('[data-live-hub-copy-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const card = button.closest('[data-live-hub-session]');
      const accessId = card?.querySelector('.live-hub-session-access')?.value.trim() || '';
      if (!accessId) {
        window.alert('No host code found to copy.');
        return;
      }
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(accessId);
        } else {
          const helper = document.createElement('textarea');
          helper.value = accessId;
          helper.setAttribute('readonly', 'readonly');
          helper.style.position = 'absolute';
          helper.style.left = '-9999px';
          document.body.appendChild(helper);
          helper.select();
          document.execCommand('copy');
          document.body.removeChild(helper);
        }
        button.textContent = 'Copied';
        window.setTimeout(() => {
          button.textContent = 'Copy Code';
        }, 1200);
      } catch (_error) {
        window.alert('Unable to copy right now. Please copy manually.');
      }
    });
  });

  list.querySelectorAll('[data-live-hub-regenerate-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('[data-live-hub-session]');
      if (!card) return;
      const input = card.querySelector('.live-hub-session-access');
      if (!input) return;
      if (!window.confirm('Regenerate this code? The old code will stop working immediately.')) return;
      input.value = generateGoLiveAccessId();
      renderLiveHubSessions(readLiveHubSessions());
    });
  });

  list.querySelectorAll('.live-hub-session-status').forEach((select) => {
    select.addEventListener('change', () => {
      renderLiveHubSessions(readLiveHubSessions());
    });
  });

  list.querySelectorAll('[data-live-session-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      const sessionId = button.dataset.liveSessionEdit;
      const card = list.querySelector(`[data-live-hub-session] input.live-hub-session-id[value="${escapeCssValue(sessionId)}"]`)?.closest('[data-live-hub-session]');
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card?.classList.add('pulse-highlight');
      window.setTimeout(() => card?.classList.remove('pulse-highlight'), 1400);
    });
  });

  list.querySelectorAll('[data-live-session-save]').forEach((button) => {
    button.addEventListener('click', async () => {
      const sessionId = button.dataset.liveSessionSave;
      const card = list.querySelector(`[data-live-hub-session] input.live-hub-session-id[value="${escapeCssValue(sessionId)}"]`)?.closest('[data-live-hub-session]');
      if (!card) return;
      try {
        await persistLiveHubSessionFromCard(normalizeLiveHubSessionFromCard(card, Number(card.dataset.liveHubIndex || 0)));
        await loadLiveSessionControl();
      } catch (error) {
        window.alert(error?.message || 'Unable to save this session.');
      }
    });
  });

  list.querySelectorAll('[data-live-session-start]').forEach((button) => {
    button.addEventListener('click', () => {
      openLiveSessionAction(button.dataset.liveSessionStart, 'start').catch((error) => window.alert(error?.message || 'Unable to start the session.'));
    });
  });

  list.querySelectorAll('[data-live-session-end]').forEach((button) => {
    button.addEventListener('click', () => {
      openLiveSessionAction(button.dataset.liveSessionEnd, 'end').catch((error) => window.alert(error?.message || 'Unable to end the session.'));
    });
  });

  list.querySelectorAll('[data-live-session-cancel]').forEach((button) => {
    button.addEventListener('click', () => {
      openLiveSessionAction(button.dataset.liveSessionCancel, 'cancel').catch((error) => window.alert(error?.message || 'Unable to cancel the session.'));
    });
  });
}

function readLiveHubSessions() {
  return Array.from(cById('liveHubSessionList')?.querySelectorAll('[data-live-hub-session]') || [])
    .map((card, index) => normalizeLiveHubSessionFromCard(card, index))
    .filter((session) => Boolean(session.id));
}

function mapLiveSessionApiToCard(session = {}) {
  return {
    id: session.sessionId || session.id || '',
    type: String(session.sessionType || session.type || 'mentorship').toLowerCase() === 'lab' ? 'lab' : 'mentorship',
    title: session.title || '',
    mentorName: session.mentorName || '',
    assignedHostUserRef: session.assignedHostEmail || session.assignedHostUserId || session.mentorEmail || session.mentorProfileKey || '',
    assignedHostEmail: session.assignedHostEmail || session.mentorEmail || '',
    mentorProfileKey: session.assignedHostEmail || session.assignedHostUserId || session.mentorEmail || session.mentorProfileKey || '',
    mentorAccessId: session.hostCode || session.hostCodePreview || session.hostCodePlain || session.mentorAccessId || '',
    startAt: session.scheduledStart || session.startAt || '',
    endAt: session.scheduledEnd || session.endAt || '',
    durationMinutes: session.durationMinutes || 60,
    provider: session.provider || getLiveDefaultProvider(),
    roomId: session.roomName || session.roomId || session.channelName || '',
    roomLabel: session.roomLabel || session.channelName || '',
    status: normalizeGoLiveStatus(session.status || 'scheduled'),
    summary: session.description || session.summary || '',
    participantCount: session.participantCount || 0,
    codeGenerated: Boolean(session.codeGenerated || session.hostCode || session.hostCodePreview || session.hostCodePlain),
    lastGeneratedAt: session.lastGeneratedAt || session.hostCodeGeneratedAt || null
  };
}

async function addLiveHubSession(session = {}) {
  const list = cById('liveHubSessionList');
  if (!list) return;

  const response = await window.CollegeOSApi.liveSessionCreate({
    title: session.title || 'New Live Session',
    description: session.summary || '',
    mentorName: session.mentorName || '',
    assignedHostUserRef: session.assignedHostUserRef || session.mentorProfileKey || '',
    assignedHostEmail: session.assignedHostUserRef || session.assignedHostEmail || session.mentorProfileKey || '',
    sessionType: session.type || 'mentorship',
    provider: session.provider || getLiveDefaultProvider(),
    maxParticipants: Number(session.maxParticipants || 100),
    scheduledStart: session.startAt || new Date().toISOString(),
    scheduledEnd: session.endAt || new Date(Date.now() + 60 * 60000).toISOString(),
    hostCode: session.mentorAccessId || undefined
  });

  const wrapper = document.createElement('div');
  const index = list.querySelectorAll('[data-live-hub-session]').length;
  wrapper.innerHTML = liveHubSessionCardHtml(mapLiveSessionApiToCard({
    ...response.session,
    hostCode: response.hostCode
  }), index).trim();
  list.appendChild(wrapper.firstElementChild);
  renderLiveHubSessions(readLiveHubSessions());
  if (response.hostCode) {
    window.alert(`Session created. Host code: ${response.hostCode}`);
  }
  await loadLiveSessionControl();
}

let currentAdminUser = null;
let currentAdminPermissions = [];
let currentAdminRole = '';
let adminAuthStatus = 'LOADING'; // 'LOADING' | 'AUTHENTICATED' | 'UNAUTHENTICATED'
let adminPermissionStatus = 'LOADING'; // 'LOADING' | 'AUTHORIZED' | 'UNAUTHORIZED'

function isSuperAdminRole(role) {
  const norm = String(role || '').toLowerCase().trim();
  return norm === 'super_admin' || norm === 'superadmin' || norm === 'admin';
}

function checkRoutePermission(requiredPermission) {
  if (!requiredPermission) return true;
  if (adminPermissionStatus === 'LOADING') return true;
  if (isSuperAdminRole(currentAdminRole)) return true;
  if (currentAdminPermissions.includes('*')) return true;
  return currentAdminPermissions.includes(requiredPermission);
}

async function ensureAdminSession() {
  adminAuthStatus = 'LOADING';
  adminPermissionStatus = 'LOADING';
  try {
    const perm = await window.CollegeOSApi.adminControlPermissions();
    if (!perm || !perm.role) {
      adminAuthStatus = 'UNAUTHENTICATED';
      adminPermissionStatus = 'UNAUTHORIZED';
      window.location.href = 'admin-login.html';
      return false;
    }
    
    currentAdminRole = String(perm.role || '').toLowerCase();
    currentAdminPermissions = Array.isArray(perm.permissions) ? perm.permissions : [];
    currentAdminUser = perm.user || null;
    
    adminAuthStatus = 'AUTHENTICATED';
    adminPermissionStatus = 'AUTHORIZED';

    const infoEl = cById('controlPermissionInfo');
    if (infoEl) {
      infoEl.textContent = `Signed in as ${perm.role}. Permissions: ${currentAdminPermissions.join(', ')}`;
    }
    return true;
  } catch (_error) {
    console.error('[ensureAdminSession] Failed:', _error?.message || String(_error));
    adminAuthStatus = 'UNAUTHENTICATED';
    adminPermissionStatus = 'UNAUTHORIZED';
    window.location.href = 'admin-login.html';
    return false;
  }
}

let currentRouteToken = 0;
let activeRouteKey = '';

const ADMIN_ROUTE_REGISTRY = [
  {
    hash: '#students-management',
    path: '/admin/students',
    aliases: ['#students', '#student-management', '/admin/students', '/admin/student-management'],
    key: 'students',
    panelId: 'panel-students',
    title: 'Student Management',
    requiredPermission: 'view_students',
    loader: (token) => loadStudents(false, token)
  },
  {
    hash: '#membership-management',
    path: '/admin/memberships',
    aliases: ['#memberships', '#membership-plans', '#membership', '/admin/memberships', '/admin-memberships.html'],
    key: 'memberships',
    panelId: 'panel-memberships',
    title: 'Membership Plan & Entitlement System',
    requiredPermission: 'manage_memberships',
    loader: (token) => loadMembershipPlansPanel(token)
  },
  {
    hash: '#payments-governance',
    path: '/admin/payments',
    aliases: ['#payments', '#payment-queue', '#payments-verification', '#payments-governance', '/admin/payments'],
    key: 'payments',
    panelId: 'panel-payments',
    title: 'Memberships & Payments Governance',
    requiredPermission: 'verify_payments',
    loader: (token) => loadPayments(token)
  },
  {
    hash: '#analytics',
    path: '/admin/analytics',
    aliases: ['#analytics-dashboard', '#dashboard-analytics', '#analytics', '/admin/analytics', '/admin-control.html', '/admin-control'],
    key: 'analytics',
    panelId: 'panel-analytics',
    title: 'Analytics Dashboard',
    requiredPermission: 'view_analytics',
    loader: (token) => loadAnalytics(token)
  },
  {
    hash: '#academic-structure',
    path: '/admin/academic-structure',
    aliases: ['#academics', '#academic', '#universities', '#courses', '#batches', '#academic-structure', '/admin/academic-structure', '/admin/academics'],
    key: 'academic-structure',
    panelId: 'panel-academic-structure',
    title: 'Academic Structure & Scope Management',
    requiredPermission: 'manage_academic_content',
    loader: () => loadAcademicStructurePanel()
  },
  {
    hash: '#content-governance',
    path: '/admin/content',
    aliases: ['#content', '#bulk-content', '#content-governance', '/admin/content'],
    key: 'content',
    panelId: 'panel-content',
    title: 'Bulk Content Management',
    requiredPermission: 'manage_content',
    loader: () => loadContentOverview()
  },
  {
    hash: '#branches',
    path: '/admin/branches',
    aliases: ['#branch-management', '#branches', '/admin/branches'],
    key: 'branches',
    panelId: 'panel-branches',
    title: 'Branch & Course Management',
    requiredPermission: 'manage_academic_content',
    loader: () => loadBranches()
  },
  {
    hash: '#onboarding',
    path: '/admin/onboarding',
    aliases: ['#onboarding-config', '#onboarding', '/admin/onboarding'],
    key: 'onboarding',
    panelId: 'panel-onboarding',
    title: 'Onboarding & Recommendations',
    requiredPermission: 'manage_settings',
    loader: async () => {
      await loadOnboardingConfig();
      await loadRecommendationRules();
    }
  },
  {
    hash: '#mock-tests',
    path: '/admin/mock-tests',
    aliases: ['#mocktests', '#mock-tests', '/admin/mock-tests'],
    key: 'mocktests',
    panelId: 'panel-mocktests',
    title: 'Mock Test Studio',
    requiredPermission: 'manage_assessments',
    loader: () => loadMockTests()
  },
  {
    hash: '#roadmaps',
    path: '/admin/roadmaps',
    aliases: ['#study-roadmaps', '#roadmaps', '/admin/roadmaps'],
    key: 'roadmaps',
    panelId: 'panel-roadmaps',
    title: 'Study Roadmaps',
    requiredPermission: 'manage_content',
    loader: () => loadRoadmaps()
  },
  {
    hash: '#notifications',
    path: '/admin/notifications',
    aliases: ['#notify', '#announcements', '#notifications', '/admin/notifications'],
    key: 'notify',
    panelId: 'panel-notify',
    title: 'Notifications & Announcements',
    requiredPermission: 'manage_settings',
    loader: () => loadAnnouncements()
  },
  {
    hash: '#moderation',
    path: '/admin/moderation',
    aliases: ['#forum-moderation', '#moderation', '/admin/moderation'],
    key: 'moderation',
    panelId: 'panel-moderation',
    title: 'Forum & Feedback Moderation',
    requiredPermission: 'manage_community',
    loader: async () => {
      await loadForumPosts();
      await loadFeedback();
    }
  },
  {
    hash: '#referrals',
    path: '/admin/referrals',
    aliases: ['#referral-management', '#referrals', '/admin/referrals'],
    key: 'referrals',
    panelId: 'panel-referrals',
    title: 'Referral Management',
    requiredPermission: 'manage_settings',
    loader: async () => {
      await loadReferralHistory();
      await loadTopReferrers();
    }
  },
  {
    hash: '#roles-permissions',
    path: '/admin/roles',
    aliases: ['#roles', '#permissions', '#roles-permissions', '/admin/roles', '/admin/permissions'],
    key: 'roles',
    panelId: 'panel-roles',
    title: 'Roles & Permissions',
    requiredPermission: 'manage_roles',
    loader: () => loadRoles()
  },
  {
    hash: '#system-settings',
    path: '/admin/settings',
    aliases: ['#settings', '#feature-toggles', '#system-settings', '/admin/settings', '/admin/features'],
    key: 'settings',
    panelId: 'panel-settings',
    title: 'System Settings & Feature Toggles',
    requiredPermission: 'manage_settings',
    loader: async () => {
      await loadSettings();
      await loadContributionVisibilitySettings();
      await loadCodingSettings();
      await loadMembershipConfig();
      await loadExperienceConfig();
      await loadFeatureVisibilityMatrix();
    }
  },
  {
    hash: '#coding-challenges',
    path: '/admin/coding',
    aliases: ['#coding', '#coding-governance', '#coding-challenges', '/admin/coding', '/admin/coding-governance'],
    key: 'coding',
    panelId: 'panel-coding',
    title: 'Coding Challenges Governance',
    requiredPermission: 'manage_coding',
    loader: () => loadCodingDashboardPanel()
  },
  {
    hash: '#experience',
    path: '/admin/experience',
    aliases: ['#experience-studio', '#experience', '/admin/experience'],
    key: 'experience',
    panelId: 'panel-experience',
    title: 'Experience Studio',
    requiredPermission: 'manage_settings',
    loader: () => loadExperienceConfig()
  },
  {
    hash: '#live-sessions',
    path: '/admin/live-sessions',
    aliases: ['#live-session-control', '#live-sessions', '/admin/live-sessions'],
    key: 'live-sessions',
    panelId: 'panel-live-sessions',
    title: 'Live Session Control',
    requiredPermission: 'manage_live_sessions',
    loader: () => loadLiveSessionControl()
  },
  {
    hash: '#audit-logs',
    path: '/admin/audit-logs',
    aliases: ['#audit', '#audit-logs', '/admin/audit-logs', '/admin/audit'],
    key: 'audit',
    panelId: 'panel-audit',
    title: 'Audit & Activity Logs',
    requiredPermission: 'view_audit_logs',
    loader: () => loadAuditLogs()
  },
  {
    hash: '#company',
    path: '/admin/company',
    aliases: ['#company-support', '#company', '/admin/company'],
    key: 'company',
    panelId: 'panel-company',
    title: 'Company & Support Management',
    requiredPermission: 'manage_settings',
    loader: () => {}
  }
];

function resolveRouteFromHash(rawHashOrUrl) {
  const normHash = String(window.location.hash || rawHashOrUrl || '').toLowerCase().trim();
  const normPath = String(window.location.pathname || rawHashOrUrl || '').toLowerCase().trim();

  // 1. Check hash first if hash exists
  if (normHash && normHash !== '#') {
    const foundHash = ADMIN_ROUTE_REGISTRY.find(r => r.hash === normHash || (r.aliases && r.aliases.includes(normHash)));
    if (foundHash) return foundHash;
  }

  // 2. Check path next
  if (normPath) {
    const foundPath = ADMIN_ROUTE_REGISTRY.find(r => r.path === normPath || (r.aliases && r.aliases.includes(normPath)));
    if (foundPath) return foundPath;

    if (normPath.includes('/admin/student')) return ADMIN_ROUTE_REGISTRY.find(r => r.key === 'students');
    if (normPath.includes('/admin/payment') || normPath.includes('/admin/member')) return ADMIN_ROUTE_REGISTRY.find(r => r.key === 'payments');
    if (normPath.includes('/admin/setting') || normPath.includes('/admin/feature')) return ADMIN_ROUTE_REGISTRY.find(r => r.key === 'settings');
    if (normPath.includes('/admin/audit')) return ADMIN_ROUTE_REGISTRY.find(r => r.key === 'audit');
    if (normPath.includes('/admin/role') || normPath.includes('/admin/permission')) return ADMIN_ROUTE_REGISTRY.find(r => r.key === 'roles');
    if (normPath.includes('/admin/academic')) return ADMIN_ROUTE_REGISTRY.find(r => r.key === 'academic-structure');
    if (normPath.includes('/admin/coding')) return ADMIN_ROUTE_REGISTRY.find(r => r.key === 'coding');
    if (normPath.includes('/admin/live')) return ADMIN_ROUTE_REGISTRY.find(r => r.key === 'live-sessions');
  }

  // 3. Fallback for /admin-control.html without hash -> analytics
  if (normPath.endsWith('admin-control.html') || normPath.endsWith('admin-control')) {
    return ADMIN_ROUTE_REGISTRY.find(r => r.key === 'analytics');
  }

  return null; // Return null for unknown routes (404)
}

function resolvePanelFromHash(hash) {
  const route = resolveRouteFromHash(hash);
  return route ? route.panelId : 'panel-analytics';
}

async function activateAdminRoute(rawHashOrUrl) {
  const route = resolveRouteFromHash(rawHashOrUrl);

  // 1. Deactivate & HIDE ALL module containers
  document.querySelectorAll('.control-panel').forEach((panel) => {
    panel.setAttribute('hidden', 'hidden');
    panel.classList.remove('active');
  });

  // Handle 404 Unknown Route
  if (!route) {
    const notFoundPanel = cById('panel-not-found');
    if (notFoundPanel) {
      notFoundPanel.removeAttribute('hidden');
      notFoundPanel.classList.add('active');
    }
    document.title = '404 Page Not Found | College OS Admin';
    return;
  }

  // Handle 403 Access Denied
  if (route.requiredPermission && !checkRoutePermission(route.requiredPermission)) {
    const accessDeniedPanel = cById('panel-access-denied');
    if (accessDeniedPanel) {
      const msg = cById('accessDeniedMessage');
      if (msg) msg.textContent = `Access Denied: You do not have the required permission (${route.requiredPermission}) to access ${route.title}.`;
      accessDeniedPanel.removeAttribute('hidden');
      accessDeniedPanel.classList.add('active');
    }
    document.title = `403 Access Denied | College OS Admin`;
    return;
  }

  currentRouteToken += 1;
  const token = currentRouteToken;
  activeRouteKey = route.key;
  document.title = `${route.title} | College OS Admin`;

  // 2. Remove active class from all sidebar links and dropdown option
  document.querySelectorAll('.co-admin-nav-link').forEach((link) => {
    const href = (link.getAttribute('href') || '').toLowerCase();
    if (href.includes(route.hash.toLowerCase()) || (route.path && href.includes(route.path.toLowerCase())) || (route.aliases && route.aliases.some(a => href.includes(a.toLowerCase())))) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // 3. Update quick switcher dropdown and active route breadcrumb badge
  const quickSelect = cById('quickModuleSelect');
  if (quickSelect) quickSelect.value = route.hash;
  const breadcrumbText = cById('activeRouteBreadcrumbText');
  if (breadcrumbText) breadcrumbText.textContent = route.title;

  // 4. Activate target module container
  const targetPanel = cById(route.panelId);
  if (targetPanel) {
    targetPanel.removeAttribute('hidden');
    targetPanel.classList.add('active');
  }

  // 5. Reset main content scroll container to top (0, 0)
  const mainContent = document.querySelector('.co-admin-main');
  if (mainContent) mainContent.scrollTop = 0;
  window.scrollTo(0, 0);

  // 6. Scroll active sidebar navigation item into view safely
  const activeLink = document.querySelector('.co-admin-nav-link.active');
  if (activeLink && typeof activeLink.scrollIntoView === 'function') {
    activeLink.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // 7. Execute data loader ONLY for the active module
  if (typeof route.loader === 'function') {
    try {
      await route.loader(token);
      if (route.key === 'students') {
        const raw = window.location.hash || '';
        const match = raw.match(/#(?:students|students-management)(?:\/|\?studentId=)(\d+)/i) || window.location.search.match(/studentId=(\d+)/i);
        if (match && match[1]) {
          const targetStudentId = Number(match[1]);
          if (targetStudentId > 0) {
            window.setTimeout(() => {
              openStudentDrawer(targetStudentId).catch(() => {});
            }, 150);
          }
        }
      }
    } catch (err) {
      console.warn(`[RouteLoader:${route.key}] Error:`, err.message);
    }
  }
}

async function loadAnalytics(token) {
  const kpiNode = cById('analyticsKpis');
  const branchNode = cById('analyticsBranchTable');
  const data = await window.CollegeOSApi.adminControlAnalytics();
  if (token && token !== currentRouteToken) return;

  const kpis = [
    ['Total Students', data.totals.total_students],
    ['Active Students', data.activeStudents.active_students],
    ['Premium Students', data.totals.premium_students],
    ['Expired Memberships', data.totals.expired_memberships],
    ['Blocked Students', data.totals.blocked_students],
    ['Revenue (INR)', Number(data.revenue || 0).toLocaleString('en-IN')],
    ['Quiz Attempts', data.quizAttempts.total_attempts],
    ['Roadmap Avg Completion', `${data.roadmapStats.avg_completion}%`]
  ];

  if (kpiNode) {
    kpiNode.innerHTML = kpis.map((item) => `
      <div class="kpi-card">
        <div class="kpi-label">${item[0]}</div>
        <div class="kpi-value">${item[1]}</div>
      </div>
    `).join('');
  }

  const rows = data.branchWise || [];
  if (branchNode) {
    if (!rows.length) {
      branchNode.innerHTML = '<tr><td colspan="3" class="co-admin-table-empty">No branch analytics found.</td></tr>';
      return;
    }

    branchNode.innerHTML = rows.map((row) => `
      <tr>
        <td>${row.category || '-'}</td>
        <td>${row.branch || '-'}</td>
        <td>${row.students || 0}</td>
      </tr>
    `).join('');
  }
}

const studentCache = new Map();
let studentCurrentPage = 1;
let studentTotalPages = 1;
let studentTotalItems = 0;
let studentSearchDebounceTimer = null;

async function loadStudents(includeDeleted = false, token, page = 1) {
  studentCurrentPage = Math.max(1, page);
  const tbody = cById('studentsTableBody');
  const limit = Number(cById('studentPerPageSelect')?.value || 20);

  const payload = await window.CollegeOSApi.adminControlStudents({
    search: cById('studentSearchInput')?.value || '',
    membership: cById('studentMembershipFilter')?.value || '',
    status: cById('studentStatusFilter')?.value || '',
    collegeId: cById('studentCollegeFilter')?.value || '',
    branchId: cById('studentBranchFilter')?.value || '',
    semesterId: cById('studentSemesterFilter')?.value || '',
    sortBy: cById('studentSortBySelect')?.value || 'created_at',
    sortDir: cById('studentSortDirSelect')?.value || 'DESC',
    page: studentCurrentPage,
    limit,
    includeDeleted
  });

  if (token && token !== currentRouteToken) return;

  const rows = payload.students || [];
  const pagination = payload.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 };
  const stats = payload.stats || {};

  studentTotalPages = pagination.totalPages || 1;
  studentTotalItems = pagination.total || 0;

  // Update KPI cards
  if (cById('kpiTotalStudents')) cById('kpiTotalStudents').textContent = String(stats.total ?? studentTotalItems);
  if (cById('kpiActiveStudents')) cById('kpiActiveStudents').textContent = String(stats.active ?? 0);
  if (cById('kpiSuspendedStudents')) cById('kpiSuspendedStudents').textContent = String(stats.suspended ?? 0);
  if (cById('kpiRecentStudents')) cById('kpiRecentStudents').textContent = String(stats.premium ?? 0);

  // Update Pagination Controls
  const infoNode = cById('studentPaginationInfo');
  const pageIndicatorNode = cById('studentPageIndicator');
  const prevBtn = cById('studentPrevPageBtn');
  const nextBtn = cById('studentNextPageBtn');

  if (infoNode) {
    const startIdx = studentTotalItems === 0 ? 0 : (studentCurrentPage - 1) * limit + 1;
    const endIdx = Math.min(studentCurrentPage * limit, studentTotalItems);
    infoNode.textContent = `Showing ${startIdx}-${endIdx} of ${studentTotalItems} students`;
  }
  if (pageIndicatorNode) {
    pageIndicatorNode.textContent = `Page ${studentCurrentPage} of ${studentTotalPages}`;
  }
  if (prevBtn) prevBtn.disabled = studentCurrentPage <= 1;
  if (nextBtn) nextBtn.disabled = studentCurrentPage >= studentTotalPages;

  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="co-admin-table-empty">No students found. Try adjusting search or filters.</td></tr>';
    return;
  }

  const formatDate = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('en-IN');
  };

  tbody.innerHTML = rows.map((student) => {
    studentCache.set(Number(student.id), student);
    return `
    <tr>
      <td><input class="student-row-checkbox" type="checkbox" value="${student.id}" /></td>
      <td>
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:34px; height:34px; border-radius:50%; background:var(--primary-color,#2563eb); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; flex-shrink:0;">
            ${(student.full_name || 'S').charAt(0).toUpperCase()}
          </div>
          <div>
            <strong>${escapeHtml(student.full_name)}</strong>
            <div class="muted">${escapeHtml(student.email)}</div>
            <div class="muted">ID: ${escapeHtml(student.uid || student.id)}</div>
          </div>
        </div>
      </td>
      <td>
        <div>${escapeHtml(student.college_name || '-')}</div>
        <div class="muted">${escapeHtml(student.course_name || student.category_name || '-')}</div>
        <div class="muted">${escapeHtml(student.branch_name || '-')} · ${escapeHtml(student.semester_label || '-')}</div>
      </td>
      <td>${student.deleted_at ? asStatusBadge('deleted') : (student.is_blocked ? asStatusBadge('blocked') : (student.is_suspended ? asStatusBadge('suspended') : asStatusBadge('active')))}</td>
      <td>${asStatusBadge(student.subscription_tier)}</td>
      <td>${formatDate(student.signup_date)}</td>
      <td>${formatDate(student.last_login_at)}</td>
      <td style="text-align:right;">
        <div style="display:inline-flex; align-items:center; gap:6px;">
          <button class="btn primary btn-sm" data-action="view" data-id="${student.id}"><i class="fa-solid fa-eye"></i> View</button>
          <div class="co-admin-dropdown">
            <button class="btn secondary btn-sm co-admin-dropdown-toggle" type="button"><i class="fa-solid fa-ellipsis-vertical"></i></button>
            <div class="co-admin-dropdown-menu align-right">
              <button class="co-admin-dropdown-item" data-action="view" data-id="${student.id}"><i class="fa-solid fa-user-gear"></i> Manage Account</button>
              <button class="co-admin-dropdown-item" data-action="grant" data-id="${student.id}"><i class="fa-solid fa-crown"></i> Manage Membership</button>
              <button class="co-admin-dropdown-item" data-action="reset" data-id="${student.id}"><i class="fa-solid fa-key"></i> Reset Password</button>
              <div class="co-admin-dropdown-divider"></div>
              <button class="co-admin-dropdown-item" data-action="activate" data-id="${student.id}"><i class="fa-solid fa-check text-success"></i> Activate Account</button>
              <button class="co-admin-dropdown-item" data-action="suspend" data-id="${student.id}"><i class="fa-solid fa-pause text-warn"></i> Suspend Account</button>
              <button class="co-admin-dropdown-item danger" data-action="block" data-id="${student.id}"><i class="fa-solid fa-ban"></i> Block Account</button>
              ${student.deleted_at ? `<button class="co-admin-dropdown-item" data-action="restore" data-id="${student.id}"><i class="fa-solid fa-rotate-left"></i> Restore</button>` : `<button class="co-admin-dropdown-item danger" data-action="delete" data-id="${student.id}"><i class="fa-solid fa-trash"></i> Soft Delete</button>`}
            </div>
          </div>
        </div>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('button[data-action]').forEach((button) => {
    button.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = button.dataset.action;
      const id = Number(button.dataset.id);
      try {
        if (action === 'view' || action === 'grant') {
          await openStudentDrawer(id, action === 'grant' ? 'membership' : 'overview');
        } else if (action === 'reset') {
          await openStudentDrawer(id, 'security');
        } else if (action === 'activate' || action === 'suspend' || action === 'block') {
          const reason = window.prompt(`Reason for setting status to "${action}":`, '');
          if (reason === null) return;
          await window.CollegeOSApi.adminControlStudentStatus(id, action, { reason: reason || 'Admin action' });
          await loadStudents(includeDeleted, token, studentCurrentPage);
        } else if (action === 'delete') {
          if (!window.confirm('Soft delete this student record?')) return;
          await window.CollegeOSApi.adminControlDeleteStudent(id);
          await loadStudents(includeDeleted, token, studentCurrentPage);
        } else if (action === 'restore') {
          await window.CollegeOSApi.adminControlRestoreStudent(id);
          await loadStudents(includeDeleted, token, studentCurrentPage);
        }
      } catch (error) {
        window.alert(error.message || 'Operation failed');
      }
    });
  });
}

async function openStudentDrawer(id, initialTab = 'overview') {
  try {
    const detail = await window.CollegeOSApi.adminControlStudentDetail(id);
    const student = detail.student || {};
    const profile = detail.profile || {};
    const payments = detail.payments || [];
    const academicActivity = detail.academicActivity || {};
    const codingActivity = detail.codingActivity || {};
    const certificates = detail.certificates || [];
    const auditHistory = detail.auditHistory || [];
    const effectiveFeatures = detail.effectiveFeatures || {};

    const nameNode = cById('drawerStudentName');
    const subNode = cById('drawerStudentSub');
    if (nameNode) nameNode.textContent = student.full_name || `Student #${id}`;
    if (subNode) subNode.textContent = `${student.email || ''} • Student ID: ${student.uid || id} • ${profile.college_name || 'College OS'}`;

    const bodyNode = cById('drawerStudentContent');
    if (!bodyNode) return;

    bodyNode.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:14px; background:var(--surface-1,#f8fafc); border-radius:10px; margin-bottom:14px; border:1px solid #e2e8f0;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="width:44px; height:44px; border-radius:50%; background:#2563eb; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:16px;">
            ${(student.full_name || 'S').charAt(0).toUpperCase()}
          </div>
          <div>
            <div style="font-weight:700; font-size:16px; color:#0f172a;">${escapeHtml(student.full_name)}</div>
            <div style="font-size:12px; color:#64748b;">${escapeHtml(student.email)} &bull; <strong>ID:</strong> ${escapeHtml(student.uid || student.id)}</div>
          </div>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          ${student.deleted_at ? asStatusBadge('deleted') : (student.is_blocked ? asStatusBadge('blocked') : (student.is_suspended ? asStatusBadge('suspended') : asStatusBadge('active')))}
          ${asStatusBadge(student.subscription_tier || 'free')}
        </div>
      </div>

      <!-- Detail Tabs Header -->
      <div style="display:flex; gap:4px; overflow-x:auto; padding-bottom:8px; margin-bottom:16px; border-bottom:1px solid #e2e8f0;" id="studentDrawerTabNav">
        <button class="btn btn-sm secondary ${initialTab === 'overview' ? 'active' : ''}" data-tab="overview"><i class="fa-solid fa-user"></i> Overview</button>
        <button class="btn btn-sm secondary ${initialTab === 'membership' ? 'active' : ''}" data-tab="membership"><i class="fa-solid fa-crown"></i> Membership</button>
        <button class="btn btn-sm secondary ${initialTab === 'payments' ? 'active' : ''}" data-tab="payments"><i class="fa-solid fa-receipt"></i> Payments (${payments.length})</button>
        <button class="btn btn-sm secondary ${initialTab === 'academic' ? 'active' : ''}" data-tab="academic"><i class="fa-solid fa-graduation-cap"></i> Academic</button>
        <button class="btn btn-sm secondary ${initialTab === 'coding' ? 'active' : ''}" data-tab="coding"><i class="fa-solid fa-code"></i> Coding</button>
        <button class="btn btn-sm secondary ${initialTab === 'certificates' ? 'active' : ''}" data-tab="certificates"><i class="fa-solid fa-certificate"></i> Certificates (${certificates.length})</button>
        <button class="btn btn-sm secondary ${initialTab === 'features' ? 'active' : ''}" data-tab="features"><i class="fa-solid fa-toggle-on"></i> Feature Access</button>
        <button class="btn btn-sm secondary ${initialTab === 'security' ? 'active' : ''}" data-tab="security"><i class="fa-solid fa-shield-halved"></i> Security & Account</button>
        <button class="btn btn-sm secondary ${initialTab === 'audit' ? 'active' : ''}" data-tab="audit"><i class="fa-solid fa-history"></i> Audit Log (${auditHistory.length})</button>
      </div>

      <!-- Tab Content Area -->
      <div id="studentDrawerTabPanels">
        <!-- Panel: Overview -->
        <div data-tab-panel="overview" style="${initialTab === 'overview' ? '' : 'display:none;'}">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px; font-size:0.88rem;">
            <div style="background:#fff; padding:12px; border-radius:8px; border:1px solid #e2e8f0;">
              <strong style="display:block; color:#0f172a; margin-bottom:6px;"><i class="fa-solid fa-id-card"></i> Profile & Identity</strong>
              <div><strong>Full Name:</strong> ${escapeHtml(student.full_name)}</div>
              <div><strong>Email:</strong> ${escapeHtml(student.email)}</div>
              <div><strong>Student ID (UID):</strong> ${escapeHtml(student.uid || student.id)}</div>
              <div><strong>College:</strong> ${escapeHtml(profile.college_name || '-')}</div>
              <div><strong>Course / Branch:</strong> ${escapeHtml(profile.course_name || '-')} / ${escapeHtml(profile.branch_name || '-')}</div>
              <div><strong>Semester:</strong> ${escapeHtml(profile.semester_label || '-')}</div>
              <div><strong>Target Exam:</strong> ${escapeHtml(profile.target_exam || '-')}</div>
            </div>
            <div style="background:#fff; padding:12px; border-radius:8px; border:1px solid #e2e8f0;">
              <strong style="display:block; color:#0f172a; margin-bottom:6px;"><i class="fa-solid fa-clock"></i> Account State & Activity</strong>
              <div><strong>Account Status:</strong> ${student.is_blocked ? asStatusBadge('blocked') : (student.is_suspended ? asStatusBadge('suspended') : asStatusBadge('active'))}</div>
              <div><strong>Current Membership:</strong> ${asStatusBadge(student.subscription_tier || 'free')}</div>
              <div><strong>Membership Expiry:</strong> ${student.subscription_expiry ? new Date(student.subscription_expiry).toLocaleDateString('en-IN') : 'N/A (Free)'}</div>
              <div><strong>Joined Date:</strong> ${student.signup_date ? new Date(student.signup_date).toLocaleDateString('en-IN') : '-'}</div>
              <div><strong>Last Active:</strong> ${student.last_login_at ? new Date(student.last_login_at).toLocaleString('en-IN') : 'Never'}</div>
            </div>
          </div>
        </div>

        <!-- Panel: Membership -->
        <div data-tab-panel="membership" style="${initialTab === 'membership' ? '' : 'display:none;'}">
          <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:14px; border-radius:8px; margin-bottom:16px;">
            <h4 style="margin:0 0 8px; font-size:0.95rem; color:#0f172a;"><i class="fa-solid fa-crown"></i> Active Membership State</h4>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:10px; font-size:0.85rem;">
              <div><strong>Current Tier:</strong> ${asStatusBadge(student.subscription_tier || 'free')}</div>
              <div><strong>Payment Status:</strong> ${asStatusBadge(student.payment_status || 'free')}</div>
              <div><strong>Start Date:</strong> ${student.subscription_started_at ? new Date(student.subscription_started_at).toLocaleDateString('en-IN') : '-'}</div>
              <div><strong>Expiry Date:</strong> ${student.subscription_expiry ? new Date(student.subscription_expiry).toLocaleDateString('en-IN') : '-'}</div>
            </div>
          </div>

          <!-- Grant Membership Section -->
          <div style="background:#fff; border:1px solid #e2e8f0; padding:14px; border-radius:8px; margin-bottom:14px;">
            <h4 style="margin:0 0 8px; font-size:0.92rem; color:#0f172a;"><i class="fa-solid fa-plus-circle"></i> Admin Grant Membership</h4>
            <p style="font-size:0.8rem; color:#64748b; margin:0 0 10px;">Select an active configured membership tier and duration to grant manually to this student.</p>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
              <div>
                <label style="font-size:0.8rem; font-weight:600;">Plan Tier</label>
                <select id="grantTierSelect" class="co-admin-select">
                  <option value="premium">Premium Plan</option>
                </select>
              </div>
              <div>
                <label style="font-size:0.8rem; font-weight:600;">Duration</label>
                <select id="grantDurationSelect" class="co-admin-select">
                  <option value="30">30 Days</option>
                  <option value="90">90 Days</option>
                  <option value="180">180 Days (6 Months)</option>
                  <option value="365">365 Days (1 Year)</option>
                </select>
              </div>
            </div>
            <div style="margin-bottom:10px;">
              <label style="font-size:0.8rem; font-weight:600;">Admin Audit Reason *</label>
              <input id="grantReasonInput" class="co-admin-input" placeholder="Mandatory reason (e.g. Scholarship award, Manual UPI verification)" />
            </div>
            <button class="btn primary btn-sm" id="btnExecuteGrantMembership"><i class="fa-solid fa-check"></i> Grant Membership</button>
          </div>

          <!-- Extend Membership Section -->
          <div style="background:#fff; border:1px solid #e2e8f0; padding:14px; border-radius:8px; margin-bottom:14px;">
            <h4 style="margin:0 0 8px; font-size:0.92rem; color:#0f172a;"><i class="fa-solid fa-clock-rotate-left"></i> Extend Membership</h4>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
              <div>
                <label style="font-size:0.8rem; font-weight:600;">Days to Add</label>
                <select id="extendDaysSelect" class="co-admin-select">
                  <option value="30">Add 30 Days</option>
                  <option value="60">Add 60 Days</option>
                  <option value="90">Add 90 Days</option>
                  <option value="180">Add 180 Days</option>
                </select>
              </div>
              <div>
                <label style="font-size:0.8rem; font-weight:600;">Reason *</label>
                <input id="extendReasonInput" class="co-admin-input" placeholder="Reason for extension" />
              </div>
            </div>
            <button class="btn secondary btn-sm" id="btnExecuteExtendMembership"><i class="fa-solid fa-calendar-plus"></i> Extend Membership</button>
          </div>

          <!-- Revoke Membership Section -->
          <div style="background:#fff1f2; border:1px solid #fecdd3; padding:14px; border-radius:8px;">
            <h4 style="margin:0 0 8px; font-size:0.92rem; color:#9f1239;"><i class="fa-solid fa-ban"></i> Revoke / Cancel Membership</h4>
            <p style="font-size:0.8rem; color:#881337; margin:0 0 10px;">Reverts membership tier to Free and sets expiry to NOW. Historical payment records will be preserved.</p>
            <div style="margin-bottom:10px;">
              <input id="revokeReasonInput" class="co-admin-input" placeholder="Mandatory reason for revoking membership" />
            </div>
            <button class="btn danger btn-sm" id="btnExecuteRevokeMembership"><i class="fa-solid fa-trash"></i> Revoke Membership</button>
          </div>
        </div>

        <!-- Panel: Payments -->
        <div data-tab-panel="payments" style="${initialTab === 'payments' ? '' : 'display:none;'}">
          <div style="background:#fff; border:1px solid #e2e8f0; padding:14px; border-radius:8px;">
            <h4 style="margin:0 0 10px; font-size:0.95rem; color:#0f172a;"><i class="fa-solid fa-receipt"></i> Payment History</h4>
            ${payments.length ? `
              <div class="co-admin-table-wrap">
                <table class="co-admin-data-table">
                  <thead><tr><th>Txn ID</th><th>Method</th><th>Amount</th><th>Status</th><th>Submitted</th><th>Approved</th></tr></thead>
                  <tbody>
                    ${payments.map(p => `
                      <tr>
                        <td><code>${escapeHtml(p.transaction_id || `#${p.id}`)}</code></td>
                        <td>${escapeHtml(p.payment_method || 'UPI')}</td>
                        <td><strong>₹${Number(p.amount_inr || 0).toLocaleString('en-IN')}</strong></td>
                        <td>${asStatusBadge(p.status)}</td>
                        <td>${p.submitted_at ? new Date(p.submitted_at).toLocaleString('en-IN') : '-'}</td>
                        <td>${p.approved_at ? new Date(p.approved_at).toLocaleString('en-IN') : '-'}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            ` : '<p class="muted" style="margin:0; font-size:0.85rem;">No payment transactions recorded for this student.</p>'}
          </div>
        </div>

        <!-- Panel: Academic Activity -->
        <div data-tab-panel="academic" style="${initialTab === 'academic' ? '' : 'display:none;'}">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px;">
            <div style="background:#fff; padding:14px; border-radius:8px; border:1px solid #e2e8f0;">
              <h4 style="margin:0 0 8px; font-size:0.92rem; color:#0f172a;"><i class="fa-solid fa-clipboard-question"></i> Quiz Performance</h4>
              <div style="font-size:1.4rem; font-weight:700; color:#2563eb;">${academicActivity.quizzes?.attempts || 0} <span style="font-size:0.8rem; font-weight:400; color:#64748b;">Attempts</span></div>
              <div style="font-size:0.85rem; color:#475569; margin-top:4px;">Average Score: <strong>${academicActivity.quizzes?.avg_score || 0}%</strong></div>
            </div>
            <div style="background:#fff; padding:14px; border-radius:8px; border:1px solid #e2e8f0;">
              <h4 style="margin:0 0 8px; font-size:0.92rem; color:#0f172a;"><i class="fa-solid fa-flask-vial"></i> Mock Test Performance</h4>
              <div style="font-size:1.4rem; font-weight:700; color:#2563eb;">${academicActivity.mockTests?.attempts || 0} <span style="font-size:0.8rem; font-weight:400; color:#64748b;">Attempts</span></div>
              <div style="font-size:0.85rem; color:#475569; margin-top:4px;">Average Accuracy: <strong>${academicActivity.mockTests?.avg_accuracy || 0}%</strong></div>
            </div>
          </div>
        </div>

        <!-- Panel: Coding Activity -->
        <div data-tab-panel="coding" style="${initialTab === 'coding' ? '' : 'display:none;'}">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px;">
            <div style="background:#fff; padding:14px; border-radius:8px; border:1px solid #e2e8f0;">
              <h4 style="margin:0 0 8px; font-size:0.92rem; color:#0f172a;"><i class="fa-solid fa-code"></i> Total Code Submissions</h4>
              <div style="font-size:1.4rem; font-weight:700; color:#2563eb;">${codingActivity.total_submissions || 0}</div>
            </div>
            <div style="background:#fff; padding:14px; border-radius:8px; border:1px solid #e2e8f0;">
              <h4 style="margin:0 0 8px; font-size:0.92rem; color:#0f172a;"><i class="fa-solid fa-circle-check" style="color:#16a34a;"></i> Solved Problems</h4>
              <div style="font-size:1.4rem; font-weight:700; color:#16a34a;">${codingActivity.solved_problems || 0}</div>
            </div>
          </div>
        </div>

        <!-- Panel: Certificates -->
        <div data-tab-panel="certificates" style="${initialTab === 'certificates' ? '' : 'display:none;'}">
          <div style="background:#fff; border:1px solid #e2e8f0; padding:14px; border-radius:8px;">
            <h4 style="margin:0 0 10px; font-size:0.95rem; color:#0f172a;"><i class="fa-solid fa-certificate"></i> Issued Certificates</h4>
            ${certificates.length ? `
              <div class="co-admin-table-wrap">
                <table class="co-admin-data-table">
                  <thead><tr><th>Code</th><th>Title</th><th>Status</th><th>Issued At</th></tr></thead>
                  <tbody>
                    ${certificates.map(c => `
                      <tr>
                        <td><code>${escapeHtml(c.certificate_code || `#${c.id}`)}</code></td>
                        <td><strong>${escapeHtml(c.title)}</strong></td>
                        <td>${asStatusBadge(c.status || 'active')}</td>
                        <td>${c.issued_at ? new Date(c.issued_at).toLocaleDateString('en-IN') : '-'}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            ` : '<p class="muted" style="margin:0; font-size:0.85rem;">No certificates issued to this student yet.</p>'}
          </div>
        </div>

        <!-- Panel: Feature Access Preview -->
        <div data-tab-panel="features" style="${initialTab === 'features' ? '' : 'display:none;'}">
          <div style="background:#fff; border:1px solid #e2e8f0; padding:14px; border-radius:8px;">
            <h4 style="margin:0 0 8px; font-size:0.95rem; color:#0f172a;"><i class="fa-solid fa-toggle-on"></i> Effective Feature Access Matrix (Read-Only)</h4>
            <p style="font-size:0.8rem; color:#64748b; margin:0 0 12px;">This matrix is computed using Part 4's Central Feature Resolver and this student's membership entitlement.</p>
            <div class="co-admin-table-wrap">
              <table class="co-admin-data-table">
                <thead><tr><th>Feature Key</th><th>Visibility</th><th>Enabled</th><th>Access Mode</th><th>Effective State</th></tr></thead>
                <tbody>
                  ${Object.keys(effectiveFeatures).map(key => {
                    const feat = effectiveFeatures[key] || {};
                    return `
                      <tr>
                        <td><code>${escapeHtml(key)}</code></td>
                        <td>${feat.is_visible ? asStatusBadge('visible') : asStatusBadge('hidden')}</td>
                        <td>${feat.is_enabled ? asStatusBadge('enabled') : asStatusBadge('disabled')}</td>
                        <td><span class="co-admin-chip">${escapeHtml(feat.access_mode || 'all')}</span></td>
                        <td><strong>${feat.accessible ? '<span class="status-badge ok">Accessible</span>' : `<span class="status-badge warn">${escapeHtml(feat.reason || 'Restricted')}</span>`}</strong></td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Panel: Security & Account -->
        <div data-tab-panel="security" style="${initialTab === 'security' ? '' : 'display:none;'}">
          <!-- Password Reset Card -->
          <div style="background:#fff; border:1px solid #e2e8f0; padding:14px; border-radius:8px; margin-bottom:14px;">
            <h4 style="margin:0 0 8px; font-size:0.92rem; color:#0f172a;"><i class="fa-solid fa-key"></i> Administrative Password Reset</h4>
            <p style="font-size:0.8rem; color:#64748b; margin:0 0 10px;">Sets a new bcrypt-hashed password for the student and invalidates any active backend sessions immediately.</p>
            <div style="margin-bottom:10px;">
              <input id="secNewPasswordInput" type="password" class="co-admin-input" placeholder="New Password (min 6 characters)" />
            </div>
            <button class="btn primary btn-sm" id="btnExecuteResetPassword"><i class="fa-solid fa-lock"></i> Reset Password & Purge Active Sessions</button>
          </div>

          <!-- Account Status Change Card -->
          <div style="background:#fff; border:1px solid #e2e8f0; padding:14px; border-radius:8px;">
            <h4 style="margin:0 0 8px; font-size:0.92rem; color:#0f172a;"><i class="fa-solid fa-user-shield"></i> Account Status Enforcement</h4>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
              <div>
                <label style="font-size:0.8rem; font-weight:600;">Status</label>
                <select id="secStatusSelect" class="co-admin-select">
                  <option value="active" ${!student.is_suspended && !student.is_blocked ? 'selected' : ''}>Active</option>
                  <option value="suspended" ${student.is_suspended ? 'selected' : ''}>Suspended</option>
                  <option value="blocked" ${student.is_blocked ? 'selected' : ''}>Blocked</option>
                </select>
              </div>
              <div>
                <label style="font-size:0.8rem; font-weight:600;">Audit Reason *</label>
                <input id="secStatusReasonInput" class="co-admin-input" placeholder="Reason for status change" />
              </div>
            </div>
            <button class="btn secondary btn-sm" id="btnExecuteStatusChange"><i class="fa-solid fa-floppy-disk"></i> Update Status & Purge Sessions</button>
          </div>
        </div>

        <!-- Panel: Audit History -->
        <div data-tab-panel="audit" style="${initialTab === 'audit' ? '' : 'display:none;'}">
          <div style="background:#fff; border:1px solid #e2e8f0; padding:14px; border-radius:8px;">
            <h4 style="margin:0 0 10px; font-size:0.95rem; color:#0f172a;"><i class="fa-solid fa-history"></i> Audit Logs for Student #${id}</h4>
            ${auditHistory.length ? `
              <div class="co-admin-table-wrap">
                <table class="co-admin-data-table">
                  <thead><tr><th>Date</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead>
                  <tbody>
                    ${auditHistory.map(log => `
                      <tr>
                        <td>${new Date(log.created_at).toLocaleString('en-IN')}</td>
                        <td><span class="co-admin-chip">${escapeHtml(log.actor_role || 'admin')}</span></td>
                        <td><code>${escapeHtml(log.action)}</code></td>
                        <td>${formatAuditMetadata(log.metadata)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            ` : '<p class="muted" style="margin:0; font-size:0.85rem;">No audit logs recorded for this student.</p>'}
          </div>
        </div>
      </div>
    `;

    // Tab Switching Handlers
    const tabButtons = bodyNode.querySelectorAll('#studentDrawerTabNav button');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        bodyNode.querySelectorAll('#studentDrawerTabPanels > div').forEach(p => {
          p.style.display = p.dataset.tabPanel === target ? 'block' : 'none';
        });
      });
    });

    // Membership Grant Event
    bodyNode.querySelector('#btnExecuteGrantMembership')?.addEventListener('click', async () => {
      const tier = bodyNode.querySelector('#grantTierSelect').value;
      const durationDays = Number(bodyNode.querySelector('#grantDurationSelect').value || 30);
      const reason = bodyNode.querySelector('#grantReasonInput').value.trim();
      if (!reason) { alert('Admin reason is required for granting membership.'); return; }
      try {
        await window.CollegeOSApi.adminControlGrantMembership(id, { tier, durationDays, reason });
        alert('Membership granted successfully!');
        await openStudentDrawer(id, 'membership');
        await loadStudents(false, currentRouteToken, studentCurrentPage);
      } catch (e) { alert(e.message); }
    });

    // Membership Extend Event
    bodyNode.querySelector('#btnExecuteExtendMembership')?.addEventListener('click', async () => {
      const days = Number(bodyNode.querySelector('#extendDaysSelect').value || 30);
      const reason = bodyNode.querySelector('#extendReasonInput').value.trim();
      if (!reason) { alert('Reason is required for extending membership.'); return; }
      try {
        await window.CollegeOSApi.adminControlExtendMembership(id, { days, reason });
        alert('Membership extended successfully!');
        await openStudentDrawer(id, 'membership');
        await loadStudents(false, currentRouteToken, studentCurrentPage);
      } catch (e) { alert(e.message); }
    });

    // Membership Revoke Event
    bodyNode.querySelector('#btnExecuteRevokeMembership')?.addEventListener('click', async () => {
      const reason = bodyNode.querySelector('#revokeReasonInput').value.trim();
      if (!reason) { alert('Reason is required for revoking membership.'); return; }
      if (!confirm('Are you sure you want to revoke membership for this student?')) return;
      try {
        await window.CollegeOSApi.adminControlRevokeMembership(id, { reason });
        alert('Membership revoked successfully!');
        await openStudentDrawer(id, 'membership');
        await loadStudents(false, currentRouteToken, studentCurrentPage);
      } catch (e) { alert(e.message); }
    });

    // Password Reset Event
    bodyNode.querySelector('#btnExecuteResetPassword')?.addEventListener('click', async () => {
      const newPassword = bodyNode.querySelector('#secNewPasswordInput').value.trim();
      if (!newPassword || newPassword.length < 6) { alert('Password must be at least 6 characters.'); return; }
      try {
        await window.CollegeOSApi.adminControlResetStudentPassword(id, newPassword);
        alert('Password reset successfully and active sessions invalidated.');
        bodyNode.querySelector('#secNewPasswordInput').value = '';
      } catch (e) { alert(e.message); }
    });

    // Account Status Change Event
    bodyNode.querySelector('#btnExecuteStatusChange')?.addEventListener('click', async () => {
      const status = bodyNode.querySelector('#secStatusSelect').value;
      const reason = bodyNode.querySelector('#secStatusReasonInput').value.trim();
      if (!reason) { alert('Reason is required for status change.'); return; }
      try {
        await window.CollegeOSApi.adminControlStudentStatus(id, status, { reason });
        alert(`Account status updated to ${status}!`);
        await openStudentDrawer(id, 'security');
        await loadStudents(false, currentRouteToken, studentCurrentPage);
      } catch (e) { alert(e.message); }
    });

    if (window.CollegeAdminDrawer) {
      window.CollegeAdminDrawer.open('studentDetailDrawer');
    }
  } catch (err) {
    alert(err.message || 'Failed to load student details.');
  }
}

window.handleDrawerStudentStatusSubmit = async function(studentId) {
  const actionNode = cById('drawerStudentActionSelect');
  const reasonNode = cById('drawerStudentReasonText');
  const action = actionNode ? actionNode.value : '';
  const reason = reasonNode ? reasonNode.value.trim() : '';

  if (!reason) {
    alert('Please enter a mandatory administrative reason before executing state change.');
    return;
  }

  if (!confirm(`Are you sure you want to perform "${action}" for student #${studentId}?\nReason: ${reason}`)) {
    return;
  }

  try {
    if (action === 'activate' || action === 'suspend' || action === 'block') {
      await window.CollegeOSApi.adminControlStudentStatus(studentId, action, { reason });
    } else if (action === 'premium') {
      await window.CollegeOSApi.adminControlStudentMembership(studentId, { tier: 'premium', paymentStatus: 'approved', reason });
    } else if (action === 'free') {
      await window.CollegeOSApi.adminControlStudentMembership(studentId, { tier: 'free', paymentStatus: 'expired', reason });
    }
    alert('Administrative state change executed successfully.');
    if (window.CollegeAdminDrawer) {
      window.CollegeAdminDrawer.close('studentDetailDrawer');
    }
    await loadStudents();
  } catch (err) {
    alert(err.message || 'Failed to update student state.');
  }
};

async function runBulkStudents() {
  const action = cById('studentBulkAction').value;
  const studentIds = selectedStudentIds();
  if (!action || !studentIds.length) {
    window.alert('Select students and bulk action first.');
    return;
  }
  await window.CollegeOSApi.adminControlBulkStudents({ action, studentIds });
  await loadStudents();
}

async function loadPayments(token) {
  const status = cById('paymentStatusFilter')?.value || 'all';
  const paymentsResp = await window.CollegeOSApi.adminMembershipPayments(status);
  const summaryResp = await window.CollegeOSApi.adminControlRevenueSummary();
  if (token && token !== currentRouteToken) return;

  const setKpi = (id, val) => {
    const el = cById(id);
    if (el) el.textContent = val;
  };
  setKpi('kpiActiveMemberships', summaryResp.activeMemberships || 0);
  setKpi('kpiFreePlanStudents', summaryResp.freePlanStudents || summaryResp.freeStudents || 0);
  setKpi('kpiPremiumStudents', summaryResp.premiumStudents || summaryResp.activeMemberships || 0);
  setKpi('kpiExpiringStudents', summaryResp.expiringSoon || summaryResp.expiredMemberships || 0);
  setKpi('kpiPendingPayments', summaryResp.pendingApprovals || 0);
  setKpi('kpiTotalRevenue', `₹${Number(summaryResp.lifetimeRevenue || summaryResp.totalRevenue || 0).toLocaleString('en-IN')}`);

  const rows = paymentsResp.payments || [];
  const tbody = cById('paymentsTableBody');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="co-admin-table-empty">No payment verification records found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((payment) => `
    <tr>
      <td><input type="checkbox" class="payment-row-checkbox" value="${payment.id}" /></td>
      <td>
        <strong>${escapeHtml(payment.full_name || 'Student')}</strong>
        <div class="muted" style="font-size: 0.8rem;">${escapeHtml(payment.email || '-')}</div>
      </td>
      <td><span class="mono">${escapeHtml(payment.plan || payment.membership_plan || 'Premium')}</span></td>
      <td>
        <span class="mono">${escapeHtml(payment.transaction_id || payment.upi_ref || '-')}</span>
        ${payment.screenshot_url ? `<br/><a class="btn secondary sm" style="font-size:0.75rem; padding: 2px 6px; margin-top:2px;" href="${escapeHtml(payment.screenshot_url)}" target="_blank" rel="noreferrer"><i class="fa-solid fa-receipt"></i> Proof</a>` : ''}
      </td>
      <td><strong>₹${Number(payment.amount || payment.price || 500).toLocaleString('en-IN')}</strong></td>
      <td>${payment.submitted_at ? new Date(payment.submitted_at).toLocaleDateString('en-IN') : '-'}</td>
      <td>${asStatusBadge(payment.status)}</td>
      <td style="text-align:right;">
        <div class="control-actions" style="justify-content: flex-end;">
          <button class="btn primary sm" data-pay-action="approve" data-payment-id="${payment.id}"><i class="fa-solid fa-check"></i> Approve</button>
          <button class="btn warn sm" data-pay-action="reject" data-payment-id="${payment.id}"><i class="fa-solid fa-xmark"></i> Reject</button>
        </div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('button[data-pay-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const paymentId = Number(button.dataset.paymentId || 0);
        if (!paymentId) return;
        const action = button.dataset.payAction;
        const status = action === 'approve' ? 'approved' : 'rejected';
        const reason = status === 'rejected' ? (window.prompt('Optional rejection reason:', '') || '') : '';
        await window.CollegeOSApi.adminControlBulkPaymentsStatus({ paymentIds: [paymentId], status, reason });
        await loadPayments();
      } catch (error) {
        window.alert(error.message);
      }
    });
  });
}

async function runBulkPayments() {
  const paymentIds = parseIdList(cById('paymentIdsInput').value);
  const status = cById('paymentBulkStatus').value;
  if (!paymentIds.length || !status) {
    window.alert('Enter payment IDs and status first.');
    return;
  }

  await window.CollegeOSApi.adminControlBulkPaymentsStatus({ paymentIds, status, reason: cById('paymentReasonInput').value });
  await loadPayments();
}

async function loadContentOverview() {
  const overview = await window.CollegeOSApi.adminControlContentOverview();
  const node = cById('contentOverviewKpis');
  const entries = Object.entries(overview);
  node.innerHTML = entries.map(([key, value]) => `
    <div class="kpi-card">
      <div class="kpi-label">${key}</div>
      <div class="kpi-value">${value.total || 0}</div>
      <div class="muted">Published: ${value.published || 0}</div>
    </div>
  `).join('');
}

async function runContentBulkAction() {
  const type = cById('contentTypeSelect').value;
  const action = cById('contentBulkAction').value;
  const ids = parseIdList(cById('contentIdsInput').value);
  if (!ids.length) {
    window.alert('Enter content IDs first.');
    return;
  }
  await window.CollegeOSApi.adminControlBulkContentAction(type, { action, ids });
  await loadContentOverview();
}

async function loadBranches() {
  const tbody = cById('branchesTableBody');
  if (!tbody) return;
  const payload = await window.CollegeOSApi.adminControlBranches();
  const rows = payload.branches || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="co-admin-table-empty">No branches found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((branch) => `
    <tr>
      <td>${branch.id}</td>
      <td>${branch.category_name || '-'}</td>
      <td class="mono">${branch.code || '-'}</td>
      <td>${branch.name || '-'}</td>
      <td>${branch.students_count || 0}</td>
      <td>${branch.notes_count || 0}</td>
      <td>${branch.quizzes_count || 0}</td>
      <td>${branch.mock_tests_count || 0}</td>
      <td>${branch.roadmaps_count || 0}</td>
      <td>${branch.ai_tools_count || 0}</td>
    </tr>
  `).join('');
}

async function createBranch() {
  await window.CollegeOSApi.adminControlCreateBranch({
    categoryId: Number(cById('branchCategoryIdInput').value || 0),
    code: cById('branchCodeInput').value,
    name: cById('branchNameInput').value,
    label: cById('branchLabelInput').value,
    description: cById('branchDescriptionInput').value,
    displayOrder: Number(cById('branchDisplayOrderInput').value || 0)
  });
  await loadBranches();
}

async function updateBranch() {
  const branchId = Number(cById('branchIdInput').value || 0);
  if (!branchId) {
    window.alert('Enter branch ID to update.');
    return;
  }

  await window.CollegeOSApi.adminControlUpdateBranch(branchId, {
    categoryId: Number(cById('branchCategoryIdInput').value || 0) || null,
    code: cById('branchCodeInput').value || null,
    name: cById('branchNameInput').value || null,
    label: cById('branchLabelInput').value || null,
    description: cById('branchDescriptionInput').value || null,
    displayOrder: Number(cById('branchDisplayOrderInput').value || 0) || null
  });
  await loadBranches();
}

async function deleteBranch() {
  const branchId = Number(cById('branchIdInput').value || 0);
  if (!branchId) {
    window.alert('Enter branch ID to delete.');
    return;
  }
  if (!window.confirm(`Delete branch ID ${branchId}?`)) return;
  await window.CollegeOSApi.adminControlDeleteBranch(branchId);
  await loadBranches();
}

async function assignBranchContent() {
  await window.CollegeOSApi.adminControlAssignBranchContent({
    contentType: cById('assignContentType').value,
    contentId: Number(cById('assignContentId').value || 0),
    branchId: Number(cById('assignBranchId').value || 0),
    categoryId: Number(cById('assignCategoryId').value || 0) || null,
    semesterId: Number(cById('assignSemesterId').value || 0) || null
  });
  await loadBranches();
}

function collectUniversityPayload() {
  return {
    name: cById('uniNameInput').value.trim(),
    campus: cById('uniCampusInput').value.trim() || null,
    city: cById('uniCityInput').value.trim() || null,
    state: cById('uniStateInput').value.trim() || null,
    countryCode: (cById('uniCountryCodeInput').value.trim() || 'IN').toUpperCase(),
    isFeatured: cById('uniFeaturedSelect').value === 'true',
    isEnabled: cById('uniEnabledSelect').value === 'true',
    priorityRank: Number(cById('uniPriorityInput').value || 999)
  };
}

async function loadUniversities() {
  const tbody = cById('universitiesTableBody');
  if (!tbody) return;

  const payload = await window.CollegeOSApi.adminControlUniversities({
    q: cById('uniSearchInput').value.trim(),
    includeDisabled: true,
    limit: 500
  });

  const rows = payload.universities || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="co-admin-table-empty">No universities found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((uni) => `
    <tr>
      <td>${uni.id}</td>
      <td><strong>${uni.name}</strong>${uni.campus ? `<div class="muted">${uni.campus}</div>` : ''}</td>
      <td>${[uni.city, uni.state, uni.country_code].filter(Boolean).join(', ') || '-'}</td>
      <td>${asStatusBadge(uni.is_featured ? 'featured' : 'normal')}</td>
      <td>${asStatusBadge(uni.is_enabled ? 'enabled' : 'disabled')}</td>
      <td>${uni.priority_rank}</td>
      <td>${uni.users_count || 0}</td>
    </tr>
  `).join('');
}

async function createUniversity() {
  const payload = collectUniversityPayload();
  if (!payload.name) {
    window.alert('University name is required.');
    return;
  }
  await window.CollegeOSApi.adminControlCreateUniversity(payload);
  await loadUniversities();
}

async function updateUniversity() {
  const id = Number(cById('uniIdInput').value || 0);
  if (!id) {
    window.alert('Provide University ID to update.');
    return;
  }
  await window.CollegeOSApi.adminControlUpdateUniversity(id, collectUniversityPayload());
  await loadUniversities();
}

async function reorderUniversities() {
  const ids = parseIdList(cById('uniOrderedIdsInput').value);
  if (!ids.length) {
    window.alert('Enter ordered university IDs first.');
    return;
  }
  await window.CollegeOSApi.adminControlReorderUniversities(ids);
  await loadUniversities();
}

async function deleteUniversity() {
  const id = Number(cById('uniIdInput').value || 0);
  if (!id) {
    window.alert('Provide University ID to delete.');
    return;
  }
  if (!window.confirm(`Delete university ID ${id}?`)) return;
  await window.CollegeOSApi.adminControlDeleteUniversity(id);
  await loadUniversities();
}

async function loadOnboardingConfig() {
  const payload = await window.CollegeOSApi.adminControlOnboardingConfig();
  const wizard = payload.wizard || { enabled: true, version: 1, steps: [] };
  const options = payload.options || [];

  cById('onboardingEnabledSelect').value = String(Boolean(wizard.enabled));
  cById('onboardingVersionInput').value = Number(wizard.version || 1);
  cById('onboardingStepsInput').value = Array.isArray(wizard.steps) ? wizard.steps.join(',') : '';

  const tbody = cById('onboardingOptionTableBody');
  if (!options.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="co-admin-table-empty">No onboarding options configured.</td></tr>';
    return;
  }

  tbody.innerHTML = options.map((item) => `
    <tr>
      <td>${item.id}</td>
      <td>${item.option_group}</td>
      <td>${item.option_value}</td>
      <td>${item.option_label}</td>
      <td>${item.position_order || 0}</td>
      <td>${asStatusBadge(item.is_enabled ? 'active' : 'disabled')}</td>
    </tr>
  `).join('');
}

async function saveOnboardingConfig() {
  const enabled = cById('onboardingEnabledSelect').value === 'true';
  const version = Number(cById('onboardingVersionInput').value || 1);
  const steps = cById('onboardingStepsInput').value.split(',').map((x) => x.trim()).filter(Boolean);

  await window.CollegeOSApi.adminControlUpdateOnboardingConfig({
    wizard: { enabled, version, steps }
  });

  await loadOnboardingConfig();
}

async function createOnboardingOption() {
  await window.CollegeOSApi.adminControlCreateOnboardingOption({
    optionGroup: cById('onboardingOptionGroup').value,
    optionValue: cById('onboardingOptionValue').value,
    optionLabel: cById('onboardingOptionLabel').value,
    positionOrder: Number(cById('onboardingOptionOrder').value || 0),
    isEnabled: true
  });
  await loadOnboardingConfig();
}

async function loadRecommendationRules() {
  const payload = await window.CollegeOSApi.adminControlRecommendationRules();
  const rows = payload.rules || [];
  const tbody = cById('recommendationRuleTableBody');

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="co-admin-table-empty">No recommendation rules found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((row) => `
    <tr>
      <td>${row.id}</td>
      <td>${row.title || '-'}</td>
      <td>${row.content_type || '-'}</td>
      <td>${row.content_id || '-'}</td>
      <td>${row.branch_name || '-'}</td>
      <td>${row.membership_tier || 'all'}</td>
      <td>${asStatusBadge(row.is_featured ? 'featured' : 'normal')}</td>
    </tr>
  `).join('');
}

async function createRecommendationRule() {
  await window.CollegeOSApi.adminControlCreateRecommendationRule({
    contentType: cById('ruleContentType').value,
    contentId: Number(cById('ruleContentId').value || 0),
    title: cById('ruleTitle').value,
    branchId: Number(cById('ruleBranchId').value || 0) || null,
    membershipTier: cById('ruleMembershipTier').value || null,
    isFeatured: cById('ruleIsFeatured').value === 'true',
    positionOrder: Number(cById('rulePositionOrder').value || 0)
  });
  await loadRecommendationRules();
}

async function createMockTest() {
  await window.CollegeOSApi.adminControlCreateMockTest({
    title: cById('mockTitle').value,
    subject: cById('mockSubject').value,
    topic: cById('mockTopic').value,
    durationMinutes: Number(cById('mockDuration').value || 0),
    totalMarks: Number(cById('mockMarks').value || 0),
    categoryId: Number(cById('mockCategoryId').value || 0) || null,
    branchId: Number(cById('mockBranchId').value || 0) || null,
    semesterId: Number(cById('mockSemesterId').value || 0) || null,
    status: 'published'
  });
  await loadMockTests();
}

async function loadMockTests() {
  const data = await window.CollegeOSApi.adminControlMockTests();
  const rows = data.mockTests || [];
  const tbody = cById('mockTableBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="co-admin-table-empty">No mock tests found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((mock) => `
    <tr>
      <td>${mock.id}</td>
      <td>${mock.title}</td>
      <td>${mock.branch_name || '-'}</td>
      <td>${mock.duration_minutes} min</td>
      <td>${asStatusBadge(mock.status)}</td>
      <td>${mock.attempts || 0}</td>
    </tr>
  `).join('');
}

async function createRoadmap() {
  await window.CollegeOSApi.adminControlCreateRoadmap({
    title: cById('roadmapTitle').value,
    categoryId: Number(cById('roadmapCategoryId').value || 0) || null,
    branchId: Number(cById('roadmapBranchId').value || 0) || null,
    semesterId: Number(cById('roadmapSemesterId').value || 0) || null,
    sequenceNo: Number(cById('roadmapSequence').value || 0),
    isPublished: true,
    roadmapData: { nodes: [], edges: [] }
  });
  await loadRoadmaps();
}

async function loadRoadmaps() {
  const data = await window.CollegeOSApi.adminControlRoadmaps();
  const rows = data.roadmaps || [];
  const tbody = cById('roadmapTableBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="co-admin-table-empty">No roadmaps found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((roadmap) => `
    <tr>
      <td>${roadmap.id}</td>
      <td>${roadmap.title || 'Untitled'}</td>
      <td>${roadmap.branch_name || '-'}</td>
      <td>${asStatusBadge(roadmap.is_published ? 'published' : 'hidden')}</td>
      <td>${roadmap.progress || 0}%</td>
      <td>${(roadmap.milestones || []).length}</td>
    </tr>
  `).join('');
}

async function sendNotification(reminderOnly = false) {
  await window.CollegeOSApi.adminControlSendNotifications({
    title: cById('notifyTitle').value,
    message: cById('notifyMessage').value,
    categoryId: Number(cById('notifyCategoryId').value || 0) || null,
    branchId: Number(cById('notifyBranchId').value || 0) || null,
    semesterId: Number(cById('notifySemesterId').value || 0) || null,
    onlyPremium: cById('notifyOnlyPremium').value === 'true',
    membershipReminder: reminderOnly,
    isAnnouncement: false
  });
  window.alert(reminderOnly ? 'Membership reminders sent.' : 'Notifications sent.');
}

async function createAnnouncement() {
  await window.CollegeOSApi.adminControlCreateAnnouncement({
    title: cById('notifyTitle').value || 'Announcement',
    message: cById('notifyMessage').value,
    categoryId: Number(cById('notifyCategoryId').value || 0) || null,
    branchId: Number(cById('notifyBranchId').value || 0) || null,
    semesterId: Number(cById('notifySemesterId').value || 0) || null,
    status: 'published'
  });
  await loadAnnouncements();
}

async function loadAnnouncements() {
  const data = await window.CollegeOSApi.adminControlAnnouncements();
  const rows = data.announcements || [];
  const tbody = cById('announcementTableBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="co-admin-table-empty">No announcements found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((item) => `
    <tr>
      <td>${item.id}</td>
      <td>${item.title}</td>
      <td>${item.branch_name || '-'}</td>
      <td>${asStatusBadge(item.status)}</td>
      <td>${new Date(item.created_at).toLocaleDateString('en-IN')}</td>
      <td><button class="btn danger sm" data-ann-delete="${item.id}">Delete</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-ann-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      await window.CollegeOSApi.adminControlDeleteAnnouncement(Number(button.dataset.annDelete));
      await loadAnnouncements();
    });
  });
}

async function loadForumPosts() {
  const data = await window.CollegeOSApi.adminControlForumPosts();
  const rows = data.posts || [];
  const tbody = cById('forumTableBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="co-admin-table-empty">No forum posts found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((post) => `
    <tr>
      <td>${post.id}</td>
      <td>${post.title}</td>
      <td>${post.full_name}<div class="muted">${post.email}</div></td>
      <td>${post.replies || 0}</td>
      <td>
        <button class="btn warn sm" data-hide-post="${post.id}">Hide</button>
        <button class="btn danger sm" data-delete-post="${post.id}">Delete</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-hide-post]').forEach((button) => {
    button.addEventListener('click', async () => {
      await window.CollegeOSApi.adminControlHideForumPost(Number(button.dataset.hidePost), true);
      await loadForumPosts();
    });
  });

  tbody.querySelectorAll('[data-delete-post]').forEach((button) => {
    button.addEventListener('click', async () => {
      await window.CollegeOSApi.adminControlDeleteForumPost(Number(button.dataset.deletePost));
      await loadForumPosts();
    });
  });
}

async function loadFeedback() {
  const data = await window.CollegeOSApi.adminControlFeedback();
  const rows = data.feedback || [];
  const tbody = cById('feedbackTableBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="co-admin-table-empty">No feedback found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((item) => `
    <tr>
      <td>${item.id}</td>
      <td>${item.full_name}<div class="muted">${item.email}</div></td>
      <td>${item.rating}/5</td>
      <td>${asStatusBadge(item.status || 'open')}</td>
      <td>${item.message}</td>
      <td>
        <button class="btn primary sm" data-resolve-feedback="${item.id}">Resolve</button>
        <button class="btn secondary sm" data-reply-feedback="${item.id}">Reply</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-resolve-feedback]').forEach((button) => {
    button.addEventListener('click', async () => {
      await window.CollegeOSApi.adminControlResolveFeedback(Number(button.dataset.resolveFeedback));
      await loadFeedback();
    });
  });

  tbody.querySelectorAll('[data-reply-feedback]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = Number(button.dataset.replyFeedback);
      const reply = window.prompt('Enter reply for this feedback:');
      if (!reply) return;
      await window.CollegeOSApi.adminControlReplyFeedback(id, reply);
      await loadFeedback();
    });
  });
}

async function loadReferralHistory() {
  const data = await window.CollegeOSApi.adminControlReferrals();
  const rows = data.referrals || [];
  const tbody = cById('referralHistoryBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="co-admin-table-empty">No referral history found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((row) => `
    <tr>
      <td>${row.id}</td>
      <td>${row.referrer_name}<div class="muted">${row.referrer_email}</div></td>
      <td>${row.referred_name}<div class="muted">${row.referred_email}</div></td>
      <td>${asStatusBadge(row.status)} ${row.is_blocked ? asStatusBadge('blocked') : ''}</td>
      <td>${row.reward_points || 0}</td>
      <td><button class="btn warn sm" data-block-referral="${row.id}">Block</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-block-referral]').forEach((button) => {
    button.addEventListener('click', async () => {
      await window.CollegeOSApi.adminControlBlockReferral(Number(button.dataset.blockReferral));
      await loadReferralHistory();
    });
  });
}

async function loadTopReferrers() {
  const data = await window.CollegeOSApi.adminControlTopReferrers();
  const rows = data.topReferrers || [];
  const tbody = cById('topReferrerBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="co-admin-table-empty">No top referrers found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((row) => `
    <tr>
      <td>${row.full_name}</td>
      <td>${row.email}</td>
      <td>${row.total_referrals || 0}</td>
      <td>${row.reward_points || 0}</td>
    </tr>
  `).join('');
}

async function assignReferralReward() {
  const referralId = Number(cById('rewardReferralId').value || 0);
  const rewardPoints = Number(cById('rewardPoints').value || 0);
  const note = cById('rewardNote').value;
  if (!referralId || !rewardPoints) {
    window.alert('Provide referral ID and reward points.');
    return;
  }
  await window.CollegeOSApi.adminControlAssignReferralReward(referralId, rewardPoints, note);
  await loadReferralHistory();
}

async function loadRoles() {
  const data = await window.CollegeOSApi.adminControlRoles();
  const rows = data.admins || [];
  const tbody = cById('rolesTableBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="co-admin-table-empty">No admin users found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((admin) => `
    <tr>
      <td>${admin.id}</td>
      <td>${admin.full_name}</td>
      <td>${admin.email}</td>
      <td>${admin.admin_role || 'super_admin'}</td>
    </tr>
  `).join('');
}

async function assignRole() {
  const adminId = Number(cById('roleAdminId').value || 0);
  const adminRole = cById('roleNameSelect').value;
  if (!adminId) {
    window.alert('Provide admin user ID.');
    return;
  }
  await window.CollegeOSApi.adminControlAssignRole(adminId, adminRole);
  await loadRoles();
}

async function updateRolePermissions() {
  const role = cById('permissionRoleInput').value.trim();
  if (!role) {
    window.alert('Provide role name.');
    return;
  }

  let permissions = [];
  try {
    permissions = JSON.parse(cById('permissionListInput').value || '[]');
  } catch (_error) {
    window.alert('Invalid JSON for permissions.');
    return;
  }

  await window.CollegeOSApi.adminControlSetRolePermissions(role, permissions);
  await loadRoles();
}

async function loadSettings() {
  const data = await window.CollegeOSApi.adminControlSettings();
  const settings = data.settings || {};
  cById('settingAppName').value = settings.app_branding?.appName || 'College OS';
  cById('settingPrimaryColor').value = settings.app_branding?.primaryColor || '#2f6fed';
  cById('settingLiveDefaultProvider').value = settings.live_defaults?.defaultProvider || 'jitsi';
  cById('settingMonthlyPrice').value = settings.membership_pricing?.monthly || 49;
  cById('settingMaintenanceEnabled').value = settings.maintenance_mode?.enabled ? 'true' : 'false';
  cById('settingSystemNotice').value = settings.system_notice?.message || '';
  cById('settingFeatureToggles').value = JSON.stringify(settings.feature_toggles || {}, null, 2);
}

async function loadCodingSettings() {
  try {
    const res = await fetch('/api/admin/coding-challenges/settings', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load coding settings');
    const payload = await res.json();
    const settings = payload?.settings || {};
    if (cById('settingCodingModuleEnabled')) cById('settingCodingModuleEnabled').value = settings.module_enabled ? 'true' : 'false';
    if (cById('settingCodingLeaderboardEnabled')) cById('settingCodingLeaderboardEnabled').value = settings.leaderboard_enabled !== false ? 'true' : 'false';
    if (cById('settingCodingCertificatesEnabled')) cById('settingCodingCertificatesEnabled').value = settings.certificates_enabled !== false ? 'true' : 'false';
    if (cById('settingCodingStrictModeDefault')) cById('settingCodingStrictModeDefault').value = settings.strict_mode_default ? 'true' : 'false';
    if (cById('codingSettingsStatus')) {
      cById('codingSettingsStatus').textContent = `Status: ${settings.module_enabled ? 'ENABLED' : 'DISABLED'} (Updated: ${settings.updated_at ? new Date(settings.updated_at).toLocaleString() : 'N/A'})`;
    }
  } catch (error) {
    if (cById('codingSettingsStatus')) cById('codingSettingsStatus').textContent = `Error loading settings: ${error.message}`;
  }
}

async function saveCodingSettings() {
  try {
    const body = {
      module_enabled: cById('settingCodingModuleEnabled').value === 'true',
      leaderboard_enabled: cById('settingCodingLeaderboardEnabled').value === 'true',
      certificates_enabled: cById('settingCodingCertificatesEnabled').value === 'true',
      strict_mode_default: cById('settingCodingStrictModeDefault').value === 'true'
    };

    const res = await fetch('/api/admin/coding-challenges/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Failed to save settings');
    
    const settings = payload.settings || {};
    if (cById('codingSettingsStatus')) {
      cById('codingSettingsStatus').textContent = `Settings saved successfully! Status: ${settings.module_enabled ? 'ENABLED' : 'DISABLED'}`;
    }
    window.alert(`Coding Challenges settings updated: Module is now ${settings.module_enabled ? 'ENABLED' : 'DISABLED'}`);
  } catch (error) {
    window.alert(error.message);
  }
}

async function loadCodingDashboardPanel() {
  try {
    const res = await fetch('/api/admin/coding-challenges/stats', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load coding stats');
    const data = await res.json();
    const stats = data.stats || {};

    if (cById('panelCodingTotal')) cById('panelCodingTotal').textContent = stats.total_contests || 0;
    if (cById('panelCodingLive')) cById('panelCodingLive').textContent = stats.live_contests || 0;
    if (cById('panelCodingScheduled')) cById('panelCodingScheduled').textContent = stats.scheduled_contests || 0;
    if (cById('panelCodingDrafts')) cById('panelCodingDrafts').textContent = stats.draft_contests || 0;
    if (cById('panelCodingParticipants')) cById('panelCodingParticipants').textContent = stats.total_participants || 0;
    if (cById('panelCodingSubmissions')) cById('panelCodingSubmissions').textContent = stats.total_submissions || 0;

    const contestsRes = await fetch('/api/admin/coding-challenges/contests', { credentials: 'include' });
    if (contestsRes.ok) {
      const cData = await contestsRes.json();
      const contests = cData.contests || [];
      const summaryNode = cById('panelCodingContestsSummary');
      if (summaryNode) {
        if (contests.length === 0) {
          summaryNode.innerHTML = '<p style="color:#64748b; margin:0;">No contests created yet. Click "Open Full Coding Portal" to create one.</p>';
        } else {
          summaryNode.innerHTML = `
            <table class="data-table" style="font-size:13px; width:100%;">
              <thead>
                <tr>
                  <th>Contest Title</th>
                  <th>Status</th>
                  <th>Schedule</th>
                  <th>Problems</th>
                </tr>
              </thead>
              <tbody>
                ${contests.slice(0, 5).map(c => `
                  <tr>
                    <td><strong>${escapeHtml(c.title)}</strong></td>
                    <td><span class="badge-status ${c.computed_status}">${c.computed_status}</span></td>
                    <td>${new Date(c.start_time).toLocaleString()}</td>
                    <td>${c.problem_count || 0}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `;
        }
      }
    }
  } catch (err) {
    console.error('Error loading coding dashboard panel:', err);
  }
}

async function loadContributionVisibilitySettings() {
  const payload = await window.CollegeOSApi.adminGetContributionConfig();
  const cfg = payload?.config || {};
  const visibility = cfg.visibility || {};
  cById('settingContributionEnabled').value = cfg.enabled !== false ? 'true' : 'false';
  cById('settingContributionHubVisible').value = visibility.showHubEntryPoint !== false ? 'true' : 'false';
  cById('contributionVisibilityStatus').textContent = '';
}

async function saveSettings() {
  let toggles = {};
  try {
    toggles = JSON.parse(cById('settingFeatureToggles').value || '{}');
  } catch (_error) {
    window.alert('Invalid feature toggles JSON.');
    return;
  }

  await window.CollegeOSApi.adminControlUpdateSettings({
    app_branding: {
      appName: cById('settingAppName').value,
      primaryColor: cById('settingPrimaryColor').value
    },
    membership_pricing: {
      monthly: Number(cById('settingMonthlyPrice').value || 49),
      currency: 'INR'
    },
    maintenance_mode: {
      enabled: cById('settingMaintenanceEnabled').value === 'true',
      message: cById('settingSystemNotice').value
    },
    system_notice: {
      message: cById('settingSystemNotice').value
    },
    live_defaults: {
      defaultProvider: getLiveDefaultProvider()
    },
    feature_toggles: toggles
  });

  window.alert('System settings updated.');
}

async function saveContributionVisibilitySettings() {
  const enabled = cById('settingContributionEnabled').value === 'true';
  const showHubEntryPoint = cById('settingContributionHubVisible').value === 'true';

  await window.CollegeOSApi.adminUpdateContributionConfig({
    enabled,
    visibility: {
      showHubEntryPoint
    }
  });

  cById('contributionVisibilityStatus').textContent = 'Contribution visibility updated. Student surfaces will reflect this immediately.';
}

async function loadMembershipConfig() {
  const payload = await window.CollegeOSApi.adminControlMembershipConfig();
  const config = payload?.config || {};

  cById('memHeroTitle').value = config.hero?.title || '';
  cById('memHeroSubtitle').value = config.hero?.subtitle || '';
  cById('memHeroHighlights').value = Array.isArray(config.hero?.highlights) ? config.hero.highlights.join('\n') : '';

  cById('memPlanFreeName').value = config.plans?.free?.name || 'Free Plan';
  cById('memPlanPremiumName').value = config.plans?.premium?.name || 'Premium Plan';
  cById('memPlanPremiumPrice').value = Number(config.plans?.premium?.priceInr || 49);
  cById('memPlanDurationDays').value = Number(config.plans?.premium?.durationDays || 30);
  cById('memPlanFreeDesc').value = config.plans?.free?.description || '';
  cById('memPlanPremiumDesc').value = config.plans?.premium?.description || '';

  cById('memUpiId').value = config.payment?.upiId || '';
  cById('memQrUrl').value = config.payment?.qrCodeImageUrl || '';
  cById('memPaymentInstructions').value = Array.isArray(config.payment?.instructions) ? config.payment.instructions.join('\n') : '';

  cById('memNotesAccessFree').value = config.featureAccess?.notesAccess?.free || 'Limited';
  cById('memNotesAccessPremium').value = config.featureAccess?.notesAccess?.premium || 'Unlimited';
  cById('memMockTestsFree').value = config.featureAccess?.mockTests?.free || '2 attempts';
  cById('memMockTestsPremium').value = config.featureAccess?.mockTests?.premium || 'Unlimited';
  cById('memRoadmapDepthFree').value = config.featureAccess?.roadmapDepth?.free || 'Basic';
  cById('memRoadmapDepthPremium').value = config.featureAccess?.roadmapDepth?.premium || 'Advanced';
  cById('memAiToolsPremiumEnabled').value = config.featureAccess?.aiTools?.premium === false ? 'false' : 'true';
  cById('memCertificatesPremiumEnabled').value = config.featureAccess?.certificates?.premium === false ? 'false' : 'true';
  cById('memDownloadsPremiumEnabled').value = config.featureAccess?.downloads?.premium === false ? 'false' : 'true';
}

async function saveMembershipConfig() {
  const payload = {
    hero: {
      title: cById('memHeroTitle').value,
      subtitle: cById('memHeroSubtitle').value,
      highlights: cById('memHeroHighlights').value.split('\n').map((line) => line.trim()).filter(Boolean)
    },
    plans: {
      free: {
        name: cById('memPlanFreeName').value,
        description: cById('memPlanFreeDesc').value
      },
      premium: {
        name: cById('memPlanPremiumName').value,
        description: cById('memPlanPremiumDesc').value,
        priceInr: Number(cById('memPlanPremiumPrice').value || 49),
        durationDays: Number(cById('memPlanDurationDays').value || 30)
      }
    },
    payment: {
      upiId: cById('memUpiId').value,
      qrCodeImageUrl: cById('memQrUrl').value,
      instructions: cById('memPaymentInstructions').value.split('\n').map((line) => line.trim()).filter(Boolean)
    },
    featureAccess: {
      notesAccess: {
        free: cById('memNotesAccessFree').value,
        premium: cById('memNotesAccessPremium').value
      },
      mockTests: {
        free: cById('memMockTestsFree').value,
        premium: cById('memMockTestsPremium').value
      },
      roadmapDepth: {
        free: cById('memRoadmapDepthFree').value,
        premium: cById('memRoadmapDepthPremium').value
      },
      aiTools: {
        free: false,
        premium: cById('memAiToolsPremiumEnabled').value === 'true'
      },
      certificates: {
        free: false,
        premium: cById('memCertificatesPremiumEnabled').value === 'true'
      },
      downloads: {
        free: false,
        premium: cById('memDownloadsPremiumEnabled').value === 'true'
      }
    }
  };

  await window.CollegeOSApi.adminControlUpdateMembershipConfig(payload);
  window.alert('Membership studio saved. Pricing updates instantly for students.');
}

function renderToggleGrid(hostId, options, selectedValues = {}) {
  const host = cById(hostId);
  if (!host) return;
  host.innerHTML = options.map((item) => `
    <label class="toggle-item">
      <input type="checkbox" data-toggle-key="${item.key}" ${selectedValues[item.key] !== false ? 'checked' : ''} />
      <span>${item.label}</span>
    </label>
  `).join('');
}

function buildOrderList(items) {
  const host = cById('expDashboardOrderList');
  if (!host) return;
  host.innerHTML = items.map((item) => `
    <li class="drag-item" draggable="true" data-section-key="${item.key}">
      <span>${item.label}</span>
      <i class="fa-solid fa-grip-vertical"></i>
    </li>
  `).join('');

  let dragging = null;
  host.querySelectorAll('.drag-item').forEach((node) => {
    node.addEventListener('dragstart', () => {
      dragging = node;
      node.classList.add('dragging');
    });
    node.addEventListener('dragend', () => {
      node.classList.remove('dragging');
      dragging = null;
    });
    node.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (!dragging || dragging === node) return;
      const rect = node.getBoundingClientRect();
      const after = (event.clientY - rect.top) > (rect.height / 2);
      if (after) {
        node.parentElement.insertBefore(dragging, node.nextSibling);
      } else {
        node.parentElement.insertBefore(dragging, node);
      }
    });
  });
}

function readToggleGrid(hostId) {
  const host = cById(hostId);
  if (!host) return {};
  const out = {};
  host.querySelectorAll('input[data-toggle-key]').forEach((input) => {
    out[input.dataset.toggleKey] = Boolean(input.checked);
  });
  return out;
}

function readDashboardOrder() {
  return Array.from(cById('expDashboardOrderList')?.querySelectorAll('.drag-item') || [])
    .map((node) => node.dataset.sectionKey)
    .filter(Boolean);
}

async function loadExperienceConfig() {
  const payload = await window.CollegeOSApi.adminControlExperienceConfig();
  const config = payload?.config || {};

  cById('expHomeHeroTitle').value = config.home?.hero?.title || '';
  cById('expHomeHeroDescription').value = config.home?.hero?.description || '';
  cById('expHomeCtaPrimaryLabel').value = config.home?.hero?.ctaPrimary?.label || '';
  cById('expHomeCtaPrimaryHref').value = config.home?.hero?.ctaPrimary?.href || '';
  cById('expHomeCtaSecondaryLabel').value = config.home?.hero?.ctaSecondary?.label || '';
  cById('expHomeCtaSecondaryHref').value = config.home?.hero?.ctaSecondary?.href || '';
  cById('expHomeBannerGraphicUrl').value = config.home?.hero?.bannerGraphicUrl || '';

  cById('expAuthBrandKicker').value = config.auth?.branding?.kicker || 'College OS Student Access';
  cById('expAuthBrandHeadline').value = config.auth?.branding?.headline || 'A clean, secure student workspace for focused outcomes.';
  cById('expAuthBrandDescription').value = config.auth?.branding?.description || 'Sign in to continue your learning flow with profile-based recommendations, progress tracking, and verified access controls.';
  cById('expAuthFeatures').value = Array.isArray(config.auth?.branding?.features) ? config.auth.branding.features.join('\n') : '';
  cById('expAuthTrustPoints').value = Array.isArray(config.auth?.branding?.trustPoints) ? config.auth.branding.trustPoints.join('\n') : '';
  cById('expAuthStatValue').value = config.auth?.branding?.stats?.value || 'Active';
  cById('expAuthStatLabel').value = config.auth?.branding?.stats?.label || 'Learners Community';

  cById('expAuthLoginTitle').value = config.auth?.text?.loginTitle || 'Welcome back';
  cById('expAuthLoginDescription').value = config.auth?.text?.loginDescription || 'Sign in to continue with your personalized learning workspace.';
  cById('expAuthSignupTitle').value = config.auth?.text?.signupTitle || 'Create your account';
  cById('expAuthSignupDescription').value = config.auth?.text?.signupDescription || 'Set up your profile in a few steps to unlock a branch-aware dashboard.';
  cById('expAuthBrandName').value = config.auth?.text?.brandName || 'College OS';
  cById('expAuthBrandSubtext').value = config.auth?.text?.brandSubtext || 'Student Workspace';
  cById('expAuthSupportLinkLabel').value = config.auth?.text?.supportLinkLabel || 'Need help? Contact support';
  cById('expAuthFooterConsentText').value = config.auth?.text?.footerConsentText || 'By continuing, you agree to';

  cById('expAuthSupportEmail').value = config.auth?.support?.email || 'support@collegeo.in';
  cById('expAuthSupportWhatsapp').value = config.auth?.support?.whatsapp || '';
  cById('expAuthSupportHelpText').value = config.auth?.support?.helpText || 'Share your issue and our team will help you quickly.';
  cById('expAuthTermsTitle').value = config.auth?.legal?.termsTitle || 'Terms and Conditions';
  cById('expAuthTermsText').value = config.auth?.legal?.termsText || 'By creating an account, you agree to use College OS responsibly, provide accurate profile information, and follow platform policies for fair usage.';
  cById('expAuthPrivacyTitle').value = config.auth?.legal?.privacyTitle || 'Privacy Policy';
  cById('expAuthPrivacyText').value = config.auth?.legal?.privacyText || 'College OS uses your academic and usage data to personalize recommendations and improve learning outcomes. Your data is handled securely and is never sold to third parties.';
  cById('expAuthLegalUpdatedAt').value = config.auth?.legal?.updatedAt || 'March 2026';

  renderToggleGrid('expAuthModuleGrid', AUTH_MODULE_KEYS, config.auth?.modules || {});
  renderToggleGrid('expAuthSignupFieldGrid', AUTH_SIGNUP_FIELD_KEYS, config.auth?.signup?.fieldVisibility || {});

  renderToggleGrid('expDashboardVisibilityGrid', DASHBOARD_VISIBILITY_KEYS, config.dashboard?.sectionVisibility || {});
  renderToggleGrid('expFeatureFlagsGrid', FEATURE_FLAG_KEYS, config.featureFlags || {});

  const order = Array.isArray(config.dashboard?.sectionOrder) ? config.dashboard.sectionOrder : DASHBOARD_SECTION_ORDER_OPTIONS.map((item) => item.key);
  const orderedItems = [
    ...order.map((key) => DASHBOARD_SECTION_ORDER_OPTIONS.find((item) => item.key === key)).filter(Boolean),
    ...DASHBOARD_SECTION_ORDER_OPTIONS.filter((item) => !order.includes(item.key))
  ];
  buildOrderList(orderedItems);

  cById('expXpMultiplier').value = config.gamification?.xpMultiplier ?? 1;
  cById('expStreakMinActions').value = config.gamification?.streakMinActionsPerDay ?? 1;
  cById('expBadgeStreak7').value = config.gamification?.badgeThresholds?.streak7 ?? 7;
  cById('expBadgeStreak14').value = config.gamification?.badgeThresholds?.streak14 ?? 14;
  cById('expBadgeStreak30').value = config.gamification?.badgeThresholds?.streak30 ?? 30;
  cById('expBadgeXp500').value = config.gamification?.badgeThresholds?.xp500 ?? 500;
  cById('expBadgeXp1000').value = config.gamification?.badgeThresholds?.xp1000 ?? 1000;
}

async function saveExperienceConfig() {
  const payload = {
    home: {
      hero: {
        title: cById('expHomeHeroTitle').value,
        description: cById('expHomeHeroDescription').value,
        ctaPrimary: {
          label: cById('expHomeCtaPrimaryLabel').value,
          href: cById('expHomeCtaPrimaryHref').value
        },
        ctaSecondary: {
          label: cById('expHomeCtaSecondaryLabel').value,
          href: cById('expHomeCtaSecondaryHref').value
        },
        bannerGraphicUrl: cById('expHomeBannerGraphicUrl').value
      }
    },
    auth: {
      modules: readToggleGrid('expAuthModuleGrid'),
      branding: {
        kicker: cById('expAuthBrandKicker').value,
        headline: cById('expAuthBrandHeadline').value,
        description: cById('expAuthBrandDescription').value,
        features: parseLines(cById('expAuthFeatures').value, [
          'Secure sign-in with session protection',
          'Branch-aware learning paths',
          'Progress and mock analytics',
          'Certificates and achievement tracking'
        ]),
        trustPoints: parseLines(cById('expAuthTrustPoints').value, [
          'Trusted by colleges and independent learners',
          'OTP-ready account verification',
          'Privacy-first data handling'
        ]),
        stats: {
          value: cById('expAuthStatValue').value || '10k+',
          label: cById('expAuthStatLabel').value || 'active learners'
        }
      },
      text: {
        brandName: cById('expAuthBrandName').value,
        brandSubtext: cById('expAuthBrandSubtext').value,
        loginTitle: cById('expAuthLoginTitle').value,
        loginDescription: cById('expAuthLoginDescription').value,
        signupTitle: cById('expAuthSignupTitle').value,
        signupDescription: cById('expAuthSignupDescription').value,
        supportLinkLabel: cById('expAuthSupportLinkLabel').value,
        footerConsentText: cById('expAuthFooterConsentText').value
      },
      signup: {
        fieldVisibility: readToggleGrid('expAuthSignupFieldGrid')
      },
      support: {
        email: cById('expAuthSupportEmail').value,
        whatsapp: cById('expAuthSupportWhatsapp').value,
        helpText: cById('expAuthSupportHelpText').value
      },
      legal: {
        termsTitle: cById('expAuthTermsTitle').value,
        termsText: cById('expAuthTermsText').value,
        privacyTitle: cById('expAuthPrivacyTitle').value,
        privacyText: cById('expAuthPrivacyText').value,
        updatedAt: cById('expAuthLegalUpdatedAt').value
      }
    },
    dashboard: {
      sectionVisibility: readToggleGrid('expDashboardVisibilityGrid'),
      sectionOrder: readDashboardOrder()
    },
    featureFlags: readToggleGrid('expFeatureFlagsGrid'),
    gamification: {
      xpMultiplier: Number(cById('expXpMultiplier').value || 1),
      streakMinActionsPerDay: Number(cById('expStreakMinActions').value || 1),
      badgeThresholds: {
        streak7: Number(cById('expBadgeStreak7').value || 7),
        streak14: Number(cById('expBadgeStreak14').value || 14),
        streak30: Number(cById('expBadgeStreak30').value || 30),
        xp500: Number(cById('expBadgeXp500').value || 500),
        xp1000: Number(cById('expBadgeXp1000').value || 1000)
      }
    }
  };

  await window.CollegeOSApi.adminControlUpdateExperienceConfig(payload);
  window.alert('Experience studio saved. Home, auth, onboarding, and dashboard modules will reflect updates instantly.');
}

async function loadLiveSessionControl() {
  const [payload, visibility, liveSessions] = await Promise.all([
    window.CollegeOSApi.adminControlExperienceConfig(),
    window.CollegeOSApi.adminControlLiveHubVisibility(),
    window.CollegeOSApi.liveSessionsUpcoming({ scope: 'admin', includeEnded: true })
  ]);
  const config = payload?.config || {};
  const liveHub = config.liveHub || {};
  const configSessions = Array.isArray(liveHub.sessions) ? liveHub.sessions : [];
  const configSessionById = new Map(configSessions.map((session) => [String(session.id || session.sessionId || '').trim(), session]));

  cById('liveHubEnabled').value = String(liveHub.enabled !== false);
  cById('liveHubTitle').value = liveHub.title || 'Unified Live Hub';
  cById('liveHubSubtitle').value = liveHub.subtitle || 'Mentorship sessions and hands-on labs in one place.';
  cById('liveHubSidebarLabel').value = liveHub.sidebarLabel || 'Live Hub';
  cById('liveHubMentorshipDays').value = liveHub.mentorshipCycleDays ?? 15;
  cById('liveHubLabDays').value = liveHub.labCycleDays ?? 7;
  setLiveHubVisibilityStatus(liveHub.enabled !== false, visibility?.enabled === false || visibility?.enabled === true
    ? visibility.statusLabel
    : undefined);
  const sessions = (liveSessions.sessions || []).map((session) => {
    const configSession = configSessionById.get(String(session.sessionId || session.id || '').trim()) || {};
    return mapLiveSessionApiToCard({
      ...session,
      mentorAccessId: configSession.mentorAccessId || session.hostCode || session.hostCodePreview || session.hostCodePlain || '',
      assignedHostUserRef: configSession.assignedHostUserRef || session.assignedHostUserRef || session.assignedHostEmail || session.mentorProfileKey || '',
      assignedHostEmail: configSession.assignedHostEmail || session.assignedHostEmail || session.mentorEmail || '',
      mentorProfileKey: configSession.mentorProfileKey || session.mentorProfileKey || session.assignedHostUserId || session.assignedHostEmail || '',
      codeGenerated: Boolean(configSession.mentorAccessId || session.hostCode || session.hostCodePreview || session.hostCodePlain),
      lastGeneratedAt: session.lastGeneratedAt || configSession.lastGeneratedAt || null
    });
  });
  renderLiveSessionMonitor(sessions);
  renderLiveHubSessions(sessions);
}

async function saveLiveSessionControl() {
  const liveHubSessions = readLiveHubSessions();
  const liveHubErrors = validateLiveHubSessions(liveHubSessions);
  if (liveHubErrors.length) {
    window.alert(`Live Session Control issue:\n- ${liveHubErrors.join('\n- ')}`);
    return;
  }

  await window.CollegeOSApi.adminControlUpdateExperienceConfig({
    liveHub: {
      enabled: cById('liveHubEnabled').value === 'true',
      title: cById('liveHubTitle').value || 'Unified Live Hub',
      subtitle: cById('liveHubSubtitle').value || 'Mentorship sessions and hands-on labs in one place.',
      sidebarLabel: cById('liveHubSidebarLabel').value || 'Live Hub',
      mentorshipCycleDays: Number(cById('liveHubMentorshipDays').value || 15),
      labCycleDays: Number(cById('liveHubLabDays').value || 7),
      defaultProvider: getLiveDefaultProvider(),
      sessions: liveHubSessions
    }
  });

  await window.CollegeOSApi.adminControlUpdateLiveHubVisibility({
    enabled: cById('liveHubEnabled').value === 'true'
  });

  await window.CollegeOSApi.adminLiveSessionsSync({
    sessions: liveHubSessions.map((session) => ({
      sessionId: session.id,
      title: session.title,
      description: session.summary,
      mentorName: session.mentorName,
      assignedHostUserRef: session.assignedHostUserRef || session.mentorProfileKey,
      assignedHostEmail: session.assignedHostUserRef || session.assignedHostEmail || session.mentorProfileKey,
      sessionType: session.type,
      provider: session.provider,
      roomName: session.roomId,
      channelName: session.roomId,
      scheduledStart: session.startAt,
      scheduledEnd: session.endAt,
      status: session.status,
      maxParticipants: session.maxParticipants || 100,
      hostCode: session.mentorAccessId || undefined
    }))
  });

  setLiveHubVisibilityStatus(cById('liveHubEnabled').value === 'true');
  window.alert(cById('liveHubEnabled').value === 'true'
    ? 'Live Hub is enabled for students.'
    : 'Live Hub is now hidden behind the Work in Progress screen.');

  window.alert('Live operations saved successfully.');
  await loadLiveSessionControl();
}

const auditLogCache = new Map();

function sanitizeSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const copy = Array.isArray(obj) ? [...obj] : { ...obj };
  for (const k of Object.keys(copy)) {
    if (/password|secret|token|key|auth|cookie|credential/i.test(k)) {
      copy[k] = '[REDACTED_SECRET]';
    } else if (typeof copy[k] === 'object' && copy[k] !== null) {
      copy[k] = sanitizeSecrets(copy[k]);
    }
  }
  return copy;
}

function openAuditDrawer(logId) {
  const log = auditLogCache.get(Number(logId));
  if (!log) {
    alert('Log details not found in cache.');
    return;
  }

  const actionNode = cById('drawerAuditAction');
  const actorNode = cById('drawerAuditActor');
  if (actionNode) actionNode.textContent = `Action: ${log.action}`;
  if (actorNode) actorNode.textContent = `Actor: ${log.actor_name || 'System'} (${log.actor_role || 'admin'}) • ${new Date(log.created_at).toLocaleString('en-IN')}`;

  const sanitizedMeta = sanitizeSecrets(log.metadata || {});
  const beforeState = sanitizeSecrets(log.metadata?.before || log.metadata?.previous || null);
  const afterState = sanitizeSecrets(log.metadata?.after || log.metadata?.current || log.metadata?.updated || null);

  const bodyNode = cById('drawerAuditContent');
  if (!bodyNode) return;

  bodyNode.innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px; font-size:0.88rem;">
      <div style="background:#f8fafc; padding:12px; border-radius:8px; border:1px solid #e2e8f0;">
        <strong style="display:block; color:#0f172a; margin-bottom:4px;">Operation Metadata</strong>
        <div><strong>Module / Target:</strong> ${log.target_type || '-'}:${log.target_id || '-'}</div>
        <div><strong>Timestamp:</strong> ${new Date(log.created_at).toLocaleString('en-IN')}</div>
        <div><strong>IP / Session:</strong> ${log.ip_address || 'Internal/Secure'}</div>
      </div>
      <div style="background:#f8fafc; padding:12px; border-radius:8px; border:1px solid #e2e8f0;">
        <strong style="display:block; color:#0f172a; margin-bottom:4px;">Actor Context</strong>
        <div><strong>Actor Name:</strong> ${escapeHtml(log.actor_name || 'System')}</div>
        <div><strong>Role:</strong> ${escapeHtml(log.actor_role || 'Admin')}</div>
        <div><strong>Result:</strong> <span class="badge badge-success">Success</span></div>
      </div>
    </div>

    ${(beforeState || afterState) ? `
      <h4 style="margin:14px 0 8px; font-size:0.95rem; color:#0f172a;"><i class="fa-solid fa-code-compare"></i> Safe State Comparison (Before vs After)</h4>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
        <div style="background:#fff1f2; border:1px solid #fecdd3; padding:12px; border-radius:8px;">
          <strong style="color:#9f1239; font-size:0.85rem; display:block; margin-bottom:6px;">Previous State (Before)</strong>
          <pre style="margin:0; font-size:0.78rem; overflow:auto; max-height:220px; color:#881337;">${JSON.stringify(beforeState || {}, null, 2)}</pre>
        </div>
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:12px; border-radius:8px;">
          <strong style="color:#166534; font-size:0.85rem; display:block; margin-bottom:6px;">Current State (After)</strong>
          <pre style="margin:0; font-size:0.78rem; overflow:auto; max-height:220px; color:#14532d;">${JSON.stringify(afterState || {}, null, 2)}</pre>
        </div>
      </div>
    ` : ''}

    <h4 style="margin:14px 0 8px; font-size:0.95rem; color:#0f172a;"><i class="fa-solid fa-file-code"></i> Complete Metadata Payload (Sanitized)</h4>
    <pre style="background:#1e293b; color:#f8fafc; padding:14px; border-radius:8px; font-size:0.82rem; overflow:auto; max-height:280px;">${JSON.stringify(sanitizedMeta, null, 2)}</pre>
  `;

  if (window.CollegeAdminDrawer) {
    window.CollegeAdminDrawer.open('auditDetailDrawer');
  }
}

function formatAuditMetadata(meta) {
  if (!meta || typeof meta !== 'object' || Object.keys(meta).length === 0) {
    return '<span class="muted">-</span>';
  }
  const keys = Object.keys(meta);
  const summaryParts = keys.slice(0, 2).map((k) => `${k}: ${typeof meta[k] === 'object' ? JSON.stringify(meta[k]) : meta[k]}`);
  const summaryText = summaryParts.join(' | ') + (keys.length > 2 ? ` (+${keys.length - 2} more)` : '');
  const jsonStr = JSON.stringify(sanitizeSecrets(meta), null, 2);

  return `
    <details class="co-admin-audit-meta">
      <summary style="cursor:pointer;font-size:12px;color:var(--primary-color,#2563eb);">${summaryText}</summary>
      <pre style="margin:4px 0 0;padding:6px;background:var(--surface-1,#f8fafc);border-radius:6px;font-size:11px;max-height:160px;overflow:auto;">${jsonStr}</pre>
    </details>
  `;
}

async function loadAuditLogs() {
  const limit = Number(cById('auditLimitInput')?.value || 100);
  const data = await window.CollegeOSApi.adminControlAuditLogs(limit);
  const rows = data.logs || [];
  const tbody = cById('auditTableBody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="co-admin-table-empty">No audit logs found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((log, index) => {
    const id = log.id || (index + 1);
    auditLogCache.set(Number(id), log);
    return `
    <tr>
      <td>${new Date(log.created_at).toLocaleString('en-IN')}</td>
      <td><strong>${escapeHtml(log.actor_name || '-')}</strong></td>
      <td><span class="co-admin-chip">${escapeHtml(log.actor_role || '-')}</span></td>
      <td><code>${escapeHtml(log.action)}</code></td>
      <td>${escapeHtml(log.target_type || '-')}:${escapeHtml(log.target_id || '-')}</td>
      <td>
        <button class="btn secondary btn-sm" onclick="openAuditDrawer(${id})"><i class="fa-solid fa-eye"></i> View Diff</button>
      </td>
    </tr>
  `;
  }).join('');
}

function bindEvents() {
  cById('refreshAnalyticsBtn')?.addEventListener('click', () => loadAnalytics().catch((e) => window.alert(e.message)));

  const reloadStudents = () => loadStudents(false, currentRouteToken, 1).catch((e) => window.alert(e.message));

  cById('loadStudentsBtn')?.addEventListener('click', reloadStudents);
  cById('showDeletedStudentsBtn')?.addEventListener('click', () => loadStudents(true, currentRouteToken, 1).catch((e) => window.alert(e.message)));
  cById('studentSearchInput')?.addEventListener('input', () => {
    if (studentSearchDebounceTimer) clearTimeout(studentSearchDebounceTimer);
    studentSearchDebounceTimer = setTimeout(reloadStudents, 300);
  });
  cById('studentStatusFilter')?.addEventListener('change', reloadStudents);
  cById('studentMembershipFilter')?.addEventListener('change', reloadStudents);
  cById('studentCollegeFilter')?.addEventListener('change', reloadStudents);
  cById('studentBranchFilter')?.addEventListener('change', reloadStudents);
  cById('studentSemesterFilter')?.addEventListener('change', reloadStudents);
  cById('studentSortBySelect')?.addEventListener('change', reloadStudents);
  cById('studentSortDirSelect')?.addEventListener('change', reloadStudents);
  cById('studentPerPageSelect')?.addEventListener('change', reloadStudents);

  cById('studentPrevPageBtn')?.addEventListener('click', () => {
    if (studentCurrentPage > 1) {
      loadStudents(false, currentRouteToken, studentCurrentPage - 1).catch((e) => window.alert(e.message));
    }
  });

  cById('studentNextPageBtn')?.addEventListener('click', () => {
    if (studentCurrentPage < studentTotalPages) {
      loadStudents(false, currentRouteToken, studentCurrentPage + 1).catch((e) => window.alert(e.message));
    }
  });

  cById('resetStudentsFilterBtn')?.addEventListener('click', () => {
    if (cById('studentSearchInput')) cById('studentSearchInput').value = '';
    if (cById('studentStatusFilter')) cById('studentStatusFilter').value = '';
    if (cById('studentMembershipFilter')) cById('studentMembershipFilter').value = '';
    if (cById('studentCollegeFilter')) cById('studentCollegeFilter').value = '';
    if (cById('studentBranchFilter')) cById('studentBranchFilter').value = '';
    if (cById('studentSemesterFilter')) cById('studentSemesterFilter').value = '';
    if (cById('studentSortBySelect')) cById('studentSortBySelect').value = 'created_at';
    if (cById('studentSortDirSelect')) cById('studentSortDirSelect').value = 'DESC';
    if (cById('studentPerPageSelect')) cById('studentPerPageSelect').value = '20';
    reloadStudents();
  });

  cById('bulkStudentsBtn')?.addEventListener('click', () => runBulkStudents().catch((e) => window.alert(e.message)));
  cById('studentsSelectAll')?.addEventListener('change', (event) => {
    document.querySelectorAll('.student-row-checkbox').forEach((node) => {
      node.checked = event.target.checked;
    });
  });

  cById('loadPaymentsBtn')?.addEventListener('click', () => loadPayments().catch((e) => window.alert(e.message)));
  cById('bulkPaymentsBtn')?.addEventListener('click', () => runBulkPayments().catch((e) => window.alert(e.message)));
  cById('expireMembershipsBtn')?.addEventListener('click', async () => {
    await window.CollegeOSApi.adminControlDeactivateExpired();
    await loadPayments();
  });

  cById('runContentBulkBtn')?.addEventListener('click', () => runContentBulkAction().catch((e) => window.alert(e.message)));

  cById('loadBranchesBtn')?.addEventListener('click', () => loadBranches().catch((e) => window.alert(e.message)));
  cById('createBranchBtn')?.addEventListener('click', () => createBranch().catch((e) => window.alert(e.message)));
  cById('updateBranchBtn')?.addEventListener('click', () => updateBranch().catch((e) => window.alert(e.message)));
  cById('deleteBranchBtn')?.addEventListener('click', () => deleteBranch().catch((e) => window.alert(e.message)));
  cById('assignBranchContentBtn')?.addEventListener('click', () => assignBranchContent().catch((e) => window.alert(e.message)));

  cById('loadUniversitiesBtn')?.addEventListener('click', () => loadUniversities().catch((e) => window.alert(e.message)));
  cById('createUniversityBtn')?.addEventListener('click', () => createUniversity().catch((e) => window.alert(e.message)));
  cById('updateUniversityBtn')?.addEventListener('click', () => updateUniversity().catch((e) => window.alert(e.message)));
  cById('reorderUniversitiesBtn')?.addEventListener('click', () => reorderUniversities().catch((e) => window.alert(e.message)));
  cById('deleteUniversityBtn')?.addEventListener('click', () => deleteUniversity().catch((e) => window.alert(e.message)));

  cById('saveOnboardingConfigBtn')?.addEventListener('click', () => saveOnboardingConfig().catch((e) => window.alert(e.message)));
  cById('createOnboardingOptionBtn')?.addEventListener('click', () => createOnboardingOption().catch((e) => window.alert(e.message)));
  cById('loadOnboardingConfigBtn')?.addEventListener('click', () => loadOnboardingConfig().catch((e) => window.alert(e.message)));
  cById('createRecommendationRuleBtn')?.addEventListener('click', () => createRecommendationRule().catch((e) => window.alert(e.message)));
  cById('loadRecommendationRulesBtn')?.addEventListener('click', () => loadRecommendationRules().catch((e) => window.alert(e.message)));

  cById('createMockBtn')?.addEventListener('click', () => createMockTest().catch((e) => window.alert(e.message)));
  cById('loadMockBtn')?.addEventListener('click', () => loadMockTests().catch((e) => window.alert(e.message)));

  cById('createRoadmapBtn')?.addEventListener('click', () => createRoadmap().catch((e) => window.alert(e.message)));
  cById('loadRoadmapsBtn')?.addEventListener('click', () => loadRoadmaps().catch((e) => window.alert(e.message)));

  cById('sendNotificationBtn')?.addEventListener('click', () => sendNotification(false).catch((e) => window.alert(e.message)));
  cById('sendReminderBtn')?.addEventListener('click', () => sendNotification(true).catch((e) => window.alert(e.message)));
  cById('createAnnouncementBtn')?.addEventListener('click', () => createAnnouncement().catch((e) => window.alert(e.message)));
  cById('loadAnnouncementsBtn')?.addEventListener('click', () => loadAnnouncements().catch((e) => window.alert(e.message)));

  cById('loadForumBtn')?.addEventListener('click', () => loadForumPosts().catch((e) => window.alert(e.message)));
  cById('loadFeedbackBtn')?.addEventListener('click', () => loadFeedback().catch((e) => window.alert(e.message)));

  cById('assignRewardBtn')?.addEventListener('click', () => assignReferralReward().catch((e) => window.alert(e.message)));
  cById('loadReferralHistoryBtn')?.addEventListener('click', () => loadReferralHistory().catch((e) => window.alert(e.message)));
  cById('loadTopReferrersBtn')?.addEventListener('click', () => loadTopReferrers().catch((e) => window.alert(e.message)));

  cById('assignRoleBtn')?.addEventListener('click', () => assignRole().catch((e) => window.alert(e.message)));
  cById('updatePermissionsBtn')?.addEventListener('click', () => updateRolePermissions().catch((e) => window.alert(e.message)));
  cById('loadRolesBtn')?.addEventListener('click', () => loadRoles().catch((e) => window.alert(e.message)));

  cById('saveSettingsBtn')?.addEventListener('click', () => saveSettings().catch((e) => window.alert(e.message)));
  cById('loadSettingsBtn')?.addEventListener('click', () => loadSettings().catch((e) => window.alert(e.message)));
  cById('saveContributionVisibilityBtn')?.addEventListener('click', () => saveContributionVisibilitySettings().catch((e) => window.alert(e.message)));
  cById('loadContributionVisibilityBtn')?.addEventListener('click', () => loadContributionVisibilitySettings().catch((e) => window.alert(e.message)));
  cById('saveCodingSettingsBtn')?.addEventListener('click', () => saveCodingSettings().catch((e) => window.alert(e.message)));
  cById('loadCodingSettingsBtn')?.addEventListener('click', () => loadCodingSettings().catch((e) => window.alert(e.message)));
  cById('refreshCodingStatsBtn')?.addEventListener('click', () => loadCodingDashboardPanel().catch((e) => window.alert(e.message)));
  cById('saveMembershipConfigBtn')?.addEventListener('click', () => saveMembershipConfig().catch((e) => window.alert(e.message)));
  cById('loadMembershipConfigBtn')?.addEventListener('click', () => loadMembershipConfig().catch((e) => window.alert(e.message)));
  cById('saveExperienceConfigBtn')?.addEventListener('click', () => saveExperienceConfig().catch((e) => window.alert(e.message)));
  cById('loadExperienceConfigBtn')?.addEventListener('click', () => loadExperienceConfig().catch((e) => window.alert(e.message)));
  cById('saveLiveHubControlBtn')?.addEventListener('click', () => saveLiveSessionControl().catch((e) => window.alert(e.message)));
  cById('loadLiveHubControlBtn')?.addEventListener('click', () => loadLiveSessionControl().catch((e) => window.alert(e.message)));
  cById('addLiveHubSessionBtn')?.addEventListener('click', () => addLiveHubSession().catch((e) => window.alert(e.message)));
  cById('seedLiveHubSessionsBtn')?.addEventListener('click', () => window.CollegeOSApi.adminLiveSessionsSync({
    sessions: liveHubSeedSessions().map((session) => ({
      sessionId: session.id,
      title: session.title,
      description: session.summary,
      mentorName: session.mentorName,
      assignedHostUserRef: session.assignedHostUserRef || session.assignedHostEmail || session.mentorProfileKey,
      assignedHostEmail: session.assignedHostUserRef || session.assignedHostEmail || session.mentorProfileKey,
      allowUnresolvedHost: true,
      sessionType: session.type,
      provider: session.provider,
      roomName: session.roomId,
      channelName: session.roomId,
      scheduledStart: session.startAt,
      scheduledEnd: session.endAt,
      status: session.status,
      maxParticipants: session.maxParticipants || 100,
      hostCode: session.mentorAccessId || undefined
    }))
  }).then(() => loadLiveSessionControl()).catch((e) => window.alert(e.message)));

  cById('loadAuditBtn')?.addEventListener('click', () => loadAuditLogs().catch((e) => window.alert(e.message)));
  cById('refreshFeatureMatrixBtn')?.addEventListener('click', () => loadFeatureVisibilityMatrix().catch((e) => window.alert(e.message)));
}

const FEATURE_META_MAP = {
  study_materials: { name: 'Study Materials', desc: 'Curated course materials, syllabus notes & lecture resources.', link: 'admin-materials.html', adminModuleId: 'ADM-03' },
  notes_library: { name: 'Notes Library', desc: 'Community & verified student notes repository.', link: 'admin-notes.html', adminModuleId: 'ADM-04' },
  previous_papers: { name: 'Previous Papers', desc: 'University and college past exam question papers.', link: 'admin-papers.html', adminModuleId: 'ADM-05' },
  quizzes: { name: 'Quizzes', desc: 'Subject-wise diagnostic quizzes & practice assessments.', link: 'admin-quizzes.html', adminModuleId: 'ADM-06' },
  mock_tests: { name: 'Mock Test Studio', desc: 'Full-length practice exams & timed mock tests.', link: 'admin-mock-tests.html', adminModuleId: 'ADM-07' },
  study_roadmaps: { name: 'Study Roadmaps', desc: 'Personalized career & academic learning paths.', link: 'admin-roadmaps.html', adminModuleId: 'ADM-08' },
  academic_structure: { name: 'Academic Structure', desc: 'Branch selection, category setup & semester mapping.', link: 'admin-academics.html', adminModuleId: 'ADM-09' },
  coding_challenges: { name: 'Coding Challenges', desc: 'Algorithmic contests, code execution & problem bank.', link: 'admin-coding-challenges.html', adminModuleId: 'ADM-14' },
  certificates: { name: 'Certificates & Credentials', desc: 'Issuance governance, verification system & badges.', link: 'admin-certificates.html', adminModuleId: 'ADM-13' },
  student_contributions: { name: 'Student Contributions', desc: 'Student uploads, note sharing & moderation queue.', link: 'admin-academics.html#contributions', adminModuleId: 'ADM-12' },
  campus_feed: { name: 'Campus Feed', desc: 'College discussions, news, updates & community posts.', link: 'admin-campus-feed.html', adminModuleId: 'ADM-16' },
  ai_tools: { name: 'AI Tools Studio', desc: 'AI assistant tools, prompt lifecycle & quota limits.', link: 'admin-ai-tools.html', adminModuleId: 'ADM-17' },
  support: { name: 'Support Governance', desc: 'Student tickets, helper trust levels & reward points.', link: 'admin-support-governance.html', adminModuleId: 'ADM-15' },
  live_sessions: { name: 'Live Sessions', desc: 'Mentorship webinars, live labs & instructor sessions.', link: 'admin-control.html#live-sessions', adminModuleId: 'ADM-21' },
  referrals: { name: 'Referrals & Rewards', desc: 'Invite classmates and earn platform points & rewards.', link: 'admin-control.html#referrals', adminModuleId: 'ADM-22' },
  student_experience: { name: 'Student Experience', desc: 'Product feedback, feature requests & discussion forum.', link: 'admin-control.html#experience', adminModuleId: 'ADM-23' },
  membership: { name: 'Memberships & Subscriptions', desc: 'Pricing plans, subscription tiers & payment verification.', link: 'admin-control.html#membership-management', adminModuleId: 'ADM-11' }
};

async function loadFeatureVisibilityMatrix() {
  const mount = cById('featureVisibilityMatrixGrid');
  if (!mount) return;

  try {
    const res = await window.CollegeOSApi.adminControlFeatureVisibilityGet();
    const matrix = res.matrix || {};

    const keys = Object.keys(FEATURE_META_MAP);
    mount.innerHTML = keys.map((key) => {
      const meta = FEATURE_META_MAP[key];
      const feat = matrix[key] || { is_visible: true, is_enabled: true, maintenance_mode: false, access_mode: 'EVERYONE', maintenance_message: '' };
      
      const visible = feat.is_visible !== false;
      const enabled = feat.is_enabled !== false;
      const maintenance = Boolean(feat.maintenance_mode);
      const accessMode = feat.access_mode || 'EVERYONE';

      let statusTag = 'LIVE';
      let statusClass = 'bg-emerald-100 text-emerald-800';
      if (!visible) {
        statusTag = 'HIDDEN';
        statusClass = 'bg-slate-200 text-slate-800';
      } else if (maintenance) {
        statusTag = 'MAINTENANCE';
        statusClass = 'bg-amber-100 text-amber-800';
      } else if (!enabled) {
        statusTag = 'DISABLED';
        statusClass = 'bg-rose-100 text-rose-800';
      }

      return `
        <div style="border:1px solid var(--border-color, #dbe4ef); border-radius:12px; padding:14px; background:var(--surface-1, #f8fafc); display:flex; flex-direction:column; justify-content:space-between; gap:12px;">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:6px;">
              <div>
                <strong style="font-size:15px; color:var(--text-primary, #0f172a);">${meta.name}</strong>
                <span class="muted" style="font-size:11px; margin-left:6px;">(${meta.adminModuleId})</span>
              </div>
              <span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:999px; border:1px solid #cbd5e1; white-space:nowrap;" class="${statusClass}">${statusTag}</span>
            </div>
            <p style="margin:0 0 10px; font-size:12px; color:var(--text-secondary, #475569);">${meta.desc}</p>
            
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-bottom:10px;">
              <div>
                <label style="font-size:11px; font-weight:600; display:block; margin-bottom:2px;">Student Visibility:</label>
                <select id="vis_${key}" class="co-admin-select-sm" style="width:100%;">
                  <option value="true" ${visible ? 'selected' : ''}>Visible (Shown)</option>
                  <option value="false" ${!visible ? 'selected' : ''}>Hidden (Off Nav)</option>
                </select>
              </div>
              <div>
                <label style="font-size:11px; font-weight:600; display:block; margin-bottom:2px;">Feature Availability:</label>
                <select id="ena_${key}" class="co-admin-select-sm" style="width:100%;">
                  <option value="true" ${enabled ? 'selected' : ''}>Enabled (Active)</option>
                  <option value="false" ${!enabled ? 'selected' : ''}>Disabled (Blocked)</option>
                </select>
              </div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-bottom:10px;">
              <div>
                <label style="font-size:11px; font-weight:600; display:block; margin-bottom:2px;">Maintenance Mode:</label>
                <select id="maintMode_${key}" class="co-admin-select-sm" style="width:100%;">
                  <option value="false" ${!maintenance ? 'selected' : ''}>Maintenance OFF</option>
                  <option value="true" ${maintenance ? 'selected' : ''}>Maintenance ON</option>
                </select>
              </div>
              <div>
                <label style="font-size:11px; font-weight:600; display:block; margin-bottom:2px;">Access Rule:</label>
                <select id="access_${key}" class="co-admin-select-sm" style="width:100%;">
                  <option value="EVERYONE" ${accessMode === 'EVERYONE' ? 'selected' : ''}>Everyone</option>
                  <option value="AUTHENTICATED" ${accessMode === 'AUTHENTICATED' ? 'selected' : ''}>Logged In Students</option>
                  <option value="MEMBERSHIP_REQUIRED" ${accessMode === 'MEMBERSHIP_REQUIRED' ? 'selected' : ''}>Membership Required</option>
                </select>
              </div>
            </div>

            <div style="margin-bottom:8px;">
              <input id="maintMsg_${key}" placeholder="Custom maintenance message (optional)" value="${escapeHtml(feat.maintenance_message || feat.maintenanceMessage || '')}" style="width:100%; border:1px solid #cbd5e1; border-radius:6px; padding:5px 8px; font-size:12px; background:#fff;" />
            </div>

            <div style="font-size:10px; color:var(--text-secondary, #64748b);">
              Updated: ${feat.updatedAt ? new Date(feat.updatedAt).toLocaleString('en-IN') : 'Default'} | By: ${escapeHtml(feat.updatedBy || 'System')}
            </div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; border-top:1fr solid #e2e8f0; pt:8px;">
            <button class="btn primary btn-sm" style="font-size:11px; padding:4px 10px;" onclick="window.CollegeOSSaveFeatureControl('${key}')"><i class="fa-solid fa-floppy-disk"></i> Save Feature State</button>
            <a href="${meta.link}" style="font-size:11px; color:var(--primary-color, #2563eb); text-decoration:none; font-weight:600;"><i class="fa-solid fa-arrow-right"></i> Manage Module</a>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    mount.innerHTML = `<p class="error">Failed to load feature matrix: ${err.message}</p>`;
  }
}

window.CollegeOSSaveFeatureControl = async function(featureKey) {
  const meta = FEATURE_META_MAP[featureKey] || { name: featureKey };
  const is_visible = cById(`vis_${featureKey}`)?.value === 'true';
  const is_enabled = cById(`ena_${featureKey}`)?.value === 'true';
  const maintenance_mode = cById(`maintMode_${featureKey}`)?.value === 'true';
  const access_mode = cById(`access_${featureKey}`)?.value || 'EVERYONE';
  const maintenanceMessage = cById(`maintMsg_${featureKey}`)?.value.trim() || '';

  const confirmMsg = (!is_enabled || maintenance_mode || !is_visible)
    ? `Warning: Setting ${meta.name} to Disabled/Hidden/Maintenance will restrict or hide student access immediately. Proceed?`
    : `Save configuration changes for ${meta.name}?`;

  if (!window.confirm(confirmMsg)) return;

  try {
    await window.CollegeOSApi.adminControlFeatureVisibilityPut({
      featureKey,
      is_visible,
      is_enabled,
      maintenance_mode,
      access_mode,
      maintenanceMessage,
      reason: `Admin Feature Control saved for ${featureKey}`
    });

    if (window.CollegeOSToast && typeof window.CollegeOSToast.show === 'function') {
      window.CollegeOSToast.show(`${meta.name} feature state saved cleanly`, 'success');
    } else {
      window.alert(`${meta.name} feature state saved cleanly`);
    }

    await loadFeatureVisibilityMatrix();
  } catch (err) {
    window.alert(err.message || 'Failed to update feature status');
  }
};

window.CollegeOSToggleFeature = window.CollegeOSSaveFeatureControl;

/* ============================================================
 * PART 6: MEMBERSHIP PLAN & ENTITLEMENT SYSTEM UI HANDLERS
 * ============================================================ */

let currentMembershipPlansCache = [];

async function loadMembershipPlansPanel() {
  const mount = cById('membershipPlansTableBody');
  if (mount) mount.innerHTML = '<tr><td colspan="7" class="co-admin-table-empty">Loading membership plans...</td></tr>';
  try {
    const res = await window.CollegeOSApi.adminControlMembershipPlans();
    currentMembershipPlansCache = res.plans || [];
    renderMembershipPlans(currentMembershipPlansCache);
  } catch (err) {
    if (mount) mount.innerHTML = `<tr class="error"><td colspan="7">Failed to load membership plans: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderMembershipPlans(plans) {
  const mount = cById('membershipPlansTableBody');
  if (!mount) return;
  if (!plans || plans.length === 0) {
    mount.innerHTML = '<tr><td colspan="7" class="co-admin-table-empty">No membership plans found. Click "Create New Plan" to add one.</td></tr>';
    return;
  }

  mount.innerHTML = plans.map(plan => {
    const statusClass = plan.status === 'ACTIVE' ? 'ok' : (plan.status === 'ARCHIVED' ? 'danger' : 'warn');
    const purchasableBadge = plan.is_purchasable ? '<span class="status-badge ok">Yes</span>' : '<span class="status-badge warn">No</span>';
    const durationText = `${plan.duration_value} ${plan.duration_unit}`;
    const priceText = Number(plan.price) === 0 ? 'FREE' : `₹${plan.price}`;

    return `
      <tr>
        <td>
          <div style="font-weight:700; color:var(--text-primary,#0f172a);">${escapeHtml(plan.name)}</div>
          <div style="font-size:0.75rem; color:#64748b; font-family:monospace;">Code: ${escapeHtml(plan.code)}</div>
        </td>
        <td>
          <div style="font-weight:700; color:#047857;">${priceText} / ${durationText}</div>
          <div style="font-size:0.75rem; color:#64748b;">${escapeHtml(plan.currency)}</div>
        </td>
        <td><span class="status-badge ${statusClass}">${escapeHtml(plan.status)}</span></td>
        <td>${purchasableBadge}</td>
        <td><strong style="color:var(--primary-color,#2563eb);">${plan.active_subscribers_count || 0}</strong> members</td>
        <td><span class="status-badge ok">${(plan.entitlements || []).length} features</span></td>
        <td style="text-align:right;">
          <div style="display:flex; gap:6px; justify-content:flex-end;">
            <button class="btn secondary btn-sm" type="button" onclick="window.CollegeOSEditPlan(${plan.id})"><i class="fa-solid fa-pen"></i> Edit</button>
            <button class="btn secondary btn-sm" type="button" onclick="window.CollegeOSConfigureEntitlements(${plan.id})"><i class="fa-solid fa-key"></i> Features</button>
            <button class="btn danger btn-sm" type="button" onclick="window.CollegeOSArchivePlan(${plan.id})"><i class="fa-solid fa-box-archive"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadActiveMembershipsView(page = 1) {
  const mount = cById('activeMembershipsTableBody');
  if (mount) mount.innerHTML = '<tr><td colspan="6" class="co-admin-table-empty">Loading active student subscriptions...</td></tr>';
  try {
    const res = await window.CollegeOSApi.adminControlActiveMemberships(page, 20);
    const list = res.activeMemberships || [];
    if (list.length === 0) {
      mount.innerHTML = '<tr><td colspan="6" class="co-admin-table-empty">No active student subscriptions found.</td></tr>';
      return;
    }
    mount.innerHTML = list.map(m => `
      <tr>
        <td>
          <div style="font-weight:600;">${escapeHtml(m.student_name || 'Student #' + m.student_id)}</div>
          <div style="font-size:0.75rem; color:#64748b;">${escapeHtml(m.student_email)}</div>
        </td>
        <td><span class="status-badge ok">${escapeHtml(m.plan_name || m.plan_code || 'Premium')}</span></td>
        <td><span class="status-badge info">${escapeHtml(m.source || 'PAYMENT')}</span></td>
        <td>${m.started_at ? new Date(m.started_at).toLocaleDateString('en-IN') : 'N/A'}</td>
        <td>${m.expires_at ? new Date(m.expires_at).toLocaleDateString('en-IN') : 'Lifetime / Continuous'}</td>
        <td><strong>₹${m.price_at_activation != null ? m.price_at_activation : '0'}</strong></td>
      </tr>
    `).join('');
  } catch (err) {
    if (mount) mount.innerHTML = `<tr class="error"><td colspan="6">Failed to load active subscriptions: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function loadMembershipHistoryView(page = 1) {
  const mount = cById('membershipHistoryTableBody');
  if (mount) mount.innerHTML = '<tr><td colspan="6" class="co-admin-table-empty">Loading subscription history...</td></tr>';
  try {
    const res = await window.CollegeOSApi.adminControlMembershipHistory(page, 20);
    const list = res.membershipHistory || [];
    if (list.length === 0) {
      mount.innerHTML = '<tr><td colspan="6" class="co-admin-table-empty">No historical subscription records found.</td></tr>';
      return;
    }
    mount.innerHTML = list.map(m => `
      <tr>
        <td>
          <div style="font-weight:600;">${escapeHtml(m.student_name || 'Student #' + m.student_id)}</div>
          <div style="font-size:0.75rem; color:#64748b;">${escapeHtml(m.student_email)}</div>
        </td>
        <td><span class="status-badge secondary">${escapeHtml(m.plan_name || m.plan_code || 'Plan')}</span></td>
        <td><span class="status-badge warn">${escapeHtml(m.status)}</span></td>
        <td><span class="status-badge info">${escapeHtml(m.source || 'PAYMENT')}</span></td>
        <td>${m.started_at ? new Date(m.started_at).toLocaleDateString('en-IN') : ''} - ${m.expires_at ? new Date(m.expires_at).toLocaleDateString('en-IN') : 'Ended'}</td>
        <td>₹${m.price_at_activation != null ? m.price_at_activation : '0'}</td>
      </tr>
    `).join('');
  } catch (err) {
    if (mount) mount.innerHTML = `<tr class="error"><td colspan="6">Failed to load subscription history: ${escapeHtml(err.message)}</td></tr>`;
  }
}

window.CollegeOSEditPlan = function(planId) {
  const plan = currentMembershipPlansCache.find(p => p.id === planId);
  if (!plan) return;

  cById('planModalTitle').textContent = 'Edit Membership Plan';
  cById('planFormId').value = plan.id;
  cById('planFormCode').value = plan.code;
  cById('planFormCode').disabled = true; // Code is immutable once created
  cById('planFormName').value = plan.name;
  cById('planFormDescription').value = plan.description || '';
  cById('planFormPrice').value = plan.price;
  cById('planFormDurationValue').value = plan.duration_value;
  cById('planFormDurationUnit').value = plan.duration_unit;
  cById('planFormStatus').value = plan.status;
  cById('planFormDisplayOrder').value = plan.display_order;
  cById('planFormPurchasable').checked = Boolean(plan.is_purchasable);
  cById('planFormBenefits').value = Array.isArray(plan.display_benefits) ? plan.display_benefits.join('\n') : '';

  const modal = cById('planFormModal');
  if (modal) modal.style.display = 'flex';
};

window.CollegeOSConfigureEntitlements = function(planId) {
  const plan = currentMembershipPlansCache.find(p => p.id === planId);
  if (!plan) return;

  cById('entitlementsModalTitle').textContent = `Configure Entitlements for ${plan.name}`;
  cById('entitlementsPlanId').value = plan.id;

  const currentEnts = new Set(plan.entitlements || []);
  const listMount = cById('entitlementsCheckboxesList');

  const registryFeatures = [
    { key: 'study_materials', label: 'Study Materials' },
    { key: 'notes_library', label: 'Notes Library' },
    { key: 'previous_papers', label: 'Previous Papers' },
    { key: 'quizzes', label: 'Quizzes' },
    { key: 'mock_tests', label: 'Mock Test Studio' },
    { key: 'study_roadmaps', label: 'Study Roadmaps' },
    { key: 'academic_structure', label: 'Academic Structure' },
    { key: 'career_guidance', label: 'Career Guidance' },
    { key: 'ai_study_assistant', label: 'AI Study Tools' },
    { key: 'certificates', label: 'Certificates' },
    { key: 'company_support', label: 'Company Support' },
    { key: 'campus_feed', label: 'Campus Feed' },
    { key: 'forum', label: 'Student Forum' },
    { key: 'referrals', label: 'Referral Rewards' },
    { key: 'contributions', label: 'Student Contributions' },
    { key: 'ai_tools', label: 'AI Career Tools' },
    { key: 'live_sessions', label: 'Live Sessions' }
  ];

  if (listMount) {
    listMount.innerHTML = registryFeatures.map(f => {
      const checked = currentEnts.has(f.key) ? 'checked' : '';
      return `
        <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; padding:4px 6px; cursor:pointer;">
          <input type="checkbox" name="entitlementKey" value="${f.key}" ${checked} />
          <span>${escapeHtml(f.label)}</span>
        </label>
      `;
    }).join('');
  }

  const modal = cById('planEntitlementsModal');
  if (modal) modal.style.display = 'flex';
};

window.CollegeOSArchivePlan = async function(planId) {
  const plan = currentMembershipPlansCache.find(p => p.id === planId);
  if (!plan) return;

  if (!window.confirm(`Are you sure you want to archive/delete plan "${plan.name}"? If active subscribers exist, it will be archived safely.`)) {
    return;
  }

  try {
    const res = await window.CollegeOSApi.adminControlArchiveMembershipPlan(planId);
    window.alert(res.message || 'Plan archived/deleted successfully');
    await loadMembershipPlansPanel();
  } catch (err) {
    window.alert(err.message || 'Failed to archive plan');
  }
};

/* ============================================================
 * PART 7: PRODUCTION PAYMENTS + UPI + QR + MANUAL VERIFICATION UI
 * ============================================================ */

let currentPendingQueueCache = [];
let selectedReviewPaymentId = null;

async function loadPayments(token) {
  await loadPaymentsQueue();
}

async function loadPaymentsQueue(page = 1) {
  const mount = cById('paymentQueueTableBody');
  if (mount) mount.innerHTML = '<tr><td colspan="6" class="co-admin-table-empty">Loading pending verification requests...</td></tr>';
  try {
    const res = await window.CollegeOSApi.adminControlPaymentQueue(page, 20);
    currentPendingQueueCache = res.pendingQueue || [];
    if (currentPendingQueueCache.length === 0) {
      if (mount) mount.innerHTML = '<tr><td colspan="6" class="co-admin-table-empty">No pending payment verification requests in queue.</td></tr>';
      return;
    }
    renderPaymentQueue(currentPendingQueueCache);
  } catch (err) {
    if (mount) mount.innerHTML = `<tr class="error"><td colspan="6">Failed to load payment queue: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderPaymentQueue(items) {
  const mount = cById('paymentQueueTableBody');
  if (!mount) return;

  mount.innerHTML = items.map(item => {
    const dupBadge = item.is_duplicate_utr
      ? '<span class="status-badge danger" title="Duplicate UTR detected"><i class="fa-solid fa-triangle-exclamation"></i> Duplicate UTR</span>'
      : '';

    const proofLink = item.proof_url
      ? `<a href="${escapeHtml(item.proof_url)}" target="_blank" style="color:var(--primary-color,#2563eb); font-weight:600;"><i class="fa-solid fa-image"></i> View Proof</a>`
      : '<span style="color:#94a3b8; font-size:0.8rem;">No Proof</span>';

    return `
      <tr>
        <td>
          <div style="font-weight:600;">${escapeHtml(item.student_name || 'Student #' + item.student_id)}</div>
          <div style="font-size:0.75rem; color:#64748b;">${escapeHtml(item.student_email)}</div>
        </td>
        <td>
          <div style="font-weight:700; color:#047857;">₹${item.amount_inr}</div>
        </td>
        <td>
          <code style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-weight:600;">${escapeHtml(item.utr_reference)}</code>
          ${dupBadge}
        </td>
        <td>${proofLink}</td>
        <td>${item.submitted_at ? new Date(item.submitted_at).toLocaleString('en-IN') : 'N/A'}</td>
        <td style="text-align:right;">
          <button class="btn primary btn-sm" type="button" onclick="window.CollegeOSReviewPayment(${item.id})"><i class="fa-solid fa-magnifying-glass"></i> Review</button>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadPaymentTransactions(page = 1) {
  const mount = cById('paymentTransactionsTableBody');
  if (mount) mount.innerHTML = '<tr><td colspan="6" class="co-admin-table-empty">Loading payment transactions...</td></tr>';
  const status = cById('payTxStatusFilter')?.value || 'all';
  const search = cById('payTxSearchInput')?.value || '';

  try {
    const res = await window.CollegeOSApi.adminControlPaymentTransactions(page, 20, status, search);
    const list = res.transactions || [];
    if (list.length === 0) {
      mount.innerHTML = '<tr><td colspan="6" class="co-admin-table-empty">No payment transactions match filter.</td></tr>';
      return;
    }

    mount.innerHTML = list.map(tx => {
      const statusClass = tx.status === 'approved' ? 'ok' : (tx.status === 'rejected' ? 'danger' : 'warn');
      return `
        <tr>
          <td>
            <div style="font-weight:600;">${escapeHtml(tx.student_name || 'Student #' + tx.student_id)}</div>
            <div style="font-size:0.75rem; color:#64748b;">${escapeHtml(tx.student_email)}</div>
          </td>
          <td><strong>₹${tx.amount_inr}</strong></td>
          <td><code>${escapeHtml(tx.utr_reference)}</code></td>
          <td><span class="status-badge ${statusClass}">${escapeHtml(tx.status)}</span></td>
          <td>${tx.submitted_at ? new Date(tx.submitted_at).toLocaleDateString('en-IN') : ''}</td>
          <td>
            ${tx.approved_at ? new Date(tx.approved_at).toLocaleDateString('en-IN') : (tx.rejection_reason ? 'Rejected' : '-')}
            ${tx.approved_by_name ? `<div style="font-size:0.75rem; color:#64748b;">By: ${escapeHtml(tx.approved_by_name)}</div>` : ''}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    if (mount) mount.innerHTML = `<tr class="error"><td colspan="6">Failed to load transactions: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function loadPaymentSettings() {
  try {
    const res = await window.CollegeOSApi.adminControlPaymentSettingsGet();
    const s = res.settings || {};
    if (cById('psPaymentEnabled')) cById('psPaymentEnabled').checked = Boolean(s.payment_enabled);
    if (cById('psUpiId')) cById('psUpiId').value = s.upi_id || '';
    if (cById('psPayeeName')) cById('psPayeeName').value = s.payee_name || '';
    if (cById('psInstructions')) cById('psInstructions').value = Array.isArray(s.instructions) ? s.instructions.join('\n') : '';
    if (cById('psSupportMessage')) cById('psSupportMessage').value = s.support_message || '';

    const previewBox = cById('psQrPreviewBox');
    if (previewBox) {
      if (s.qr_image_url) {
        previewBox.innerHTML = `<img src="${escapeHtml(s.qr_image_url)}" alt="QR Code" style="max-width:100%; max-height:100%; object-fit:contain;" />`;
      } else {
        previewBox.innerHTML = '<span style="font-size:0.75rem; color:#94a3b8;">No QR</span>';
      }
    }
  } catch (err) {
    window.alert(err.message || 'Failed to load payment settings');
  }
}

window.CollegeOSReviewPayment = function(paymentId) {
  const item = currentPendingQueueCache.find(i => i.id === paymentId);
  if (!item) return;

  selectedReviewPaymentId = paymentId;
  cById('prStudent').textContent = `${item.student_name} (${item.student_email})`;
  cById('prAmount').textContent = `₹${item.amount_inr}`;
  cById('prUtr').textContent = item.utr_reference;

  const warn = cById('prDuplicateWarn');
  if (warn) warn.style.display = item.is_duplicate_utr ? 'block' : 'none';

  const proofBox = cById('prProofContainer');
  if (proofBox) {
    if (item.proof_url) {
      proofBox.innerHTML = `<a href="${escapeHtml(item.proof_url)}" target="_blank"><img src="${escapeHtml(item.proof_url)}" alt="Proof Screenshot" style="max-width:100%; max-height:240px; border-radius:6px; object-fit:contain;" /></a>`;
    } else {
      proofBox.innerHTML = '<span style="font-size:0.85rem; color:#64748b;">No screenshot uploaded</span>';
    }
  }

  cById('prRejectReasonInput').value = '';
  cById('paymentReviewModal').style.display = 'flex';
};

function bindPaymentTabEvents() {
  const qBtn = cById('payTabQueueBtn');
  const txBtn = cById('payTabTransactionsBtn');
  const setBtn = cById('payTabSettingsBtn');

  if (qBtn && txBtn && setBtn) {
    qBtn.onclick = () => {
      qBtn.classList.add('active');
      txBtn.classList.remove('active');
      setBtn.classList.remove('active');
      cById('paymentQueueView').style.display = 'block';
      cById('paymentTransactionsView').style.display = 'none';
      cById('paymentSettingsView').style.display = 'none';
      loadPaymentsQueue(1);
    };

    txBtn.onclick = () => {
      txBtn.classList.add('active');
      qBtn.classList.remove('active');
      setBtn.classList.remove('active');
      cById('paymentTransactionsView').style.display = 'block';
      cById('paymentQueueView').style.display = 'none';
      cById('paymentSettingsView').style.display = 'none';
      loadPaymentTransactions(1);
    };

    setBtn.onclick = () => {
      setBtn.classList.add('active');
      qBtn.classList.remove('active');
      txBtn.classList.remove('active');
      cById('paymentSettingsView').style.display = 'block';
      cById('paymentQueueView').style.display = 'none';
      cById('paymentTransactionsView').style.display = 'none';
      loadPaymentSettings();
    };
  }

  const closeReviewBtn = cById('closePayReviewModalBtn');
  if (closeReviewBtn) {
    closeReviewBtn.onclick = () => {
      cById('paymentReviewModal').style.display = 'none';
    };
  }

  const approvePayBtn = cById('approvePayBtn');
  if (approvePayBtn) {
    approvePayBtn.onclick = async () => {
      if (!selectedReviewPaymentId) return;
      if (!window.confirm('Approve payment and activate student membership now?')) return;

      try {
        const res = await window.CollegeOSApi.adminControlApprovePayment(selectedReviewPaymentId);
        window.alert(res.message || 'Payment approved and membership activated!');
        cById('paymentReviewModal').style.display = 'none';
        await loadPaymentsQueue(1);
      } catch (err) {
        window.alert(err.message || 'Failed to approve payment');
      }
    };
  }

  const rejectPayBtn = cById('rejectPayBtn');
  if (rejectPayBtn) {
    rejectPayBtn.onclick = async () => {
      if (!selectedReviewPaymentId) return;
      const reason = cById('prRejectReasonInput').value.trim();
      if (!reason) {
        window.alert('Please enter a rejection reason.');
        return;
      }

      if (!window.confirm(`Reject payment with reason: "${reason}"?`)) return;

      try {
        const res = await window.CollegeOSApi.adminControlRejectPayment(selectedReviewPaymentId, reason);
        window.alert(res.message || 'Payment rejected successfully');
        cById('paymentReviewModal').style.display = 'none';
        await loadPaymentsQueue(1);
      } catch (err) {
        window.alert(err.message || 'Failed to reject payment');
      }
    };
  }

  const psForm = cById('paymentSettingsForm');
  if (psForm) {
    psForm.onsubmit = async (e) => {
      e.preventDefault();
      const payment_enabled = cById('psPaymentEnabled').checked;
      const upi_id = cById('psUpiId').value.trim();
      const payee_name = cById('psPayeeName').value.trim();
      const instructions = cById('psInstructions').value.split('\n').map(s => s.trim()).filter(Boolean);
      const support_message = cById('psSupportMessage').value.trim();

      try {
        await window.CollegeOSApi.adminControlPaymentSettingsPut({
          payment_enabled,
          upi_id,
          payee_name,
          instructions,
          support_message
        });
        window.alert('Payment settings saved successfully!');
        await loadPaymentSettings();
      } catch (err) {
        window.alert(err.message || 'Failed to save payment settings');
      }
    };
  }

  const uploadQrBtn = cById('uploadQrBtn');
  const qrFileInput = cById('psQrFileInput');
  if (uploadQrBtn && qrFileInput) {
    uploadQrBtn.onclick = async () => {
      const file = qrFileInput.files[0];
      if (!file) {
        window.alert('Please select an image file first.');
        return;
      }

      const formData = new FormData();
      formData.append('qrImage', file);

      try {
        const res = await fetch('/api/admin/control/payments/settings/qr', {
          method: 'POST',
          body: formData
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Upload failed');
        window.alert('Payment QR code updated successfully!');
        qrFileInput.value = '';
        await loadPaymentSettings();
      } catch (err) {
        window.alert(err.message || 'Failed to upload QR image');
      }
    };
  }

  const refreshQueueBtn = cById('loadPaymentsQueueBtn');
  if (refreshQueueBtn) {
    refreshQueueBtn.onclick = () => loadPaymentsQueue(1);
  }
}

function bindMembershipEvents() {
  const openBtn = cById('openCreatePlanModalBtn');
  if (openBtn) {
    openBtn.onclick = () => {
      cById('planModalTitle').textContent = 'Create Membership Plan';
      cById('planFormId').value = '';
      cById('planFormCode').value = '';
      cById('planFormCode').disabled = false;
      cById('planFormName').value = '';
      cById('planFormDescription').value = '';
      cById('planFormPrice').value = '49.00';
      cById('planFormDurationValue').value = '30';
      cById('planFormDurationUnit').value = 'DAYS';
      cById('planFormStatus').value = 'ACTIVE';
      cById('planFormDisplayOrder').value = '0';
      cById('planFormPurchasable').checked = true;
      cById('planFormBenefits').value = '';
      cById('planFormModal').style.display = 'flex';
    };
  }

  const closePlanModalBtn = cById('closePlanModalBtn');
  if (closePlanModalBtn) {
    closePlanModalBtn.onclick = () => {
      cById('planFormModal').style.display = 'none';
    };
  }

  const closeEntModalBtn = cById('closeEntitlementsModalBtn');
  if (closeEntModalBtn) {
    closeEntModalBtn.onclick = () => {
      cById('planEntitlementsModal').style.display = 'none';
    };
  }

  const planForm = cById('planForm');
  if (planForm) {
    planForm.onsubmit = async (e) => {
      e.preventDefault();
      const planId = cById('planFormId').value;
      const code = cById('planFormCode').value.trim();
      const name = cById('planFormName').value.trim();
      const description = cById('planFormDescription').value.trim();
      const price = parseFloat(cById('planFormPrice').value || '0');
      const duration_value = parseInt(cById('planFormDurationValue').value || '30', 10);
      const duration_unit = cById('planFormDurationUnit').value;
      const status = cById('planFormStatus').value;
      const display_order = parseInt(cById('planFormDisplayOrder').value || '0', 10);
      const is_purchasable = cById('planFormPurchasable').checked;
      const benefitsText = cById('planFormBenefits').value;
      const display_benefits = benefitsText.split('\n').map(s => s.trim()).filter(Boolean);

      try {
        if (planId) {
          // Edit existing
          await window.CollegeOSApi.adminControlUpdateMembershipPlan(planId, {
            name,
            description,
            price,
            duration_value,
            duration_unit,
            status,
            is_purchasable,
            display_order,
            display_benefits
          });
          window.alert('Membership plan updated successfully!');
        } else {
          // Create new
          await window.CollegeOSApi.adminControlCreateMembershipPlan({
            code,
            name,
            description,
            price,
            duration_value,
            duration_unit,
            status,
            is_purchasable,
            display_order,
            display_benefits
          });
          window.alert('New membership plan created successfully!');
        }
        cById('planFormModal').style.display = 'none';
        await loadMembershipPlansPanel();
      } catch (err) {
        window.alert(err.message || 'Failed to save membership plan');
      }
    };
  }

  const entForm = cById('entitlementsForm');
  if (entForm) {
    entForm.onsubmit = async (e) => {
      e.preventDefault();
      const planId = cById('entitlementsPlanId').value;
      const checkboxes = document.querySelectorAll('input[name="entitlementKey"]:checked');
      const entitlements = Array.from(checkboxes).map(cb => cb.value);

      try {
        await window.CollegeOSApi.adminControlSetPlanEntitlements(planId, entitlements);
        window.alert('Plan entitlements updated successfully!');
        cById('planEntitlementsModal').style.display = 'none';
        await loadMembershipPlansPanel();
      } catch (err) {
        window.alert(err.message || 'Failed to update plan entitlements');
      }
    };
  }

  // Sub-tabs handling
  const subtabPlansBtn = cById('subtabPlansBtn');
  const subtabActiveBtn = cById('subtabActiveMembershipsBtn');
  const subtabHistoryBtn = cById('subtabMembershipHistoryBtn');

  if (subtabPlansBtn && subtabActiveBtn && subtabHistoryBtn) {
    subtabPlansBtn.onclick = () => {
      subtabPlansBtn.classList.add('active');
      subtabActiveBtn.classList.remove('active');
      subtabHistoryBtn.classList.remove('active');
      cById('membershipPlansView').style.display = 'block';
      cById('activeMembershipsView').style.display = 'none';
      cById('membershipHistoryView').style.display = 'none';
      loadMembershipPlansPanel();
    };

    subtabActiveBtn.onclick = () => {
      subtabActiveBtn.classList.add('active');
      subtabPlansBtn.classList.remove('active');
      subtabHistoryBtn.classList.remove('active');
      cById('activeMembershipsView').style.display = 'block';
      cById('membershipPlansView').style.display = 'none';
      cById('membershipHistoryView').style.display = 'none';
      loadActiveMembershipsView(1);
    };

    subtabHistoryBtn.onclick = () => {
      subtabHistoryBtn.classList.add('active');
      subtabPlansBtn.classList.remove('active');
      subtabActiveBtn.classList.remove('active');
      cById('membershipHistoryView').style.display = 'block';
      cById('membershipPlansView').style.display = 'none';
      cById('activeMembershipsView').style.display = 'none';
      loadMembershipHistoryView(1);
    };
  }

  const refreshBtn = cById('loadMembershipPlansBtn');
  if (refreshBtn) {
    refreshBtn.onclick = () => loadMembershipPlansPanel();
  }
}

/* ============================================================
 * PART 2: ACADEMIC STRUCTURE & STUDENT SCOPE GOVERNANCE
 * ============================================================ */

let asCurrentUniversities = [];
let asCurrentCourses = [];
let asCurrentBatches = [];
let asAssignCurrentPage = 1;

async function loadAcademicStructurePanel() {
  bindAcademicStructureSubtabs();
  await loadAcademicStructureOverview();
}

function bindAcademicStructureSubtabs() {
  const tabOverview = cById('asTabOverviewBtn');
  const tabUnis = cById('asTabUniversitiesBtn');
  const tabCourses = cById('asTabCoursesBtn');
  const tabBatches = cById('asTabBatchesBtn');
  const tabAssign = cById('asTabAssignmentsBtn');

  const viewOverview = cById('asViewOverview');
  const viewUnis = cById('asViewUniversities');
  const viewCourses = cById('asViewCourses');
  const viewBatches = cById('asViewBatches');
  const viewAssign = cById('asViewAssignments');

  if (!tabOverview || !tabUnis || !tabCourses || !tabBatches || !tabAssign) return;

  const resetSubtabs = () => {
    [tabOverview, tabUnis, tabCourses, tabBatches, tabAssign].forEach(b => b.classList.remove('active'));
    [viewOverview, viewUnis, viewCourses, viewBatches, viewAssign].forEach(v => v.style.display = 'none');
  };

  tabOverview.onclick = () => {
    resetSubtabs();
    tabOverview.classList.add('active');
    viewOverview.style.display = 'block';
    loadAcademicStructureOverview();
  };

  tabUnis.onclick = () => {
    resetSubtabs();
    tabUnis.classList.add('active');
    viewUnis.style.display = 'block';
    loadAsUniversities();
  };

  tabCourses.onclick = () => {
    resetSubtabs();
    tabCourses.classList.add('active');
    viewCourses.style.display = 'block';
    loadAsCourses();
  };

  tabBatches.onclick = () => {
    resetSubtabs();
    tabBatches.classList.add('active');
    viewBatches.style.display = 'block';
    loadAsBatches();
  };

  tabAssign.onclick = () => {
    resetSubtabs();
    tabAssign.classList.add('active');
    viewAssign.style.display = 'block';
    loadAsStudentAssignments(1);
  };
}

async function loadAcademicStructureOverview() {
  const refreshBtn = cById('loadAcademicStructureOverviewBtn');
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    const res = await fetch('/api/admin/academic-structure/overview', { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch overview');

    const stats = data.stats || {};
    if (cById('kpiActiveUniversities')) cById('kpiActiveUniversities').textContent = stats.activeUniversities || 0;
    if (cById('kpiActiveCourses')) cById('kpiActiveCourses').textContent = stats.activeCourses || 0;
    if (cById('kpiActiveBatches')) cById('kpiActiveBatches').textContent = stats.activeBatches || 0;
    if (cById('kpiStudentsConfigured')) cById('kpiStudentsConfigured').textContent = stats.studentsAssigned || 0;

    // Render Health Alerts
    const healthBanner = cById('academicHealthBannerContainer');
    if (healthBanner) {
      const alerts = data.healthAlerts || [];
      if (alerts.length === 0) {
        healthBanner.innerHTML = `
          <div style="background:#f0fdf4; border:1px solid #bbf7d0; color:#166534; padding:10px 14px; border-radius:8px; font-size:0.85rem; display:flex; align-items:center; gap:8px;">
            <i class="fa-solid fa-circle-check"></i>
            <span><strong>System Healthy:</strong> Academic structure is active and ready for student onboarding.</span>
          </div>
        `;
      } else {
        healthBanner.innerHTML = alerts.map(a => `
          <div style="background:${a.severity === 'CRITICAL' ? '#fef2f2' : '#fffbe6'}; border:1px solid ${a.severity === 'CRITICAL' ? '#fca5a5' : '#ffe58f'}; color:${a.severity === 'CRITICAL' ? '#991b1b' : '#d48806'}; padding:10px 14px; border-radius:8px; font-size:0.85rem; display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span><strong>${a.severity} WARNING:</strong> ${escapeHtml(a.message)}</span>
          </div>
        `).join('');
      }
    }

    // Render Onboarding Preview Tree
    const treeBox = cById('asOnboardingPreviewTree');
    if (treeBox) {
      const preview = data.onboardingPreview || [];
      if (preview.length === 0) {
        treeBox.innerHTML = '<div style="color:#94a3b8; text-align:center; padding:16px;">No active universities configured.</div>';
      } else {
        treeBox.innerHTML = preview.map(u => `
          <div style="margin-bottom:12px; border-bottom:1px dashed #e2e8f0; padding-bottom:8px;">
            <div style="font-weight:700; color:#1e293b;">
              <i class="fa-solid fa-building-columns" style="color:#2563eb;"></i> ${escapeHtml(u.name)} <code style="font-size:0.75rem; background:#e2e8f0; padding:1px 5px; border-radius:3px;">${escapeHtml(u.code)}</code>
            </div>
            ${u.courses && u.courses.length > 0 ? `
              <div style="margin-left:18px; margin-top:6px; display:flex; flex-direction:column; gap:4px;">
                ${u.courses.map(c => `
                  <div>
                    <span style="font-weight:600; color:#334155;"><i class="fa-solid fa-book-open" style="font-size:0.8rem; color:#64748b;"></i> ${escapeHtml(c.name)}</span>
                    ${c.batches && c.batches.length > 0 ? `
                      <div style="margin-left:18px; display:flex; gap:6px; flex-wrap:wrap; margin-top:2px;">
                        ${c.batches.map(b => `<span style="background:#e0f2fe; color:#0369a1; padding:1px 6px; border-radius:4px; font-size:0.75rem; font-weight:600;">${escapeHtml(b.name)}</span>`).join('')}
                      </div>
                    ` : '<div style="margin-left:18px; color:#ef4444; font-size:0.75rem;">(No active batches)</div>'}
                  </div>
                `).join('')}
              </div>
            ` : '<div style="margin-left:18px; color:#ef4444; font-size:0.75rem; margin-top:4px;">(No active courses)</div>'}
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Overview error:', err);
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

async function loadAsUniversities() {
  const search = cById('asUniSearchInput')?.value || '';
  const status = cById('asUniStatusFilter')?.value || 'ALL';
  const tbody = cById('asUniversitiesTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="co-admin-table-empty">Loading universities...</td></tr>';

  try {
    const res = await fetch(`/api/admin/academic-structure/universities?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch universities');

    asCurrentUniversities = data.universities || [];
    if (asCurrentUniversities.length === 0) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="co-admin-table-empty">No universities found.</td></tr>';
      return;
    }

    if (tbody) {
      tbody.innerHTML = asCurrentUniversities.map(u => `
        <tr>
          <td><code style="background:#e2e8f0; padding:2px 6px; border-radius:4px; font-weight:700;">${escapeHtml(u.code)}</code></td>
          <td>
            <div style="font-weight:700;">${escapeHtml(u.name)}</div>
            ${u.short_name ? `<div style="font-size:0.75rem; color:#64748b;">${escapeHtml(u.short_name)}</div>` : ''}
          </td>
          <td>${escapeHtml([u.campus, u.city, u.state].filter(Boolean).join(', ') || 'Main Campus')}</td>
          <td>${asStatusBadge(u.status)}</td>
          <td>${u.display_order}</td>
          <td><strong>${u.courses_count || 0}</strong></td>
          <td><strong>${u.students_count || 0}</strong></td>
          <td style="text-align:right;">
            <div class="control-actions" style="justify-content:flex-end;">
              <button class="btn secondary btn-sm" onclick="openEditAsUniModal(${u.id})"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
              <button class="btn danger btn-sm" onclick="deleteAsUni(${u.id})"><i class="fa-solid fa-trash-can"></i> Delete</button>
            </div>
          </td>
        </tr>
      `).join('');
    }

    populateUniversityDropdowns(asCurrentUniversities);
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr class="error"><td colspan="8">${escapeHtml(err.message)}</td></tr>`;
  }
}

function populateUniversityDropdowns(unis) {
  const activeUnis = unis.filter(u => u.status === 'ACTIVE' || u.status === 'INACTIVE');
  const optionsHtml = '<option value="">Select University...</option>' + activeUnis.map(u => `<option value="${u.id}">${escapeHtml(u.name)} (${escapeHtml(u.code)})</option>`).join('');
  const filterOptionsHtml = '<option value="">All Universities</option>' + activeUnis.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');

  ['asCourseUniSelect', 'asBatchUniSelect', 'reassignUniversitySelect'].forEach(id => {
    const el = cById(id);
    if (el) el.innerHTML = optionsHtml;
  });

  ['asCourseUniFilter', 'asBatchUniFilter', 'asAssignUniFilter'].forEach(id => {
    const el = cById(id);
    if (el) {
      const cur = el.value;
      el.innerHTML = filterOptionsHtml;
      el.value = cur;
    }
  });
}

function openAddAsUniModal() {
  cById('asUniModalTitle').textContent = 'Add University';
  cById('asUniId').value = '';
  cById('asUniCode').value = '';
  cById('asUniCode').disabled = false;
  cById('asUniShortName').value = '';
  cById('asUniName').value = '';
  cById('asUniStatus').value = 'ACTIVE';
  cById('asUniDisplayOrder').value = '0';
  cById('asUniPriorityRank').value = '1';
  cById('asUniModal').style.display = 'flex';
}

function openEditAsUniModal(uniId) {
  const uni = asCurrentUniversities.find(u => u.id === uniId);
  if (!uni) return;
  cById('asUniModalTitle').textContent = 'Edit University';
  cById('asUniId').value = uni.id;
  cById('asUniCode').value = uni.code || '';
  cById('asUniShortName').value = uni.short_name || '';
  cById('asUniName').value = uni.name || '';
  cById('asUniStatus').value = uni.status || 'ACTIVE';
  cById('asUniDisplayOrder').value = uni.display_order || 0;
  cById('asUniPriorityRank').value = uni.priority_rank || 1;
  cById('asUniModal').style.display = 'flex';
}

async function deleteAsUni(uniId) {
  const uni = asCurrentUniversities.find(u => u.id === uniId);
  if (!uni) return;

  if (!window.confirm(`Delete or archive University "${uni.name}"?`)) return;

  try {
    const res = await fetch(`/api/admin/academic-structure/universities/${uniId}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete university');

    window.alert(data.message || 'University deleted successfully');
    await loadAsUniversities();
    await loadAcademicStructureOverview();
  } catch (err) {
    window.alert(err.message || 'Failed to delete university');
  }
}

async function loadAsCourses() {
  const uniId = cById('asCourseUniFilter')?.value || '';
  const search = cById('asCourseSearchInput')?.value || '';
  const status = cById('asCourseStatusFilter')?.value || 'ALL';
  const tbody = cById('asCoursesTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="co-admin-table-empty">Loading courses...</td></tr>';

  try {
    const res = await fetch(`/api/admin/academic-structure/courses?universityId=${uniId}&search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch courses');

    asCurrentCourses = data.courses || [];
    if (asCurrentCourses.length === 0) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="co-admin-table-empty">No courses found.</td></tr>';
      return;
    }

    if (tbody) {
      tbody.innerHTML = asCurrentCourses.map(c => `
        <tr>
          <td><strong>${escapeHtml(c.university_name)}</strong></td>
          <td><code style="background:#e2e8f0; padding:2px 6px; border-radius:4px; font-weight:700;">${escapeHtml(c.code)}</code></td>
          <td><div style="font-weight:700;">${escapeHtml(c.name)}</div></td>
          <td>${escapeHtml(c.degree_type || '-')} (${c.duration_years || 4} Years)</td>
          <td>${asStatusBadge(c.status)}</td>
          <td><strong>${c.batches_count || 0}</strong></td>
          <td><strong>${c.students_count || 0}</strong></td>
          <td style="text-align:right;">
            <div class="control-actions" style="justify-content:flex-end;">
              <button class="btn secondary btn-sm" onclick="openEditAsCourseModal(${c.id})"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
              <button class="btn danger btn-sm" onclick="deleteAsCourse(${c.id})"><i class="fa-solid fa-trash-can"></i> Delete</button>
            </div>
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr class="error"><td colspan="8">${escapeHtml(err.message)}</td></tr>`;
  }
}

function openAddAsCourseModal() {
  cById('asCourseModalTitle').textContent = 'Add Course';
  cById('asCourseId').value = '';
  cById('asCourseUniSelect').value = cById('asCourseUniFilter')?.value || '';
  cById('asCourseCode').value = '';
  cById('asCourseDegreeType').value = 'B.Tech';
  cById('asCourseName').value = '';
  cById('asCourseDuration').value = '4';
  cById('asCourseStatus').value = 'ACTIVE';
  cById('asCourseDisplayOrder').value = '0';
  cById('asCourseModal').style.display = 'flex';
}

function openEditAsCourseModal(courseId) {
  const course = asCurrentCourses.find(c => c.id === courseId);
  if (!course) return;
  cById('asCourseModalTitle').textContent = 'Edit Course';
  cById('asCourseId').value = course.id;
  cById('asCourseUniSelect').value = course.university_id;
  cById('asCourseCode').value = course.code || '';
  cById('asCourseDegreeType').value = course.degree_type || '';
  cById('asCourseName').value = course.name || '';
  cById('asCourseDuration').value = course.duration_years || 4;
  cById('asCourseStatus').value = course.status || 'ACTIVE';
  cById('asCourseDisplayOrder').value = course.display_order || 0;
  cById('asCourseModal').style.display = 'flex';
}

async function deleteAsCourse(courseId) {
  const course = asCurrentCourses.find(c => c.id === courseId);
  if (!course) return;

  if (!window.confirm(`Delete or archive Course "${course.name}"?`)) return;

  try {
    const res = await fetch(`/api/admin/academic-structure/courses/${courseId}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete course');

    window.alert(data.message || 'Course deleted successfully');
    await loadAsCourses();
    await loadAcademicStructureOverview();
  } catch (err) {
    window.alert(err.message || 'Failed to delete course');
  }
}

async function loadAsBatches() {
  const uniId = cById('asBatchUniFilter')?.value || '';
  const courseId = cById('asBatchCourseFilter')?.value || '';
  const search = cById('asBatchSearchInput')?.value || '';
  const status = cById('asBatchStatusFilter')?.value || 'ALL';
  const tbody = cById('asBatchesTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="co-admin-table-empty">Loading batches...</td></tr>';

  try {
    const res = await fetch(`/api/admin/academic-structure/batches?universityId=${uniId}&courseId=${courseId}&search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch batches');

    asCurrentBatches = data.batches || [];
    if (asCurrentBatches.length === 0) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="co-admin-table-empty">No batches found.</td></tr>';
      return;
    }

    if (tbody) {
      tbody.innerHTML = asCurrentBatches.map(b => `
        <tr>
          <td><strong style="color:#0369a1; font-weight:700;">${escapeHtml(b.name)}</strong></td>
          <td>${escapeHtml(b.university_name)}</td>
          <td>${escapeHtml(b.course_name)}</td>
          <td>${b.start_year}${b.end_year ? ' - ' + b.end_year : ''}</td>
          <td>${asStatusBadge(b.status)}</td>
          <td><strong>${b.students_count || 0}</strong></td>
          <td style="text-align:right;">
            <div class="control-actions" style="justify-content:flex-end;">
              <button class="btn secondary btn-sm" onclick="openEditAsBatchModal(${b.id})"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
              <button class="btn danger btn-sm" onclick="deleteAsBatch(${b.id})"><i class="fa-solid fa-trash-can"></i> Delete</button>
            </div>
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr class="error"><td colspan="7">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function loadAsCoursesForUniversity(uniId, targetSelectId, selectedCourseId = '') {
  const select = cById(targetSelectId);
  if (!select) return;
  if (!uniId) {
    select.innerHTML = '<option value="">Select University First</option>';
    select.disabled = true;
    return;
  }

  select.disabled = true;
  select.innerHTML = '<option value="">Loading courses...</option>';

  try {
    const res = await fetch(`/api/student/academic-options/courses?universityId=${uniId}`, { credentials: 'include' });
    const data = await res.json();
    const courses = data.courses || [];
    if (courses.length === 0) {
      select.innerHTML = '<option value="">No courses available</option>';
    } else {
      select.innerHTML = '<option value="">Select Course...</option>' + courses.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.code)})</option>`).join('');
      select.disabled = false;
      if (selectedCourseId) select.value = selectedCourseId;
    }
  } catch (err) {
    select.innerHTML = '<option value="">Failed to load courses</option>';
  }
}

async function loadAsBatchesForCourse(uniId, courseId, targetSelectId, selectedBatchId = '') {
  const select = cById(targetSelectId);
  if (!select) return;
  if (!uniId || !courseId) {
    select.innerHTML = '<option value="">Select Course First</option>';
    select.disabled = true;
    return;
  }

  select.disabled = true;
  select.innerHTML = '<option value="">Loading batches...</option>';

  try {
    const res = await fetch(`/api/student/academic-options/batches?universityId=${uniId}&courseId=${courseId}`, { credentials: 'include' });
    const data = await res.json();
    const batches = data.batches || [];
    if (batches.length === 0) {
      select.innerHTML = '<option value="">No batches available</option>';
    } else {
      select.innerHTML = '<option value="">Select Batch...</option>' + batches.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
      select.disabled = false;
      if (selectedBatchId) select.value = selectedBatchId;
    }
  } catch (err) {
    select.innerHTML = '<option value="">Failed to load batches</option>';
  }
}

function openAddAsBatchModal() {
  cById('asBatchModalTitle').textContent = 'Add Batch';
  cById('asBatchId').value = '';
  cById('asBatchUniSelect').value = cById('asBatchUniFilter')?.value || '';
  cById('asBatchCourseSelect').innerHTML = '<option value="">Select University First</option>';
  cById('asBatchCourseSelect').disabled = true;
  cById('asBatchName').value = '2026-2030';
  cById('asBatchStartYear').value = '2026';
  cById('asBatchEndYear').value = '2030';
  cById('asBatchStatus').value = 'ACTIVE';
  cById('asBatchDisplayOrder').value = '0';

  if (cById('asBatchUniSelect').value) {
    loadAsCoursesForUniversity(cById('asBatchUniSelect').value, 'asBatchCourseSelect');
  }

  cById('asBatchModal').style.display = 'flex';
}

function openEditAsBatchModal(batchId) {
  const batch = asCurrentBatches.find(b => b.id === batchId);
  if (!batch) return;
  cById('asBatchModalTitle').textContent = 'Edit Batch';
  cById('asBatchId').value = batch.id;
  cById('asBatchUniSelect').value = batch.university_id;
  loadAsCoursesForUniversity(batch.university_id, 'asBatchCourseSelect', batch.course_id);
  cById('asBatchName').value = batch.name || '';
  cById('asBatchStartYear').value = batch.start_year || 2026;
  cById('asBatchEndYear').value = batch.end_year || 2030;
  cById('asBatchStatus').value = batch.status || 'ACTIVE';
  cById('asBatchDisplayOrder').value = batch.display_order || 0;
  cById('asBatchModal').style.display = 'flex';
}

async function deleteAsBatch(batchId) {
  const batch = asCurrentBatches.find(b => b.id === batchId);
  if (!batch) return;

  if (!window.confirm(`Delete or archive Batch "${batch.name}"?`)) return;

  try {
    const res = await fetch(`/api/admin/academic-structure/batches/${batchId}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete batch');

    window.alert(data.message || 'Batch deleted successfully');
    await loadAsBatches();
    await loadAcademicStructureOverview();
  } catch (err) {
    window.alert(err.message || 'Failed to delete batch');
  }
}

async function loadAsStudentAssignments(page = 1) {
  asAssignCurrentPage = page;
  const search = cById('asAssignSearchInput')?.value || '';
  const profileStatus = cById('asAssignStatusFilter')?.value || 'all';
  const uniId = cById('asAssignUniFilter')?.value || '';
  const courseId = cById('asAssignCourseFilter')?.value || '';

  const tbody = cById('asAssignmentsTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="co-admin-table-empty">Loading student assignments...</td></tr>';

  try {
    const res = await fetch(`/api/admin/academic-structure/student-assignments?page=${page}&limit=20&search=${encodeURIComponent(search)}&profileStatus=${profileStatus}&universityId=${uniId}&courseId=${courseId}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch student assignments');

    const students = data.students || [];
    const pagination = data.pagination || { page: 1, totalPages: 1, total: 0 };

    if (students.length === 0) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="co-admin-table-empty">No student assignments found matching filters.</td></tr>';
      return;
    }

    if (tbody) {
      tbody.innerHTML = students.map(s => {
        const isComplete = s.isComplete;
        const prof = s.academicProfile;
        return `
          <tr>
            <td>
              <div style="font-weight:700;">${escapeHtml(s.fullName || 'Student #' + s.studentId)}</div>
              <div style="font-size:0.75rem; color:#64748b;">${escapeHtml(s.email)}</div>
            </td>
            <td>
              ${isComplete 
                ? '<span class="status-badge ok"><i class="fa-solid fa-circle-check"></i> Complete</span>'
                : '<span class="status-badge warn"><i class="fa-solid fa-clock"></i> Incomplete</span>'}
            </td>
            <td>${prof ? escapeHtml(prof.universityName) : '<span style="color:#94a3b8;">Not set</span>'}</td>
            <td>${prof ? escapeHtml(prof.courseName) : '<span style="color:#94a3b8;">Not set</span>'}</td>
            <td>${prof ? `<span style="background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-weight:600;">${escapeHtml(prof.batchName)}</span>` : '<span style="color:#94a3b8;">Not set</span>'}</td>
            <td>${s.profileCompletedAt ? new Date(s.profileCompletedAt).toLocaleDateString('en-IN') : '-'}</td>
            <td style="text-align:right;">
              <button class="btn primary btn-sm" onclick='openReassignStudentModal(${JSON.stringify(s).replace(/'/g, "&#39;")})'><i class="fa-solid fa-user-pen"></i> Reassign</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Pagination info
    if (cById('asAssignPaginationInfo')) {
      cById('asAssignPaginationInfo').textContent = `Showing ${students.length} of ${pagination.total} students (Page ${pagination.page} of ${pagination.totalPages})`;
    }
    if (cById('asAssignPageIndicator')) {
      cById('asAssignPageIndicator').textContent = `Page ${pagination.page}`;
    }
    if (cById('asAssignPrevPageBtn')) {
      cById('asAssignPrevPageBtn').disabled = pagination.page <= 1;
      cById('asAssignPrevPageBtn').onclick = () => loadAsStudentAssignments(pagination.page - 1);
    }
    if (cById('asAssignNextPageBtn')) {
      cById('asAssignNextPageBtn').disabled = pagination.page >= pagination.totalPages;
      cById('asAssignNextPageBtn').onclick = () => loadAsStudentAssignments(pagination.page + 1);
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr class="error"><td colspan="7">${escapeHtml(err.message)}</td></tr>`;
  }
}

function openReassignStudentModal(student) {
  cById('reassignStudentId').value = student.studentId;
  cById('reassignStudentNameEmail').textContent = `${student.fullName} (${student.email})`;

  const prof = student.academicProfile;
  if (prof) {
    cById('reassignCurrentScope').textContent = `${prof.universityName} • ${prof.courseName} • ${prof.batchName}`;
    cById('reassignCurrentScope').style.color = '#047857';
  } else {
    cById('reassignCurrentScope').textContent = 'Not configured (Incomplete profile)';
    cById('reassignCurrentScope').style.color = '#d97706';
  }

  cById('reassignReasonInput').value = '';
  cById('reassignCourseSelect').innerHTML = '<option value="">Select University First</option>';
  cById('reassignCourseSelect').disabled = true;
  cById('reassignBatchSelect').innerHTML = '<option value="">Select Course First</option>';
  cById('reassignBatchSelect').disabled = true;

  // Preselect if existing
  if (prof && prof.universityId) {
    cById('reassignUniversitySelect').value = prof.universityId;
    loadAsCoursesForUniversity(prof.universityId, 'reassignCourseSelect', prof.courseId).then(() => {
      if (prof.courseId) {
        loadAsBatchesForCourse(prof.universityId, prof.courseId, 'reassignBatchSelect', prof.batchId);
      }
    });
  } else {
    cById('reassignUniversitySelect').value = '';
  }

  cById('studentReassignModal').style.display = 'flex';
}

function bindAcademicStructureEvents() {
  // Add University Modal Open / Close / Submit
  const openAddUniBtn = cById('openAddUniModalBtn');
  if (openAddUniBtn) openAddUniBtn.onclick = openAddAsUniModal;

  const closeUniBtn = cById('closeAsUniModalBtn');
  if (closeUniBtn) closeUniBtn.onclick = () => cById('asUniModal').style.display = 'none';

  const uniForm = cById('asUniForm');
  if (uniForm) {
    uniForm.onsubmit = async (e) => {
      e.preventDefault();
      const uniId = cById('asUniId').value;
      const body = {
        code: cById('asUniCode').value.trim(),
        shortName: cById('asUniShortName').value.trim(),
        name: cById('asUniName').value.trim(),
        status: cById('asUniStatus').value,
        displayOrder: parseInt(cById('asUniDisplayOrder').value || '0', 10),
        priorityRank: parseInt(cById('asUniPriorityRank').value || '1', 10)
      };

      try {
        const url = uniId ? `/api/admin/academic-structure/universities/${uniId}` : '/api/admin/academic-structure/universities';
        const method = uniId ? 'PUT' : 'POST';
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          credentials: 'include'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save university');

        window.alert(data.message || 'University saved successfully');
        cById('asUniModal').style.display = 'none';
        await loadAsUniversities();
        await loadAcademicStructureOverview();
      } catch (err) {
        window.alert(err.message || 'Failed to save university');
      }
    };
  }

  // Add Course Modal Open / Close / Submit & Dependent Selectors
  const openAddCourseBtn = cById('openAddCourseModalBtn');
  if (openAddCourseBtn) openAddCourseBtn.onclick = openAddAsCourseModal;

  const closeCourseBtn = cById('closeAsCourseModalBtn');
  if (closeCourseBtn) closeCourseBtn.onclick = () => cById('asCourseModal').style.display = 'none';

  const courseForm = cById('asCourseForm');
  if (courseForm) {
    courseForm.onsubmit = async (e) => {
      e.preventDefault();
      const courseId = cById('asCourseId').value;
      const body = {
        universityId: parseInt(cById('asCourseUniSelect').value, 10),
        code: cById('asCourseCode').value.trim(),
        degreeType: cById('asCourseDegreeType').value.trim(),
        name: cById('asCourseName').value.trim(),
        durationYears: parseInt(cById('asCourseDuration').value || '4', 10),
        status: cById('asCourseStatus').value,
        displayOrder: parseInt(cById('asCourseDisplayOrder').value || '0', 10)
      };

      try {
        const url = courseId ? `/api/admin/academic-structure/courses/${courseId}` : '/api/admin/academic-structure/courses';
        const method = courseId ? 'PUT' : 'POST';
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          credentials: 'include'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save course');

        window.alert(data.message || 'Course saved successfully');
        cById('asCourseModal').style.display = 'none';
        await loadAsCourses();
        await loadAcademicStructureOverview();
      } catch (err) {
        window.alert(err.message || 'Failed to save course');
      }
    };
  }

  // Add Batch Modal Open / Close / Submit & Dependent Selectors
  const openAddBatchBtn = cById('openAddBatchModalBtn');
  if (openAddBatchBtn) openAddBatchBtn.onclick = openAddAsBatchModal;

  const closeBatchBtn = cById('closeAsBatchModalBtn');
  if (closeBatchBtn) closeBatchBtn.onclick = () => cById('asBatchModal').style.display = 'none';

  const batchUniSelect = cById('asBatchUniSelect');
  if (batchUniSelect) {
    batchUniSelect.onchange = () => {
      loadAsCoursesForUniversity(batchUniSelect.value, 'asBatchCourseSelect');
    };
  }

  const batchForm = cById('asBatchForm');
  if (batchForm) {
    batchForm.onsubmit = async (e) => {
      e.preventDefault();
      const batchId = cById('asBatchId').value;
      const body = {
        universityId: parseInt(cById('asBatchUniSelect').value, 10),
        courseId: parseInt(cById('asBatchCourseSelect').value, 10),
        name: cById('asBatchName').value.trim(),
        startYear: parseInt(cById('asBatchStartYear').value || '2026', 10),
        endYear: parseInt(cById('asBatchEndYear').value || '2030', 10),
        status: cById('asBatchStatus').value,
        displayOrder: parseInt(cById('asBatchDisplayOrder').value || '0', 10)
      };

      try {
        const url = batchId ? `/api/admin/academic-structure/batches/${batchId}` : '/api/admin/academic-structure/batches';
        const method = batchId ? 'PUT' : 'POST';
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          credentials: 'include'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save batch');

        window.alert(data.message || 'Batch saved successfully');
        cById('asBatchModal').style.display = 'none';
        await loadAsBatches();
        await loadAcademicStructureOverview();
      } catch (err) {
        window.alert(err.message || 'Failed to save batch');
      }
    };
  }

  // Reassign Modal Selectors & Form Submit
  const reassignUniSelect = cById('reassignUniversitySelect');
  if (reassignUniSelect) {
    reassignUniSelect.onchange = () => {
      loadAsCoursesForUniversity(reassignUniSelect.value, 'reassignCourseSelect');
      cById('reassignBatchSelect').innerHTML = '<option value="">Select Course First</option>';
      cById('reassignBatchSelect').disabled = true;
    };
  }

  const reassignCourseSelect = cById('reassignCourseSelect');
  if (reassignCourseSelect) {
    reassignCourseSelect.onchange = () => {
      loadAsBatchesForCourse(reassignUniSelect.value, reassignCourseSelect.value, 'reassignBatchSelect');
    };
  }

  const closeReassignBtn = cById('closeReassignModalBtn');
  if (closeReassignBtn) {
    closeReassignBtn.onclick = () => cById('studentReassignModal').style.display = 'none';
  }

  const reassignForm = cById('reassignStudentForm');
  if (reassignForm) {
    reassignForm.onsubmit = async (e) => {
      e.preventDefault();
      const studentId = parseInt(cById('reassignStudentId').value, 10);
      const universityId = parseInt(cById('reassignUniversitySelect').value, 10);
      const courseId = parseInt(cById('reassignCourseSelect').value, 10);
      const batchId = parseInt(cById('reassignBatchSelect').value, 10);
      const reason = cById('reassignReasonInput').value.trim();

      if (!studentId || !universityId || !courseId || !batchId || !reason) {
        window.alert('All fields including University, Course, Batch, and Reason are required.');
        return;
      }

      if (!window.confirm('Confirm reassigning student academic profile? This will change their resource scope.')) return;

      try {
        const res = await fetch('/api/admin/academic-structure/reassign-student', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId, universityId, courseId, batchId, reason }),
          credentials: 'include'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to reassign student profile');

        window.alert(data.message || 'Student academic profile reassigned successfully!');
        cById('studentReassignModal').style.display = 'none';
        await loadAsStudentAssignments(asAssignCurrentPage);
        await loadAcademicStructureOverview();
      } catch (err) {
        window.alert(err.message || 'Failed to reassign student academic profile');
      }
    };
  }

  // Filter Event Listeners
  if (cById('asUniSearchInput')) cById('asUniSearchInput').oninput = loadAsUniversities;
  if (cById('asUniStatusFilter')) cById('asUniStatusFilter').onchange = loadAsUniversities;

  if (cById('asCourseUniFilter')) cById('asCourseUniFilter').onchange = loadAsCourses;
  if (cById('asCourseSearchInput')) cById('asCourseSearchInput').oninput = loadAsCourses;
  if (cById('asCourseStatusFilter')) cById('asCourseStatusFilter').onchange = loadAsCourses;

  if (cById('asBatchUniFilter')) {
    cById('asBatchUniFilter').onchange = () => {
      loadAsCoursesForUniversity(cById('asBatchUniFilter').value, 'asBatchCourseFilter').then(() => {
        loadAsBatches();
      });
    };
  }
  if (cById('asBatchCourseFilter')) cById('asBatchCourseFilter').onchange = loadAsBatches;
  if (cById('asBatchSearchInput')) cById('asBatchSearchInput').oninput = loadAsBatches;
  if (cById('asBatchStatusFilter')) cById('asBatchStatusFilter').onchange = loadAsBatches;

  if (cById('asAssignSearchInput')) cById('asAssignSearchInput').oninput = () => loadAsStudentAssignments(1);
  if (cById('asAssignStatusFilter')) cById('asAssignStatusFilter').onchange = () => loadAsStudentAssignments(1);
  if (cById('asAssignUniFilter')) {
    cById('asAssignUniFilter').onchange = () => {
      loadAsCoursesForUniversity(cById('asAssignUniFilter').value, 'asAssignCourseFilter').then(() => {
        loadAsStudentAssignments(1);
      });
    };
  }
  if (cById('asAssignCourseFilter')) cById('asAssignCourseFilter').onchange = () => loadAsStudentAssignments(1);
  if (cById('asAssignResetBtn')) {
    cById('asAssignResetBtn').onclick = () => {
      cById('asAssignSearchInput').value = '';
      cById('asAssignStatusFilter').value = 'all';
      cById('asAssignUniFilter').value = '';
      cById('asAssignCourseFilter').value = '';
      cById('asAssignCourseFilter').disabled = true;
      loadAsStudentAssignments(1);
    };
  }

  const overviewRefreshBtn = cById('loadAcademicStructureOverviewBtn');
  if (overviewRefreshBtn) {
    overviewRefreshBtn.onclick = loadAcademicStructureOverview;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await ensureAdminSession();
  bindEvents();
  bindMembershipEvents();
  bindPaymentTabEvents();
  bindAcademicStructureEvents();
  bindLiveSessionRealtime();

  const quickSelect = cById('quickModuleSelect');
  if (quickSelect) {
    quickSelect.addEventListener('change', () => {
      window.location.hash = quickSelect.value;
    });
  }

  window.addEventListener('hashchange', () => {
    activateAdminRoute(window.location.href);
  });

  await activateAdminRoute(window.location.href);
});
