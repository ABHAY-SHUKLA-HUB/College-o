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

      ['live_session_changed', 'live_session_created', 'live_session_started', 'live_session_ended', 'live_session_joined', 'live_session_left', 'live_session_cancelled', 'live_session_rescheduled']
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

async function ensureAdminSession() {
  try {
    const perm = await window.CollegeOSApi.adminControlPermissions();
    cById('controlPermissionInfo').textContent = `Signed in as ${perm.role}. Permissions: ${perm.permissions.join(', ')}`;
  } catch (_error) {
    window.location.href = 'admin-login.html';
  }
}

function bindTabs() {
  const activatePanel = (panelId) => {
    if (!panelId || !cById(panelId)) return;
    document.querySelectorAll('.control-tab').forEach((node) => {
      if (node.dataset.panel === panelId) node.classList.add('active');
      else node.classList.remove('active');
    });
    document.querySelectorAll('.control-panel').forEach((panel) => panel.classList.remove('active'));
    cById(panelId).classList.add('active');
  };

  document.querySelectorAll('.control-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      activatePanel(tab.dataset.panel);
    });
  });

  if (window.location.hash === '#live-session-control') {
    window.setTimeout(() => {
      activatePanel('panel-live-sessions');
      cById('liveSessionControlBlock')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#live-session-control') {
      activatePanel('panel-live-sessions');
      cById('liveSessionControlBlock')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

async function loadAnalytics() {
  const kpiNode = cById('analyticsKpis');
  const branchNode = cById('analyticsBranchTable');
  const data = await window.CollegeOSApi.adminControlAnalytics();

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

  kpiNode.innerHTML = kpis.map((item) => `
    <div class="kpi-card">
      <div class="kpi-label">${item[0]}</div>
      <div class="kpi-value">${item[1]}</div>
    </div>
  `).join('');

  const rows = data.branchWise || [];
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

async function loadStudents(includeDeleted = false) {
  const tbody = cById('studentsTableBody');
  const payload = await window.CollegeOSApi.adminControlStudents({
    search: cById('studentSearchInput').value,
    membership: cById('studentMembershipFilter').value,
    status: cById('studentStatusFilter').value,
    includeDeleted
  });

  const rows = payload.students || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="co-admin-table-empty">No students found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((student) => `
    <tr>
      <td><input class="student-row-checkbox" type="checkbox" value="${student.id}" /></td>
      <td>
        <strong>${student.full_name}</strong>
        <div class="muted">${student.email}</div>
      </td>
      <td class="mono">${student.uid || '-'}</td>
      <td>${student.branch_name || '-'}</td>
      <td>${asStatusBadge(student.subscription_tier)}</td>
      <td>${student.deleted_at ? asStatusBadge('deleted') : (student.is_blocked ? asStatusBadge('blocked') : (student.is_suspended ? asStatusBadge('suspended') : asStatusBadge('active')))}</td>
      <td>
        <div class="control-actions">
          <button class="btn secondary sm" data-action="view" data-id="${student.id}">View</button>
          <button class="btn secondary sm" data-action="reset" data-id="${student.id}">Reset Password</button>
          <button class="btn secondary sm" data-action="activate" data-id="${student.id}">Activate</button>
          <button class="btn warn sm" data-action="suspend" data-id="${student.id}">Suspend</button>
          <button class="btn warn sm" data-action="block" data-id="${student.id}">Block</button>
          <button class="btn danger sm" data-action="delete" data-id="${student.id}">Delete</button>
          <button class="btn primary sm" data-action="restore" data-id="${student.id}">Restore</button>
          <button class="btn primary sm" data-action="premium" data-id="${student.id}">Premium</button>
          <button class="btn secondary sm" data-action="free" data-id="${student.id}">Free</button>
        </div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('button[data-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.action;
      const id = Number(button.dataset.id);
      try {
        if (action === 'view') {
          const detail = await window.CollegeOSApi.adminControlStudentDetail(id);
          window.alert(JSON.stringify(detail, null, 2));
        } else if (action === 'reset') {
          const newPassword = window.prompt('Enter new password (min 6 chars):', 'Student@123');
          if (!newPassword) return;
          await window.CollegeOSApi.adminControlResetStudentPassword(id, newPassword);
          window.alert('Password reset successful.');
        } else if (action === 'activate' || action === 'suspend' || action === 'block') {
          await window.CollegeOSApi.adminControlStudentStatus(id, action);
        } else if (action === 'delete') {
          if (!window.confirm('Soft delete this student?')) return;
          await window.CollegeOSApi.adminControlDeleteStudent(id);
        } else if (action === 'restore') {
          await window.CollegeOSApi.adminControlRestoreStudent(id);
        } else if (action === 'premium') {
          await window.CollegeOSApi.adminControlStudentMembership(id, { tier: 'premium', paymentStatus: 'approved' });
        } else if (action === 'free') {
          await window.CollegeOSApi.adminControlStudentMembership(id, { tier: 'free', paymentStatus: 'expired' });
        }
        await loadStudents(includeDeleted);
      } catch (error) {
        window.alert(error.message);
      }
    });
  });
}

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

async function loadPayments() {
  const status = cById('paymentStatusFilter').value;
  const paymentsResp = await window.CollegeOSApi.adminMembershipPayments(status);
  const summaryResp = await window.CollegeOSApi.adminControlRevenueSummary();

  const summary = cById('paymentSummaryKpis');
  summary.innerHTML = [
    ['Monthly Revenue', `Rs.${Number(summaryResp.monthlyRevenue || 0).toLocaleString('en-IN')}`],
    ['Lifetime Revenue', `Rs.${Number(summaryResp.lifetimeRevenue || 0).toLocaleString('en-IN')}`],
    ['Pending Approvals', summaryResp.pendingApprovals || 0],
    ['Active Memberships', summaryResp.activeMemberships || 0],
    ['Expired Memberships', summaryResp.expiredMemberships || 0]
  ].map((item) => `<div class="kpi-card"><div class="kpi-label">${item[0]}</div><div class="kpi-value">${item[1]}</div></div>`).join('');

  const rows = paymentsResp.payments || [];
  const tbody = cById('paymentsTableBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="co-admin-table-empty">No payment requests found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((payment) => `
    <tr>
      <td class="mono">${payment.id}</td>
      <td>${payment.full_name}<div class="muted">${payment.email}</div></td>
      <td class="mono">${payment.transaction_id}</td>
      <td>${asStatusBadge(payment.status)}</td>
      <td>${payment.screenshot_url ? `<a class="btn secondary sm" href="${payment.screenshot_url}" target="_blank" rel="noreferrer">View</a>` : '-'}</td>
      <td>${payment.submitted_at ? new Date(payment.submitted_at).toLocaleDateString('en-IN') : '-'}</td>
      <td>
        <div class="control-actions">
          <button class="btn primary sm" data-pay-action="approve" data-payment-id="${payment.id}">Approve</button>
          <button class="btn warn sm" data-pay-action="reject" data-payment-id="${payment.id}">Reject</button>
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
  cById('expAuthStatValue').value = config.auth?.branding?.stats?.value || '10k+';
  cById('expAuthStatLabel').value = config.auth?.branding?.stats?.label || 'active learners';

  cById('expAuthLoginTitle').value = config.auth?.text?.loginTitle || 'Welcome back';
  cById('expAuthLoginDescription').value = config.auth?.text?.loginDescription || 'Sign in to continue with your personalized learning workspace.';
  cById('expAuthSignupTitle').value = config.auth?.text?.signupTitle || 'Create your account';
  cById('expAuthSignupDescription').value = config.auth?.text?.signupDescription || 'Set up your profile in a few steps to unlock a branch-aware dashboard.';
  cById('expAuthBrandName').value = config.auth?.text?.brandName || 'College OS';
  cById('expAuthBrandSubtext').value = config.auth?.text?.brandSubtext || 'Student Workspace';
  cById('expAuthSupportLinkLabel').value = config.auth?.text?.supportLinkLabel || 'Need help? Contact support';
  cById('expAuthFooterConsentText').value = config.auth?.text?.footerConsentText || 'By continuing, you agree to';

  cById('expAuthSupportEmail').value = config.auth?.support?.email || 'support@collegeos.in';
  cById('expAuthSupportWhatsapp').value = config.auth?.support?.whatsapp || '+919000000000';
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
  const [payload, liveSessions] = await Promise.all([
    window.CollegeOSApi.adminControlExperienceConfig(),
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

  window.alert('Live operations saved successfully.');
  await loadLiveSessionControl();
}

async function loadAuditLogs() {
  const limit = Number(cById('auditLimitInput').value || 100);
  const data = await window.CollegeOSApi.adminControlAuditLogs(limit);
  const rows = data.logs || [];
  const tbody = cById('auditTableBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="co-admin-table-empty">No audit logs found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((log) => `
    <tr>
      <td>${new Date(log.created_at).toLocaleString('en-IN')}</td>
      <td>${log.actor_name || '-'}</td>
      <td>${log.actor_role || '-'}</td>
      <td>${log.action}</td>
      <td>${log.target_type || '-'}:${log.target_id || '-'}</td>
      <td class="mono">${JSON.stringify(log.metadata || {})}</td>
    </tr>
  `).join('');
}

function bindEvents() {
  cById('refreshAnalyticsBtn').addEventListener('click', () => loadAnalytics().catch((e) => window.alert(e.message)));

  cById('loadStudentsBtn').addEventListener('click', () => loadStudents(false).catch((e) => window.alert(e.message)));
  cById('showDeletedStudentsBtn').addEventListener('click', () => loadStudents(true).catch((e) => window.alert(e.message)));
  cById('bulkStudentsBtn').addEventListener('click', () => runBulkStudents().catch((e) => window.alert(e.message)));
  cById('studentsSelectAll').addEventListener('change', (event) => {
    document.querySelectorAll('.student-row-checkbox').forEach((node) => {
      node.checked = event.target.checked;
    });
  });

  cById('loadPaymentsBtn').addEventListener('click', () => loadPayments().catch((e) => window.alert(e.message)));
  cById('bulkPaymentsBtn').addEventListener('click', () => runBulkPayments().catch((e) => window.alert(e.message)));
  cById('expireMembershipsBtn').addEventListener('click', async () => {
    await window.CollegeOSApi.adminControlDeactivateExpired();
    await loadPayments();
  });

  cById('runContentBulkBtn').addEventListener('click', () => runContentBulkAction().catch((e) => window.alert(e.message)));

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

  cById('createMockBtn').addEventListener('click', () => createMockTest().catch((e) => window.alert(e.message)));
  cById('loadMockBtn').addEventListener('click', () => loadMockTests().catch((e) => window.alert(e.message)));

  cById('createRoadmapBtn').addEventListener('click', () => createRoadmap().catch((e) => window.alert(e.message)));
  cById('loadRoadmapsBtn').addEventListener('click', () => loadRoadmaps().catch((e) => window.alert(e.message)));

  cById('sendNotificationBtn').addEventListener('click', () => sendNotification(false).catch((e) => window.alert(e.message)));
  cById('sendReminderBtn').addEventListener('click', () => sendNotification(true).catch((e) => window.alert(e.message)));
  cById('createAnnouncementBtn').addEventListener('click', () => createAnnouncement().catch((e) => window.alert(e.message)));
  cById('loadAnnouncementsBtn').addEventListener('click', () => loadAnnouncements().catch((e) => window.alert(e.message)));

  cById('loadForumBtn').addEventListener('click', () => loadForumPosts().catch((e) => window.alert(e.message)));
  cById('loadFeedbackBtn').addEventListener('click', () => loadFeedback().catch((e) => window.alert(e.message)));

  cById('assignRewardBtn').addEventListener('click', () => assignReferralReward().catch((e) => window.alert(e.message)));
  cById('loadReferralHistoryBtn').addEventListener('click', () => loadReferralHistory().catch((e) => window.alert(e.message)));
  cById('loadTopReferrersBtn').addEventListener('click', () => loadTopReferrers().catch((e) => window.alert(e.message)));

  cById('assignRoleBtn').addEventListener('click', () => assignRole().catch((e) => window.alert(e.message)));
  cById('updatePermissionsBtn').addEventListener('click', () => updateRolePermissions().catch((e) => window.alert(e.message)));
  cById('loadRolesBtn').addEventListener('click', () => loadRoles().catch((e) => window.alert(e.message)));

  cById('saveSettingsBtn').addEventListener('click', () => saveSettings().catch((e) => window.alert(e.message)));
  cById('loadSettingsBtn').addEventListener('click', () => loadSettings().catch((e) => window.alert(e.message)));
  cById('saveContributionVisibilityBtn')?.addEventListener('click', () => saveContributionVisibilitySettings().catch((e) => window.alert(e.message)));
  cById('loadContributionVisibilityBtn')?.addEventListener('click', () => loadContributionVisibilitySettings().catch((e) => window.alert(e.message)));
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

  cById('loadAuditBtn').addEventListener('click', () => loadAuditLogs().catch((e) => window.alert(e.message)));
}

document.addEventListener('DOMContentLoaded', async () => {
  bindTabs();
  await ensureAdminSession();
  bindEvents();
  bindLiveSessionRealtime();

  const bootstrapJobs = [
    ['analytics', () => loadAnalytics()],
    ['students', () => loadStudents(false)],
    ['payments', () => loadPayments()],
    ['content overview', () => loadContentOverview()],
    ['branches', () => loadBranches()],
    ['universities', () => loadUniversities()],
    ['onboarding config', () => loadOnboardingConfig()],
    ['recommendation rules', () => loadRecommendationRules()],
    ['mock tests', () => loadMockTests()],
    ['roadmaps', () => loadRoadmaps()],
    ['announcements', () => loadAnnouncements()],
    ['referrals', () => loadReferralHistory()],
    ['top referrers', () => loadTopReferrers()],
    ['roles', () => loadRoles()],
    ['settings', () => loadSettings()],
    ['contribution visibility', () => loadContributionVisibilitySettings()],
    ['membership config', () => loadMembershipConfig()],
    ['experience settings', () => loadExperienceConfig()],
    ['live session control', () => loadLiveSessionControl()],
    ['audit logs', () => loadAuditLogs()]
  ];

  const outcomes = await Promise.allSettled(bootstrapJobs.map((job) => job[1]()));
  const failed = outcomes
    .map((result, index) => ({ result, label: bootstrapJobs[index][0] }))
    .filter((item) => item.result.status === 'rejected');

  if (failed.length) {
    const details = failed
      .slice(0, 3)
      .map((item) => `${item.label}: ${item.result.reason?.message || 'request failed'}`)
      .join(' | ');
    cById('controlPermissionInfo').textContent += ` | Some modules failed to load. ${details}`;
  }
});
