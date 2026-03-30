function byId(id) {
  return document.getElementById(id);
}

function asInt(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asBool(value) {
  return value === true || value === 'true' || value === '1' || value === 'on';
}

function adminToast(message, isError = false) {
  const node = byId('adminMockStatus');
  if (!node) return;
  node.textContent = message;
  node.style.color = isError ? '#bf2d3e' : '#1f7f55';
}

let adminMockState = {
  selectedTestId: null,
  tests: []
};

async function ensureAdminAccess() {
  await window.CollegeOSApi.adminDashboard();
}

async function loadAcademicOptions() {
  const [catRes, semRes] = await Promise.all([
    window.CollegeOSApi.getAcademicCategories(),
    window.CollegeOSApi.getAcademicSemesters()
  ]);

  const categories = catRes.categories || [];
  const semesters = semRes.semesters || [];

  const categorySelects = [byId('mtCategoryId'), byId('mtFilterCategoryId')];
  categorySelects.forEach((select) => {
    select.innerHTML = '<option value="">All / None</option>';
    categories.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      select.appendChild(opt);
    });
  });

  const semesterSelects = [byId('mtSemesterId'), byId('mtFilterSemesterId')];
  semesterSelects.forEach((select) => {
    select.innerHTML = '<option value="">All / None</option>';
    semesters.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.label;
      select.appendChild(opt);
    });
  });
}

async function loadBranchesForCategory(categorySelectId, branchSelectId) {
  const categoryId = asInt(byId(categorySelectId).value, null);
  const branchSelect = byId(branchSelectId);
  branchSelect.innerHTML = '<option value="">All / None</option>';

  if (!categoryId) return;
  const payload = await window.CollegeOSApi.getAcademicBranches(categoryId);
  (payload.branches || []).forEach((b) => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.name;
    branchSelect.appendChild(opt);
  });
}

function collectTestFormPayload() {
  return {
    title: byId('mtTitle').value.trim(),
    categoryKey: byId('mtCategoryKey').value,
    difficulty: byId('mtDifficulty').value,
    durationMinutes: asInt(byId('mtDuration').value, 0),
    totalMarks: asInt(byId('mtTotalMarks').value, 0),
    totalQuestions: asInt(byId('mtTotalQuestions').value, 0),
    subject: byId('mtSubject').value.trim(),
    topic: byId('mtTopic').value.trim(),
    categoryId: asInt(byId('mtCategoryId').value, null),
    branchId: asInt(byId('mtBranchId').value, null),
    semesterId: asInt(byId('mtSemesterId').value, null),
    accessType: byId('mtAccessType').value,
    status: byId('mtStatus').value,
    isCommon: byId('mtIsCommon').checked,
    syllabus: byId('mtSyllabus').value.trim(),
    instructions: byId('mtInstructions').value.trim(),
    attemptLimitFree: asInt(byId('mtAttemptLimitFree').value, 2),
    retakeAllowed: byId('mtRetakeAllowed').checked,
    shuffleQuestions: byId('mtShuffleQuestions').checked,
    shuffleOptions: byId('mtShuffleOptions').checked,
    explanationsVisible: byId('mtExplanationsVisible').checked,
    marksPerQuestion: Number(byId('mtMarksPerQuestion').value || 1),
    negativeMarkingEnabled: byId('mtNegativeEnabled').checked,
    negativeMarks: Number(byId('mtNegativeMarks').value || 0)
  };
}

function fillTestForm(test) {
  byId('mtTitle').value = test.title || '';
  byId('mtCategoryKey').value = test.category_key || 'grand';
  byId('mtDifficulty').value = test.difficulty || 'medium';
  byId('mtDuration').value = test.duration_minutes || '';
  byId('mtTotalMarks').value = test.total_marks || '';
  byId('mtTotalQuestions').value = test.total_questions || '';
  byId('mtSubject').value = test.subject || '';
  byId('mtTopic').value = test.topic || '';
  byId('mtCategoryId').value = test.category_id || '';
  byId('mtBranchId').value = test.branch_id || '';
  byId('mtSemesterId').value = test.semester_id || '';
  byId('mtAccessType').value = test.access_type || 'free';
  byId('mtStatus').value = test.status || 'published';
  byId('mtIsCommon').checked = !!test.is_common;
  byId('mtSyllabus').value = test.syllabus || '';
  byId('mtInstructions').value = test.instructions || '';
  byId('mtAttemptLimitFree').value = test.attempt_limit_free ?? 2;
  byId('mtRetakeAllowed').checked = !!test.retake_allowed;
  byId('mtShuffleQuestions').checked = !!test.shuffle_questions;
  byId('mtShuffleOptions').checked = !!test.shuffle_options;
  byId('mtExplanationsVisible').checked = !!test.explanations_visible;
  byId('mtMarksPerQuestion').value = test.marks_per_question ?? 1;
  byId('mtNegativeEnabled').checked = !!test.negative_marking_enabled;
  byId('mtNegativeMarks').value = test.negative_marks ?? 0;
}

function resetTestForm() {
  byId('mockTestForm').reset();
  byId('mtCategoryKey').value = 'grand';
  byId('mtDifficulty').value = 'medium';
  byId('mtAccessType').value = 'free';
  byId('mtStatus').value = 'published';
  byId('mtAttemptLimitFree').value = 2;
  byId('mtMarksPerQuestion').value = 1;
  byId('mtNegativeMarks').value = 0;
  byId('mtRetakeAllowed').checked = true;
  byId('mtExplanationsVisible').checked = true;
  adminMockState.selectedTestId = null;
}

function buildQuery() {
  const includeDeleted = byId('mtFilterIncludeDeleted').checked;
  const qs = new URLSearchParams();
  if (includeDeleted) qs.set('includeDeleted', 'true');
  const q = qs.toString();
  return q ? `?${q}` : '';
}

function renderTestsTable() {
  const tbody = byId('mockTestsTableBody');
  const q = byId('mtFilterSearch').value.trim().toLowerCase();
  const category = byId('mtFilterCategoryId').value;
  const branch = byId('mtFilterBranchId').value;
  const semester = byId('mtFilterSemesterId').value;
  const status = byId('mtFilterStatus').value;

  const filtered = adminMockState.tests.filter((t) => {
    const passSearch = !q || String(t.title || '').toLowerCase().includes(q) || String(t.subject || '').toLowerCase().includes(q) || String(t.topic || '').toLowerCase().includes(q);
    const passCategory = !category || String(t.category_id || '') === String(category);
    const passBranch = !branch || String(t.branch_id || '') === String(branch);
    const passSemester = !semester || String(t.semester_id || '') === String(semester);
    const passStatus = !status || String(t.status || '') === status;
    return passSearch && passCategory && passBranch && passSemester && passStatus;
  });

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="co-admin-table-empty">No mock tests found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((t) => `
    <tr>
      <td>${t.id}</td>
      <td><strong>${t.title || 'Untitled'}</strong><br><span class="muted">${t.subject || 'General'} · ${t.topic || 'General'}</span></td>
      <td>${t.category_name || '-'}</td>
      <td>${t.branch_name || (t.is_common ? 'Common' : '-')}</td>
      <td>${t.semester_label || 'All'}</td>
      <td>${t.duration_minutes || 0}m<br><span class="muted">${t.question_count || t.total_questions || 0} Q</span></td>
      <td>${t.attempts || 0}<br><span class="muted">Avg ${Number(t.avg_score || 0).toFixed(1)}</span></td>
      <td><span class="co-admin-badge">${t.access_type || 'free'}</span><br><span class="co-admin-badge">${t.status || 'published'}</span></td>
      <td>${t.deleted_at ? '<span class="co-admin-badge danger">Deleted</span>' : '<span class="co-admin-badge success">Active</span>'}</td>
      <td>
        <div class="actions">
          <button class="btn secondary sm" data-action="edit" data-id="${t.id}">Edit</button>
          <button class="btn secondary sm" data-action="questions" data-id="${t.id}">Questions</button>
          ${t.deleted_at
            ? `<button class="btn warn sm" data-action="restore" data-id="${t.id}">Restore</button>`
            : `<button class="btn danger sm" data-action="delete" data-id="${t.id}">Delete</button>`}
        </div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const id = asInt(btn.getAttribute('data-id'), -1);
      if (id < 1) return;

      if (action === 'edit') {
        const test = adminMockState.tests.find((x) => Number(x.id) === id);
        if (!test) return;
        adminMockState.selectedTestId = id;
        fillTestForm(test);
        adminToast(`Editing test #${id}`);
      }

      if (action === 'questions') {
        await loadQuestions(id);
      }

      if (action === 'delete') {
        if (!window.confirm('Soft delete this test?')) return;
        await window.CollegeOSApi.adminControlDeleteMockTest(id);
        adminToast(`Mock test #${id} deleted`);
        await loadTests();
      }

      if (action === 'restore') {
        await window.CollegeOSApi.adminControlRestoreMockTest(id);
        adminToast(`Mock test #${id} restored`);
        await loadTests();
      }
    });
  });
}

async function loadTests() {
  const data = await window.CollegeOSApi.adminControlMockTests(buildQuery());
  adminMockState.tests = data.mockTests || [];
  renderTestsTable();
}

async function saveTest() {
  const payload = collectTestFormPayload();
  if (!payload.title || !payload.durationMinutes || !payload.totalMarks) {
    adminToast('Title, duration, and total marks are required.', true);
    return;
  }

  if (adminMockState.selectedTestId) {
    await window.CollegeOSApi.adminControlUpdateMockTest(adminMockState.selectedTestId, payload);
    adminToast(`Mock test #${adminMockState.selectedTestId} updated successfully`);
  } else {
    const result = await window.CollegeOSApi.adminControlCreateMockTest(payload);
    adminToast(`Mock test created with id #${result.mockTest?.id || '--'}`);
  }

  resetTestForm();
  await loadTests();
  await loadAnalytics();
}

async function loadQuestions(mockTestId) {
  adminMockState.selectedTestId = mockTestId;
  byId('questionPanelTitle').textContent = `Question Bank · Test #${mockTestId}`;

  const payload = await window.CollegeOSApi.adminControlMockTestQuestions(mockTestId);
  const rows = payload.questions || [];
  const tbody = byId('mockQuestionsTableBody');

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="co-admin-table-empty">No questions in this test yet.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((q) => `
    <tr>
      <td>${q.id}</td>
      <td>${q.order_no || 0}</td>
      <td>${q.question_type}</td>
      <td>${q.topic || '-'}</td>
      <td>${Number(q.marks || 0)}</td>
      <td>${Number(q.negative_marks || 0)}</td>
      <td>${(q.question_text || '').slice(0, 100)}</td>
      <td><button class="btn danger sm" data-q-del="${q.id}">Delete</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-q-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const qid = asInt(btn.getAttribute('data-q-del'), -1);
      if (qid < 1 || adminMockState.selectedTestId < 1) return;
      await window.CollegeOSApi.adminControlDeleteMockTestQuestion(adminMockState.selectedTestId, qid);
      adminToast(`Question #${qid} deleted`);
      await loadQuestions(adminMockState.selectedTestId);
      await loadTests();
    });
  });
}

function parseBulkInput(text) {
  const rows = [];
  const lines = String(text || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

  lines.forEach((line, idx) => {
    const parts = line.split('|').map((x) => x.trim());
    if (parts.length < 7) return;
    const [questionText, questionType, difficulty, topic, marks, negativeMarks, optionsRaw, correctRaw, explanation] = parts;
    const options = optionsRaw.split(';').map((opt, i) => {
      const [k, ...rest] = opt.split(':');
      const key = (rest.length ? k : String.fromCharCode(65 + i)).trim();
      const textVal = (rest.length ? rest.join(':') : k).trim();
      return { key, text: textVal };
    });
    rows.push({
      questionText,
      questionType: questionType || 'single_mcq',
      difficulty: difficulty || 'medium',
      topic: topic || null,
      marks: Number(marks || 1),
      negativeMarks: Number(negativeMarks || 0),
      options,
      correctAnswer: questionType === 'multi_select' ? correctRaw.split(',').map((x) => x.trim()) : (correctRaw || '').trim(),
      explanation: explanation || null,
      orderNo: idx
    });
  });

  return rows;
}

async function addManualQuestion() {
  if (!adminMockState.selectedTestId) {
    adminToast('Select or create a test first.', true);
    return;
  }

  const options = [
    { key: 'A', text: byId('mqOptionA').value.trim() },
    { key: 'B', text: byId('mqOptionB').value.trim() },
    { key: 'C', text: byId('mqOptionC').value.trim() },
    { key: 'D', text: byId('mqOptionD').value.trim() }
  ].filter((x) => x.text);

  const payload = {
    questionText: byId('mqText').value.trim(),
    questionType: byId('mqType').value,
    difficulty: byId('mqDifficulty').value,
    sectionName: byId('mqSection').value.trim() || null,
    subject: byId('mqSubject').value.trim() || null,
    topic: byId('mqTopic').value.trim() || null,
    marks: Number(byId('mqMarks').value || 1),
    negativeMarks: Number(byId('mqNegative').value || 0),
    explanation: byId('mqExplanation').value.trim() || null,
    options,
    correctAnswer: byId('mqType').value === 'multi_select'
      ? byId('mqCorrect').value.split(',').map((x) => x.trim()).filter(Boolean)
      : byId('mqCorrect').value.trim(),
    orderNo: asInt(byId('mqOrder').value, 0)
  };

  await window.CollegeOSApi.adminControlCreateMockTestQuestion(adminMockState.selectedTestId, payload);
  adminToast('Question added successfully');
  byId('manualQuestionForm').reset();
  byId('mqType').value = 'single_mcq';
  byId('mqDifficulty').value = 'medium';
  byId('mqMarks').value = 1;
  byId('mqNegative').value = 0;
  await loadQuestions(adminMockState.selectedTestId);
  await loadTests();
}

async function bulkUploadQuestions() {
  if (!adminMockState.selectedTestId) {
    adminToast('Select or create a test first.', true);
    return;
  }

  const rows = parseBulkInput(byId('mqBulkInput').value);
  if (!rows.length) {
    adminToast('Bulk input is empty or invalid format.', true);
    return;
  }

  await window.CollegeOSApi.adminControlBulkUploadMockTestQuestions(adminMockState.selectedTestId, rows);
  adminToast(`Bulk upload successful (${rows.length} question rows)`);
  byId('mqBulkInput').value = '';
  await loadQuestions(adminMockState.selectedTestId);
  await loadTests();
}

async function loadAnalytics() {
  const data = await window.CollegeOSApi.adminControlMockTestAnalytics();
  const summary = data.summary || {};

  byId('anaTotalAttempts').textContent = Number(summary.total_attempts || 0);
  byId('anaAvgScore').textContent = Number(summary.average_score || 0).toFixed(1);
  byId('anaTopScore').textContent = Number(summary.top_score || 0).toFixed(1);
  byId('anaCompletion').textContent = `${Number(summary.completion_rate || 0).toFixed(1)}%`;

  byId('anaBranchAttempts').innerHTML = (data.branchWiseAttempts || []).slice(0, 8)
    .map((r) => `<li>${r.branch}: <strong>${r.attempts}</strong></li>`)
    .join('') || '<li>No branch attempts yet.</li>';

  byId('anaTopicWeakness').innerHTML = (data.topicWiseWeakness || []).slice(0, 8)
    .map((r) => `<li>${r.topic}: <strong>${Number(r.accuracy || 0).toFixed(1)}%</strong></li>`)
    .join('') || '<li>No topic weakness data yet.</li>';

  byId('anaFreePremium').innerHTML = (data.freeVsPremiumUsage || [])
    .map((r) => `<li>${r.access_type}: <strong>${r.attempts}</strong> attempts</li>`)
    .join('') || '<li>No access usage yet.</li>';
}

function bindEvents() {
  byId('mtCategoryId').addEventListener('change', () => loadBranchesForCategory('mtCategoryId', 'mtBranchId').catch((e) => adminToast(e.message, true)));
  byId('mtFilterCategoryId').addEventListener('change', async () => {
    await loadBranchesForCategory('mtFilterCategoryId', 'mtFilterBranchId');
    renderTestsTable();
  });

  byId('saveMockTestBtn').addEventListener('click', () => saveTest().catch((e) => adminToast(e.message, true)));
  byId('resetMockTestBtn').addEventListener('click', resetTestForm);
  byId('refreshMockTestsBtn').addEventListener('click', () => loadTests().catch((e) => adminToast(e.message, true)));
  byId('refreshAnalyticsBtn').addEventListener('click', () => loadAnalytics().catch((e) => adminToast(e.message, true)));
  byId('addManualQuestionBtn').addEventListener('click', () => addManualQuestion().catch((e) => adminToast(e.message, true)));
  byId('bulkUploadQuestionBtn').addEventListener('click', () => bulkUploadQuestions().catch((e) => adminToast(e.message, true)));

  ['mtFilterSearch', 'mtFilterBranchId', 'mtFilterSemesterId', 'mtFilterStatus', 'mtFilterIncludeDeleted'].forEach((id) => {
    byId(id).addEventListener('input', renderTestsTable);
    byId(id).addEventListener('change', renderTestsTable);
  });
}

(async function initAdminMockTests() {
  if (!window.CollegeOSApi) return;

  try {
    await ensureAdminAccess();
    await loadAcademicOptions();
    bindEvents();
    resetTestForm();
    await Promise.all([loadTests(), loadAnalytics()]);
    adminToast('Mock test admin workspace ready.');
  } catch (error) {
    adminToast(error.message || 'Failed to load admin workspace', true);
    if (/401|403|login/i.test(String(error.message || ''))) {
      window.location.href = 'admin-login.html';
    }
  }
})();
