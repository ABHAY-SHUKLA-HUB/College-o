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

async function ensureAdminSession() {
  try {
    const perm = await window.CollegeOSApi.adminControlPermissions();
    cById('controlPermissionInfo').textContent = `Signed in as ${perm.role}. Permissions: ${perm.permissions.join(', ')}`;
  } catch (_error) {
    window.location.href = 'admin-login.html';
  }
}

function bindTabs() {
  document.querySelectorAll('.control-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.control-tab').forEach((node) => node.classList.remove('active'));
      tab.classList.add('active');
      const panelId = tab.dataset.panel;
      document.querySelectorAll('.control-panel').forEach((panel) => panel.classList.remove('active'));
      cById(panelId).classList.add('active');
    });
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
    feature_toggles: toggles
  });

  window.alert('Platform settings updated.');
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
  window.alert('Membership center configuration saved. Pricing page updates instantly for students.');
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
  window.alert('Student experience configuration saved. Home and Dashboard will reflect updates instantly.');
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

  cById('loadAuditBtn').addEventListener('click', () => loadAuditLogs().catch((e) => window.alert(e.message)));
}

document.addEventListener('DOMContentLoaded', async () => {
  bindTabs();
  await ensureAdminSession();
  bindEvents();

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
    ['experience config', () => loadExperienceConfig()],
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
