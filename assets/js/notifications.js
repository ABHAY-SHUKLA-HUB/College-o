document.addEventListener('DOMContentLoaded', () => {
  if (!window.CollegeOSApi) return;

  const byId = (id) => document.getElementById(id);
  const state = { tab: 'all', notifications: [] };

  function toCategory(kind, message) {
    const k = String(kind || '').toLowerCase();
    const m = String(message || '').toLowerCase();
    if (k.includes('roadmap') || m.includes('roadmap')) return 'Roadmap Progress';
    if (k.includes('note') || m.includes('note')) return 'New Notes Uploaded';
    if (k.includes('certificate') || m.includes('certificate')) return 'Certificates Issued';
    if (k.includes('mock') || m.includes('mock')) return 'Mock Test Results';
    if (k.includes('system') || m.includes('security') || m.includes('account')) return 'System Alerts';
    return 'Study Updates';
  }

  function tabGroup(category) {
    if (category === 'Certificates Issued') return 'achievements';
    if (category === 'Study Updates' || category === 'Roadmap Progress' || category === 'New Notes Uploaded' || category === 'Mock Test Results') return 'study';
    if (category === 'System Alerts') return 'system';
    return 'all';
  }

  function iconFor(category) {
    if (category === 'Study Updates') return { icon: 'fa-book-open-reader', bg: '#e4f2ff', color: '#2b66a0' };
    if (category === 'Roadmap Progress') return { icon: 'fa-map-location-dot', bg: '#e8f5ed', color: '#20663a' };
    if (category === 'New Notes Uploaded') return { icon: 'fa-file-circle-plus', bg: '#eef0ff', color: '#4847a5' };
    if (category === 'Certificates Issued') return { icon: 'fa-certificate', bg: '#fff2df', color: '#8d5800' };
    if (category === 'Mock Test Results') return { icon: 'fa-flask', bg: '#ffecef', color: '#9c3151' };
    return { icon: 'fa-triangle-exclamation', bg: '#edf3fb', color: '#375472' };
  }

  function timeAgo(value) {
    const dt = new Date(value);
    const now = new Date();
    const mins = Math.floor((now - dt) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} minutes ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hours ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'Yesterday';
    return dt.toLocaleDateString('en-IN');
  }

  function groupBucket(value) {
    const dt = new Date(value);
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startYesterday = new Date(startToday);
    startYesterday.setDate(startYesterday.getDate() - 1);
    if (dt >= startToday) return 'Today';
    if (dt >= startYesterday) return 'Yesterday';
    return 'Earlier';
  }

  function actionButtons(item) {
    if (item.category === 'Certificates Issued') {
      return '<a class="btn-mini warn" href="certificates.html"><i class="fa-solid fa-eye"></i> View Certificate</a>';
    }
    if (item.category === 'New Notes Uploaded') {
      return '<a class="btn-mini warn" href="notes-library.html"><i class="fa-solid fa-file-lines"></i> Open Notes</a>';
    }
    if (item.category === 'Mock Test Results') {
      return '<a class="btn-mini warn" href="mock-tests.html"><i class="fa-solid fa-flask"></i> Start Mock Test</a>';
    }
    if (item.category === 'Roadmap Progress') {
      return '<a class="btn-mini warn" href="study-roadmap.html"><i class="fa-solid fa-map"></i> Continue Roadmap</a>';
    }
    return '';
  }

  function filterRows() {
    return state.notifications.filter((n) => {
      if (state.tab === 'all') return true;
      if (state.tab === 'unread') return !n.is_read;
      if (state.tab === 'achievements') return tabGroup(n.category) === 'achievements';
      if (state.tab === 'study') return tabGroup(n.category) === 'study';
      if (state.tab === 'system') return tabGroup(n.category) === 'system';
      return true;
    });
  }

  function render() {
    const mount = byId('notificationFeed');
    const rows = filterRows();

    if (!rows.length) {
      mount.innerHTML = '<div class="empty-state"><h3 style="margin:.2rem 0;">No notifications yet</h3><p style="margin:0;">Start quizzes, continue your roadmap, or explore notes to receive activity updates here.</p></div>';
      return;
    }

    const groups = { Today: [], Yesterday: [], Earlier: [] };
    rows.forEach((n) => {
      groups[groupBucket(n.created_at)].push(n);
    });

    mount.innerHTML = ['Today', 'Yesterday', 'Earlier'].map((bucket) => {
      const list = groups[bucket];
      if (!list.length) return '';
      return `
        <section>
          <div class="group-title">${bucket}</div>
          <div class="notif-list">
            ${list.map((n) => {
              const style = iconFor(n.category);
              return `
                <article class="notif-item ${n.is_read ? '' : 'unread'}" data-notif-id="${n.id}">
                  <div class="notif-row">
                    <div class="notif-main">
                      <div class="nicon" style="background:${style.bg};color:${style.color};"><i class="fa-solid ${style.icon}"></i></div>
                      <div>
                        <h4 style="margin:0 0 .2rem;">${n.title}</h4>
                        <p style="margin:0;color:#41586f;">${n.description}</p>
                        <div class="meta"><span>${timeAgo(n.created_at)}</span><span class="pill">${n.category}</span></div>
                        <div class="actions">
                          ${actionButtons(n)}
                          ${n.is_read ? '' : `<button class="btn-mini secondary" data-action="read" data-id="${n.id}"><i class="fa-regular fa-circle-check"></i> Mark as Read</button>`}
                          <button class="btn-mini danger" data-action="delete" data-id="${n.id}"><i class="fa-regular fa-trash-can"></i> Delete</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              `;
            }).join('')}
          </div>
        </section>
      `;
    }).join('');

    mount.querySelectorAll('[data-action="read"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await window.CollegeOSApi.markNotificationRead(Number(btn.dataset.id));
        await load();
      });
    });

    mount.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await window.CollegeOSApi.deleteNotification(Number(btn.dataset.id));
        await load();
      });
    });
  }

  async function load() {
    const payload = await window.CollegeOSApi.getNotifications();
    state.notifications = (payload.notifications || []).map((n) => {
      const category = toCategory(n.kind, n.message);
      return {
        ...n,
        category,
        title: category,
        description: n.message || 'New update available.'
      };
    });
    render();
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('collegeos:notifications-updated'));
    }
  }

  function initRealtime() {
    if (typeof window.EventSource !== 'function') return;
    const streamUrl = typeof window.CollegeOSApi.getNotificationRealtimeStreamUrl === 'function'
      ? window.CollegeOSApi.getNotificationRealtimeStreamUrl()
      : '/api/notifications/stream';

    let source = null;
    try {
      source = new EventSource(streamUrl, { withCredentials: true });
    } catch {
      return;
    }

    source.addEventListener('notification_changed', () => {
      load().catch(() => {});
    });

    window.addEventListener('beforeunload', () => {
      try {
        source.close();
      } catch {
        // no-op
      }
    });
  }

  byId('notificationTabs')?.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.tab = tab.dataset.tab || 'all';
      byId('notificationTabs').querySelectorAll('[data-tab]').forEach((x) => x.classList.remove('active'));
      tab.classList.add('active');
      render();
    });
  });

  byId('markAllReadBtn')?.addEventListener('click', async () => {
    await window.CollegeOSApi.markAllNotificationsRead();
    await load();
  });

  initRealtime();

  load().catch((error) => {
    byId('notificationFeed').innerHTML = `<div class="empty-state">${error.message}</div>`;
  });
});
