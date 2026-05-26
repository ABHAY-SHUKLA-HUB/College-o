(function () {
  function byId(id) {
    return document.getElementById(id);
  }

  function toNum(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, Math.round(toNum(value, 0))));
  }

  function shortDateLabel(date) {
    return date.toLocaleDateString('en-IN', { weekday: 'short' }).slice(0, 2);
  }

  function firstNameOf(user) {
    const full = String(user?.full_name || user?.fullName || user?.name || 'Student').trim();
    return full.split(/\s+/)[0] || 'Student';
  }

  function safeText(value, fallback) {
    const text = String(value || '').trim();
    return text || fallback;
  }

  function createEmptyCard(message) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = message;
    return li;
  }

  async function safeCall(fn, fallback) {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  }

  function listDays(count) {
    const now = new Date();
    const days = [];
    for (let i = count - 1; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      days.push(d);
    }
    return days;
  }

  function aggregateByDay(rows, valueGetter, count = 7) {
    const days = listDays(count);
    const map = new Map();

    days.forEach((d) => {
      const key = d.toISOString().slice(0, 10);
      map.set(key, 0);
    });

    rows.forEach((row) => {
      const dt = new Date(row.attempted_at || row.attemptedAt || row.created_at || row.createdAt || Date.now());
      const key = dt.toISOString().slice(0, 10);
      if (!map.has(key)) return;
      map.set(key, map.get(key) + toNum(valueGetter(row), 0));
    });

    return days.map((d) => {
      const key = d.toISOString().slice(0, 10);
      return {
        label: shortDateLabel(d),
        value: map.get(key) || 0
      };
    });
  }

  function renderBarChart(barId, axisId, points, maxFloor, formatter) {
    const bars = byId(barId);
    const axis = byId(axisId);
    if (!bars || !axis) return;

    bars.innerHTML = '';
    axis.innerHTML = '';

    const values = points.map((p) => toNum(p.value, 0));
    const max = Math.max(maxFloor || 1, ...values, 1);

    points.forEach((point) => {
      const bar = document.createElement('div');
      bar.className = 'chart-bar';
      const ratio = Math.max(0.06, Math.min(1, point.value / max));
      bar.style.height = `${Math.round(ratio * 100)}%`;
      bar.title = `${point.label}: ${formatter(point.value)}`;
      bars.appendChild(bar);

      const tick = document.createElement('span');
      tick.textContent = point.label;
      axis.appendChild(tick);
    });
  }

  function renderTasks(tasks) {
    const host = byId('todayPlanList');
    if (!host) return;
    host.innerHTML = '';

    const progressText = byId('taskProgressText');
    const progressFill = byId('taskProgressFill');

    function syncTaskProgress() {
      const all = host.querySelectorAll('.task-item');
      const done = host.querySelectorAll('.task-item.completed').length;
      const total = all.length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      if (progressText) progressText.textContent = `${done}/${total} done`;
      if (progressFill) progressFill.style.width = `${pct}%`;
    }

    if (!tasks.length) {
      host.appendChild(createEmptyCard('No study tasks yet. Start with one quiz and one roadmap step today.'));
      if (progressText) progressText.textContent = '0/0 done';
      if (progressFill) progressFill.style.width = '0%';
      return;
    }

    tasks.forEach((task, index) => {
      const li = document.createElement('li');
      li.className = 'task-item';
      li.innerHTML = `
        <button type="button" class="task-check" aria-label="Mark task complete">✓</button>
        <div>
          <p class="task-title"></p>
          <p class="task-note"></p>
        </div>
      `;
      li.querySelector('.task-title').textContent = safeText(task.title, 'Study Task');
      li.querySelector('.task-note').textContent = safeText(task.note, 'Keep your momentum with a focused 20-minute sprint.');
      if (index === 0) li.classList.add('completed');
      li.querySelector('.task-check')?.addEventListener('click', () => {
        li.classList.toggle('completed');
        syncTaskProgress();
      });
      host.appendChild(li);
    });

    syncTaskProgress();
  }

  function renderContinue(cards) {
    const host = byId('continueLearningGrid');
    if (!host) return;
    host.innerHTML = '';

    cards.forEach((card) => {
      const article = document.createElement('article');
      article.className = 'continue-card';
      article.innerHTML = `
        <div class="continue-card-head">
          <p class="task-title"></p>
          <i class="fa-solid ${card.icon || 'fa-compass'}"></i>
        </div>
        <p class="continue-note"></p>
        <div class="continue-meta"></div>
        <a class="card-action-btn" href="#"></a>
      `;
      article.querySelector('.task-title').textContent = card.title;
      article.querySelector('.continue-note').textContent = card.note;
      const meta = article.querySelector('.continue-meta');
      (card.meta || []).forEach((token) => {
        const chip = document.createElement('span');
        chip.className = 'continue-chip';
        chip.textContent = token;
        meta.appendChild(chip);
      });
      const link = article.querySelector('a');
      link.href = card.href;
      link.textContent = card.cta;
      host.appendChild(article);
    });
  }

  function renderRecommendedForYou(cards) {
    const host = byId('recommendedForYouGrid');
    if (!host) return;
    host.innerHTML = '';

    if (!cards.length) {
      host.appendChild(createEmptyCard('Personalized recommendations will appear after a few study actions.'));
      return;
    }

    cards.forEach((card) => {
      const article = document.createElement('article');
      article.className = 'continue-card';
      article.innerHTML = `
        <div class="continue-card-head">
          <p class="task-title"></p>
          <i class="fa-solid ${card.icon || 'fa-lightbulb'}"></i>
        </div>
        <p class="continue-note"></p>
        <div class="continue-meta"></div>
        <a class="card-action-btn" href="#"></a>
      `;
      article.querySelector('.task-title').textContent = card.title;
      article.querySelector('.continue-note').textContent = card.note;
      const meta = article.querySelector('.continue-meta');
      (card.meta || []).forEach((token) => {
        const chip = document.createElement('span');
        chip.className = 'continue-chip';
        chip.textContent = token;
        meta.appendChild(chip);
      });
      const link = article.querySelector('a');
      link.href = card.href;
      link.textContent = card.cta;
      host.appendChild(article);
    });
  }

  function renderAiRecommendations(items) {
    const host = byId('aiRecommendationList');
    if (!host) return;
    host.innerHTML = '';

    if (!items.length) {
      host.appendChild(createEmptyCard('No recommendation generated yet. Complete one quiz attempt to unlock AI targeting.'));
      return;
    }

    items.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'recommend-item';
      li.innerHTML = '<p></p>';
      li.querySelector('p').textContent = item;
      host.appendChild(li);
    });
  }

  function renderRoadmapBars(rows) {
    const host = byId('roadmapBars');
    if (!host) return;
    host.innerHTML = '';

    if (!rows.length) {
      host.appendChild(createEmptyCard('Your roadmap is empty. Add modules to visualize your weekly progress.'));
      return;
    }

    rows.forEach((row) => {
      const pct = clampPercent(row.progress);
      const wrap = document.createElement('div');
      wrap.className = 'progress-row';
      wrap.innerHTML = `
        <div class="progress-label"><span></span><span>${pct}%</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;"></div></div>
      `;
      wrap.querySelector('.progress-label span').textContent = row.label;
      host.appendChild(wrap);
    });
  }

  function renderBranchFocus(items) {
    const host = byId('branchFocusList');
    if (!host) return;
    host.innerHTML = '';

    if (!items.length) {
      host.appendChild(createEmptyCard('Branch-specific recommendations will appear after profile sync.'));
      return;
    }

    items.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'recommend-item';
      li.innerHTML = '<p></p>';
      li.querySelector('p').textContent = item;
      host.appendChild(li);
    });
  }

  function renderContentList(hostId, rows, buildLink, fallbackText) {
    const host = byId(hostId);
    if (!host) return;
    host.innerHTML = '';

    if (!rows.length) {
      host.appendChild(createEmptyCard(fallbackText));
      return;
    }

    rows.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'content-item';
      const title = safeText(item.title || item.chapter || item.subject, 'Suggested resource');
      const note = [item.subject, item.topic, item.difficulty, item.career_track].filter(Boolean).join(' • ');
      const href = buildLink(item);
      li.innerHTML = `
        <p class="content-title"></p>
        <p class="content-note"></p>
        <a class="hero-btn" style="margin-top:0.55rem; width:fit-content;" href="${href}">Open</a>
      `;
      li.querySelector('.content-title').textContent = title;
      li.querySelector('.content-note').textContent = note || 'Personalized for your study profile';
      host.appendChild(li);
    });
  }

  function renderBadges(stats) {
    const host = byId('badgesGrid');
    if (!host) return;
    host.innerHTML = '';

    const streak = toNum(stats.streak, 0);
    const xp = toNum(stats.xp, 0);
    const roadmap = toNum(stats.roadmapProgress, 0);
    const achievements = toNum(stats.achievements, 0);

    const badges = [
      {
        key: 'streak',
        icon: 'fa-fire',
        name: 'Consistency Flame',
        note: 'Maintain a 7-day learning streak.',
        earned: streak >= 7
      },
      {
        key: 'xp',
        icon: 'fa-bolt',
        name: 'XP Explorer',
        note: 'Cross 500 XP through quizzes.',
        earned: xp >= 500
      },
      {
        key: 'roadmap',
        icon: 'fa-map-location-dot',
        name: 'Path Builder',
        note: 'Reach 50% roadmap completion.',
        earned: roadmap >= 50
      },
      {
        key: 'achieve',
        icon: 'fa-award',
        name: 'First Certificate',
        note: 'Earn your first certificate or badge.',
        earned: achievements >= 1
      }
    ];

    badges.forEach((badge) => {
      const article = document.createElement('article');
      article.className = `badge-card ${badge.earned ? 'earned' : ''}`;
      article.innerHTML = `
        <span class="badge-icon"><i class="fa-solid ${badge.icon}"></i></span>
        <div class="badge-meta">
          <p class="badge-name">${badge.name}</p>
          <p class="badge-note">${badge.note}</p>
        </div>
      `;
      host.appendChild(article);
    });
  }

  function renderWeakTopics(weakTopics, weakSubjects) {
    const host = byId('weakTopicsGrid');
    if (!host) return;
    host.innerHTML = '';

    const cards = [];
    weakTopics.slice(0, 3).forEach((item) => {
      cards.push({
        title: safeText(item.topic, 'General Topic'),
        note: `Accuracy around ${Math.round(toNum(item.accuracy, 0))}%. Revise and attempt a focused quiz.`
      });
    });

    if (!cards.length && weakSubjects.length) {
      weakSubjects.slice(0, 3).forEach((subject) => {
        cards.push({
          title: safeText(subject, 'Core Subject'),
          note: 'Marked as weak subject. Prioritize revision, flashcards, and one quiz attempt.'
        });
      });
    }

    if (!cards.length) {
      cards.push(
        { title: 'Topic insights pending', note: 'Complete a quiz and one mock test to unlock weak-topic AI guidance.' },
        { title: 'Revision opportunity', note: 'Review your most recent note and test recall with 5 quick questions.' },
        { title: 'Skill consolidation', note: 'Focus on concept clarity before jumping to harder timed tests.' }
      );
    }

    cards.forEach((card) => {
      const article = document.createElement('article');
      article.className = 'weak-topic-card';
      article.innerHTML = `
        <h4><i class="fa-solid fa-triangle-exclamation"></i>${card.title}</h4>
        <p>${card.note}</p>
        <div class="weak-topic-actions">
          <a href="quiz-library.html?search=${encodeURIComponent(card.title)}">Practice Now</a>
          <a href="notes-library.html?search=${encodeURIComponent(card.title)}">Revise Notes</a>
        </div>
      `;
      host.appendChild(article);
    });
  }

  function renderGamification(stats) {
    const streakBadge = byId('streakBadgeText');
    const xp500Fill = byId('xp500Fill');
    const xp500Label = byId('xp500Label');
    const xp1000Fill = byId('xp1000Fill');
    const xp1000Label = byId('xp1000Label');
    const momentum = byId('achievementMomentumText');

    const streak = toNum(stats.streak, 0);
    const xp = toNum(stats.xp, 0);
    const achievements = toNum(stats.achievements, 0);
    const roadmap = toNum(stats.roadmapProgress, 0);

    if (streakBadge) {
      streakBadge.textContent =
        streak >= 30 ? 'Legend Badge unlocked: 30+ day streak.' :
        streak >= 14 ? 'Pro Streak Badge unlocked. Keep pushing to 30 days.' :
        streak >= 7 ? 'Consistency Badge unlocked. Next target: 14 days.' :
        `Current streak is ${streak} day(s). Reach 7 days for your first badge.`;
    }

    const xp500Pct = Math.max(0, Math.min(100, Math.round((xp / 500) * 100)));
    const xp1000Pct = Math.max(0, Math.min(100, Math.round((xp / 1000) * 100)));

    if (xp500Fill) xp500Fill.style.width = `${xp500Pct}%`;
    if (xp500Label) xp500Label.textContent = `${xp500Pct}%`;
    if (xp1000Fill) xp1000Fill.style.width = `${xp1000Pct}%`;
    if (xp1000Label) xp1000Label.textContent = `${xp1000Pct}%`;

    if (momentum) {
      momentum.textContent = achievements > 0
        ? `You have ${achievements} achievement(s). Push roadmap beyond ${Math.round(roadmap)}% for the next unlock.`
        : 'No achievements yet. Hit 500 XP and 7-day streak to start your reward journey.';
    }
  }

  function appendAssistantMessage(message, role) {
    const body = byId('assistantBody');
    if (!body) return;
    const msg = document.createElement('div');
    msg.className = `assistant-msg ${role}`;
    msg.textContent = message;
    body.appendChild(msg);
    body.scrollTop = body.scrollHeight;
  }

  function assistantAnswer(query, state) {
    const q = String(query || '').toLowerCase();
    const branch = state?.branchLabel || 'your branch';

    if (q.includes('plan') || q.includes('today')) {
      return `For ${branch}, start with one roadmap step, then a medium quiz, and finish by revising one weak topic note.`;
    }
    if (q.includes('quiz')) {
      return state?.topQuiz
        ? `Try ${state.topQuiz.chapter || state.topQuiz.subject} now. It matches your recent progress pattern.`
        : 'Start with one targeted quiz from Quiz Library, then review mistakes before the next attempt.';
    }
    if (q.includes('roadmap')) {
      return `Continue your roadmap from the current module and target at least +8% completion this week.`;
    }
    if (q.includes('mock')) {
      return state?.topMock
        ? `Attempt ${state.topMock.title} next. Keep a 90-minute focused block for best results.`
        : 'Take a topic-wise mock first, then move to a full-length test.';
    }
    if (q.includes('revise') || q.includes('notes')) {
      return state?.topNote
        ? `Revise ${state.topNote.chapter || state.topNote.subject} first. Summarize key formulas in 5 bullet points.`
        : 'Revise one high-weightage note and make 3 quick recall prompts.';
    }
    return `Focus on one high-impact task now: quiz, roadmap, or note revision. Consistency compounds your progress.`;
  }

  function setupAssistant(state) {
    const widget = byId('aiAssistantWidget');
    const toggle = byId('assistantToggle');
    const form = byId('assistantForm');
    const input = byId('assistantInput');
    const prompts = byId('assistantPrompts');
    if (!widget || !toggle || !form || !input) return;

    appendAssistantMessage('Ask me for a quick study move: quiz, revision, roadmap, or mock strategy.', 'bot');

    toggle.addEventListener('click', () => {
      widget.classList.toggle('collapsed');
      toggle.textContent = widget.classList.contains('collapsed') ? '+' : '-';
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const question = input.value.trim();
      if (!question) return;
      appendAssistantMessage(question, 'user');
      input.value = '';
      const answer = assistantAnswer(question, state);
      window.setTimeout(() => appendAssistantMessage(answer, 'bot'), 260);
    });

    prompts?.querySelectorAll('.assistant-prompt-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const question = btn.textContent.trim();
        if (!question) return;
        appendAssistantMessage(question, 'user');
        const answer = assistantAnswer(question, state);
        window.setTimeout(() => appendAssistantMessage(answer, 'bot'), 180);
      });
    });
  }

  function setVisible(id, visible) {
    const node = byId(id);
    if (!node) return;
    node.hidden = !visible;
  }

  function applyHomeExperienceConfig(config) {
    if (!config || typeof config !== 'object') return;

    const hero = config.home?.hero || {};
    const title = safeText(hero.title, '');
    const description = safeText(hero.description, '');
    if (title) {
      const heroTitle = byId('heroTitle');
      if (heroTitle) heroTitle.textContent = title;
    }
    if (description) {
      const heroSubtitle = byId('heroSubtitle');
      if (heroSubtitle) heroSubtitle.textContent = description;
    }

    const ctaPrimary = hero.ctaPrimary || {};
    const ctaSecondary = hero.ctaSecondary || {};
    const primaryLink = byId('heroPrimaryCta');
    const secondaryLink = byId('heroSecondaryCta');
    if (primaryLink) {
      const label = safeText(ctaPrimary.label, '');
      const href = safeText(ctaPrimary.href, '');
      if (label) {
        const icon = primaryLink.querySelector('i')?.outerHTML || '<i class="fa-solid fa-play"></i>';
        primaryLink.innerHTML = `${icon} ${label}`;
      }
      if (href) primaryLink.href = href;
    }
    if (secondaryLink) {
      const label = safeText(ctaSecondary.label, '');
      const href = safeText(ctaSecondary.href, '');
      if (label) {
        const icon = secondaryLink.querySelector('i')?.outerHTML || '<i class="fa-solid fa-map-location-dot"></i>';
        secondaryLink.innerHTML = `${icon} ${label}`;
      }
      if (href) secondaryLink.href = href;
    }

    if (safeText(hero.bannerGraphicUrl, '')) {
      const heroSection = byId('homeHeroSection');
      if (heroSection) {
        const bannerUrl = hero.bannerGraphicUrl.replace(/"/g, '\\"');
        heroSection.style.backgroundImage = `url("${bannerUrl}"), radial-gradient(circle at 20% 0%, rgba(74, 222, 128, 0.2) 0%, rgba(74, 222, 128, 0) 40%), radial-gradient(circle at 80% 100%, rgba(59, 130, 246, 0.26) 0%, rgba(59, 130, 246, 0) 42%), linear-gradient(140deg, #153a64 0%, #0f5f53 55%, #0b7c8b 100%)`;
        heroSection.style.backgroundSize = 'cover, auto, auto, auto';
        heroSection.style.backgroundPosition = 'center, center, center, center';
      }
    }

    const sectionVisibility = config.dashboard?.sectionVisibility || {};
    const visibilityMap = {
      learningStats: 'homeStatsSection',
      studyPlan: 'homeStackSection',
      continueLearning: 'homeContinueSection',
      aiSuggestions: 'homeRecommendSection',
      recommendedNotes: 'homeRecommendedNotesPanel',
      recommendedQuizzes: 'homeRecommendedQuizzesPanel',
      recommendedMockTests: 'homeRecommendedMocksPanel',
      weakTopics: 'homeWeakTopicsSection',
      analyticsCharts: 'homeAnalyticsSection',
      achievements: 'homeAchievementsSection'
    };
    Object.entries(visibilityMap).forEach(([key, id]) => {
      if (key in sectionVisibility) setVisible(id, sectionVisibility[key] !== false);
    });

    const featureFlags = config.featureFlags || {};
    if (featureFlags.analytics === false) setVisible('homeAnalyticsSection', false);
    if (featureFlags.aiTools === false) {
      setVisible('homeAiRecommendationsPanel', false);
      setVisible('aiAssistantWidget', false);
      const aiLink = document.querySelector('.quick-link[href="ai-tools.html"]');
      if (aiLink) aiLink.hidden = true;
    }
    if (featureFlags.mockTests === false) {
      const mockLink = document.querySelector('.quick-link[href="mock-tests.html"]');
      if (mockLink) mockLink.hidden = true;
      setVisible('homeRecommendedMocksPanel', false);
    }
    if (featureFlags.roadmapSystem === false) {
      const roadmapLink = document.querySelector('.quick-link[href="study-roadmap.html"]');
      if (roadmapLink) roadmapLink.hidden = true;
      setVisible('homeRoadmapPanel', false);
    }
    if (featureFlags.certificates === false) {
      const certLink = document.querySelector('.quick-link[href="certificates.html"]');
      if (certLink) certLink.hidden = true;
    }
  }

  async function initHomeDashboard() {
    if (!window.CollegeOSApi) return;
    if (!byId('homeDashboard')) return;

    const user = window.collegeOsCurrentUser || null;
    const bootstrap = await safeCall(() => window.CollegeOSApi.getDashboardBootstrap(), null);
    const bootstrapProfile = bootstrap?.profile || {};
    const bootstrapStats = bootstrap?.stats || {};
    const bootstrapConfig = bootstrap?.config || null;
    const bootstrapMembership = bootstrap?.membership || {};

    const heroTitle = byId('heroTitle');
    const heroSubtitle = byId('heroSubtitle');
    const heroContext = byId('heroContext');
    const heroRoadmapPct = byId('heroRoadmapPct');
    const heroRoadmapFill = byId('heroRoadmapFill');
    const branchHeadline = byId('branchHeadline');
    const heroStreakValue = byId('heroStreakValue');
    const heroMilestoneValue = byId('heroMilestoneValue');

    const branchLabel = bootstrapProfile.branchName || 'your branch';
    const semesterLabel = bootstrapProfile.semesterLabel || 'current semester';
    const criticalStats = {
      streak: toNum(bootstrapStats.streak, 0),
      xp: toNum(bootstrapStats.xp, 0),
      roadmapProgress: clampPercent(bootstrapStats.roadmapProgress),
      achievements: toNum(bootstrapStats.certificates, 0)
    };

    if (heroTitle) heroTitle.textContent = bootstrap?.hero?.title || `Welcome back, ${firstNameOf(user)}`;
    if (heroSubtitle) {
      heroSubtitle.textContent = bootstrap?.hero?.subtitle || `Your dashboard is personalized for ${branchLabel}.`;
    }
    if (heroContext) heroContext.textContent = `${safeText(branchLabel, 'Branch')} • ${safeText(semesterLabel, 'Semester')}`;
    if (heroRoadmapPct) heroRoadmapPct.textContent = `${criticalStats.roadmapProgress}%`;
    if (heroRoadmapFill) heroRoadmapFill.style.width = `${criticalStats.roadmapProgress}%`;
    if (branchHeadline) branchHeadline.textContent = `Optimized for ${safeText(branchLabel, 'your track')} and ${safeText(semesterLabel, 'your term')}.`;
    if (heroStreakValue) heroStreakValue.textContent = `${Math.round(criticalStats.streak)} day(s)`;

    if (byId('statStreak')) byId('statStreak').textContent = String(criticalStats.streak);
    if (byId('statXp')) byId('statXp').textContent = String(criticalStats.xp);
    if (byId('statRoadmap')) byId('statRoadmap').textContent = `${criticalStats.roadmapProgress}%`;
    if (byId('statAchievements')) byId('statAchievements').textContent = String(criticalStats.achievements);

    if (heroMilestoneValue) {
      heroMilestoneValue.textContent = bootstrapMembership.premiumActive
        ? 'Premium active'
        : 'Start roadmap milestone';
    }

    applyHomeExperienceConfig(bootstrapConfig);

    const [personalized, quizzes, mockDash, roadmap, notesMine] = await Promise.all([
      safeCall(() => window.CollegeOSApi.getPersonalizedDashboard(), null),
      safeCall(() => window.CollegeOSApi.getMyQuizAttempts(), { attempts: [] }),
      safeCall(() => window.CollegeOSApi.getMockTestsDashboard(), null),
      safeCall(() => window.CollegeOSApi.getRoadmap(), null),
      safeCall(() => window.CollegeOSApi.getMyNotes(), { notes: [] })
    ]);

    const consolidated = {
      streak: toNum(personalized?.stats?.streak, criticalStats.streak),
      xp: toNum(personalized?.stats?.xp, criticalStats.xp),
      roadmapProgress: clampPercent(toNum(personalized?.stats?.roadmapProgress, criticalStats.roadmapProgress)),
      achievements: toNum(personalized?.stats?.certificates, criticalStats.achievements)
    };

    const academic = {
      profile: {
        branch: { label: bootstrapProfile.branchName || bootstrapProfile.branch_name || branchLabel },
        semester: { label: bootstrapProfile.semesterLabel || bootstrapProfile.semester_label || semesterLabel },
        weakSubjects: []
      }
    };

    const runtimeExperienceConfig = bootstrapConfig;

    const tasks = (personalized?.sections?.todaysTasks || []).map((task, idx) => ({
      title: safeText(task.label, `Task ${idx + 1}`),
      note: idx === 0 ? 'Complete this first to unlock momentum.' : 'Short focused sprints work best.'
    }));

    if (!tasks.length) {
      tasks.push(
        { title: 'Complete one roadmap step', note: 'Move one module forward today.' },
        { title: 'Attempt one quiz', note: 'Pick a medium-difficulty chapter quiz.' },
        { title: 'Revise one note', note: 'Review weak topics for 20 minutes.' }
      );
    }
    renderTasks(tasks);

    const lastNote = notesMine?.notes?.[0] || personalized?.sections?.recommendedNotes?.[0] || null;
    const lastRoadmap = roadmap?.roadmap || null;
    const quizAttemptsList = Array.isArray(quizzes?.attempts) ? quizzes.attempts : [];
    const lastQuizAttempt = quizAttemptsList[0] || null;
    const roadmapData = Array.isArray(lastRoadmap?.roadmap_data)
      ? lastRoadmap.roadmap_data
      : (Array.isArray(lastRoadmap?.roadmapData) ? lastRoadmap.roadmapData : []);
    const nextRoadmapStep = roadmapData.find((s) => !s.completed) || roadmapData[0] || null;
    const recQuizzes = personalized?.sections?.recommendedQuizzes || [];

    const topMock = (personalized?.sections?.recommendedMockTests || [])[0] || null;
    const difficultyLabel = safeText(recQuizzes[0]?.difficulty, 'Medium');

    renderContinue([
      {
        title: 'Recommended Note',
        note: lastNote
          ? `${safeText(lastNote.subject, 'Subject')} • ${safeText(lastNote.chapter, 'Chapter')}`
          : 'No note opened yet. Jump into branch-focused notes.',
        href: lastNote ? `notes-library.html?search=${encodeURIComponent(lastNote.subject || lastNote.chapter || '')}` : 'notes-library.html',
        cta: 'Resume Reading',
        icon: 'fa-book-open-reader',
        meta: [safeText(lastNote?.difficulty, 'Core'), '12 min read']
      },
      {
        title: 'Recommended Quiz',
        note: lastQuizAttempt
          ? `${safeText(lastQuizAttempt.subject, 'Quiz')} • ${safeText(lastQuizAttempt.chapter, 'Chapter')} • ${Math.round(toNum(lastQuizAttempt.score_percent, 0))}%`
          : 'No quiz attempts yet. Start with one branch-focused quiz.',
        href: 'quiz-library.html',
        cta: 'Start Quiz',
        icon: 'fa-clipboard-question',
        meta: [difficultyLabel, '10-15 min']
      },
      {
        title: 'Recommended Mock Test',
        note: topMock
          ? safeText(topMock.title || topMock.subject, 'Targeted mock test ready')
          : 'No mock suggestions yet. Start with one topic-wise practice test.',
        href: 'mock-tests.html',
        cta: 'Attempt Test',
        icon: 'fa-flask',
        meta: [safeText(topMock?.difficulty, 'Mixed'), '45-90 min']
      },
      {
        title: 'Roadmap Progress',
        note: nextRoadmapStep
          ? safeText(nextRoadmapStep.title || nextRoadmapStep.name, 'Current roadmap step available')
          : (lastRoadmap ? `Current completion: ${clampPercent(lastRoadmap.progress)}%` : 'No roadmap progress found. Start your personalized path.'),
        href: 'study-roadmap.html',
        cta: 'Continue Path',
        icon: 'fa-map-location-dot',
        meta: [`${consolidated.roadmapProgress}% complete`, 'Next milestone']
      },
      {
        title: 'Branch Focus',
        note: `${safeText(branchLabel, 'Branch')} priorities aligned for ${safeText(semesterLabel, 'this semester')}.`,
        href: 'notes-library.html',
        cta: 'Open Focus Area',
        icon: 'fa-sitemap',
        meta: [safeText(branchLabel, 'Track'), safeText(semesterLabel, 'Semester')]
      }
    ]);

    const recommendedForYou = [
      {
        title: 'Most Relevant Notes Pack',
        note: lastNote
          ? `Continue ${safeText(lastNote.chapter, 'core chapter')} with AI-assisted summaries.`
          : `Start curated ${safeText(branchLabel, 'branch')} notes to build concept depth.`,
        href: lastNote ? `notes-library.html?search=${encodeURIComponent(lastNote.subject || lastNote.chapter || '')}` : 'notes-library.html',
        cta: 'Open Notes',
        icon: 'fa-file-lines',
        meta: ['High relevance', 'Guided revision']
      },
      {
        title: 'Skill Gap Quiz Set',
        note: recQuizzes[0]
          ? `Focus on ${safeText(recQuizzes[0].subject, 'targeted')} questions to improve accuracy.`
          : 'Attempt one medium quiz to unlock more precise AI recommendations.',
        href: 'quiz-library.html',
        cta: 'Practice Quiz',
        icon: 'fa-bullseye',
        meta: [difficultyLabel, 'Adaptive']
      },
      {
        title: 'Interview Readiness Boost',
        note: topMock
          ? `Timed mock available: ${safeText(topMock.title, 'assessment')} to improve performance under pressure.`
          : 'Start one timed mock to benchmark your speed and accuracy.',
        href: 'mock-tests.html',
        cta: 'Start Mock',
        icon: 'fa-stopwatch',
        meta: ['Timed', 'Performance tracking']
      },
      {
        title: 'AI Learning Actions',
        note: 'Generate quiz sets, explain difficult concepts, and create flashcards in one workflow.',
        href: 'ai-tools.html',
        cta: 'Open AI Tools',
        icon: 'fa-sparkles',
        meta: ['AI powered', 'Instant help']
      }
    ];
    renderRecommendedForYou(recommendedForYou);

    const weakSubjects = Array.isArray(academic?.profile?.weakSubjects) ? academic.profile.weakSubjects : [];
    const weakTopics = Array.isArray(mockDash?.aiInsights?.weakTopics) ? mockDash.aiInsights.weakTopics : [];

    const aiRecommendations = [];
    if (weakSubjects.length) aiRecommendations.push(`Revise weak subjects: ${weakSubjects.slice(0, 2).join(', ')}`);
    if (weakTopics.length) aiRecommendations.push(`Accuracy alert in ${weakTopics[0].topic}. Revise before next mock.`);
    if (recQuizzes.length) aiRecommendations.push(`Attempt ${safeText(recQuizzes[0].chapter, recQuizzes[0].subject || 'a targeted quiz')} next.`);
    if (roadmapData.length) {
      const nextStep = roadmapData.find((s) => !s.completed) || roadmapData[0];
      const stepText = safeText(nextStep?.title || nextStep?.name, 'next roadmap milestone');
      aiRecommendations.push(`Continue roadmap step: ${stepText}.`);
      if (heroMilestoneValue) heroMilestoneValue.textContent = stepText;
    }
    if (!aiRecommendations.length) {
      aiRecommendations.push('Complete one quiz and one roadmap action to unlock sharper recommendations.');
      if (heroMilestoneValue) heroMilestoneValue.textContent = 'Start roadmap milestone';
    }
    renderAiRecommendations(aiRecommendations);

    const roadmapBars = [];
    roadmapBars.push({ label: 'Overall Progress', progress: consolidated.roadmapProgress });
    if (roadmapData.length) {
      roadmapData.slice(0, 3).forEach((step, idx) => {
        const pct = clampPercent(step.progress !== undefined ? step.progress : (step.completed ? 100 : 35 + idx * 15));
        roadmapBars.push({ label: safeText(step.title || step.name, `Module ${idx + 1}`), progress: pct });
      });
    } else {
      roadmapBars.push(
        { label: 'Foundation', progress: Math.max(10, Math.round(consolidated.roadmapProgress * 0.5)) },
        { label: 'Core Concepts', progress: Math.max(5, Math.round(consolidated.roadmapProgress * 0.35)) },
        { label: 'Practice & Projects', progress: Math.max(0, Math.round(consolidated.roadmapProgress * 0.2)) }
      );
    }
    renderRoadmapBars(roadmapBars);

    const branchFocus = [];
    if (branchLabel) branchFocus.push(`Top priority track: ${branchLabel}`);
    if (semesterLabel) branchFocus.push(`Semester alignment: ${semesterLabel}`);
    if (personalized?.profile?.careerInterest) branchFocus.push(`Career target: ${personalized.profile.careerInterest}`);
    if (personalized?.membership?.premiumActive) {
      branchFocus.push('Premium active: full notes and roadmap access enabled.');
    } else {
      branchFocus.push('Upgrade to Premium to unlock complete notes + roadmap depth.');
    }
    renderBranchFocus(branchFocus);

    renderContentList(
      'recommendedNotes',
      personalized?.sections?.recommendedNotes || [],
      (item) => `notes-library.html?search=${encodeURIComponent(item.subject || item.chapter || '')}`,
      'No notes recommendations yet. Finish onboarding for better precision.'
    );

    renderContentList(
      'recommendedQuizzes',
      personalized?.sections?.recommendedQuizzes || [],
      () => 'quiz-library.html',
      'No quiz recommendations yet. Complete one attempt to personalize this feed.'
    );

    renderContentList(
      'recommendedMockTests',
      personalized?.sections?.recommendedMockTests || [],
      () => 'mock-tests.html',
      'No mock test suggestions available yet.'
    );

    const quizAttempts = quizAttemptsList;
    const recentMocks = Array.isArray(mockDash?.recentAttempts) ? mockDash.recentAttempts : [];

    const quizPoints = aggregateByDay(quizAttempts, () => 1, 7);
    renderBarChart('quizBars', 'quizAxis', quizPoints, 1, (value) => `${Math.round(value)} attempt(s)`);

    const studyPoints = aggregateByDay(recentMocks, (row) => toNum(row.time_spent_seconds, 0) / 3600, 7);
    renderBarChart('studyBars', 'studyAxis', studyPoints, 0.5, (value) => `${value.toFixed(1)} hour(s)`);

    const accuracySums = aggregateByDay(quizAttempts, (row) => toNum(row.score_percent, 0), 7);
    const accuracyCounts = aggregateByDay(quizAttempts, () => 1, 7);
    const accuracyPoints = accuracySums.map((point, index) => {
      const count = Math.max(1, toNum(accuracyCounts[index]?.value, 0));
      return { ...point, value: point.value / count };
    });
    renderBarChart('accuracyBars', 'accuracyAxis', accuracyPoints, 100, (value) => `${Math.round(value)}%`);

    renderBadges(consolidated);
    renderWeakTopics(weakTopics, weakSubjects);
    renderGamification(consolidated);

    setupAssistant({
      branchLabel,
      topQuiz: recQuizzes[0] || null,
      topMock: (personalized?.sections?.recommendedMockTests || [])[0] || null,
      topNote: (personalized?.sections?.recommendedNotes || [])[0] || null
    });

    applyHomeExperienceConfig(runtimeExperienceConfig);
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.setTimeout(() => {
      initHomeDashboard();
    }, 10);
  });
})();
