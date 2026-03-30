function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

async function loadQuizLibrary() {
  const body = document.getElementById('quizLibraryBody');
  const recommendedGrid = document.getElementById('recommendedQuizGrid');
  const searchInput = document.getElementById('quizSearchInput');
  const subjectFilter = document.getElementById('quizSubjectFilter');
  const branchFilter = document.getElementById('quizBranchFilter');
  const semesterFilter = document.getElementById('quizSemesterFilter');
  const difficultyFilter = document.getElementById('quizDifficultyFilter');
  const statusFilter = document.getElementById('quizStatusFilter');
  const resultMeta = document.getElementById('quizResultMeta');
  const recommendedMeta = document.getElementById('recommendedMeta');
  const modal = document.getElementById('quizInfoModal');
  const modalContent = document.getElementById('quizModalContent');
  const closeModalBtn = document.getElementById('closeQuizModalBtn');
  if (!body || !window.CollegeOSApi) return;

  const state = {
    quizzes: [],
    query: '',
    subject: 'all',
    difficulty: 'all',
    status: 'all',
    branchId: '',
    semesterId: ''
  };

  const difficultyOrder = { easy: 1, medium: 2, hard: 3 };

  const normalize = (value) => String(value || '').trim();

  const inferDifficulty = (quiz) => {
    const existing = String(quiz.difficulty || '').toLowerCase();
    if (existing === 'easy' || existing === 'medium' || existing === 'hard') return existing;
    const count = Number(quiz.question_count || 0);
    if (count >= 25) return 'hard';
    if (count >= 15) return 'medium';
    return 'easy';
  };

  const estimateMinutes = (quiz) => {
    const count = Number(quiz.question_count || 0);
    return Math.max(6, Math.round(count * 1.2));
  };

  const formatDifficulty = (value) => {
    const v = String(value || 'easy').toLowerCase();
    if (v === 'hard') return 'Hard';
    if (v === 'medium') return 'Medium';
    return 'Easy';
  };

  const formatScore = (value) => {
    const score = Number(value || 0);
    return `${Math.max(0, Math.round(score))}%`;
  };

  function openModal(title, contentHtml) {
    if (!modal || !modalContent) return;
    const heading = document.getElementById('quizModalTitle');
    if (heading) heading.textContent = title;
    modalContent.innerHTML = contentHtml;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }

  function statusLabel(attempts) {
    return Number(attempts || 0) > 0 ? 'Completed' : 'Not Attempted';
  }

  function buildQuizCard(quiz, isRecommended = false) {
    const difficulty = formatDifficulty(quiz.difficultyLevel);
    const title = `${quiz.subject} - ${quiz.chapter || 'General Practice'}`;
    const status = statusLabel(quiz.myAttempts);
    const badgeClass = `difficulty-badge ${quiz.difficultyLevel}`;
    const cardClass = isRecommended ? 'quiz-card recommended' : 'quiz-card';

    return `
      <article class="${cardClass}" data-quiz-id="${quiz.id}">
        <div class="quiz-card-head">
          <h4>${title}</h4>
          <span class="${badgeClass}">${difficulty}</span>
        </div>

        <div class="quiz-meta-row">
          <span><i class="fa-solid fa-layer-group"></i> ${quiz.subject}</span>
          <span><i class="fa-regular fa-clock"></i> ${quiz.estimatedMinutes} min</span>
          <span><i class="fa-regular fa-circle-question"></i> ${quiz.question_count} questions</span>
        </div>

        <div class="quiz-stats-grid">
          <div><label>Best Score</label><strong>${formatScore(quiz.myBestScore)}</strong></div>
          <div><label>Attempts</label><strong>${quiz.myAttempts}</strong></div>
          <div><label>Students Attempted</label><strong>${quiz.studentsAttempted}</strong></div>
        </div>

        <div class="quiz-status-line">
          <span class="quiz-status-pill ${status === 'Completed' ? 'completed' : 'not-attempted'}">${status}</span>
          <span class="muted">${quiz.category}</span>
        </div>

        <div class="actions quiz-actions">
          <a class="btn secondary" href="quiz-attempt.html?quizId=${quiz.id}">Attempt Quiz</a>
          <button class="btn primary" data-action="quick-notes" data-quiz-id="${quiz.id}"><i class="fa-solid fa-note-sticky"></i> Quick Notes</button>
          <button class="btn warn" data-action="view-progress" data-quiz-id="${quiz.id}"><i class="fa-solid fa-chart-line"></i> View Progress</button>
        </div>
      </article>
    `;
  }

  function applyFilters() {
    const query = state.query.trim().toLowerCase();
    return state.quizzes.filter((quiz) => {
      const text = `${quiz.subject} ${quiz.chapter || ''}`.toLowerCase();
      const passQuery = !query || text.includes(query);
      const passSubject = state.subject === 'all' || quiz.subject === state.subject;
      const passDifficulty = state.difficulty === 'all' || quiz.difficultyLevel === state.difficulty;
      const completed = Number(quiz.myAttempts || 0) > 0;
      const passStatus =
        state.status === 'all' ||
        (state.status === 'completed' && completed) ||
        (state.status === 'not-attempted' && !completed);
      return passQuery && passSubject && passDifficulty && passStatus;
    });
  }

  function recommendQuizzes() {
    return [...state.quizzes]
      .sort((a, b) => {
        const aPriority = Number(a.myAttempts === 0 ? 0 : 1);
        const bPriority = Number(b.myAttempts === 0 ? 0 : 1);
        if (aPriority !== bPriority) return aPriority - bPriority;
        if (a.difficultyLevel !== b.difficultyLevel) {
          return difficultyOrder[a.difficultyLevel] - difficultyOrder[b.difficultyLevel];
        }
        return Number(a.question_count) - Number(b.question_count);
      })
      .slice(0, 3);
  }

  function render() {
    const filtered = applyFilters();
    const recommended = recommendQuizzes();

    if (resultMeta) {
      resultMeta.textContent = `${filtered.length} quiz${filtered.length === 1 ? '' : 'zes'} shown`;
    }

    if (recommendedMeta) {
      recommendedMeta.textContent = `${recommended.length} picks based on your attempt history`;
    }

    if (filtered.length === 0) {
      body.innerHTML = '<div class="empty-state">No quizzes match your current search/filter.</div>';
    } else {
      body.innerHTML = filtered.map((quiz) => buildQuizCard(quiz)).join('');
    }

    if (!recommendedGrid) return;
    if (recommended.length === 0) {
      recommendedGrid.innerHTML = '<div class="empty-state">No recommendations right now. Try a new subject.</div>';
    } else {
      recommendedGrid.innerHTML = recommended.map((quiz) => buildQuizCard(quiz, true)).join('');
    }
  }

  function bindActions() {
    const mount = document.querySelector('.content');
    if (!mount) return;

    mount.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const actionBtn = target.closest('[data-action]');
      if (!actionBtn) return;

      const action = actionBtn.getAttribute('data-action');
      const quizId = Number(actionBtn.getAttribute('data-quiz-id'));
      const quiz = state.quizzes.find((item) => item.id === quizId);
      if (!quiz) return;

      if (action === 'quick-notes') {
        const notesUrl = `notes-library.html?subject=${encodeURIComponent(quiz.subject)}&chapter=${encodeURIComponent(quiz.chapter || '')}`;
        openModal(
          `${quiz.subject} Quick Notes`,
          `<div class="quiz-modal-block">
            <p><strong>Focus Topic:</strong> ${quiz.chapter || 'General Practice'}</p>
            <p class="muted">Revise core formulas, practice short problems, and then attempt this quiz for better accuracy.</p>
            <ul>
              <li>Review key definitions and concepts for ${quiz.subject}.</li>
              <li>Spend 10-15 minutes on solved examples.</li>
              <li>Attempt this quiz in timed mode (${quiz.estimatedMinutes} min).</li>
            </ul>
            <div class="actions" style="margin-top:12px;">
              <a class="btn secondary" href="${notesUrl}">Open Full Notes</a>
              <a class="btn primary" href="quiz-attempt.html?quizId=${quiz.id}">Attempt Quiz</a>
            </div>
          </div>`
        );
      }

      if (action === 'view-progress') {
        const completion = Number(quiz.myAttempts) > 0 ? 'Completed' : 'Not Attempted';
        openModal(
          `${quiz.subject} Progress`,
          `<div class="quiz-modal-block">
            <div class="quiz-stats-grid" style="margin-top:4px;">
              <div><label>Best Score</label><strong>${formatScore(quiz.myBestScore)}</strong></div>
              <div><label>Attempts</label><strong>${quiz.myAttempts}</strong></div>
              <div><label>Students Attempted</label><strong>${quiz.studentsAttempted}</strong></div>
            </div>
            <p class="muted" style="margin-top:10px;">Current Status: <strong>${completion}</strong></p>
            <p class="muted">Estimated Time: ${quiz.estimatedMinutes} minutes | Difficulty: ${formatDifficulty(quiz.difficultyLevel)}</p>
          </div>`
        );
      }
    });
  }

  if (modal) {
    modal.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.hasAttribute('data-close-modal')) closeModal();
    });
  }

  if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      state.query = searchInput.value || '';
      render();
    });
  }

  if (subjectFilter) {
    subjectFilter.addEventListener('change', () => {
      state.subject = subjectFilter.value;
      render();
    });
  }

  if (difficultyFilter) {
    difficultyFilter.addEventListener('change', () => {
      state.difficulty = difficultyFilter.value;
      render();
    });
  }

  if (statusFilter) {
    statusFilter.addEventListener('change', () => {
      state.status = statusFilter.value;
      render();
    });
  }

  bindActions();

  async function populateAcademicFilters() {
    if (!branchFilter || !semesterFilter) return;
    try {
      const [semestersPayload, profilePayload] = await Promise.all([
        window.CollegeOSApi.getAcademicSemesters(),
        window.CollegeOSApi.getStudentAcademicProfile().catch(() => ({ profile: null }))
      ]);

      const semesters = semestersPayload?.semesters || [];
      const profile = profilePayload?.profile;

      const semHtml = ['<option value="">My Semester</option>'].concat(
        semesters.map((s) => `<option value="${s.id}">${s.label}</option>`)
      );
      semesterFilter.innerHTML = semHtml.join('');

      if (profile?.categoryId) {
        const branchesPayload = await window.CollegeOSApi.getAcademicBranches(profile.categoryId);
        const branches = branchesPayload?.branches || [];
        const branchHtml = ['<option value="">My Branch</option>'].concat(
          branches.map((b) => `<option value="${b.id}">${b.name}</option>`)
        );
        branchFilter.innerHTML = branchHtml.join('');
        if (profile?.branchId) {
          branchFilter.value = String(profile.branchId);
          state.branchId = String(profile.branchId);
        }
      }

      if (profile?.semesterId) {
        semesterFilter.value = String(profile.semesterId);
        state.semesterId = String(profile.semesterId);
      }
    } catch {
      // Keep defaults.
    }
  }

  if (branchFilter) {
    branchFilter.addEventListener('change', () => {
      state.branchId = branchFilter.value;
      fetchAndRender();
    });
  }

  if (semesterFilter) {
    semesterFilter.addEventListener('change', () => {
      state.semesterId = semesterFilter.value;
      fetchAndRender();
    });
  }

  async function fetchAndRender() {
    try {
      const [quizPayload, attemptsPayload] = await Promise.all([
        window.CollegeOSApi.getQuizzes({ branchId: state.branchId, semesterId: state.semesterId }),
        window.CollegeOSApi.getMyQuizAttempts ? window.CollegeOSApi.getMyQuizAttempts() : Promise.resolve({ attempts: [] })
      ]);

      const quizzes = quizPayload?.quizzes || [];
      const attempts = attemptsPayload?.attempts || [];

      const attemptsByQuiz = attempts.reduce((acc, row) => {
        const key = Number(row.quiz_id || row.id || 0);
        if (!key) return acc;
        if (!acc[key]) acc[key] = [];
        acc[key].push(row);
        return acc;
      }, {});

      const subjects = new Set();

      state.quizzes = quizzes.map((quiz) => {
        const list = attemptsByQuiz[Number(quiz.id)] || [];
        const myAttempts = Number(quiz.my_attempts ?? list.length ?? 0);
        const myBestScore = Number(
          quiz.my_best_score ??
            (list.length ? Math.max(...list.map((entry) => Number(entry.score_percent || 0))) : 0)
        );
        const studentsAttempted = Number(quiz.students_attempted ?? quiz.attempted_students ?? 0);
        const difficultyLevel = inferDifficulty(quiz);

        subjects.add(quiz.subject);

        return {
          ...quiz,
          myAttempts,
          myBestScore,
          studentsAttempted,
          estimatedMinutes: estimateMinutes(quiz),
          difficultyLevel,
          category: normalize(quiz.subject)
        };
      });

      if (subjectFilter) {
        const options = ['<option value="all">All Subjects</option>']
          .concat([...subjects].sort((a, b) => a.localeCompare(b)).map((subject) => `<option value="${subject}">${subject}</option>`));
        subjectFilter.innerHTML = options.join('');
      }

      render();
    } catch (error) {
      body.innerHTML = `<div class="empty-state">${error.message}</div>`;
      if (recommendedGrid) recommendedGrid.innerHTML = '<div class="empty-state">Unable to load recommendations.</div>';
    }
  }

  try {
    await populateAcademicFilters();
    await fetchAndRender();
  } catch (error) {
    body.innerHTML = `<div class="empty-state">${error.message}</div>`;
    if (recommendedGrid) recommendedGrid.innerHTML = '<div class="empty-state">Unable to load recommendations.</div>';
  }
}

function bindQuizSubmit() {
  const submitBtn = document.getElementById('submitQuizBtn');
  const root = document.getElementById('quizAttemptRoot');
  if (!submitBtn || !window.CollegeOSApi || !root) return;

  const QUESTION_BANK = {
    default: [
      {
        text: 'Which data structure follows FIFO order?',
        type: 'MCQ',
        options: ['Stack', 'Queue', 'Tree', 'Graph'],
        correctIndex: 1,
        explanation: 'Queue inserts at rear and removes from front, so it follows First-In-First-Out.'
      },
      {
        text: 'What is the time complexity of binary search in a sorted array?',
        type: 'MCQ',
        options: ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'],
        correctIndex: 1,
        explanation: 'Binary search halves the search space every step, resulting in logarithmic complexity.'
      },
      {
        text: 'Which SQL command is used to remove a table and its data permanently?',
        type: 'MCQ',
        options: ['DELETE', 'TRUNCATE', 'DROP', 'REMOVE'],
        correctIndex: 2,
        explanation: 'DROP TABLE deletes both table structure and all records.'
      },
      {
        text: 'In cloud computing, what does IaaS stand for?',
        type: 'MCQ',
        options: ['Internet as a Service', 'Infrastructure as a Service', 'Integration as a Service', 'Instance as a Service'],
        correctIndex: 1,
        explanation: 'IaaS provides virtualized infrastructure such as VMs, storage, and networking.'
      },
      {
        text: 'Which HTTP status code indicates that the requested resource was not found?',
        type: 'MCQ',
        options: ['200', '301', '403', '404'],
        correctIndex: 3,
        explanation: '404 Not Found means the server cannot find the requested resource.'
      },
      {
        text: 'Which of these is a supervised machine learning algorithm?',
        type: 'MCQ',
        options: ['K-Means Clustering', 'Linear Regression', 'Apriori', 'PCA'],
        correctIndex: 1,
        explanation: 'Linear Regression is trained on labeled data and predicts continuous outputs.'
      },
      {
        text: 'What does ACID represent in database systems?',
        type: 'MCQ',
        options: ['Atomicity, Consistency, Isolation, Durability', 'Accuracy, Clarity, Integrity, Durability', 'Availability, Consistency, Isolation, Distribution', 'Atomicity, Completeness, Integrity, Distribution'],
        correctIndex: 0,
        explanation: 'ACID defines core transaction properties for reliable database processing.'
      },
      {
        text: 'Which protocol is primarily used for secure web communication?',
        type: 'MCQ',
        options: ['HTTP', 'FTP', 'SSH', 'HTTPS'],
        correctIndex: 3,
        explanation: 'HTTPS encrypts HTTP traffic using TLS/SSL for secure communication.'
      }
    ]
  };

  const state = {
    quizId: Number(getQueryParam('quizId') || 1),
    questions: [],
    currentIndex: 0,
    selectedAnswers: [],
    skipped: new Set(),
    timeRemainingSec: 0,
    timerId: null
  };

  const refs = {
    current: document.getElementById('qiCurrent'),
    total: document.getElementById('qiTotal'),
    timer: document.getElementById('qiTimer'),
    timerPill: document.getElementById('quizTimerPill'),
    score: document.getElementById('qiScore'),
    progressText: document.getElementById('qiProgressText'),
    progressFill: document.getElementById('quizProgressFill'),
    qType: document.getElementById('questionTypeBadge'),
    qTag: document.getElementById('questionTagText'),
    qTitle: document.getElementById('questionTitle'),
    optionGrid: document.getElementById('optionGrid'),
    feedback: document.getElementById('feedbackPanel'),
    palette: document.getElementById('paletteGrid'),
    statsAttempted: document.getElementById('qsAttempted'),
    statsCorrect: document.getElementById('qsCorrect'),
    statsWrong: document.getElementById('qsWrong'),
    statsRemaining: document.getElementById('qsRemaining'),
    statsAccuracy: document.getElementById('qsAccuracy'),
    prev: document.getElementById('prevQuestionBtn'),
    next: document.getElementById('nextQuestionBtn'),
    skip: document.getElementById('skipQuestionBtn'),
    submit: submitBtn
  };

  function formatSeconds(totalSec) {
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function computeStats() {
    let attempted = 0;
    let correct = 0;
    for (let i = 0; i < state.questions.length; i++) {
      const selected = state.selectedAnswers[i];
      if (selected === null || selected === undefined) continue;
      attempted += 1;
      if (selected === state.questions[i].correctIndex) correct += 1;
    }
    const wrong = attempted - correct;
    const remaining = state.questions.length - attempted;
    const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
    const scorePercent = Math.round((correct / state.questions.length) * 100);
    const completed = attempted + state.skipped.size;
    const progressPercent = Math.round((completed / state.questions.length) * 100);
    return { attempted, correct, wrong, remaining, accuracy, scorePercent, progressPercent };
  }

  function getQuestionState(index) {
    if (index === state.currentIndex) return 'current';
    if (state.selectedAnswers[index] !== null && state.selectedAnswers[index] !== undefined) return 'attempted';
    if (state.skipped.has(index)) return 'skipped';
    return 'unattempted';
  }

  function renderPalette() {
    refs.palette.innerHTML = state.questions
      .map((_, idx) => {
        const status = getQuestionState(idx);
        return `<button class="palette-btn ${status}" data-palette-index="${idx}">${idx + 1}</button>`;
      })
      .join('');

    refs.palette.querySelectorAll('.palette-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.currentIndex = Number(btn.dataset.paletteIndex);
        renderAll();
      });
    });
  }

  function renderOptions(question) {
    const selected = state.selectedAnswers[state.currentIndex];
    refs.optionGrid.innerHTML = question.options
      .map((option, index) => {
        const isSelected = selected === index;
        const isCorrect = index === question.correctIndex;
        const showEvaluation = selected !== null && selected !== undefined;
        let stateClass = isSelected ? 'selected' : '';
        if (showEvaluation && isCorrect) stateClass = `${stateClass} correct`.trim();
        if (showEvaluation && isSelected && !isCorrect) stateClass = `${stateClass} incorrect`.trim();

        return `
          <button class="option-card ${stateClass}" data-option-index="${index}">
            <span class="option-key">${String.fromCharCode(65 + index)}</span>
            <span>${option}</span>
          </button>
        `;
      })
      .join('');

    refs.optionGrid.querySelectorAll('.option-card').forEach((node) => {
      node.addEventListener('click', () => {
        const index = Number(node.dataset.optionIndex);
        state.selectedAnswers[state.currentIndex] = index;
        state.skipped.delete(state.currentIndex);
        renderAll();
      });
    });
  }

  function renderFeedback(question) {
    const selected = state.selectedAnswers[state.currentIndex];
    if (selected === null || selected === undefined) {
      refs.feedback.className = 'feedback-panel';
      refs.feedback.innerHTML = '';
      return;
    }

    const isCorrect = selected === question.correctIndex;
    refs.feedback.className = `feedback-panel ${isCorrect ? 'correct' : 'incorrect'}`;
    refs.feedback.innerHTML = `
      <strong>${isCorrect ? 'Correct answer' : 'Incorrect answer'}</strong>
      <div style="margin-top: 0.45rem;">Correct Option: <strong>${String.fromCharCode(65 + question.correctIndex)}. ${question.options[question.correctIndex]}</strong></div>
      <div style="margin-top: 0.45rem;" class="muted">${question.explanation}</div>
    `;
  }

  function updateInfoBar() {
    const stats = computeStats();
    refs.current.textContent = String(state.currentIndex + 1);
    refs.total.textContent = String(state.questions.length);
    refs.score.textContent = `${stats.scorePercent}%`;
    refs.progressText.textContent = `${stats.progressPercent}%`;
    refs.progressFill.style.width = `${stats.progressPercent}%`;
    refs.statsAttempted.textContent = String(stats.attempted);
    refs.statsCorrect.textContent = String(stats.correct);
    refs.statsWrong.textContent = String(stats.wrong);
    refs.statsRemaining.textContent = String(stats.remaining);
    refs.statsAccuracy.textContent = `${stats.accuracy}%`;
  }

  function renderCurrentQuestion() {
    const question = state.questions[state.currentIndex];
    refs.qType.textContent = question.type || 'MCQ';
    refs.qTag.textContent = `Question ${state.currentIndex + 1} of ${state.questions.length}`;
    refs.qTitle.textContent = question.text;
    renderOptions(question);
    renderFeedback(question);
  }

  function renderAll() {
    renderCurrentQuestion();
    renderPalette();
    updateInfoBar();
    refs.prev.disabled = state.currentIndex === 0;
    refs.next.disabled = state.currentIndex >= state.questions.length - 1;
  }

  async function submitQuiz(reason = 'manual') {
    const stats = computeStats();
    const quizId = state.quizId;
    const scorePercent = stats.scorePercent;
    const xpEarned = Math.round(scorePercent);
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }

    try {
      await window.CollegeOSApi.saveQuizAttempt(quizId, { scorePercent, xpEarned });
      await window.CollegeOSApi.trackLearnerEvent({
        eventType: 'quiz_session_completed',
        source: 'web',
        eventPayload: {
          quizId,
          scorePercent,
          xpEarned,
          reason
        }
      });
      const timeoutFlag = reason === 'timeout' ? '&timedOut=1' : '';
      window.location.href = `quiz-results.html?score=${scorePercent}&xp=${xpEarned}${timeoutFlag}`;
    } catch (error) {
      alert(error.message);
    }
  }

  function tickTimer() {
    refs.timer.textContent = formatSeconds(state.timeRemainingSec);
    const lowThreshold = Math.max(60, Math.floor(state.questions.length * 15));
    refs.timerPill.classList.toggle('warning', state.timeRemainingSec <= lowThreshold);

    if (state.timeRemainingSec <= 0) {
      submitQuiz('timeout');
      return;
    }
    state.timeRemainingSec -= 1;
  }

  function bindControls() {
    refs.prev.addEventListener('click', () => {
      if (state.currentIndex > 0) {
        state.currentIndex -= 1;
        renderAll();
      }
    });

    refs.next.addEventListener('click', () => {
      if (state.currentIndex < state.questions.length - 1) {
        state.currentIndex += 1;
        renderAll();
      }
    });

    refs.skip.addEventListener('click', () => {
      if (state.selectedAnswers[state.currentIndex] === null || state.selectedAnswers[state.currentIndex] === undefined) {
        state.skipped.add(state.currentIndex);
      }
      if (state.currentIndex < state.questions.length - 1) state.currentIndex += 1;
      renderAll();
    });

    refs.submit.addEventListener('click', () => submitQuiz('manual'));
  }

  async function initQuizAttempt() {
    let totalCount = QUESTION_BANK.default.length;
    try {
      const { quizzes } = await window.CollegeOSApi.getQuizzes();
      const quizMeta = quizzes.find((q) => q.id === state.quizId);
      if (quizMeta?.question_count && quizMeta.question_count > 0) {
        totalCount = Math.min(Math.max(quizMeta.question_count, 5), 20);
      }
    } catch {
      // Fallback to local question bank when quiz metadata isn't available.
    }

    const localBank = QUESTION_BANK.default;
    state.questions = Array.from({ length: totalCount }, (_, idx) => {
      const base = localBank[idx % localBank.length];
      return {
        ...base,
        text: totalCount > localBank.length ? `${base.text} (${idx + 1})` : base.text
      };
    });

    state.selectedAnswers = Array(state.questions.length).fill(null);
    state.timeRemainingSec = state.questions.length * 45;

    bindControls();
    renderAll();
    tickTimer();
    state.timerId = setInterval(tickTimer, 1000);
  }

  initQuizAttempt();
}

function hydrateQuizResult() {
  const scoreNode = document.getElementById('resultScore');
  const accuracyNode = document.getElementById('resultAccuracy');
  const xpNode = document.getElementById('resultXp');
  if (!scoreNode || !xpNode) return;

  const score = Number(getQueryParam('score') || 0);
  const xp = Number(getQueryParam('xp') || 0);
  scoreNode.textContent = `${score}%`;
  if (accuracyNode) accuracyNode.textContent = `${score}%`;
  xpNode.textContent = `+${xp}`;
}

async function loadMockTests() {
  const body = document.getElementById('mockTestsBody');
  const quotaNode = document.getElementById('mockMembershipStatus');
  if (!body || !window.CollegeOSApi) return;

  const searchInput = document.getElementById('mockTestsSearchInput');
  const filterWrap = document.getElementById('mockTestsFilterChips');

  const classifyTestType = (title = '') => {
    const value = String(title).toLowerCase();
    if (value.includes('previous') || value.includes('pyq') || value.includes('year')) return 'previous';
    if (value.includes('practice') || value.includes('chapter') || value.includes('topic')) return 'practice';
    return 'grand';
  };

  const inferTotalQuestions = (test) => {
    const marks = Number(test.total_marks || 0);
    if (marks <= 0) return 100;
    return Math.max(25, Math.round(marks / 2));
  };

  const inferDifficulty = (test) => {
    const marks = Number(test.total_marks || 0);
    const mins = Number(test.duration_minutes || 0);
    if (marks >= 300 || mins >= 180) return 'Hard';
    if (marks >= 180 || mins >= 120) return 'Medium';
    return 'Easy';
  };

  const resolveStatus = (test) => {
    const attempts = Number(test.attempt_count || 0);
    if (attempts === 0) return { label: 'Not Attempted', className: 'not-attempted' };
    if (attempts === 1) return { label: 'Attempted', className: 'attempted' };
    return { label: 'Completed', className: 'completed' };
  };

  const safeNum = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  try {
    const { mockTests, quota } = await window.CollegeOSApi.getMockTests();

    if (quotaNode) {
      if (quota?.premiumActive) {
        quotaNode.textContent = 'Premium Active: Unlimited mock tests enabled.';
      } else {
        quotaNode.textContent = `Free Plan: ${Number(quota?.remaining || 0)} of ${Number(quota?.freeLimit || 2)} test attempts remaining before premium is required.`;
      }
    }

    const viewModel = mockTests.map((test) => {
      const totalQuestions = inferTotalQuestions(test);
      const difficulty = inferDifficulty(test);
      const participants = safeNum(test.participants_count, 0);
      const attempts = safeNum(test.attempt_count, 0);
      const score = safeNum(test.last_marks_obtained, 0);
      const accuracy = test.total_marks ? Math.round((score / Number(test.total_marks)) * 100) : 0;
      const rank = safeNum(test.last_rank_india, 0);
      const percentile = safeNum(test.last_percentile, 0);
      const status = resolveStatus(test);
      const category = classifyTestType(test.title);

      return {
        ...test,
        totalQuestions,
        difficulty,
        participants,
        attempts,
        score,
        rank,
        percentile,
        accuracy,
        status,
        category
      };
    });

    let activeFilter = 'all';
    let query = '';

    const renderCards = () => {
      const normalized = query.trim().toLowerCase();
      const filtered = viewModel.filter((test) => {
        const passFilter = activeFilter === 'all' || test.category === activeFilter;
        const passSearch = !normalized || String(test.title).toLowerCase().includes(normalized);
        return passFilter && passSearch;
      });

      if (filtered.length === 0) {
        body.innerHTML = '<div class="empty-state">No tests match your search or filter.</div>';
        return;
      }

      body.innerHTML = filtered
        .map((test) => {
          const hasPerformance = test.attempts > 0;
          const perfMarkup = hasPerformance
            ? `<div class="performance">
                <h4><i class="fa-solid fa-chart-line"></i> Previous Performance</h4>
                <div class="perf-grid">
                  <div class="perf-cell"><label>Score</label><strong>${test.score}/${test.total_marks}</strong></div>
                  <div class="perf-cell"><label>Rank</label><strong>#${test.rank > 0 ? test.rank : '--'}</strong></div>
                  <div class="perf-cell"><label>Accuracy</label><strong>${test.accuracy}%</strong></div>
                </div>
              </div>`
            : `<div class="performance">
                <h4><i class="fa-regular fa-circle-play"></i> Previous Performance</h4>
                <div class="muted">No attempts yet. Start this test to generate score, rank, and accuracy.</div>
              </div>`;

          return `<article class="mock-card">
            <div class="mock-card-head">
              <h3 class="mock-card-title">${test.title}</h3>
              <span class="status-pill ${test.status.className}">${test.status.label}</span>
            </div>

            <div class="meta-grid">
              <div class="meta-chip"><label>Duration</label><strong><i class="fa-regular fa-clock"></i> ${test.duration_minutes} mins</strong></div>
              <div class="meta-chip"><label>Total Questions</label><strong><i class="fa-regular fa-clipboard"></i> ${test.totalQuestions}</strong></div>
              <div class="meta-chip"><label>Total Marks</label><strong><i class="fa-solid fa-award"></i> ${test.total_marks}</strong></div>
              <div class="meta-chip"><label>Difficulty</label><strong><i class="fa-solid fa-signal"></i> ${test.difficulty}</strong></div>
              <div class="meta-chip"><label>Participants</label><strong><i class="fa-solid fa-users"></i> ${test.participants}</strong></div>
              <div class="meta-chip"><label>Percentile</label><strong><i class="fa-solid fa-chart-column"></i> ${hasPerformance ? `${test.percentile}%` : '--'}</strong></div>
            </div>

            ${perfMarkup}

            <div class="actions">
              <a class="btn primary" href="mock-test-results.html?mockTestId=${test.id}">Attempt</a>
            </div>
          </article>`;
        })
        .join('');
    };

    if (filterWrap) {
      filterWrap.querySelectorAll('.filter-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          activeFilter = chip.dataset.filter || 'all';
          filterWrap.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
          chip.classList.add('active');
          renderCards();
        });
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', (event) => {
        query = event.target.value || '';
        renderCards();
      });
    }

    renderCards();
  } catch (error) {
    body.innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadQuizLibrary();
  bindQuizSubmit();
  hydrateQuizResult();
  loadMockTests();
});
