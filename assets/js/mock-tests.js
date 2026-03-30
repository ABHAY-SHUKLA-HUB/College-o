function mockParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

function mockEsc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderBar(value, max = 100) {
  const safe = Math.max(0, Math.min(max, Number(value || 0)));
  return `<div class="metric-bar"><span style="width:${safe}%"></span></div>`;
}

function formatPct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatHours(value) {
  return Number(value || 0).toFixed(1);
}

function formatDate(value) {
  if (!value) return '--';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTimeSpent(seconds) {
  const n = Math.max(0, Number(seconds || 0));
  const mins = Math.floor(n / 60);
  const sec = n % 60;
  return `${mins}m ${sec}s`;
}

async function loadPremiumMockDashboard() {
  const root = document.getElementById('mockDashboardRoot');
  if (!root || !window.CollegeOSApi) return;

  const testsNode = document.getElementById('availableTestsGrid');
  const recNode = document.getElementById('recommendedTestsGrid');
  const recentNode = document.getElementById('recentAttemptsTableBody');
  const lbNode = document.getElementById('mockLeaderboardBody');
  const catNode = document.getElementById('mockCategoryGrid');
  const aiNode = document.getElementById('mockAiInsights');
  const statNode = {
    attempted: document.getElementById('statAttemptedTests'),
    avg: document.getElementById('statAverageScore'),
    accuracy: document.getElementById('statAccuracy'),
    bestRank: document.getElementById('statBestRank'),
    percentile: document.getElementById('statPercentile'),
    hours: document.getElementById('statPracticeHours')
  };

  const searchInput = document.getElementById('mockSearchInput');
  const categoryFilter = document.getElementById('mockCategoryFilter');
  const accessFilter = document.getElementById('mockAccessFilter');

  let tests = [];
  let recommended = [];

  function renderTests() {
    const q = String(searchInput?.value || '').trim().toLowerCase();
    const category = String(categoryFilter?.value || 'all');
    const access = String(accessFilter?.value || 'all');

    const filtered = tests.filter((t) => {
      const passQuery = !q || String(t.title || '').toLowerCase().includes(q) || String(t.subject || '').toLowerCase().includes(q) || String(t.topic || '').toLowerCase().includes(q);
      const passCategory = category === 'all' || String(t.category_key || 'grand') === category;
      const passAccess = access === 'all' || String(t.access_type || 'free') === access;
      return passQuery && passCategory && passAccess;
    });

    if (!filtered.length) {
      testsNode.innerHTML = '<div class="empty-state">No tests match your filters.</div>';
      return;
    }

    testsNode.innerHTML = filtered.map((t) => {
      const locked = Boolean(t.locked);
      const lastPerf = t.previous_performance;
      const analysisHref = t.last_attempt_id ? `mock-test-results.html?attemptId=${encodeURIComponent(t.last_attempt_id)}` : '#';
      const syllabusText = t.syllabus || `${t.subject || 'General'} - ${t.topic || 'Mixed Topics'}`;

      return `
        <article class="mock-test-card ${locked ? 'locked' : ''}">
          <header>
            <div>
              <h4>${mockEsc(t.title)}</h4>
              <p>${mockEsc(t.subject || 'General')} · ${mockEsc(t.topic || 'General')}</p>
            </div>
            <div class="card-badges">
              <span class="badge category">${mockEsc(String(t.category_key || 'grand').toUpperCase())}</span>
              <span class="badge difficulty ${mockEsc(String(t.difficulty || 'medium').toLowerCase())}">${mockEsc(String(t.difficulty || 'medium'))}</span>
            </div>
          </header>
          <div class="card-metrics">
            <div><label>Duration</label><strong>${Number(t.duration_minutes || 0)} min</strong></div>
            <div><label>Questions</label><strong>${Number(t.total_questions || 0)}</strong></div>
            <div><label>Total Marks</label><strong>${Number(t.total_marks || 0)}</strong></div>
            <div><label>Participants</label><strong>${Number(t.participants_count || 0)}</strong></div>
            <div><label>Percentile</label><strong>${t.last_percentile ? formatPct(t.last_percentile) : '--'}</strong></div>
            <div><label>Branch</label><strong>${mockEsc(t.branch_name || t.branch_relevance || 'General')}</strong></div>
          </div>
          <div class="perf-snippet">
            ${lastPerf
              ? `<div>Last Score: <strong>${Number(lastPerf.marks || 0)}</strong></div><div>Rank: <strong>#${Number(lastPerf.rank || 0) || '--'}</strong></div><div>Accuracy: <strong>${formatPct(lastPerf.accuracy || 0)}</strong></div>`
              : '<div>No previous attempts yet.</div>'}
          </div>
          ${locked ? `<div class="lock-banner"><i class="fa-solid fa-lock"></i> ${mockEsc(t.lockReason || 'Upgrade to access this mock test')} <a href="pricing.html">Upgrade</a></div>` : ''}
          <footer class="card-actions">
            <a class="btn primary ${locked ? 'disabled' : ''}" ${locked ? 'aria-disabled="true"' : ''} href="${locked ? 'pricing.html' : `mock-test-attempt.html?mockTestId=${encodeURIComponent(t.id)}`}">${locked ? 'Locked' : 'Start Test'}</a>
            <a class="btn secondary ${!t.last_attempt_id ? 'disabled' : ''}" href="${analysisHref}">View Analysis</a>
            <button class="btn ghost" type="button" data-syllabus="${mockEsc(syllabusText)}">View Syllabus</button>
          </footer>
        </article>
      `;
    }).join('');

    testsNode.querySelectorAll('[data-syllabus]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const text = btn.getAttribute('data-syllabus') || 'Syllabus not available';
        window.alert(text);
      });
    });
  }

  function renderRecommended() {
    if (!recommended.length) {
      recNode.innerHTML = '<div class="empty-state">No recommendations available right now.</div>';
      return;
    }
    recNode.innerHTML = recommended.map((t) => `
      <article class="recommend-card">
        <h4>${mockEsc(t.title)}</h4>
        <p>${mockEsc(t.subject || 'General')} · ${mockEsc(t.topic || 'General')}</p>
        <div class="recommend-meta">
          <span>${mockEsc(String(t.category_key || 'grand'))}</span>
          <span>${mockEsc(String(t.difficulty || 'medium'))}</span>
          <span>${Number(t.duration_minutes || 0)}m</span>
        </div>
        <a class="btn secondary" href="mock-test-attempt.html?mockTestId=${encodeURIComponent(t.id)}">Start Suggested Test</a>
      </article>
    `).join('');
  }

  try {
    const data = await window.CollegeOSApi.getMockTestsDashboard();

    tests = data.tests || [];
    recommended = data.recommended || [];

    const overview = data.overview || {};
    statNode.attempted.textContent = Number(overview.attemptedTests || 0);
    statNode.avg.textContent = Number(overview.averageScore || 0).toFixed(1);
    statNode.accuracy.textContent = formatPct(overview.accuracyPercentage || 0);
    statNode.bestRank.textContent = overview.bestRank ? `#${Number(overview.bestRank)}` : '--';
    statNode.percentile.textContent = formatPct(overview.percentile || 0);
    statNode.hours.textContent = formatHours(overview.totalPracticeHours || 0);

    const categories = data.categories || [];
    catNode.innerHTML = categories.map((c) => `
      <article class="category-card">
        <span class="cat-icon"><i class="fa-solid ${mockEsc(c.icon || 'fa-layer-group')}"></i></span>
        <div>
          <h4>${mockEsc(c.title)}</h4>
          <p>${mockEsc(c.description)}</p>
        </div>
        <strong>${Number(c.testsAvailable || 0)} tests</strong>
      </article>
    `).join('');

    renderRecommended();
    renderTests();

    const recent = data.recentAttempts || [];
    if (!recent.length) {
      recentNode.innerHTML = '<tr><td colspan="6" class="table-empty">No attempts yet.</td></tr>';
    } else {
      recentNode.innerHTML = recent.map((a) => `
        <tr>
          <td>${mockEsc(a.title || 'Mock Test')}</td>
          <td>${Number(a.marks_obtained || 0)}/${Number(a.total_possible_marks || 0)}</td>
          <td>${a.rank_india ? `#${Number(a.rank_india)}` : '--'}</td>
          <td>${formatPct(a.accuracy_percent || 0)}</td>
          <td>${formatDate(a.attempted_at)}</td>
          <td>${formatTimeSpent(a.time_spent_seconds || 0)}</td>
        </tr>
      `).join('');
    }

    const leaderboard = data.leaderboard || [];
    if (!leaderboard.length) {
      lbNode.innerHTML = '<tr><td colspan="5" class="table-empty">Leaderboard will appear after attempts.</td></tr>';
    } else {
      lbNode.innerHTML = leaderboard.slice(0, 8).map((u, idx) => `
        <tr>
          <td>#${idx + 1}</td>
          <td>${mockEsc(u.full_name || 'Student')}</td>
          <td>${mockEsc(u.course_branch || 'General')}</td>
          <td>${Number(u.avg_score || 0).toFixed(1)}</td>
          <td>${formatPct(u.best_percentile || 0)}</td>
        </tr>
      `).join('');
    }

    const ai = data.aiInsights || {};
    const weakTopics = ai.weakTopics || [];
    aiNode.innerHTML = `
      <div class="ai-block">
        <h4><i class="fa-solid fa-brain"></i> Weak Topic Detection</h4>
        ${weakTopics.length
          ? weakTopics.map((t) => `<p>${mockEsc(t.topic)}: ${formatPct(t.accuracy)} accuracy</p>`).join('')
          : '<p>No weak topics detected yet. Attempt more tests for deeper insights.</p>'}
      </div>
      <div class="ai-block">
        <h4><i class="fa-solid fa-bullseye"></i> Next Recommended Test</h4>
        <p>${ai.nextRecommendedTest ? mockEsc(ai.nextRecommendedTest.title) : 'No recommendation yet'}</p>
      </div>
      <div class="ai-block">
        <h4><i class="fa-solid fa-lightbulb"></i> Improvement Tips</h4>
        ${(ai.suggestions || []).slice(0, 3).map((tip) => `<p>${mockEsc(tip)}</p>`).join('') || '<p>Review your last attempt and retry with time tracking.</p>'}
      </div>
    `;

    if (searchInput) searchInput.addEventListener('input', renderTests);
    if (categoryFilter) categoryFilter.addEventListener('change', renderTests);
    if (accessFilter) accessFilter.addEventListener('change', renderTests);
  } catch (error) {
    root.innerHTML = `<div class="empty-state">${mockEsc(error.message)}</div>`;
  }
}

async function loadMockTestAttempt() {
  const root = document.getElementById('mockAttemptRoot');
  if (!root || !window.CollegeOSApi) return;

  const mockTestId = Number(mockParam('mockTestId') || 0);
  if (!Number.isFinite(mockTestId) || mockTestId < 1) {
    root.innerHTML = '<div class="empty-state">Invalid mock test id.</div>';
    return;
  }

  const refs = {
    title: document.getElementById('examTitle'),
    total: document.getElementById('examTotalQuestions'),
    current: document.getElementById('examCurrentQuestion'),
    timer: document.getElementById('examTimer'),
    attempted: document.getElementById('examAttemptedCount'),
    remaining: document.getElementById('examRemainingCount'),
    section: document.getElementById('examCurrentSection'),
    qText: document.getElementById('examQuestionText'),
    qBadge: document.getElementById('examQuestionMeta'),
    optionWrap: document.getElementById('examOptionGrid'),
    palette: document.getElementById('examPaletteGrid'),
    prev: document.getElementById('examPrevBtn'),
    next: document.getElementById('examNextBtn'),
    skip: document.getElementById('examSkipBtn'),
    review: document.getElementById('examReviewBtn'),
    saveNext: document.getElementById('examSaveNextBtn'),
    submit: document.getElementById('examSubmitBtn')
  };

  const state = {
    test: null,
    questions: [],
    currentIndex: 0,
    answers: new Map(),
    skipped: new Set(),
    marked: new Set(),
    remainingSec: 0,
    timerId: null,
    startedAt: Date.now()
  };

  function answerKey(value) {
    if (Array.isArray(value)) return value.join('|');
    return String(value);
  }

  function getQuestionState(index) {
    if (index === state.currentIndex) return 'current';
    if (state.marked.has(index)) return 'review';
    if (state.answers.has(index)) return 'answered';
    if (state.skipped.has(index)) return 'skipped';
    return 'not-visited';
  }

  function updateHeader() {
    const attempted = state.answers.size;
    const remaining = Math.max(0, state.questions.length - attempted);
    const q = state.questions[state.currentIndex];
    refs.current.textContent = String(state.currentIndex + 1);
    refs.total.textContent = String(state.questions.length);
    refs.attempted.textContent = String(attempted);
    refs.remaining.textContent = String(remaining);
    refs.section.textContent = mockEsc(q.section || 'General');
  }

  function renderPalette() {
    refs.palette.innerHTML = state.questions.map((_q, idx) => {
      const status = getQuestionState(idx);
      return `<button type="button" class="palette-btn ${status}" data-idx="${idx}">${idx + 1}</button>`;
    }).join('');

    refs.palette.querySelectorAll('[data-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.currentIndex = Number(btn.getAttribute('data-idx'));
        renderQuestion();
      });
    });
  }

  function renderOptions(question) {
    const selected = state.answers.get(state.currentIndex);
    const type = String(question.type || 'single_mcq');
    const isMulti = type === 'multi_select';
    const options = Array.isArray(question.options) ? question.options : [];

    refs.optionWrap.innerHTML = options.map((opt, i) => {
      const key = String(opt.key || String.fromCharCode(65 + i));
      const text = String(opt.text || opt.label || `Option ${key}`);
      const selectedNow = isMulti
        ? Array.isArray(selected) && selected.includes(key)
        : selected === key;
      return `
        <button type="button" class="exam-option ${selectedNow ? 'selected' : ''}" data-key="${mockEsc(key)}">
          <span class="opt-key">${mockEsc(key)}</span>
          <span class="opt-text">${mockEsc(text)}</span>
        </button>
      `;
    }).join('');

    refs.optionWrap.querySelectorAll('[data-key]').forEach((node) => {
      node.addEventListener('click', () => {
        const key = node.getAttribute('data-key');
        if (!key) return;
        if (isMulti) {
          const next = Array.isArray(selected) ? [...selected] : [];
          const index = next.indexOf(key);
          if (index >= 0) next.splice(index, 1);
          else next.push(key);
          state.answers.set(state.currentIndex, next);
        } else {
          state.answers.set(state.currentIndex, key);
        }
        state.skipped.delete(state.currentIndex);
        renderQuestion();
      });
    });
  }

  function renderQuestion() {
    const question = state.questions[state.currentIndex];
    refs.qText.textContent = question.text;
    refs.qBadge.innerHTML = `
      <span class="badge">Q${state.currentIndex + 1}</span>
      <span class="badge">${mockEsc(String(question.type || 'single_mcq').toUpperCase())}</span>
      <span class="badge">${mockEsc(String(question.difficulty || 'medium'))}</span>
      <span class="badge">${mockEsc(question.section || 'General')}</span>
    `;
    renderOptions(question);
    renderPalette();
    updateHeader();
  }

  function move(delta) {
    const next = state.currentIndex + delta;
    if (next < 0 || next >= state.questions.length) return;
    state.currentIndex = next;
    renderQuestion();
  }

  function tick() {
    const mins = Math.floor(state.remainingSec / 60);
    const secs = state.remainingSec % 60;
    refs.timer.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    if (state.remainingSec <= 0) {
      submit(true);
      return;
    }
    state.remainingSec -= 1;
  }

  async function submit(isAuto = false) {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
    const responses = state.questions.map((q, idx) => ({
      questionId: q.id,
      answer: state.answers.has(idx) ? state.answers.get(idx) : null
    }));
    const timeSpentSeconds = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));

    try {
      const payload = await window.CollegeOSApi.submitMockTest(mockTestId, { responses, timeSpentSeconds });
      await window.CollegeOSApi.trackLearnerEvent({
        eventType: 'mock_session_completed',
        source: 'web',
        eventPayload: {
          mockTestId,
          responseCount: responses.length,
          timeSpentSeconds,
          autoSubmitted: isAuto
        }
      });
      const attemptId = payload?.attempt?.id;
      if (!attemptId) throw new Error('Attempt submission failed');
      window.location.href = `mock-test-results.html?attemptId=${encodeURIComponent(attemptId)}${isAuto ? '&auto=1' : ''}`;
    } catch (error) {
      window.alert(error.message);
    }
  }

  refs.prev.addEventListener('click', () => move(-1));
  refs.next.addEventListener('click', () => move(1));
  refs.saveNext.addEventListener('click', () => move(1));
  refs.skip.addEventListener('click', () => {
    if (!state.answers.has(state.currentIndex)) state.skipped.add(state.currentIndex);
    move(1);
  });
  refs.review.addEventListener('click', () => {
    if (state.marked.has(state.currentIndex)) state.marked.delete(state.currentIndex);
    else state.marked.add(state.currentIndex);
    renderQuestion();
  });
  refs.submit.addEventListener('click', () => submit(false));

  try {
    const payload = await window.CollegeOSApi.startMockTest(mockTestId);
    await window.CollegeOSApi.trackLearnerEvent({
      eventType: 'mock_session_started',
      source: 'web',
      eventPayload: { mockTestId }
    });
    state.test = payload.test;
    state.questions = payload.questions || [];
    if (!state.questions.length) {
      root.innerHTML = '<div class="empty-state">No questions configured for this test yet.</div>';
      return;
    }

    refs.title.textContent = state.test.title;
    state.remainingSec = Number(state.test.durationMinutes || 60) * 60;
    tick();
    state.timerId = setInterval(tick, 1000);
    renderQuestion();
  } catch (error) {
    root.innerHTML = `<div class="empty-state">${mockEsc(error.message)}</div>`;
  }
}

async function loadMockTestResults() {
  const root = document.getElementById('mockResultRoot');
  if (!root || !window.CollegeOSApi) return;

  const attemptId = Number(mockParam('attemptId') || 0);
  if (!Number.isFinite(attemptId) || attemptId < 1) {
    root.innerHTML = '<div class="empty-state">Invalid result link.</div>';
    return;
  }

  try {
    const data = await window.CollegeOSApi.getMockTestResult(attemptId);
    const r = data.result || {};
    const comparison = data.comparison || {};
    const charts = data.charts || {};
    const ai = data.aiAnalysis || {};

    document.getElementById('resScore').textContent = `${Number(r.marks_obtained || 0)}/${Number(r.total_possible_marks || 0)}`;
    document.getElementById('resCorrect').textContent = Number(r.correct_answers || 0);
    document.getElementById('resWrong').textContent = Number(r.wrong_answers || 0);
    document.getElementById('resSkipped').textContent = Number(r.skipped_answers || 0);
    document.getElementById('resAccuracy').textContent = formatPct(r.accuracy_percent || 0);
    document.getElementById('resPercentile').textContent = formatPct(r.percentile || 0);
    document.getElementById('resRank').textContent = r.rank_india ? `#${Number(r.rank_india)}` : '--';

    document.getElementById('compareYourScore').textContent = Number(comparison.yourScore || 0).toFixed(1);
    document.getElementById('compareAvgScore').textContent = Number(comparison.averageScore || 0).toFixed(1);
    document.getElementById('compareTopScore').textContent = Number(comparison.topScore || 0).toFixed(1);
    document.getElementById('compareBranchRank').textContent = comparison.branchRank ? `#${Number(comparison.branchRank)} / ${Number(comparison.branchParticipants || 0)}` : '--';
    document.getElementById('compareOverallRank').textContent = comparison.overallRank ? `#${Number(comparison.overallRank)}` : '--';

    const scoreBreakdown = charts.scoreBreakdown || {};
    document.getElementById('chartScoreBreakdown').innerHTML = `
      <div><label>Correct</label>${renderBar(Number(scoreBreakdown.correct || 0) * 5)}<strong>${Number(scoreBreakdown.correct || 0)}</strong></div>
      <div><label>Wrong</label>${renderBar(Number(scoreBreakdown.wrong || 0) * 5)}<strong>${Number(scoreBreakdown.wrong || 0)}</strong></div>
      <div><label>Skipped</label>${renderBar(Number(scoreBreakdown.skipped || 0) * 5)}<strong>${Number(scoreBreakdown.skipped || 0)}</strong></div>
    `;

    const sectionRows = Array.isArray(charts.sectionWise) ? charts.sectionWise : [];
    document.getElementById('chartSectionWise').innerHTML = sectionRows.length
      ? sectionRows.map((s) => `<div><label>${mockEsc(s.section)}</label>${renderBar(Number(s.accuracy || 0))}<strong>${formatPct(s.accuracy || 0)}</strong></div>`).join('')
      : '<p class="muted">Section analytics unavailable.</p>';

    const topicRows = Array.isArray(charts.topicWise) ? charts.topicWise : [];
    document.getElementById('chartTopicWise').innerHTML = topicRows.length
      ? topicRows.map((t) => `<div><label>${mockEsc(t.topic)}</label>${renderBar(Number(t.accuracy || 0))}<strong>${formatPct(t.accuracy || 0)}</strong></div>`).join('')
      : '<p class="muted">Topic analytics unavailable.</p>';

    const strong = ai.strongTopics || [];
    const weak = ai.weakTopics || [];
    document.getElementById('strongTopics').innerHTML = strong.length
      ? strong.map((x) => `<li>${mockEsc(x.topic)} (${formatPct(x.accuracy || 0)})</li>`).join('')
      : '<li>No strong-topic trend yet.</li>';
    document.getElementById('weakTopics').innerHTML = weak.length
      ? weak.map((x) => `<li>${mockEsc(x.topic)} (${formatPct(x.accuracy || 0)})</li>`).join('')
      : '<li>No weak-topic alerts detected.</li>';

    document.getElementById('aiSuggestions').innerHTML = (ai.suggestions || [])
      .slice(0, 4)
      .map((tip) => `<li>${mockEsc(tip)}</li>`)
      .join('') || '<li>Attempt another test for detailed AI suggestions.</li>';

    const review = data.review || [];
    document.getElementById('reviewList').innerHTML = review.length
      ? review.map((q) => `
        <article class="review-item ${q.isCorrect ? 'correct' : 'wrong'}">
          <h4>${mockEsc(q.questionText)}</h4>
          <p><strong>Your Answer:</strong> ${mockEsc(Array.isArray(q.submittedAnswer) ? q.submittedAnswer.join(', ') : (q.submittedAnswer ?? 'Skipped'))}</p>
          <p><strong>Correct Answer:</strong> ${mockEsc(Array.isArray(q.correctAnswer) ? q.correctAnswer.join(', ') : (q.correctAnswer ?? '--'))}</p>
          <p class="muted">${mockEsc(q.explanation || 'No explanation provided.')}</p>
        </article>
      `).join('')
      : '<div class="empty-state">No review data found.</div>';

    const next = data.nextActions || {};
    document.getElementById('actionRetry').href = next.retryUrl || `mock-test-attempt.html?mockTestId=${encodeURIComponent(r.mock_test_id || '')}`;
    document.getElementById('actionTopic').href = next.suggestedTopic ? `mock-tests.html?topic=${encodeURIComponent(next.suggestedTopic)}` : 'mock-tests.html';
    document.getElementById('actionNotes').href = next.notesUrl || 'notes-library.html';
    document.getElementById('actionRoadmap').href = next.roadmapUrl || 'study-roadmap.html';
  } catch (error) {
    root.innerHTML = `<div class="empty-state">${mockEsc(error.message)}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadPremiumMockDashboard();
  loadMockTestAttempt();
  loadMockTestResults();
});
