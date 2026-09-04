/* Coding Challenges Governance Admin Script */

(function () {
  'use strict';

  let currentContests = [];
  let currentFilter = 'all';
  let activeContestId = null;
  let activeProblemId = null;
  let isSubmitting = false;

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDatetimeInput(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function apiFetch(url, options = {}) {
    options.credentials = 'include';
    options.headers = options.headers || {};
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status} Error`);
    }
    return data;
  }

  /* --- Dashboard & Overview Stats --- */
  async function loadDashboardStats() {
    try {
      const data = await apiFetch('/api/admin/coding-challenges/stats');
      const stats = data.stats || {};
      if (el('statTotalContests')) el('statTotalContests').textContent = stats.total_contests || 0;
      if (el('statLiveContests')) el('statLiveContests').textContent = stats.live_contests || 0;
      if (el('statScheduledContests')) el('statScheduledContests').textContent = stats.scheduled_contests || 0;
      if (el('statDraftContests')) el('statDraftContests').textContent = stats.draft_contests || 0;
      if (el('statParticipants')) el('statParticipants').textContent = stats.total_participants || 0;
      if (el('statSubmissions')) el('statSubmissions').textContent = stats.total_submissions || 0;
    } catch (err) {
      console.error('Failed to load dashboard stats:', err);
    }
  }

  /* --- Contests Table & Lifecycle --- */
  async function loadContests() {
    const tbody = el('contestsTbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 24px; color:#64748b;">Loading contests data...</td></tr>';

    try {
      const data = await apiFetch('/api/admin/coding-challenges/contests');
      currentContests = data.contests || [];
      renderContestsTable();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#ef4444; padding:24px;">Failed to load contests: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderContestsTable() {
    const tbody = el('contestsTbody');
    if (!tbody) return;

    let filtered = currentContests;
    if (currentFilter !== 'all') {
      filtered = currentContests.filter((c) => c.computed_status === currentFilter);
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 24px; color:#64748b;">No ${currentFilter === 'all' ? '' : currentFilter} contests found. Click "Create New Contest" to get started.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered
      .map((c) => {
        const start = new Date(c.start_time).toLocaleString();
        const end = new Date(c.end_time).toLocaleString();
        const statusBadge = `<span class="badge-status ${c.computed_status}">${c.computed_status}</span>`;

        let actionBtns = `
        <button class="btn-sm" data-action="edit-contest" data-id="${c.id}"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn-sm primary" data-action="manage-problems" data-id="${c.id}"><i class="fa-solid fa-list-check"></i> Problems (${c.problem_count || 0})</button>
        <button class="btn-sm" data-action="view-results" data-id="${c.id}"><i class="fa-solid fa-trophy"></i> Results</button>
        <button class="btn-sm" data-action="duplicate-contest" data-id="${c.id}"><i class="fa-solid fa-copy"></i> Duplicate</button>
      `;

        if (c.computed_status === 'draft') {
          actionBtns += `
          <button class="btn-sm success" data-action="publish-contest" data-id="${c.id}"><i class="fa-solid fa-paper-plane"></i> Publish</button>
          <button class="btn-sm danger" data-action="delete-contest" data-id="${c.id}"><i class="fa-solid fa-trash"></i> Delete</button>
        `;
        } else if (c.computed_status === 'live' || c.computed_status === 'scheduled') {
          actionBtns += `
          <button class="btn-sm danger" data-action="cancel-contest" data-id="${c.id}"><i class="fa-solid fa-ban"></i> Cancel</button>
        `;
        }

        return `
        <tr>
          <td>
            <strong>${escapeHtml(c.title)}</strong>
            <div style="font-size:12px; color:#64748b;">${escapeHtml(c.description || 'No description')}</div>
          </td>
          <td>${statusBadge}</td>
          <td>
            <div style="font-size:12px;"><strong>Start:</strong> ${start}</div>
            <div style="font-size:12px; color:#64748b;"><strong>End:</strong> ${end} (${c.duration_minutes || 60} mins)</div>
          </td>
          <td><strong>${c.problem_count || 0}</strong> problems</td>
          <td><strong>${c.participant_count || 0}</strong> enrolled</td>
          <td><strong>${c.submission_count || 0}</strong> submissions</td>
          <td>
            <div class="btn-group">${actionBtns}</div>
          </td>
        </tr>
      `;
      })
      .join('');
  }

  /* --- Contest Form Modal --- */
  function openContestModal(contest = null) {
    const modal = el('contestModal');
    if (!modal) return;

    el('contestId').value = contest ? contest.id : '';
    el('contestModalTitle').textContent = contest ? 'Edit Coding Contest' : 'Create Coding Contest';
    el('contestTitle').value = contest ? contest.title || '' : '';
    el('contestDescription').value = contest ? contest.description || '' : '';
    el('contestInstructions').value = contest ? contest.rules_and_instructions || '' : '';
    el('contestStatus').value = contest ? contest.status || 'draft' : 'draft';
    el('contestDuration').value = contest ? contest.duration_minutes || 60 : 60;
    el('contestStartTime').value = contest ? formatDatetimeInput(contest.start_time) : formatDatetimeInput(new Date(Date.now() + 3600000));
    el('contestEndTime').value = contest ? formatDatetimeInput(contest.end_time) : formatDatetimeInput(new Date(Date.now() + 7200000));

    const allowedLangs = contest && Array.isArray(contest.allowed_languages) ? contest.allowed_languages : ['python', 'javascript', 'cpp', 'c', 'java'];
    document.querySelectorAll('input[name="languages"]').forEach((cb) => {
      cb.checked = allowedLangs.includes(cb.value);
    });

    el('contestLeaderboardVisible').checked = contest ? contest.leaderboard_visible !== false : true;
    el('contestStrictModeEnabled').checked = contest ? contest.strict_mode_enabled === true : false;
    el('contestCertificateEnabled').checked = contest ? contest.certificate_enabled === true : false;

    modal.style.display = 'flex';
  }

  function closeContestModal() {
    const modal = el('contestModal');
    if (modal) modal.style.display = 'none';
  }

  async function handleContestSubmit(e) {
    e.preventDefault();
    if (isSubmitting) return;

    const contestId = el('contestId').value;
    const title = el('contestTitle').value.trim();
    const description = el('contestDescription').value.trim();
    const rules_and_instructions = el('contestInstructions').value.trim();
    const status = el('contestStatus').value;
    const duration_minutes = parseInt(el('contestDuration').value, 10);
    const start_time = el('contestStartTime').value;
    const end_time = el('contestEndTime').value;

    const allowed_languages = [];
    document.querySelectorAll('input[name="languages"]:checked').forEach((cb) => {
      allowed_languages.push(cb.value);
    });

    if (allowed_languages.length === 0) {
      window.alert('Please select at least one supported programming language.');
      return;
    }

    if (new Date(end_time) <= new Date(start_time)) {
      window.alert('End time must be after start time.');
      return;
    }

    const payload = {
      title,
      description,
      rules_and_instructions,
      status,
      duration_minutes,
      start_time,
      end_time,
      allowed_languages,
      leaderboard_visible: el('contestLeaderboardVisible').checked,
      strict_mode_enabled: el('contestStrictModeEnabled').checked,
      certificate_enabled: el('contestCertificateEnabled').checked
    };

    isSubmitting = true;
    const submitBtn = el('btnSubmitContest');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';
    }

    try {
      if (contestId) {
        await apiFetch(`/api/admin/coding-challenges/contests/${contestId}`, { method: 'PUT', body: payload });
      } else {
        await apiFetch('/api/admin/coding-challenges/contests', { method: 'POST', body: payload });
      }

      closeContestModal();
      await loadContests();
      await loadDashboardStats();
    } catch (err) {
      window.alert(`Error saving contest: ${err.message}`);
    } finally {
      isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Contest';
      }
    }
  }

  /* --- Contest Operations (Duplicate, Status, Delete) --- */
  async function handleDuplicateContest(id) {
    if (!window.confirm('Duplicate this contest along with its problems and test cases?')) return;
    try {
      await apiFetch(`/api/admin/coding-challenges/contests/${id}/duplicate`, { method: 'POST' });
      await loadContests();
      await loadDashboardStats();
    } catch (err) {
      window.alert(`Failed to duplicate contest: ${err.message}`);
    }
  }

  async function handleUpdateContestStatus(id, newStatus) {
    if (!window.confirm(`Are you sure you want to change contest status to "${newStatus}"?`)) return;
    try {
      await apiFetch(`/api/admin/coding-challenges/contests/${id}/status`, { method: 'PATCH', body: { status: newStatus } });
      await loadContests();
      await loadDashboardStats();
    } catch (err) {
      window.alert(`Failed to update status: ${err.message}`);
    }
  }

  async function handleDeleteContest(id) {
    if (!window.confirm('Are you sure you want to delete this draft contest? This action cannot be undone.')) return;
    try {
      await apiFetch(`/api/admin/coding-challenges/contests/${id}`, { method: 'DELETE' });
      await loadContests();
      await loadDashboardStats();
    } catch (err) {
      window.alert(`Failed to delete contest: ${err.message}`);
    }
  }

  /* --- Problem Manager Modal --- */
  async function openProblemManagerModal(contestId) {
    activeContestId = contestId;
    const modal = el('problemManagerModal');
    if (!modal) return;

    const contest = currentContests.find((c) => c.id === contestId);
    if (el('problemManagerSubtitle')) {
      el('problemManagerSubtitle').textContent = contest ? `Contest: ${contest.title}` : `Contest ID: ${contestId}`;
    }

    el('problemEditorSection').style.display = 'none';
    el('problemListSection').style.display = 'block';

    modal.style.display = 'flex';
    await loadProblems(contestId);
  }

  function closeProblemManagerModal() {
    const modal = el('problemManagerModal');
    if (modal) modal.style.display = 'none';
    activeContestId = null;
  }

  async function loadProblems(contestId) {
    const tbody = el('problemsTbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 16px;">Loading problems...</td></tr>';

    try {
      const data = await apiFetch(`/api/admin/coding-challenges/contests/${contestId}/problems`);
      const problems = data.problems || [];

      if (problems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 16px; color:#64748b;">No problems created for this contest yet. Click "Add Problem" to create one.</td></tr>';
        return;
      }

      tbody.innerHTML = problems
        .map(
          (p, idx) => `
        <tr>
          <td><strong>#${p.order_index || idx + 1}</strong></td>
          <td>
            <strong>${escapeHtml(p.title)}</strong>
          </td>
          <td><span class="badge-status ${p.difficulty}">${p.difficulty}</span></td>
          <td><strong>${p.score || 100}</strong> pts</td>
          <td><strong>${p.test_case_count || 0}</strong> test cases</td>
          <td>
            <div class="btn-group">
              <button class="btn-sm" data-action="edit-problem" data-pid="${p.id}"><i class="fa-solid fa-pen"></i> Edit</button>
              <button class="btn-sm primary" data-action="manage-testcases" data-pid="${p.id}"><i class="fa-solid fa-vial"></i> Test Cases (${p.test_case_count || 0})</button>
              <button class="btn-sm danger" data-action="delete-problem" data-pid="${p.id}"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `
        )
        .join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#ef4444; padding:16px;">Failed to load problems: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function showProblemEditor(problem = null) {
    el('problemEditorSection').style.display = 'block';
    el('problemEditorTitle').textContent = problem ? 'Edit Problem Statement' : 'Add New Problem';
    el('problemId').value = problem ? problem.id : '';
    el('problemContestId').value = activeContestId;
    el('problemTitle').value = problem ? problem.title || '' : '';
    el('problemDifficulty').value = problem ? problem.difficulty || 'medium' : 'medium';
    el('problemScore').value = problem ? problem.score || 100 : 100;
    el('problemStatement').value = problem ? problem.problem_statement || '' : '';
    el('problemInputFormat').value = problem ? problem.input_format || '' : '';
    el('problemOutputFormat').value = problem ? problem.output_format || '' : '';
    el('problemConstraints').value = problem ? problem.constraints || '' : '';
    el('problemExamples').value = problem && problem.public_examples ? JSON.stringify(problem.public_examples, null, 2) : '';
    el('problemStarterCode').value = problem && problem.starter_code_templates ? JSON.stringify(problem.starter_code_templates, null, 2) : '';
  }

  function hideProblemEditor() {
    el('problemEditorSection').style.display = 'none';
  }

  async function handleProblemSubmit(e) {
    e.preventDefault();
    if (isSubmitting) return;

    const problemId = el('problemId').value;
    const contest_id = activeContestId;
    const title = el('problemTitle').value.trim();
    const difficulty = el('problemDifficulty').value;
    const score = parseInt(el('problemScore').value, 10);
    const problem_statement = el('problemStatement').value.trim();
    const input_format = el('problemInputFormat').value.trim();
    const output_format = el('problemOutputFormat').value.trim();
    const constraints = el('problemConstraints').value.trim();

    let public_examples = [];
    if (el('problemExamples').value.trim()) {
      try {
        public_examples = JSON.parse(el('problemExamples').value.trim());
      } catch (_e) {
        window.alert('Public Examples must be a valid JSON Array.');
        return;
      }
    }

    let starter_code_templates = {};
    if (el('problemStarterCode').value.trim()) {
      try {
        starter_code_templates = JSON.parse(el('problemStarterCode').value.trim());
      } catch (_e) {
        window.alert('Starter Code Templates must be a valid JSON Object.');
        return;
      }
    }

    const payload = {
      contest_id,
      title,
      difficulty,
      score,
      problem_statement,
      input_format,
      output_format,
      constraints,
      public_examples,
      starter_code_templates
    };

    isSubmitting = true;
    const btn = el('btnSaveProblem');
    if (btn) btn.disabled = true;

    try {
      if (problemId) {
        await apiFetch(`/api/admin/coding-challenges/problems/${problemId}`, { method: 'PUT', body: payload });
      } else {
        await apiFetch(`/api/admin/coding-challenges/contests/${contest_id}/problems`, { method: 'POST', body: payload });
      }

      hideProblemEditor();
      await loadProblems(activeContestId);
      await loadContests();
    } catch (err) {
      window.alert(`Error saving problem: ${err.message}`);
    } finally {
      isSubmitting = false;
      if (btn) btn.disabled = false;
    }
  }

  async function handleDeleteProblem(problemId) {
    if (!window.confirm('Delete this problem statement and all associated test cases?')) return;
    try {
      await apiFetch(`/api/admin/coding-challenges/problems/${problemId}`, { method: 'DELETE' });
      await loadProblems(activeContestId);
      await loadContests();
    } catch (err) {
      window.alert(`Failed to delete problem: ${err.message}`);
    }
  }

  /* --- Test Case Manager Modal --- */
  async function openTestCaseModal(problemId) {
    activeProblemId = problemId;
    const modal = el('testCaseModal');
    if (!modal) return;

    modal.style.display = 'flex';
    resetTestCaseForm();

    // Default to Single TC tab
    el('testCaseForm').style.display = 'block';
    el('bulkTestCaseSection').style.display = 'none';
    el('tabSingleTestCase').classList.add('active');
    el('tabBulkImportTestCase').classList.remove('active');

    await loadTestCases(problemId);
  }

  function closeTestCaseModal() {
    const modal = el('testCaseModal');
    if (modal) modal.style.display = 'none';
    activeProblemId = null;
  }

  async function loadTestCases(problemId) {
    const tbody = el('testCasesTbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 12px;">Loading test cases...</td></tr>';

    try {
      const data = await apiFetch(`/api/admin/coding-challenges/problems/${problemId}/test-cases`);
      const tcs = data.test_cases || [];

      if (tcs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 12px; color:#64748b;">No test cases found. Use form below or bulk import to add test cases.</td></tr>';
        return;
      }

      tbody.innerHTML = tcs
        .map((tc) => {
          const typeBadge = tc.is_hidden
            ? '<span class="badge-status cancelled"><i class="fa-solid fa-lock"></i> Hidden</span>'
            : '<span class="badge-status live"><i class="fa-solid fa-eye"></i> Sample</span>';

          const inSnippet = escapeHtml((tc.input_data || '').slice(0, 30)) + ((tc.input_data || '').length > 30 ? '...' : '');
          const outSnippet = escapeHtml((tc.expected_output || '').slice(0, 30)) + ((tc.expected_output || '').length > 30 ? '...' : '');

          return `
          <tr>
            <td>${typeBadge}</td>
            <td><code>${inSnippet || '(empty)'}</code></td>
            <td><code>${outSnippet || '(empty)'}</code></td>
            <td><strong>${tc.weight || 10}</strong> pts</td>
            <td>
              <div class="btn-group">
                <button class="btn-sm" data-action="edit-tc" data-tcid="${tc.id}"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-sm danger" data-action="delete-tc" data-tcid="${tc.id}"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
        })
        .join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#ef4444; padding:12px;">Failed to load test cases: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function resetTestCaseForm() {
    el('tcId').value = '';
    el('tcProblemId').value = activeProblemId || '';
    el('tcInput').value = '';
    el('tcOutput').value = '';
    el('tcWeight').value = '10';
    el('tcIsSample').checked = false;
    el('tcIsHidden').checked = true;
    el('btnSaveTc').textContent = 'Save Test Case';
  }

  async function handleTestCaseSubmit(e) {
    e.preventDefault();
    if (isSubmitting) return;

    const tcId = el('tcId').value;
    const problem_id = activeProblemId;
    const input_data = el('tcInput').value;
    const expected_output = el('tcOutput').value;
    const weight = parseInt(el('tcWeight').value, 10) || 10;
    const is_sample = el('tcIsSample').checked;
    const is_hidden = el('tcIsHidden').checked;

    const payload = {
      problem_id,
      input_data,
      expected_output,
      weight,
      is_sample,
      is_hidden
    };

    isSubmitting = true;
    const btn = el('btnSaveTc');
    if (btn) btn.disabled = true;

    try {
      if (tcId) {
        await apiFetch(`/api/admin/coding-challenges/test-cases/${tcId}`, { method: 'PUT', body: payload });
      } else {
        await apiFetch(`/api/admin/coding-challenges/problems/${problem_id}/test-cases`, { method: 'POST', body: payload });
      }

      resetTestCaseForm();
      await loadTestCases(activeProblemId);
      if (activeContestId) await loadProblems(activeContestId);
    } catch (err) {
      window.alert(`Error saving test case: ${err.message}`);
    } finally {
      isSubmitting = false;
      if (btn) btn.disabled = false;
    }
  }

  async function handleBulkTcSubmit() {
    if (isSubmitting) return;

    const rawJson = el('bulkTcJson').value.trim();
    if (!rawJson) {
      window.alert('Please paste a JSON array of test cases.');
      return;
    }

    let test_cases = [];
    try {
      test_cases = JSON.parse(rawJson);
      if (!Array.isArray(test_cases)) throw new Error('Root JSON must be an Array');
    } catch (e) {
      window.alert(`Invalid JSON format: ${e.message}`);
      return;
    }

    isSubmitting = true;
    const btn = el('btnSubmitBulkTc');
    if (btn) btn.disabled = true;

    try {
      await apiFetch(`/api/admin/coding-challenges/problems/${activeProblemId}/test-cases/bulk`, {
        method: 'POST',
        body: { test_cases }
      });

      el('bulkTcJson').value = '';
      window.alert('Bulk test cases imported successfully!');
      await loadTestCases(activeProblemId);
      if (activeContestId) await loadProblems(activeContestId);
    } catch (err) {
      window.alert(`Failed to import bulk test cases: ${err.message}`);
    } finally {
      isSubmitting = false;
      if (btn) btn.disabled = false;
    }
  }

  async function handleDeleteTestCase(tcId) {
    if (!window.confirm('Delete this test case?')) return;
    try {
      await apiFetch(`/api/admin/coding-challenges/test-cases/${tcId}`, { method: 'DELETE' });
      await loadTestCases(activeProblemId);
      if (activeContestId) await loadProblems(activeContestId);
    } catch (err) {
      window.alert(`Failed to delete test case: ${err.message}`);
    }
  }

  /* --- Contest Results & Leaderboard Modal --- */
  async function openResultsModal(contestId) {
    const modal = el('contestResultsModal');
    if (!modal) return;

    modal.style.display = 'flex';

    const tbody = el('resultsTbody');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:16px;">Loading contest results & proctoring reports...</td></tr>';

    try {
      const data = await apiFetch(`/api/admin/coding-challenges/contests/${contestId}/results`);
      const resObj = data.results || {};
      const contest = resObj.contest || {};
      const participants = resObj.participants || [];

      if (el('contestResultsTitle')) {
        el('contestResultsTitle').innerHTML = `
          Results & Integrity: ${escapeHtml(contest.title || 'Contest')}
          <button id="btnRunSimilarity" class="btn btn-sm btn-outline-primary" style="margin-left:12px;" data-contest-id="${contestId}">
            <i class="fa-solid fa-magnifying-glass"></i> Analyze Code Similarity
          </button>
        `;
        document.getElementById('btnRunSimilarity')?.addEventListener('click', async () => {
          try {
            const btn = document.getElementById('btnRunSimilarity');
            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...`;
            const simData = await apiFetch(`/api/admin/coding-challenges/contests/${contestId}/similarity/analyze`, { method: 'POST' });
            alert(`Plagiarism Analysis Complete! Flagged ${simData.flaggedCount || 0} pair(s).`);
            openResultsModal(contestId);
          } catch (err) {
            alert(`Similarity analysis failed: ${err.message}`);
          }
        });
      }

      if (el('resParticipants')) el('resParticipants').textContent = participants.length;
      if (el('resSubmissions')) el('resSubmissions').textContent = resObj.recent_submissions ? resObj.recent_submissions.length : 0;

      if (participants.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:16px; color:#64748b;">No submission results or participants recorded yet.</td></tr>';
        return;
      }

      tbody.innerHTML = participants
        .map(
          (r) => {
            const isDisqualified = r.status === 'disqualified';
            const riskRating = r.integrity_rating || 'Low';
            const riskBadgeColor = riskRating === 'High Review Priority' ? '#ef4444' : riskRating === 'Medium' ? '#f59e0b' : '#10b981';

            return `
        <tr style="${isDisqualified ? 'opacity:0.6; background:#fee2e211;' : ''}">
          <td><strong>${isDisqualified ? 'DISQ' : '#' + (r.rank || '-')}</strong></td>
          <td>
            <strong>${escapeHtml(r.full_name || 'Student')}</strong>
            <div style="font-size:12px; color:#64748b;">${escapeHtml(r.email || '')}</div>
          </td>
          <td><strong>${r.total_score || 0}</strong> pts</td>
          <td><strong>${r.problems_solved || 0}</strong> solved</td>
          <td>
            <div style="font-size:12px;">
              <span>Pastes: <strong>${r.paste_count || 0}</strong></span> |
              <span>Tabs: <strong>${r.tab_switch_count || 0}</strong></span>
            </div>
            <div style="font-size:12px;">Max Sim: <strong>${r.max_similarity || 0}%</strong></div>
          </td>
          <td>
            <span class="badge-status" style="background:${riskBadgeColor}22; color:${riskBadgeColor}; font-weight:700;">
              ${escapeHtml(riskRating)}
            </span>
          </td>
          <td>
            <span class="badge-status ${isDisqualified ? 'cancelled' : 'live'}">${isDisqualified ? 'Disqualified' : 'Active'}</span>
          </td>
          <td style="text-align:right;">
            ${
              !isDisqualified
                ? `<button class="btn btn-sm btn-outline-danger btn-disqualify" data-contest-id="${contestId}" data-student-id="${r.student_id}">
                    <i class="fa-solid fa-ban"></i> Disqualify
                   </button>`
                : '<span class="text-muted" style="font-size:12px;">Disqualified</span>'
            }
          </td>
        </tr>
      `;
          }
        )
        .join('');

      tbody.querySelectorAll('.btn-disqualify').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const reason = prompt('Enter disqualification reason for audit trail:');
          if (reason !== null) {
            try {
              await apiFetch(`/api/admin/coding-challenges/contests/${btn.dataset.contestId}/participants/${btn.dataset.studentId}/disqualify`, {
                method: 'POST',
                body: { reason: reason || 'Integrity violation' }
              });
              alert('Participant disqualified and leaderboard recalculated safely.');
              openResultsModal(contestId);
            } catch (err) {
              alert(`Disqualification failed: ${err.message}`);
            }
          }
        });
      });

      // Contest Finalize button setup
      const finalizeBtn = el('btnFinalizeContest');
      if (finalizeBtn) {
        finalizeBtn.dataset.contestId = contestId;
        finalizeBtn.onclick = async () => {
          if (!confirm('Finalize contest results, freeze rankings, award season leaderboard points, and generate Top 3 certificates?')) return;
          try {
            finalizeBtn.disabled = true;
            finalizeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Finalizing...';
            const finData = await apiFetch(`/api/admin/coding-challenges/contests/${contestId}/finalize`, { method: 'POST' });
            alert(`Contest finalized! Generated ${finData.result?.certificatesCount || 3} Top 3 certificate record(s).`);
            openResultsModal(contestId);
          } catch (err) {
            alert(`Finalization failed: ${err.message}`);
          } finally {
            finalizeBtn.disabled = false;
            finalizeBtn.innerHTML = '<i class="fa-solid fa-trophy"></i> Finalize Contest & Issue Certificates';
          }
        };
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#ef4444; padding:16px;">Failed to load results: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function closeResultsModal() {
    const modal = el('contestResultsModal');
    if (modal) modal.style.display = 'none';
  }

  /* --- Certificate Template Manager --- */
  let currentTemplates = [];
  let activeTemplate = null;

  async function loadCertificateTemplates() {
    try {
      const data = await apiFetch('/api/admin/coding-challenges/templates');
      currentTemplates = data.templates || [];

      // Populate contest form dropdown
      const select = el('contestCertificateTemplate');
      if (select) {
        select.innerHTML = '<option value="">Default Certificate Template</option>' +
          currentTemplates.map((t) => `<option value="${t.id}">${escapeHtml(t.name)} (v${t.active_version_number || 1})</option>`).join('');
      }

      renderTemplatesList();
    } catch (err) {
      console.error('Failed to load certificate templates:', err);
    }
  }

  function renderTemplatesList() {
    const container = el('templatesList');
    if (!container) return;

    if (currentTemplates.length === 0) {
      container.innerHTML = '<div style="padding:12px; color:#64748b; font-size:13px; text-align:center;">No templates created yet. Click "New" to start.</div>';
      return;
    }

    container.innerHTML = currentTemplates
      .map((t) => {
        const isActive = activeTemplate && activeTemplate.id === t.id;
        return `
          <div class="template-item" data-id="${t.id}" style="padding:10px; border:1px solid ${isActive ? '#4338ca' : '#e2e8f0'}; border-radius:8px; background:${isActive ? '#e0e7ff' : '#fff'}; cursor:pointer;">
            <div style="font-weight:600; font-size:13px; color:#1e293b;">${escapeHtml(t.name)}</div>
            <div style="font-size:11px; color:#64748b;">Active Ver: v${t.active_version_number || 1}</div>
          </div>
        `;
      })
      .join('');

    container.querySelectorAll('.template-item').forEach((item) => {
      item.addEventListener('click', () => {
        const tObj = currentTemplates.find((t) => t.id === item.dataset.id);
        if (tObj) selectTemplateForEditing(tObj);
      });
    });
  }

  function selectTemplateForEditing(tObj) {
    activeTemplate = tObj;
    renderTemplatesList();

    const config = (tObj.active_configuration) || {};
    el('tplId').value = tObj.id;
    el('tplName').value = tObj.name || '';
    el('tplTheme').value = config.styling?.theme_accent || 'gold';
    el('tplTitle').value = config.title || 'CERTIFICATE OF ACHIEVEMENT';
    el('tplSubtitle').value = config.subtitle || 'This is proudly presented to';
    el('tplBody').value = config.body || 'for securing {{position}} Position in {{contest_name}} held on {{contest_date}}.';
    el('tplPartnerLabel').value = config.partner_label || 'Powered by';
    el('tplPartnerName').value = config.partner_name || '';
    el('tplOrgName').value = config.organization_name || 'College OS';
    el('tplFooter').value = config.footer || 'College OS Verified Academic Credential';

    updateLivePreview();
  }

  function updateLivePreview() {
    const theme = el('tplTheme')?.value || 'gold';
    const rank = parseInt(el('previewRankSelect')?.value || '1', 10);
    const container = el('livePreviewContainer');

    let borderColor = '#D4AF37'; // Gold
    let posText = '1st Position';
    if (rank === 2 || theme === 'silver') {
      borderColor = '#C0C0C0';
      posText = '2nd Position';
    } else if (rank === 3 || theme === 'bronze') {
      borderColor = '#CD7F32';
      posText = '3rd Position';
    } else if (theme === 'classic_blue') {
      borderColor = '#38BDF8';
    }

    if (container) container.style.borderColor = borderColor;

    if (el('prevTitle')) el('prevTitle').textContent = el('tplTitle')?.value || 'CERTIFICATE OF ACHIEVEMENT';
    if (el('prevSubtitle')) el('prevSubtitle').textContent = el('tplSubtitle')?.value || 'This is proudly presented to';

    const bodyTemplate = el('tplBody')?.value || 'for securing {{position}} Position in {{contest_name}} held on {{contest_date}}.';
    let renderedBody = bodyTemplate
      .replace(/{{position}}/g, posText)
      .replace(/{{contest_name}}/g, 'Weekly CodeRush #14')
      .replace(/{{contest_date}}/g, new Date().toLocaleDateString())
      .replace(/{{student_name}}/g, 'Alex Morgan');

    if (el('prevBody')) el('prevBody').textContent = renderedBody;

    const partnerName = el('tplPartnerName')?.value || '';
    const partnerLabel = el('tplPartnerLabel')?.value || 'Powered by';
    if (el('prevPartner')) {
      el('prevPartner').textContent = partnerName ? `${partnerLabel}: ${partnerName}` : '';
    }

    if (el('prevFooter')) el('prevFooter').textContent = el('tplFooter')?.value || 'College OS Verified Academic Credential';
  }

  function openTemplateModal() {
    const modal = el('templateModal');
    if (!modal) return;
    modal.style.display = 'flex';
    loadCertificateTemplates().then(() => {
      if (currentTemplates.length > 0) selectTemplateForEditing(currentTemplates[0]);
    });
  }

  function closeTemplateModal() {
    const modal = el('templateModal');
    if (modal) modal.style.display = 'none';
  }

  async function handleSaveTemplate(e, createNewVersion = false) {
    if (e) e.preventDefault();
    const tplId = el('tplId').value;
    const name = el('tplName').value.trim();

    if (!name) {
      alert('Please provide a Template Name');
      return;
    }

    const configuration = {
      template_name: name,
      title: el('tplTitle').value,
      subtitle: el('tplSubtitle').value,
      body: el('tplBody').value,
      footer: el('tplFooter').value,
      organization_name: el('tplOrgName').value,
      partner_label: el('tplPartnerLabel').value,
      partner_name: el('tplPartnerName').value,
      styling: {
        theme_accent: el('tplTheme').value,
        show_qr: true,
        show_cert_id: true
      }
    };

    try {
      if (tplId) {
        await apiFetch(`/api/admin/coding-challenges/templates/${tplId}`, {
          method: 'PUT',
          body: { name, configuration, createNewVersion }
        });
        alert(`Template ${createNewVersion ? 'saved as new version' : 'updated'} successfully!`);
      } else {
        await apiFetch('/api/admin/coding-challenges/templates', {
          method: 'POST',
          body: { name, configuration }
        });
        alert('New Certificate Template created!');
      }

      await loadCertificateTemplates();
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    }
  }

  /* --- Event Listeners Setup --- */
  function initEventListeners() {
    // Filter tabs
    document.querySelectorAll('.filter-btn[data-status]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn[data-status]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.status;
        renderContestsTable();
      });
    });

    // Create Contest button
    if (el('btnCreateContest')) {
      el('btnCreateContest').addEventListener('click', () => openContestModal(null));
    }
    if (el('btnCloseContestModal')) {
      el('btnCloseContestModal').addEventListener('click', closeContestModal);
    }
    if (el('btnCancelContestModal')) {
      el('btnCancelContestModal').addEventListener('click', closeContestModal);
    }
    if (el('contestForm')) {
      el('contestForm').addEventListener('submit', handleContestSubmit);
    }

    // Template Manager Listeners
    if (el('btnManageTemplates')) el('btnManageTemplates').addEventListener('click', openTemplateModal);
    if (el('btnCloseTemplateModal')) el('btnCloseTemplateModal').addEventListener('click', closeTemplateModal);

    if (el('templateEditorForm')) {
      el('templateEditorForm').addEventListener('submit', (e) => handleSaveTemplate(e, false));
    }
    if (el('btnSaveNewVer')) {
      el('btnSaveNewVer').addEventListener('click', (e) => handleSaveTemplate(e, true));
    }
    if (el('btnNewTemplate')) {
      el('btnNewTemplate').addEventListener('click', () => {
        activeTemplate = null;
        el('tplId').value = '';
        el('tplName').value = 'New Custom Certificate Template';
        updateLivePreview();
      });
    }

    // Live preview update triggers
    ['tplTitle', 'tplSubtitle', 'tplBody', 'tplPartnerLabel', 'tplPartnerName', 'tplOrgName', 'tplFooter', 'tplTheme', 'previewRankSelect']
      .forEach((id) => {
        const elem = el(id);
        if (elem) {
          elem.addEventListener('input', updateLivePreview);
          elem.addEventListener('change', updateLivePreview);
        }
      });

    // Contest Action delegation
    const contestsTbody = el('contestsTbody');
    if (contestsTbody) {
      contestsTbody.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const id = btn.dataset.id;

        if (action === 'edit-contest') {
          const contest = currentContests.find((c) => c.id === id);
          if (contest) openContestModal(contest);
        } else if (action === 'manage-problems') {
          openProblemManagerModal(id);
        } else if (action === 'view-results') {
          openResultsModal(id);
        } else if (action === 'duplicate-contest') {
          handleDuplicateContest(id);
        } else if (action === 'publish-contest') {
          handleUpdateContestStatus(id, 'scheduled');
        } else if (action === 'cancel-contest') {
          handleUpdateContestStatus(id, 'cancelled');
        } else if (action === 'delete-contest') {
          handleDeleteContest(id);
        }
      });
    }

    // Problem Manager Events
    if (el('btnCloseProblemManagerModal')) el('btnCloseProblemManagerModal').addEventListener('click', closeProblemManagerModal);
    if (el('btnAddNewProblem')) el('btnAddNewProblem').addEventListener('click', () => showProblemEditor(null));
    if (el('btnCancelProblemEdit')) el('btnCancelProblemEdit').addEventListener('click', hideProblemEditor);
    if (el('problemForm')) el('problemForm').addEventListener('submit', handleProblemSubmit);

    const problemsTbody = el('problemsTbody');
    if (problemsTbody) {
      problemsTbody.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const pid = btn.dataset.pid;

        if (action === 'edit-problem') {
          const data = await apiFetch(`/api/admin/coding-challenges/contests/${activeContestId}/problems`);
          const problem = (data.problems || []).find((p) => p.id === pid);
          if (problem) showProblemEditor(problem);
        } else if (action === 'manage-testcases') {
          openTestCaseModal(pid);
        } else if (action === 'delete-problem') {
          handleDeleteProblem(pid);
        }
      });
    }

    // Test Case Manager Events
    if (el('btnCloseTestCaseModal')) el('btnCloseTestCaseModal').addEventListener('click', closeTestCaseModal);
    if (el('testCaseForm')) el('testCaseForm').addEventListener('submit', handleTestCaseSubmit);
    if (el('btnResetTcForm')) el('btnResetTcForm').addEventListener('click', resetTestCaseForm);
    if (el('btnSubmitBulkTc')) el('btnSubmitBulkTc').addEventListener('click', handleBulkTcSubmit);

    if (el('tabSingleTestCase')) {
      el('tabSingleTestCase').addEventListener('click', () => {
        el('tabSingleTestCase').classList.add('active');
        el('tabBulkImportTestCase').classList.remove('active');
        el('testCaseForm').style.display = 'block';
        el('bulkTestCaseSection').style.display = 'none';
      });
    }
    if (el('tabBulkImportTestCase')) {
      el('tabBulkImportTestCase').addEventListener('click', () => {
        el('tabBulkImportTestCase').classList.add('active');
        el('tabSingleTestCase').classList.remove('active');
        el('testCaseForm').style.display = 'none';
        el('bulkTestCaseSection').style.display = 'block';
      });
    }

    const testCasesTbody = el('testCasesTbody');
    if (testCasesTbody) {
      testCasesTbody.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const tcid = btn.dataset.tcid;

        if (action === 'edit-tc') {
          const data = await apiFetch(`/api/admin/coding-challenges/problems/${activeProblemId}/test-cases`);
          const tc = (data.test_cases || []).find((item) => item.id === tcid);
          if (tc) {
            el('tcId').value = tc.id;
            el('tcInput').value = tc.input_data || '';
            el('tcOutput').value = tc.expected_output || '';
            el('tcWeight').value = tc.weight || 10;
            el('tcIsSample').checked = tc.is_sample === true;
            el('tcIsHidden').checked = tc.is_hidden === true;
            el('btnSaveTc').textContent = 'Update Test Case';
            el('testCaseForm').style.display = 'block';
            el('bulkTestCaseSection').style.display = 'none';
          }
        } else if (action === 'delete-tc') {
          handleDeleteTestCase(tcid);
        }
      });
    }

    // Results Modal Events
    if (el('btnCloseResultsModal')) el('btnCloseResultsModal').addEventListener('click', closeResultsModal);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    initEventListeners();
    await loadDashboardStats();
    await loadContests();
    await loadCertificateTemplates();
  });
})();

