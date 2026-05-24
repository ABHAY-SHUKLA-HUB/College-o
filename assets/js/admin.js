function byId(id) {
  return document.getElementById(id);
}

const adminCharts = {};

function setText(id, value) {
  const node = byId(id);
  if (node) node.textContent = value;
}

function formatCurrency(value) {
  return `Rs.${Number(value || 0).toLocaleString('en-IN')}`;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(0)}%`;
}

function renderAiOpsChart(aiAnalytics = {}) {
  if (!window.Chart) return;

  const rootStyles = window.getComputedStyle(document.documentElement);
  const isDark = document.documentElement.dataset.themeMode === 'dark';
  const gridColor = rootStyles.getPropertyValue('--ds-chart-grid').trim() || (isDark ? 'rgba(148,163,184,0.22)' : 'rgba(16,34,51,0.08)');
  const axisColor = rootStyles.getPropertyValue('--ds-chart-axis').trim() || (isDark ? '#c7d3e5' : '#475569');
  const seriesOne = rootStyles.getPropertyValue('--ds-chart-series-1').trim() || (isDark ? '#2dd4bf' : '#0f766e');
  const seriesThree = rootStyles.getPropertyValue('--ds-chart-series-3').trim() || (isDark ? '#c084fc' : '#8c2ad8');
  const labelText = isDark ? '#d8e4f5' : '#364152';
  const aiLabels = (aiAnalytics?.trend || []).map((x) => x.day || 'Day');
  const aiRequests = (aiAnalytics?.trend || []).map((x) => Number(x.requests || 0));
  const aiSuccess = (aiAnalytics?.trend || []).map((x) => Number(x.successful_requests || x.requests || 0));

  const aiOpsCanvas = byId('chartAiOps');
  if (!aiOpsCanvas) return;

  adminCharts.aiOps?.destroy();
  adminCharts.aiOps = new Chart(aiOpsCanvas, {
    type: 'bar',
    data: {
      labels: aiLabels,
      datasets: [
        {
          label: 'AI Requests',
          data: aiRequests,
          backgroundColor: seriesOne,
          borderRadius: 10
        },
        {
          label: 'Successful Requests',
          data: aiSuccess,
          backgroundColor: seriesThree,
          borderRadius: 10
        }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { color: labelText } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: axisColor } },
        y: { beginAtZero: true, ticks: { color: axisColor }, grid: { color: gridColor } }
      }
    }
  });
}

function renderStudents(rows) {
  const body = byId('adminStudentsBody');
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="co-admin-table-empty">No students found for the selected filter.</td></tr>';
    return;
  }

  body.innerHTML = rows
    .map(
      (s) => `<tr>
        <td>
          <strong>${s.full_name}</strong>
          <div class="muted">${s.email}</div>
        </td>
        <td>${s.college_name || '-'}</td>
        <td><span class="co-admin-status ${s.subscription_tier === 'premium' ? 'ok' : 'info'}">${s.subscription_tier}</span></td>
        <td>${Number(s.xp || 0).toLocaleString('en-IN')}</td>
        <td>${Number(s.quizzes_attempted || 0).toLocaleString('en-IN')}</td>
        <td>${Number(s.avg_quiz_score || 0)}%</td>
      </tr>`
    )
    .join('');
}

function renderFeedback(rows) {
  const mount = byId('adminFeedbackList');
  if (!mount) return;
  if (!rows.length) {
    mount.innerHTML = '<div class="co-admin-feedback-card">No feedback submitted yet.</div>';
    return;
  }

  mount.innerHTML = rows
    .slice(0, 4)
    .map(
      (f) => `<article class="co-admin-feedback-card">
        <div class="co-admin-meta-row" style="margin-bottom:10px; align-items:flex-start;">
          <div>
            <strong>${f.full_name}</strong>
            <div class="muted">${f.college_name || '-'} | ${f.email}</div>
          </div>
          <span class="co-admin-badge"><i class="fa-solid fa-star"></i> ${f.rating}/5</span>
        </div>
        <p style="margin-bottom:12px;">${f.message}</p>
        ${f.screenshot_url ? `<a class="btn secondary sm" href="${f.screenshot_url}" target="_blank" rel="noreferrer"><i class="fa-solid fa-image"></i> View Screenshot</a>` : ''}
        <div style="margin-top:12px;"></div>
        <textarea id="reply-${f.id}" rows="3" placeholder="Reply to feedback">${f.admin_reply || ''}</textarea>
        <div class="actions" style="margin-top:12px;">
          <button class="btn primary" data-reply-id="${f.id}"><i class="fa-solid fa-paper-plane"></i> Send Reply</button>
        </div>
      </article>`
    )
    .join('');

  mount.querySelectorAll('[data-reply-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.replyId;
      const text = byId(`reply-${id}`).value.trim();
      if (!text) return;
      await window.CollegeOSApi.adminReplyFeedback(id, text);
      await loadAdminFeedback();
    });
  });
}

function renderMembershipPayments(rows) {
  const body = byId('adminMembershipPaymentsBody');
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="co-admin-table-empty">No payment requests found.</td></tr>';
    return;
  }

  body.innerHTML = rows
    .map((payment) => {
      const status = String(payment.status || 'pending').toLowerCase();
      const statusTone = status === 'approved' ? 'ok' : status === 'rejected' ? 'warn' : 'info';
      const submittedDate = payment.submitted_at ? new Date(payment.submitted_at).toLocaleDateString('en-IN') : '-';
      const proof = payment.screenshot_url
        ? `<a class="btn secondary sm" href="${payment.screenshot_url}" target="_blank" rel="noreferrer">View Proof</a>`
        : '<span class="muted">No screenshot</span>';

      return `<tr>
        <td>
          <strong>${payment.full_name}</strong>
          <div class="muted">${payment.email}</div>
        </td>
        <td>${payment.payment_method || '-'}</td>
        <td>${payment.transaction_id || '-'}</td>
        <td>${proof}</td>
        <td>${submittedDate}</td>
        <td><span class="co-admin-status ${statusTone}">${status}</span></td>
        <td>
          <div class="admin-payment-actions">
            <button class="btn primary sm" data-pay-action="approve" data-pay-id="${payment.id}">Approve</button>
            <button class="btn warn sm" data-pay-action="reject" data-pay-id="${payment.id}">Reject</button>
            <button class="btn secondary sm" data-pay-action="pending" data-pay-id="${payment.id}">Pending</button>
          </div>
        </td>
      </tr>`;
    })
    .join('');

  body.querySelectorAll('[data-pay-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.payAction;
      const paymentId = button.dataset.payId;
      const statusMap = {
        approve: 'approved',
        reject: 'rejected',
        pending: 'pending'
      };
      const mappedStatus = statusMap[action] || action;
      let reason = '';
      if (action === 'reject') {
        reason = window.prompt('Optional rejection reason:', '') || '';
      }
      await window.CollegeOSApi.adminUpdateMembershipPayment(paymentId, mappedStatus, reason);
      await loadMembershipPayments();
      await loadAdminDashboard();
      await loadStudents();
    });
  });
}

function renderCharts(trends, analytics = {}) {
  if (!window.Chart) return;

  const rootStyles = window.getComputedStyle(document.documentElement);
  const isDark = document.documentElement.dataset.themeMode === 'dark';
  const gridColor = rootStyles.getPropertyValue('--ds-chart-grid').trim() || (isDark ? 'rgba(148,163,184,0.22)' : 'rgba(16,34,51,0.08)');
  const axisColor = rootStyles.getPropertyValue('--ds-chart-axis').trim() || (isDark ? '#c7d3e5' : '#475569');
  const seriesOne = rootStyles.getPropertyValue('--ds-chart-series-1').trim() || (isDark ? '#2dd4bf' : '#0f766e');
  const seriesTwo = rootStyles.getPropertyValue('--ds-chart-series-2').trim() || (isDark ? '#60a5fa' : '#2f6fed');
  const seriesThree = rootStyles.getPropertyValue('--ds-chart-series-3').trim() || (isDark ? '#c084fc' : '#8c2ad8');
  const seriesFour = rootStyles.getPropertyValue('--ds-chart-series-4').trim() || (isDark ? '#fbbf24' : '#ff8b35');
  const labelText = isDark ? '#d8e4f5' : '#364152';

  const signupLabels = trends.signupTrend.map((x) => x.day);
  const signupCounts = trends.signupTrend.map((x) => Number(x.count));
  const revenueLabels = trends.revenueTrend.map((x) => x.day);
  const revenueAmounts = trends.revenueTrend.map((x) => Number(x.amount));
  const collegeLabels = trends.collegeDistribution.map((x) => x.college_name || 'Unknown');
  const collegeCounts = trends.collegeDistribution.map((x) => Number(x.students));
  const engagementLabels = (trends.quizTrend || []).map((x) => x.day);
  const quizAttempts = (trends.quizTrend || []).map((x) => Number(x.attempts));
  const avgScores = (trends.quizTrend || []).map((x) => Number(x.avg_score || 0));
  const liveLabels = (trends.liveSessionTrend || []).map((x) => x.day);
  const liveCounts = (trends.liveSessionTrend || []).map((x) => Number(x.live_sessions || 0));
  const liveParticipants = (trends.liveSessionTrend || []).map((x) => Number(x.participant_total || 0));

  const signupCanvas = byId('chartSignups');
  if (signupCanvas) {
    adminCharts.signup?.destroy();
    adminCharts.signup = new Chart(signupCanvas, {
      type: 'line',
      data: {
        labels: signupLabels,
        datasets: [{
          label: 'Daily Signups',
          data: signupCounts,
          borderColor: seriesTwo,
          backgroundColor: isDark ? 'rgba(96,165,250,0.22)' : 'rgba(47,111,237,0.16)',
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: seriesTwo
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: axisColor } },
          y: { beginAtZero: true, ticks: { color: axisColor }, grid: { color: gridColor } }
        }
      }
    });
  }

  const revenueCanvas = byId('chartRevenue');
  if (revenueCanvas) {
    adminCharts.revenue?.destroy();
    adminCharts.revenue = new Chart(revenueCanvas, {
      type: 'bar',
      data: {
        labels: revenueLabels,
        datasets: [{
          label: 'Daily Revenue (Rs.)',
          data: revenueAmounts,
          backgroundColor: [seriesFour, '#fb923c', '#f97316', seriesFour, '#fb923c', '#f97316', seriesFour],
          borderRadius: 10
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: axisColor } },
          y: { beginAtZero: true, ticks: { color: axisColor }, grid: { color: gridColor } }
        }
      }
    });
  }

  const collegeCanvas = byId('chartCollege');
  if (collegeCanvas) {
    adminCharts.college?.destroy();
    adminCharts.college = new Chart(collegeCanvas, {
      type: 'doughnut',
      data: {
        labels: collegeLabels,
        datasets: [{
          label: 'Campus Distribution',
          data: collegeCounts,
          backgroundColor: [seriesOne, seriesTwo, '#f97316', seriesThree, '#eab308', '#22d3ee'],
          borderWidth: 0
        }]
      },
      options: {
        cutout: '68%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { usePointStyle: true, boxWidth: 10, padding: 16, color: labelText }
          }
        }
      }
    });
  }

  const engagementCanvas = byId('chartEngagement');
  if (engagementCanvas) {
    adminCharts.engagement?.destroy();
    adminCharts.engagement = new Chart(engagementCanvas, {
      type: 'line',
      data: {
        labels: engagementLabels,
        datasets: [
          {
            label: 'Quiz Attempts',
            data: quizAttempts,
            borderColor: seriesThree,
            backgroundColor: isDark ? 'rgba(192,132,252,0.16)' : 'rgba(140,42,216,0.14)',
            fill: true,
            tension: 0.35,
            pointRadius: 3
          },
          {
            label: 'Average Score',
            data: avgScores,
            borderColor: seriesOne,
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.25,
            pointRadius: 2
          }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { color: labelText } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: axisColor } },
          y: { beginAtZero: true, ticks: { color: axisColor }, grid: { color: gridColor } }
        }
      }
    });
  }

  const liveSessionsCanvas = byId('chartLiveSessions');
  if (liveSessionsCanvas) {
    adminCharts.liveSessions?.destroy();
    adminCharts.liveSessions = new Chart(liveSessionsCanvas, {
      type: 'bar',
      data: {
        labels: liveLabels,
        datasets: [
          {
            label: 'Live Sessions',
            data: liveCounts,
            backgroundColor: seriesTwo,
            borderRadius: 10
          },
          {
            label: 'Participants',
            data: liveParticipants,
            backgroundColor: seriesFour,
            borderRadius: 10
          }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { color: labelText } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: axisColor } },
          y: { beginAtZero: true, ticks: { color: axisColor }, grid: { color: gridColor } }
        }
      }
    });
  }

  renderAiOpsChart({ trend: trends.aiUsageTrend || [] });
}

function renderActivityFeed({ students = [], feedback = [], trends = null } = {}) {
  const mount = byId('adminActivityList');
  if (!mount) return;

  const topStudent = students[0];
  const latestFeedback = feedback[0];
  const recentSignupTotal = (trends?.signupTrend || []).reduce((sum, item) => sum + Number(item.count || 0), 0);

  const items = [
    {
      kicker: 'Growth signal',
      title: recentSignupTotal > 0 ? `${recentSignupTotal} new student signups in the recent trend window` : 'Signup trend data is available for monitoring',
      body: 'Use this signal to judge campaign momentum, campus adoption, and onboarding demand.',
      status: 'Live',
      tone: 'info'
    },
    {
      kicker: 'Live session signal',
      title: `${Number(trends?.liveActiveUsers || 0).toLocaleString('en-IN')} users currently active in live sessions`,
      body: 'This number is derived from live presence data and gives the team a real-time operating view.',
      status: 'Online',
      tone: Number(trends?.liveActiveUsers || 0) > 0 ? 'ok' : 'info'
    },
    {
      kicker: 'Top learner snapshot',
      title: topStudent ? `${topStudent.full_name} leads with ${Number(topStudent.xp || 0).toLocaleString('en-IN')} XP` : 'Student leaderboard insight will appear here',
      body: topStudent ? `${topStudent.college_name || 'Unknown college'} | ${Number(topStudent.quizzes_attempted || 0)} quizzes attempted` : 'Once student activity increases, this panel highlights standout performance.',
      status: 'Tracked',
      tone: 'ok'
    },
    {
      kicker: 'Feedback queue',
      title: latestFeedback ? `Latest feedback from ${latestFeedback.full_name}` : 'No student feedback waiting right now',
      body: latestFeedback ? latestFeedback.message : 'New feedback items will surface here for fast admin response.',
      status: latestFeedback ? `${latestFeedback.rating}/5` : 'Clear',
      tone: latestFeedback ? 'warn' : 'ok'
    },
    {
      kicker: 'Host leaderboard',
      title: Array.isArray(trends?.hostLeaderboard) && trends.hostLeaderboard.length ? `${trends.hostLeaderboard[0].host_name} is leading live sessions` : 'No host leaderboard data yet',
      body: Array.isArray(trends?.hostLeaderboard) && trends.hostLeaderboard.length ? `${Number(trends.hostLeaderboard[0].sessions || 0)} sessions · ${Number(trends.hostLeaderboard[0].participants || 0)} participants` : 'Host activity will appear after sessions are scheduled and attended.',
      status: Array.isArray(trends?.hostLeaderboard) && trends.hostLeaderboard.length ? 'Tracked' : 'Idle',
      tone: Array.isArray(trends?.hostLeaderboard) && trends.hostLeaderboard.length ? 'info' : 'ok'
    }
  ];

  mount.innerHTML = items.map((item) => `
    <div class="co-admin-list-item">
      <div>
        <p class="co-admin-kicker">${item.kicker}</p>
        <strong>${item.title}</strong>
        <p>${item.body}</p>
      </div>
      <span class="co-admin-status ${item.tone}">${item.status}</span>
    </div>
  `).join('');
}

function renderIntelligenceSegments(segments = []) {
  const mount = byId('adminIntelligenceSegments');
  if (!mount) return;
  if (!segments.length) {
    mount.innerHTML = '<div class="co-admin-list-item"><div><p class="co-admin-kicker">No segment data</p><strong>No intelligent segments available yet.</strong><p>Segment insights will appear after activity accumulation.</p></div><span class="co-admin-status">Idle</span></div>';
    return;
  }

  mount.innerHTML = segments.map((segment) => `
    <div class="co-admin-list-item">
      <div>
        <p class="co-admin-kicker">${segment.key || 'segment'}</p>
        <strong>${segment.title || 'Learner Segment'} (${Number(segment.size || 0).toLocaleString('en-IN')})</strong>
        <p>${segment.playbook || 'No playbook available.'}</p>
      </div>
      <span class="co-admin-status info">Active</span>
    </div>
  `).join('');
}

async function loadAdminIntelligence() {
  if (!window.CollegeOSApi?.adminIntelligenceOverview) return;

  const [overview, segmentPayload] = await Promise.all([
    window.CollegeOSApi.adminIntelligenceOverview(),
    window.CollegeOSApi.adminIntelligenceSegments()
  ]);

  let aiAnalytics = null;
  if (window.CollegeOSApi?.adminAiOpsAnalyticsOverview) {
    try {
      aiAnalytics = await window.CollegeOSApi.adminAiOpsAnalyticsOverview(30);
    } catch {
      aiAnalytics = null;
    }
  }

  const aiRuns = Number(overview?.aiOperations?.ai_runs_30d || 0);
  const aiTokens = Number(overview?.aiOperations?.ai_tokens_30d || 0);
  const paymentPending = Number(overview?.monetization?.payment_pending || 0);
  const atRisk = Number(overview?.retention?.at_risk || 0);

  setText('adminAiOpsTitle', `AI Operations (${aiRuns.toLocaleString('en-IN')} runs/30d)`);
  setText('adminAiOpsDesc', `AI tokens used in 30 days: ${aiTokens.toLocaleString('en-IN')}. Use weak-topic automation to increase learning lift.`);
  setText('adminConversionTitle', 'Monetization Signal');
  setText('adminConversionDesc', `${paymentPending.toLocaleString('en-IN')} payment requests are pending. Prioritize high-intent premium conversions.`);
  setText('adminRetentionTitle', 'Retention Risk');
  setText('adminRetentionDesc', `${atRisk.toLocaleString('en-IN')} learners are currently at re-engagement risk.`);

  if (aiAnalytics?.totals) {
    setText('adminAiOpsStatus', `${Number(aiAnalytics.totals.totalRequests || 0).toLocaleString('en-IN')} AI runs monitored`);
    setText('adminAiOpsTitle', `AI Operations (${Number(aiAnalytics.totals.totalRequests || 0).toLocaleString('en-IN')} runs/30d)`);
    setText('adminAiOpsDesc', `Average response ${Number(aiAnalytics.totals.avgResponseMs || 0).toFixed(0)}ms, premium impact ${Number(aiAnalytics.totals.premiumConversionImpactPercent || 0)}%.`);
    renderAiOpsChart({ trend: aiAnalytics.trend || [] });
  }

  renderIntelligenceSegments(segmentPayload?.segments || []);

  const resourceBtn = byId('adminGenerateResourcesBtn');
  const resourceStatus = byId('adminGenerateResourcesStatus');
  if (resourceBtn) {
    resourceBtn.onclick = async () => {
      resourceBtn.disabled = true;
      if (resourceStatus) resourceStatus.textContent = 'Generating automated pack...';
      try {
        const payload = await window.CollegeOSApi.adminGenerateAutomatedResources({});
        const topic = payload?.topic || 'target topic';
        if (resourceStatus) {
          resourceStatus.textContent = `Generated: ${topic} pack with quiz + note + mock blueprint.`;
        }
      } catch (error) {
        if (resourceStatus) resourceStatus.textContent = error.message || 'Unable to generate resources.';
      } finally {
        resourceBtn.disabled = false;
      }
    };
  }
}

async function loadAdminDashboard() {
  if (!window.CollegeOSApi) return;
  const [data, trends] = await Promise.all([
    window.CollegeOSApi.adminDashboard(),
    window.CollegeOSApi.adminTrends()
  ]);

  setText('kpiStudents', Number(data.totalStudents || 0).toLocaleString('en-IN'));
  setText('kpiPremium', Number(data.premiumStudents || 0).toLocaleString('en-IN'));
  setText('kpiRevenue', formatCurrency(data.revenueInr || 0));
  setText('kpiFeedback', Number(data.totalFeedback || 0).toLocaleString('en-IN'));
  setText('kpiPendingApprovals', Number(data.pendingApprovals || 0).toLocaleString('en-IN'));
  setText('kpiExpiredUsers', Number(data.expiredUsers || 0).toLocaleString('en-IN'));
  setText('kpiMonthlyRevenue', formatCurrency(data.monthlyRevenueInr || 0));
  setText('kpiDailyActiveUsers', Number(data.dailyActiveUsers || 0).toLocaleString('en-IN'));
  setText('kpiLiveSessions', Number(data.liveSessions?.live_sessions || 0).toLocaleString('en-IN'));
  setText('kpiAttendanceRate', formatPercent(data.liveSessions?.attendance_rate || 0));
  setText('adminCollegesCovered', `${Number(data.collegesCovered || 0)} campuses`);
  setText('adminPlatformStatus', 'Platform healthy');

  const students = Number(data.totalStudents || 0);
  const premium = Number(data.premiumStudents || 0);
  const conversion = students > 0 ? Math.round((premium / students) * 100) : 0;
  setText('adminConversionRate', `${conversion}% premium conversion`);
  setText('adminRevenuePulse', `${formatCurrency(data.revenueInr || 0)} active revenue`);
  setText('adminFeedbackPulse', `${Number(data.totalFeedback || 0)} total feedback items`);
  setText('adminStudentsTrend', `${students} active student accounts`);
  setText('adminDAUPulse', `${Number(data.dailyActiveUsers || 0)} students active today`);
  setText('adminLiveSessionsPulse', `${Number(data.liveSessions?.live_sessions || 0)} live / ${Number(data.liveSessions?.scheduled_sessions || 0)} scheduled`);
  setText('adminAttendancePulse', `${formatPercent(data.liveSessions?.attendance_rate || 0)} attendance rate`);

  renderCharts(trends, data);
  renderActivityFeed({ trends });
}

async function loadMembershipPayments() {
  const filter = byId('adminPaymentStatusFilter')?.value || 'all';
  const { payments } = await window.CollegeOSApi.adminMembershipPayments(filter);
  renderMembershipPayments(payments || []);
}

async function loadStudents() {
  const college = byId('adminCollegeFilter')?.value || '';
  const { students } = await window.CollegeOSApi.adminStudents(college);
  renderStudents(students);
  renderActivityFeed({ students });
}

async function loadAdminFeedback() {
  const { feedback } = await window.CollegeOSApi.adminFeedback();
  renderFeedback(feedback);
  if (feedback[0]) {
    setText('adminHeroInsight', `Latest student signal: ${feedback[0].full_name} rated the platform ${feedback[0].rating}/5. Review and reply to keep support quality high.`);
  }
  renderActivityFeed({ feedback });
}

function bindAdminLogin() {
  const form = byId('adminLoginForm');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = byId('adminEmail').value.trim();
    const password = byId('adminPassword').value;
    const error = byId('adminLoginError');
    error.textContent = '';
    try {
      const captchaPayload = typeof getCaptchaPayload === 'function' ? getCaptchaPayload('admin') : null;
      await window.CollegeOSApi.adminLogin({ email, password, captcha: captchaPayload });
      window.location.href = 'admin-dashboard.html';
    } catch (e) {
      error.textContent = e.message;
    }
  });

}

function bindUploads() {
  const noteForm = byId('uploadNoteForm');
  const paperForm = byId('uploadPaperForm');

  noteForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(noteForm);
    try {
      const payload = await window.CollegeOSApiClient.request('/api/admin/content/notes', {
        method: 'POST',
        body: formData
      });
      byId('uploadStatus').textContent = `Note uploaded: ${payload.note.id}`;
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        byId('uploadStatus').textContent = error.message || 'Admin login required.';
        window.location.href = 'admin-login.html';
        return;
      }
      byId('uploadStatus').textContent = error.message || 'Upload failed.';
    }
  });

  paperForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(paperForm);
    try {
      const payload = await window.CollegeOSApiClient.request('/api/admin/content/papers', {
        method: 'POST',
        body: formData
      });
      byId('uploadStatus').textContent = `Paper uploaded: ${payload.paper.id}`;
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        byId('uploadStatus').textContent = error.message || 'Admin login required.';
        window.location.href = 'admin-login.html';
        return;
      }
      byId('uploadStatus').textContent = error.message || 'Upload failed.';
    }
  });
}

function bindStudentFilter() {
  byId('adminCollegeFilter')?.addEventListener('change', () => {
    loadStudents().catch((e) => {
      byId('adminStudentsBody').innerHTML = `<tr><td colspan="7">${e.message}</td></tr>`;
    });
  });
}

function bindPaymentFilter() {
  byId('adminPaymentStatusFilter')?.addEventListener('change', () => {
    loadMembershipPayments().catch((e) => {
      const body = byId('adminMembershipPaymentsBody');
      if (body) body.innerHTML = `<tr><td colspan="7">${e.message}</td></tr>`;
    });
  });
}

function bindAdminCreation() {
  const form = byId('createAdminForm');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fullName = byId('newAdminName').value.trim();
    const email = byId('newAdminEmail').value.trim();
    const password = byId('newAdminPassword').value;
    const status = byId('createAdminStatus');

    try {
      const payload = await window.CollegeOSApi.adminCreateUser({ fullName, email, password });
      status.textContent = `Admin created: ${payload.admin.email}`;
      status.style.color = '#157f37';
      form.reset();
    } catch (error) {
      status.textContent = error.message;
      status.style.color = '#c6342d';
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  bindAdminLogin();
  bindUploads();
  bindStudentFilter();
  bindPaymentFilter();
  bindAdminCreation();

  if (byId('adminDashboardRoot')) {
    try {
      await loadAdminDashboard();
      await loadStudents();
      await loadAdminFeedback();
      await loadMembershipPayments();
      await loadAdminIntelligence();
    } catch (e) {
      const status = byId('adminStatus');
      if (status) status.textContent = e.message;
      if (String(e.message).toLowerCase().includes('authentication') || String(e.message).toLowerCase().includes('admin access')) {
        window.location.href = 'admin-login.html';
      }
    }
  }
});
