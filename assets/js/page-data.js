async function loadLeaderboard() {
  const table = document.getElementById('leaderboardBody');
  const podium = document.getElementById('leaderboardPodium');
  const searchInput = document.getElementById('leaderboardSearchInput');
  const timeFilters = document.getElementById('leaderboardTimeFilters');
  const scopeFilters = document.getElementById('leaderboardScopeFilters');
  if (!table || !window.CollegeOSApi) return;

  const state = {
    timeframe: 'all',
    scope: 'college',
    search: '',
    viewerId: null
  };

  const initials = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'U';
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  };

  const avatarStyle = (name) => {
    const palette = ['#0f7b6c', '#2f6fed', '#8c2ad8', '#da4e3a', '#006e8f', '#7b3f00'];
    const hash = String(name || '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return `background:${palette[hash % palette.length]}`;
  };

  const medalIcon = (rank) => {
    if (rank === 1) return '<i class="fa-solid fa-medal rank-medal" style="color:#c89b1f"></i>';
    if (rank === 2) return '<i class="fa-solid fa-medal rank-medal" style="color:#8293a8"></i>';
    if (rank === 3) return '<i class="fa-solid fa-medal rank-medal" style="color:#b06a3b"></i>';
    return '';
  };

  const renderPodium = (rows) => {
    if (!podium) return;
    const topThree = rows.slice(0, 3);
    if (!topThree.length) {
      podium.innerHTML = '<article class="podium-card"><div class="muted">No leaderboard data.</div></article>';
      return;
    }

    const cell = (row, rank, className) => {
      const medal = rank === 1 ? '<i class="fa-solid fa-trophy" style="color:#c89b1f"></i>' : '<i class="fa-solid fa-medal"></i>';
      return `
        <article class="podium-card ${className}">
          <div class="podium-medal">${medal}</div>
          <div class="avatar" style="${avatarStyle(row.full_name)}">${initials(row.full_name)}</div>
          <h3 style="margin-top:0.4rem;">#${rank} ${row.full_name}</h3>
          <p class="muted" style="margin:0.3rem 0 0.2rem;">${row.college_name || '-'} | ${row.city || '-'}</p>
          <div class="small-pill">XP ${row.xp}</div>
        </article>
      `;
    };

    const first = topThree[0];
    const second = topThree[1];
    const third = topThree[2];

    podium.innerHTML = [
      second ? cell(second, 2, 'second') : '<article class="podium-card second"><div class="muted">#2 pending</div></article>',
      first ? cell(first, 1, 'first') : '<article class="podium-card first"><div class="muted">#1 pending</div></article>',
      third ? cell(third, 3, 'third') : '<article class="podium-card third"><div class="muted">#3 pending</div></article>'
    ].join('');
  };

  const renderTable = (rows) => {
    if (!rows.length) {
      table.innerHTML = '<tr><td colspan="8">No ranking results found.</td></tr>';
      return;
    }

    table.innerHTML = rows
      .map((row, idx) => {
        const rank = idx + 1;
        const isCurrent = state.viewerId && Number(row.id) === Number(state.viewerId);
        return `
          <tr class="${isCurrent ? 'current-user' : ''}">
            <td>${medalIcon(rank)}${rank}</td>
            <td>
              <div class="name-cell">
                <span class="avatar" style="${avatarStyle(row.full_name)}">${initials(row.full_name)}</span>
                <span>${row.full_name}${isCurrent ? ' <span class="small-pill" style="margin-left:0.3rem;">You</span>' : ''}</span>
              </div>
            </td>
            <td>${row.college_name || '-'}</td>
            <td>${row.city || '-'}</td>
            <td><strong>${row.xp || 0}</strong></td>
            <td>${row.study_streak || 0}</td>
            <td>${row.mock_tests_completed || 0}</td>
            <td>${row.certificates_earned || 0}</td>
          </tr>
        `;
      })
      .join('');
  };

  const fetchAndRender = async () => {
    try {
      const { leaderboard, meta } = await window.CollegeOSApi.getLeaderboard({
        scope: state.scope,
        timeframe: state.timeframe,
        search: state.search
      });
      state.viewerId = meta?.viewerUserId || state.viewerId;
      renderPodium(leaderboard || []);
      renderTable(leaderboard || []);
    } catch (error) {
      table.innerHTML = `<tr><td colspan="8">${error.message}</td></tr>`;
      if (podium) {
        podium.innerHTML = `<article class="podium-card"><div class="muted">${error.message}</div></article>`;
      }
    }
  };

  const setActiveChip = (container, attr, value) => {
    if (!container) return;
    container.querySelectorAll('[data-' + attr + ']').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset[attr] === value);
    });
  };

  searchInput?.addEventListener('input', (event) => {
    state.search = event.target.value || '';
    fetchAndRender();
  });

  timeFilters?.querySelectorAll('[data-timeframe]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.timeframe = btn.dataset.timeframe || 'all';
      setActiveChip(timeFilters, 'timeframe', state.timeframe);
      fetchAndRender();
    });
  });

  scopeFilters?.querySelectorAll('[data-scope]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.scope = btn.dataset.scope || 'india';
      setActiveChip(scopeFilters, 'scope', state.scope);
      fetchAndRender();
    });
  });

  try {
    const me = await window.CollegeOSApi.getMe();
    state.viewerId = me?.user?.id || null;
  } catch (error) {
    // Public or unauthenticated context can still load leaderboard.
  }

  fetchAndRender();
}

async function loadReferrals() {
  const code = document.getElementById('refCode');
  if (!code || !window.CollegeOSApi) return;

  // helpers
  const byId = (id) => document.getElementById(id);

  function buildReferralLink(referralCode) {
    const base = `${window.location.origin}/login.html?mode=signup`;
    return referralCode ? `${base}&ref=${encodeURIComponent(referralCode)}` : base;
  }

  function getStatusClass(status) {
    const s = String(status || 'pending').toLowerCase();
    if (s === 'successful') return 'ref-status ref-status-success';
    if (s === 'rewarded') return 'ref-status ref-status-rewarded';
    return 'ref-status ref-status-pending';
  }

  function renderHistory(rows) {
    const list = byId('refHistoryList');
    const empty = byId('refHistoryEmpty');
    if (!list) return;
    if (!rows || rows.length === 0) {
      if (empty) empty.style.display = '';
      list.style.display = 'none';
      return;
    }
    if (empty) empty.style.display = 'none';
    list.style.display = '';
    list.innerHTML = rows.map((row) => {
      const dateText = row.joinedAt
        ? new Date(row.joinedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
        : '—';
      const statusLabel = String(row.status || 'Pending');
      const capitalized = statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1).toLowerCase();
      return `
        <div class="ref-history-row">
          <div class="ref-history-avatar"><i class="fa-solid fa-user"></i></div>
          <div class="ref-history-info">
            <strong>${row.referredUserName || 'Anonymous'}</strong>
            <span class="muted" style="font-size:0.82rem;">Joined ${dateText}</span>
          </div>
          <span class="${getStatusClass(row.status)}">${capitalized}</span>
        </div>`;
    }).join('');
  }

  function renderLeaderboard(rows, myCode) {
    const list = byId('refLeaderboardList');
    const empty = byId('refLeaderboardEmpty');
    if (!list) return;
    if (!rows || rows.length === 0) {
      if (empty) { empty.innerHTML = '<p class="muted" style="text-align:center;font-size:0.88rem;">No referrers yet. Be the first!</p>'; empty.style.display = ''; }
      list.style.display = 'none';
      return;
    }
    if (empty) empty.style.display = 'none';
    list.style.display = '';
    const medals = ['🥇', '🥈', '🥉', '4', '5'];
    list.innerHTML = rows.map((row, i) => `
      <div class="ref-lb-row">
        <div class="ref-lb-rank">${medals[i] || String(row.rank)}</div>
        <div class="ref-lb-name">${row.name}</div>
        <div class="ref-lb-count"><i class="fa-solid fa-users" style="color:#0f7b6c;margin-right:4px;"></i>${row.successfulReferrals}</div>
      </div>`).join('');
  }

  function updateMilestones(count) {
    const milestones = [
      { threshold: 5, badgeId: 'badge5', rowId: 'reward5', msId: 'ms5', label: 'Unlocked!' },
      { threshold: 10, badgeId: 'badge10', rowId: 'reward10', msId: 'ms10', label: 'Unlocked!' },
      { threshold: 25, badgeId: 'badge25', rowId: 'reward25', msId: 'ms25', label: 'Unlocked! 🎉' }
    ];
    milestones.forEach(({ threshold, badgeId, rowId, msId, label }) => {
      const badge = byId(badgeId);
      const row = byId(rowId);
      const ms = byId(msId);
      if (count >= threshold) {
        if (badge) { badge.textContent = label; badge.style.background = '#d4edda'; badge.style.color = '#157f37'; }
        if (row) row.classList.add('ref-reward-unlocked');
        if (ms) ms.classList.add('ref-ms-done');
      }
    });
  }

  function bindShareButtons(referralCode) {
    const link = buildReferralLink(referralCode);
    const msg = encodeURIComponent(`Join College OS using my referral link and unlock study tools: ${link}`);

    const copyBtn = byId('copyRefLink');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard?.writeText(link).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = link; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        });
        const status = byId('copyStatus');
        if (status) { status.style.display = ''; setTimeout(() => { status.style.display = 'none'; }, 3000); }
      });
    }

    const wa = byId('shareWhatsApp');
    if (wa) wa.href = `https://wa.me/?text=${msg}`;

    const tg = byId('shareTelegram');
    if (tg) tg.href = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Join College OS with my referral link!')}`;

    const li = byId('shareLinkedIn');
    if (li) li.href = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`;

    const em = byId('shareEmail');
    if (em) em.href = `mailto:?subject=${encodeURIComponent('Join me on College OS!')}&body=${encodeURIComponent(`Hey! I'm using College OS for exam prep. Join using my referral link and get started: ${link}`)}`;
  }

  try {
    const data = await window.CollegeOSApi.getReferralDashboard();
    const referralCode = data.referralCode || null;
    const successful = data.successfulReferrals || 0;
    const pending = data.pendingReferrals || 0;
    const goal = data.referralGoal || 25;
    const progress = data.rewardProgress || 0;

    // Basic fields (backward-compat)
    code.textContent = referralCode || '-';
    const codeChip = byId('refCodeChip');
    if (codeChip) codeChip.title = referralCode ? `Your referral code: ${referralCode}` : 'No referral code yet';

    // Stats strip
    const countEl = byId('refCount');
    if (countEl) countEl.textContent = String(successful);
    const pendingEl = byId('refPending');
    if (pendingEl) pendingEl.textContent = String(pending);
    const goalEl = byId('refGoalStat');
    if (goalEl) goalEl.textContent = String(goal);
    const progressEl = byId('refProgress');
    if (progressEl) progressEl.textContent = `${progress}%`;

    // Progress bar
    const bar = byId('refProgressBar');
    if (bar) bar.style.width = `${progress}%`;
    const progText = byId('refProgressText');
    if (progText) progText.textContent = `${successful} / ${goal} referrals completed`;

    // Milestone badge
    const milestoneBadge = byId('refMilestageBadge');
    if (milestoneBadge) {
      if (successful >= goal) { milestoneBadge.textContent = '🏆 Goal Reached!'; milestoneBadge.style.background = '#d4edda'; milestoneBadge.style.color = '#157f37'; }
      else if (successful >= 10) { milestoneBadge.textContent = '🔥 On Fire!'; milestoneBadge.style.background = '#fff0e0'; milestoneBadge.style.color = '#b45309'; }
      else if (successful >= 5) { milestoneBadge.textContent = '⭐ Rising Star'; milestoneBadge.style.background = '#f0eeff'; milestoneBadge.style.color = '#5553a9'; }
    }

    // Milestones unlock visual
    updateMilestones(successful);

    // History
    renderHistory(data.history || []);

    // Leaderboard
    renderLeaderboard(data.topReferrers || [], referralCode);

    // Share buttons
    bindShareButtons(referralCode);

  } catch (error) {
    code.textContent = error.message || 'Error loading data';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadLeaderboard();
  loadReferrals();
});
