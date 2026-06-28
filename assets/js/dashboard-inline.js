document.addEventListener('DOMContentLoaded', async () => {
  if (!window.CollegeOSApi) return;

  function htmlEscape(value) {
    return String(value || '').replace(/[&<>"]|'/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function ensureOnboardingModalStyles() {
    if (document.getElementById('collegeos-onboarding-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'collegeos-onboarding-modal-styles';
    style.textContent = `
      .collegeos-onboarding-modal { position: fixed; inset: 0; z-index: 2200; display: flex; align-items: center; justify-content: center; padding: 1rem; background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(8px); }
      .collegeos-onboarding-modal.hidden { display: none; }
      .collegeos-onboarding-dialog { width: min(620px, 100%); max-height: min(90vh, 760px); overflow: auto; border-radius: 22px; background: linear-gradient(160deg, #ffffff, #f8fbff); box-shadow: 0 24px 70px rgba(15, 23, 42, 0.26); border: 1px solid rgba(191, 219, 254, 0.7); padding: 1.3rem; }
      .collegeos-onboarding-dialog h3 { margin: 0 0 0.35rem; font-size: 1.2rem; color: #0f172a; }
      .collegeos-onboarding-dialog p { margin: 0 0 1rem; color: #475569; line-height: 1.5; }
      .collegeos-onboarding-grid { display: grid; gap: 0.75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .collegeos-onboarding-field { display: flex; flex-direction: column; gap: 0.35rem; }
      .collegeos-onboarding-field label { font-size: 0.84rem; font-weight: 700; color: #334155; }
      .collegeos-onboarding-field input, .collegeos-onboarding-field select { border: 1px solid #dbe5f1; border-radius: 12px; padding: 0.7rem 0.8rem; font-size: 0.95rem; background: #fff; color: #0f172a; }
      .collegeos-onboarding-field.full { grid-column: 1 / -1; }
      .collegeos-onboarding-actions { display: flex; justify-content: flex-end; gap: 0.6rem; margin-top: 1rem; }
      .collegeos-onboarding-actions button { border: 0; border-radius: 999px; padding: 0.7rem 1rem; font-weight: 700; cursor: pointer; }
      .collegeos-onboarding-actions .save-btn { background: linear-gradient(135deg, #2563eb, #3b82f6); color: #fff; }
      .collegeos-onboarding-actions .save-btn:disabled { opacity: 0.7; cursor: not-allowed; }
      .collegeos-onboarding-status { min-height: 1.2rem; font-size: 0.9rem; margin-top: 0.8rem; color: #2563eb; }
      .collegeos-onboarding-status.error { color: #dc2626; }
      @media (max-width: 640px) { .collegeos-onboarding-grid { grid-template-columns: 1fr; } }
    `;
    document.head.appendChild(style);
  }

  function ensureOnboardingModal() {
    ensureOnboardingModalStyles();
    let modal = document.getElementById('collegeosOnboardingModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'collegeosOnboardingModal';
    modal.className = 'collegeos-onboarding-modal hidden';
    modal.innerHTML = `
      <div class="collegeos-onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="collegeosOnboardingTitle">
        <h3 id="collegeosOnboardingTitle">Complete your profile</h3>
        <p>Tell us a little more about your college, course, and current semester so your dashboard stays personalized.</p>
        <form id="collegeosOnboardingForm">
          <div class="collegeos-onboarding-grid">
            <div class="collegeos-onboarding-field full">
              <label for="collegeosOnboardingFullName">Full Name</label>
              <input id="collegeosOnboardingFullName" name="fullName" type="text" required />
            </div>
            <div class="collegeos-onboarding-field full">
              <label for="collegeosOnboardingCollege">College</label>
              <input id="collegeosOnboardingCollege" name="collegeName" type="text" required />
            </div>
            <div class="collegeos-onboarding-field">
              <label for="collegeosOnboardingCourse">Course</label>
              <input id="collegeosOnboardingCourse" name="courseName" type="text" required />
            </div>
            <div class="collegeos-onboarding-field">
              <label for="collegeosOnboardingBranch">Branch</label>
              <input id="collegeosOnboardingBranch" name="branchName" type="text" required />
            </div>
            <div class="collegeos-onboarding-field">
              <label for="collegeosOnboardingSemester">Semester</label>
              <input id="collegeosOnboardingSemester" name="semesterName" type="text" required />
            </div>
            <div class="collegeos-onboarding-field">
              <label for="collegeosOnboardingYear">Year</label>
              <input id="collegeosOnboardingYear" name="yearValue" type="number" min="2000" max="2100" required />
            </div>
          </div>
          <div class="collegeos-onboarding-status" id="collegeosOnboardingStatus"></div>
          <div class="collegeos-onboarding-actions">
            <button class="save-btn" type="submit">Save & Continue</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    const form = modal.querySelector('#collegeosOnboardingForm');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = modal.querySelector('#collegeosOnboardingStatus');
      const submitButton = form.querySelector('button[type="submit"]');
      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());

      if (!payload.fullName || !payload.collegeName || !payload.courseName || !payload.branchName || !payload.semesterName || !payload.yearValue) {
        status.textContent = 'Please fill in every field before continuing.';
        status.classList.add('error');
        return;
      }

      submitButton.disabled = true;
      submitButton.textContent = 'Saving...';
      status.textContent = '';
      status.classList.remove('error');

      try {
        await Promise.all([
          window.CollegeOSApi.updateProfile({
            fullName: payload.fullName,
            collegeName: payload.collegeName,
            courseBranch: `${payload.courseName} · ${payload.branchName}`,
            semester: payload.semesterName,
            targetExam: payload.yearValue
          }).catch(() => null),
          window.CollegeOSApi.updateAcademicProfile({
            courseName: payload.courseName,
            batchYear: Number(payload.yearValue) || null,
            onboardingStep: 'complete',
            onboardingCompleted: true
          }).catch(() => null)
        ]);

        if (window.collegeOsCurrentUser) {
          window.collegeOsCurrentUser.full_name = payload.fullName;
          window.collegeOsCurrentUser.college_name = payload.collegeName;
        }

        status.textContent = 'Profile saved. Welcome to your dashboard.';
        status.classList.remove('error');
        window.setTimeout(() => {
          modal.classList.add('hidden');
          document.body.classList.remove('collegeos-onboarding-open');
        }, 350);
      } catch (error) {
        status.textContent = error?.message || 'We could not save your profile. Please try again.';
        status.classList.add('error');
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Save & Continue';
      }
    });

    return modal;
  }

  function showOnboardingModal(profileData = null) {
    const modal = ensureOnboardingModal();
    if (!modal) return;
    const profile = profileData?.profile || null;
    const user = window.collegeOsCurrentUser || {};
    const fullName = user.full_name || user.fullName || user.name || '';
    const collegeName = user.college_name || user.collegeName || '';
    const courseName = profile?.courseName || profile?.course_name || '';
    const branchName = profile?.branch?.name || profile?.branchName || profile?.branch?.label || '';
    const semesterName = profile?.semester?.label || profile?.semesterLabel || '';
    const yearValue = profile?.batchYear || profile?.year || '';

    modal.querySelector('#collegeosOnboardingFullName').value = fullName;
    modal.querySelector('#collegeosOnboardingCollege').value = collegeName;
    modal.querySelector('#collegeosOnboardingCourse').value = courseName;
    modal.querySelector('#collegeosOnboardingBranch').value = branchName;
    modal.querySelector('#collegeosOnboardingSemester').value = semesterName;
    modal.querySelector('#collegeosOnboardingYear').value = yearValue;
    modal.querySelector('#collegeosOnboardingStatus').textContent = '';
    modal.classList.remove('hidden');
    document.body.classList.add('collegeos-onboarding-open');
    window.setTimeout(() => {
      modal.querySelector('#collegeosOnboardingFullName')?.focus();
    }, 20);
  }

  function handleOnboardingRequirement(event) {
    const payload = event?.detail || {};
    const profileData = payload.profileData || window.__collegeOsPendingOnboardingRequirement?.profileData || null;
    if (window.__collegeOsOnboardingPromptShown) return;
    window.__collegeOsOnboardingPromptShown = true;
    showOnboardingModal(profileData);
  }

  window.addEventListener('collegeos:onboarding-required', handleOnboardingRequirement);
  if (window.__collegeOsPendingOnboardingRequirement) {
    handleOnboardingRequirement({ detail: { profileData: window.__collegeOsPendingOnboardingRequirement.profileData } });
  }

  async function emitDashboardEvent(eventType, eventPayload = {}) {
    if (!window.CollegeOSApi?.trackLearnerEvent) return;
    try {
      await window.CollegeOSApi.trackLearnerEvent({
        eventType,
        source: 'dashboard',
        eventPayload
      });
    } catch {
      // Keep dashboard interactions responsive if telemetry fails.
    }
  }

  function actionIdFromPayload(action) {
    if (!action || typeof action !== 'object') return null;
    return action.id || action.actionId || action.key || action.slug || null;
  }

  function buildActionMeta(action, variant, fallbackTitle = '') {
    return {
      actionId: actionIdFromPayload(action),
      title: action?.title || fallbackTitle || null,
      ctaLabel: action?.ctaLabel || null,
      ctaHref: action?.ctaHref || null,
      variant
    };
  }

  function render(targetId, items, emptyMarkup) {
    const node = document.getElementById(targetId);
    if (!node) return;
    node.innerHTML = items.length ? items.join('') : emptyMarkup;
  }

  function updateDotMeter(id, score) {
    const holder = document.getElementById(id);
    if (!holder) return;
    const dots = holder.querySelectorAll('span');
    const activeCount = score >= 75 ? 3 : score >= 40 ? 2 : 1;
    dots.forEach((dot, idx) => {
      dot.classList.toggle('active', idx < activeCount);
    });
  }

  function dateKey(input) {
    const date = new Date(input || Date.now());
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }

  function last7Days() {
    const now = new Date();
    const days = [];
    for (let i = 6; i >= 0; i -= 1) {
      const day = new Date(now);
      day.setDate(now.getDate() - i);
      days.push(day);
    }
    return days;
  }

  function shortDay(input) {
    return new Date(input).toLocaleDateString('en-IN', { weekday: 'short' }).slice(0, 2);
  }

  function renderWeeklyBars(barId, axisId, points, maxBase, labelFormatter) {
    const barHost = document.getElementById(barId);
    const axisHost = document.getElementById(axisId);
    if (!barHost || !axisHost) return;

    barHost.innerHTML = '';
    axisHost.innerHTML = '';

    const values = points.map((point) => Number(point.value || 0));
    const max = Math.max(maxBase || 1, ...values, 1);

    points.forEach((point) => {
      const bar = document.createElement('div');
      bar.className = 'dash-chart-bar';
      const height = Math.max(6, Math.round((Math.max(0, Number(point.value || 0)) / max) * 100));
      bar.style.height = `${height}%`;
      bar.title = `${point.label}: ${labelFormatter(Number(point.value || 0))}`;
      barHost.appendChild(bar);

      const tick = document.createElement('span');
      tick.textContent = point.label;
      axisHost.appendChild(tick);
    });
  }

  function renderWeakTopics(items) {
    const node = document.getElementById('weakTopicsList');
    if (!node) return;
    if (!items.length) {
      node.innerHTML = '<div class="dash-empty">Complete more quizzes or mocks to detect weak topics.</div>';
      return;
    }
    node.innerHTML = items
      .slice(0, 4)
      .map((item) => `<article class="weak-topic-item"><h4><i class="fa-solid fa-bullseye"></i> ${htmlEscape(item.topic || 'General')}</h4><p>Estimated accuracy: ${Math.round(Number(item.accuracy || 0))}% • Revise and reattempt a focused quiz.</p></article>`)
      .join('');
  }

  function renderRecommendedColumn(targetId, items, icon, fallbackText, openHrefBuilder) {
    const node = document.getElementById(targetId);
    if (!node) return;
    if (!items.length) {
      node.innerHTML = `<div class="dash-empty">${fallbackText}</div>`;
      return;
    }
    node.innerHTML = items
      .slice(0, 3)
      .map((item) => `<article class="dash-item"><div class="dash-item-main"><span class="dash-item-icon"><i class="fa-solid ${icon}"></i></span><div><h3>${htmlEscape(item.title || item.chapter || item.subject || 'Recommended content')}</h3><p>${htmlEscape([item.subject, item.chapter, item.difficulty, item.topic].filter(Boolean).join(' · ') || 'Personalized for your learning profile')}</p></div></div><div class="dash-item-actions"><a class="dash-mini-btn" href="${htmlEscape(openHrefBuilder(item))}">Open</a></div></article>`)
      .join('');
  }

  function setNodeVisibility(id, visible) {
    const node = document.getElementById(id);
    if (!node) return;
    node.hidden = !visible;
  }

  function applyDashboardExperienceConfig(config) {
    if (!config || typeof config !== 'object') return;

    const visibility = config.dashboard?.sectionVisibility || {};
    const visibilityMap = {
      learningStats: 'dashStatsSection',
      aiSuggestions: 'dashAiSuggestionsSection',
      recommendedNotes: 'dashRecommendedNotesColumn',
      recommendedQuizzes: 'dashRecommendedQuizzesColumn',
      recommendedMockTests: 'dashRecommendedMocksColumn',
      achievements: 'dashAchievementsSection',
      analyticsCharts: 'dashAnalyticsSection',
      studyPlan: 'dashStudyPlanSection',
      activityTimeline: 'dashActivitySection',
      continueLearning: 'dashContinueSection',
      weakTopics: 'dashWeakTopicsSection'
    };
    Object.entries(visibilityMap).forEach(([key, id]) => {
      if (key in visibility) setNodeVisibility(id, visibility[key] !== false);
    });

    const flags = config.featureFlags || {};
    if (flags.aiTools === false) {
      setNodeVisibility('dashAiSuggestionsSection', false);
      const aiQuick = document.querySelector('.dash-feature-card[href="ai-tools.html"]');
      if (aiQuick) aiQuick.hidden = true;
    }
    if (flags.mockTests === false) {
      const mockQuick = document.querySelector('.dash-feature-card[href="mock-tests.html"]');
      if (mockQuick) mockQuick.hidden = true;
      setNodeVisibility('dashRecommendedMocksColumn', false);
    }
    if (flags.roadmapSystem === false) {
      const roadmapQuick = document.querySelector('.dash-feature-card[href="study-roadmap.html"]');
      if (roadmapQuick) roadmapQuick.hidden = true;
    }
    if (flags.certificates === false) {
      const certQuick = document.querySelector('.dash-feature-card[href="certificates.html"]');
      if (certQuick) certQuick.hidden = true;
      setNodeVisibility('dashAchievementsSection', false);
    }
    if (flags.analytics === false) {
      setNodeVisibility('dashAnalyticsSection', false);
      setNodeVisibility('dashStatsSection', false);
    }

    const heroCfg = config.home?.hero || {};
    if (heroCfg.title) {
      const node = document.getElementById('dashboardGreeting');
      if (node) node.innerHTML = `<i class="fa-solid fa-hand-wave"></i> ${htmlEscape(heroCfg.title)}`;
    }
    if (heroCfg.description) {
      const node = document.getElementById('dashboardSubtitle');
      if (node) node.textContent = heroCfg.description;
    }

    const order = Array.isArray(config.dashboard?.sectionOrder) ? config.dashboard.sectionOrder : [];
    if (order.length) {
      const mainCol = document.getElementById('dashMainCol');
      const sideCol = document.getElementById('dashSideCol');

      const sectionRegistry = {
        'continue-learning': { node: document.getElementById('dashContinueSection'), parent: mainCol },
        'recommended-for-you': { node: document.getElementById('dashRecommendedSection'), parent: mainCol },
        'weekly-analytics': { node: document.getElementById('dashAnalyticsSection'), parent: mainCol },
        'weak-topics': { node: document.getElementById('dashWeakTopicsSection'), parent: mainCol },
        'recommended-content': { node: document.getElementById('dashRecommendedContentSection'), parent: mainCol },
        'study-plan': { node: document.getElementById('dashStudyPlanSection'), parent: mainCol },
        'activity-timeline': { node: document.getElementById('dashActivitySection'), parent: mainCol },
        'ai-suggestions': { node: document.getElementById('dashAiSuggestionsSection'), parent: sideCol },
        'quick-access': { node: document.getElementById('dashQuickAccessSection'), parent: sideCol },
        achievements: { node: document.getElementById('dashAchievementsSection'), parent: sideCol }
      };

      const byParent = new Map();
      order.forEach((key) => {
        const item = sectionRegistry[key];
        if (!item || !item.node || !item.parent) return;
        if (!byParent.has(item.parent)) byParent.set(item.parent, []);
        byParent.get(item.parent).push(item.node);
      });

      byParent.forEach((nodes, parent) => {
        nodes.forEach((node) => parent.appendChild(node));
      });
    }
  }

  function setDashboardLoading(isLoading) {
    const page = document.getElementById('dashboardPage');
    if (!page) return;
    page.classList.toggle('is-loading', isLoading);
    page.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  }

  setDashboardLoading(true);
  try {
    console.log('[dashboard] Student portal loaded successfully');

    const [personalizedPayload, experiencePayload] = await Promise.all([
      window.CollegeOSApi.getPersonalizedDashboard().catch(() => null),
      window.CollegeOSApi.getStudentExperienceConfig().catch(() => null)
    ]);

    let profilePayload = null;
    let academicPayload = null;
    let statsPayload = {};
    let roadmapPayload = { roadmaps: [] };
    let aiPayload = { tools: [] };
    let subscriptionPayload = {};
    let quizAttemptsPayload = { attempts: [] };
    let mockDashboardPayload = null;

    if (!personalizedPayload) {
      [
        profilePayload,
        academicPayload,
        statsPayload,
        roadmapPayload,
        aiPayload,
        subscriptionPayload,
        quizAttemptsPayload,
        mockDashboardPayload
      ] = await Promise.all([
        window.CollegeOSApi.getProfile ? window.CollegeOSApi.getProfile() : Promise.resolve(null),
        window.CollegeOSApi.getStudentAcademicProfile().catch(() => ({ profile: null })),
        window.CollegeOSApi.getDashboardStats().catch(() => ({})),
        window.CollegeOSApi.getCareerRoadmaps().catch(() => ({ roadmaps: [] })),
        window.CollegeOSApi.getAiToolsCatalog().catch(() => ({ tools: [] })),
        window.CollegeOSApi.getSubscription().catch(() => ({})),
        window.CollegeOSApi.getMyQuizAttempts().catch(() => ({ attempts: [] })),
        window.CollegeOSApi.getMockTestsDashboard().catch(() => null)
      ]);
    }

    const runtimeExperienceConfig = experiencePayload?.config || experiencePayload || null;

    const user = personalizedPayload?.profile ? { full_name: personalizedPayload.profile.fullName } : (profilePayload?.user || profilePayload || {});
    const academic = personalizedPayload?.profile ? {
      category: { name: personalizedPayload.profile.categoryName || '' },
      branch: { name: personalizedPayload.profile.branchName || '' },
      semester: { label: personalizedPayload.profile.semesterLabel || '' }
    } : (academicPayload?.profile || null);
    const stats = personalizedPayload?.stats || statsPayload || {};
    const subscription = personalizedPayload?.membership || subscriptionPayload || {};
    const roadmaps = personalizedPayload?.sections?.recommendedRoadmaps || roadmapPayload?.roadmaps || [];
    const aiTools = personalizedPayload?.sections?.aiSuggestions || aiPayload?.tools || [];
    const intelligence = personalizedPayload?.intelligence || null;
    const personalizedTasks = personalizedPayload?.sections?.todaysTasks || [];
    const personalizedNotes = personalizedPayload?.sections?.recommendedNotes || [];
    const personalizedQuizzes = personalizedPayload?.sections?.recommendedQuizzes || [];
    const personalizedMockTests = personalizedPayload?.sections?.recommendedMockTests || [];
    const personalizedAnnouncements = personalizedPayload?.sections?.announcements || [];
    const quizAttempts = Array.isArray(quizAttemptsPayload?.attempts) ? quizAttemptsPayload.attempts : [];
    const mockRecentAttempts = Array.isArray(mockDashboardPayload?.recentAttempts) ? mockDashboardPayload.recentAttempts : [];
    const weakTopics = Array.isArray(mockDashboardPayload?.aiInsights?.weakTopics) ? mockDashboardPayload.aiInsights.weakTopics : [];

    const firstName = String(user?.name || user?.full_name || 'Student').split(' ')[0];
    const plan = String(subscription.plan || subscription.tier || 'free').toLowerCase();
    const premiumActive = Boolean(subscription.premiumActive || plan === 'premium');

    const categoryName = academic?.category?.name || '';
    const branchName = academic?.branch?.name || '';
    const semesterLabel = academic?.semester?.label || '';
    const academicSummary = [categoryName, branchName, semesterLabel].filter(Boolean).join(' · ');

    const roadmapProgress = Math.max(0, Math.round(Number(stats.roadmapProgress || 0)));
    const xp = Math.max(0, Number(stats.xp || 0));
    const streak = Math.max(0, Number(stats.streak || 0));
    const certCount = Math.max(0, Number(stats.certificates || 0));
    const savedNotes = Math.max(0, Number(stats.savedNotes || 0));

    const availableRoadmaps = roadmaps.filter((item) => item.is_published || item.isPublished || item.status === 'published');
    const recommendedRoadmaps = (availableRoadmaps.length ? availableRoadmaps : roadmaps).slice(0, 3);
    const topRoadmap = recommendedRoadmaps[0] || null;

    let nextMilestone = 'Start roadmap foundation stage';
    if (topRoadmap && window.CollegeOSApi.getCareerRoadmap) {
      try {
        const detail = await window.CollegeOSApi.getCareerRoadmap(topRoadmap.id);
        const stages = detail?.roadmap?.stages || [];
        if (stages.length) nextMilestone = stages[0].stageTitle || stages[0].stage_title || nextMilestone;
      } catch {
        // Keep fallback milestone text.
      }
    }

    const aiNextAction = intelligence?.nextAction?.primary;
    if (aiNextAction?.title) {
      nextMilestone = aiNextAction.title;
    }

    const greeting = document.getElementById('dashboardGreeting');
    const subtitle = document.getElementById('dashboardSubtitle');
    const heroAcademicBadge = document.getElementById('heroAcademicBadge');
    const heroSemesterBadge = document.getElementById('heroSemesterBadge');
    const heroRoadmapBadge = document.getElementById('heroRoadmapBadge');
    const heroMilestoneBadge = document.getElementById('heroMilestoneBadge');
    const heroNameLine = document.getElementById('heroNameLine');
    const heroBranchLine = document.getElementById('heroBranchLine');
    const heroNextActionLine = document.getElementById('heroNextActionLine');
    const heroProgressText = document.getElementById('heroProgressText');
    const heroProgressFill = document.getElementById('heroProgressFill');
    const heroNextChip = document.getElementById('heroNextChip');
    const dashPrimaryAction = document.getElementById('dashPrimaryAction');
    const dashSecondaryAction = document.getElementById('dashSecondaryAction');
    const dashMarkActionDone = document.getElementById('dashMarkActionDone');

    let primaryActionMeta = null;
    let secondaryActionMeta = null;

    if (greeting) greeting.innerHTML = `<i class="fa-solid fa-hand-wave"></i> Welcome back, ${htmlEscape(firstName)}`;
    if (subtitle) {
      subtitle.textContent = personalizedPayload?.hero?.subtitle || (academicSummary
        ? `${academicSummary} | Keep momentum with roadmap milestones and AI-assisted learning.`
        : 'Complete your academic profile to unlock branch-aware recommendations and roadmap personalization.');
    }

    if (heroAcademicBadge) heroAcademicBadge.textContent = academicSummary || 'Course not set';
    if (heroSemesterBadge) heroSemesterBadge.textContent = `Semester: ${semesterLabel || 'Not set'}`;
    if (heroRoadmapBadge) heroRoadmapBadge.textContent = `Roadmap progress: ${roadmapProgress}%`;
    if (heroMilestoneBadge) heroMilestoneBadge.textContent = aiNextAction?.rationale ? `Why now: ${aiNextAction.rationale}` : `Next milestone: ${nextMilestone}`;
    if (heroNameLine) heroNameLine.textContent = `Student: ${firstName}`;
    if (heroBranchLine) heroBranchLine.textContent = `Branch/Course: ${academicSummary || 'Not configured'}`;
    if (heroNextActionLine) heroNextActionLine.textContent = `Next action: ${nextMilestone}`;
    if (heroNextChip) heroNextChip.innerHTML = `<i class="fa-solid fa-bullseye"></i> ${htmlEscape(nextMilestone)}`;
    if (heroProgressText) {
      const focusScore = intelligence?.analytics?.focusScore;
      heroProgressText.textContent = Number.isFinite(Number(focusScore))
        ? `Focus score: ${Math.round(Number(focusScore))} | Roadmap ${roadmapProgress}%`
        : `Roadmap completion: ${roadmapProgress}%`;
    }
    if (heroProgressFill) heroProgressFill.style.width = `${Math.min(100, roadmapProgress)}%`;

    if (dashPrimaryAction && aiNextAction) {
      dashPrimaryAction.href = aiNextAction.ctaHref || 'quiz-library.html';
      dashPrimaryAction.innerHTML = `<i class="fa-solid fa-bullseye"></i> ${htmlEscape(aiNextAction.ctaLabel || 'Do Next Action')}`;
      primaryActionMeta = buildActionMeta(aiNextAction, 'primary', nextMilestone);
    }

    if (dashSecondaryAction && intelligence?.nextAction?.alternatives?.[0]) {
      const alt = intelligence.nextAction.alternatives[0];
      dashSecondaryAction.href = alt.ctaHref || 'study-roadmap.html';
      dashSecondaryAction.innerHTML = `<i class="fa-solid fa-shuffle"></i> ${htmlEscape(alt.ctaLabel || alt.title || 'Alternative Path')}`;
      secondaryActionMeta = buildActionMeta(alt, 'secondary', alt?.title || nextMilestone);
    }

    dashPrimaryAction?.addEventListener('click', () => {
      const meta = primaryActionMeta || buildActionMeta(aiNextAction, 'primary', nextMilestone);
      emitDashboardEvent('next_action_cta_clicked', {
        ...meta,
        location: 'hero'
      });
    });

    dashSecondaryAction?.addEventListener('click', () => {
      const alt = intelligence?.nextAction?.alternatives?.[0] || null;
      const meta = secondaryActionMeta || buildActionMeta(alt, 'secondary', nextMilestone);
      emitDashboardEvent('next_action_cta_clicked', {
        ...meta,
        location: 'hero'
      });
    });

    dashMarkActionDone?.addEventListener('click', () => {
      const meta = primaryActionMeta || buildActionMeta(aiNextAction, 'primary', nextMilestone);
      emitDashboardEvent('next_action_marked_completed', {
        ...meta,
        completionMethod: 'manual_mark_done',
        completedAt: new Date().toISOString()
      });
      dashMarkActionDone.disabled = true;
      dashMarkActionDone.innerHTML = '<i class="fa-solid fa-circle-check"></i> Completed Today';
    });

    const xpNode = document.querySelector('[data-stat="xp"]');
    const streakNode = document.querySelector('[data-stat="streak"]');
    const roadmapNode = document.querySelector('[data-stat="roadmapProgress"]');
    const certNode = document.querySelector('[data-stat="certificates"]');
    if (xpNode) xpNode.textContent = String(xp);
    if (streakNode) streakNode.textContent = String(streak);
    if (roadmapNode) roadmapNode.textContent = `${roadmapProgress}%`;
    if (certNode) certNode.textContent = String(certCount);

    updateDotMeter('dotXp', Math.min(100, Math.round(xp / 15)));
    updateDotMeter('dotStreak', Math.min(100, streak * 10));
    updateDotMeter('dotRoadmap', roadmapProgress);
    updateDotMeter('dotCerts', Math.min(100, certCount * 20));

    const membershipPlanLabel = document.getElementById('membershipPlanLabel');
    const membershipStatusLabel = document.getElementById('membershipStatusLabel');
    const dashboardSavedNotesLabel = document.getElementById('dashboardSavedNotesLabel');
    const membershipHeadline = document.getElementById('membershipHeadline');
    const membershipDescription = document.getElementById('membershipDescription');

    if (membershipPlanLabel) membershipPlanLabel.textContent = premiumActive ? 'Premium Plan' : 'Free Plan';
    if (membershipStatusLabel) membershipStatusLabel.textContent = subscription.statusLabel || 'Active';
    if (dashboardSavedNotesLabel) dashboardSavedNotesLabel.textContent = `${savedNotes} saved notes`;
    if (membershipHeadline) {
      membershipHeadline.textContent = premiumActive
        ? 'Premium AI and advanced roadmaps are unlocked'
        : 'You are on the free learning tier';
    }
    if (membershipDescription) {
      membershipDescription.textContent = premiumActive
        ? `You have access to premium AI tools and advanced tracks${subscription.expiryDate ? ` until ${subscription.expiryDate}` : ''}.`
        : 'Upgrade to unlock premium career paths, deeper interview prep, and advanced AI workflows.';
    }

    const topTool = aiTools[0];
    const aiSuggestionText = document.getElementById('aiSuggestionText');
    if (aiSuggestionText) {
      const weakArea = intelligence?.analytics?.weakTopicDetection?.[0];
      aiSuggestionText.textContent = weakArea
        ? `Weak area detected: ${weakArea.topic} (${Math.round(Number(weakArea.avgScore || 0))}%). Recommended action: ${intelligence?.nextAction?.primary?.ctaLabel || 'Start topic drill'}.`
        : (topTool
        ? `Suggested next topic: ${topTool.title} can accelerate your ${branchName || 'current'} study workflow.`
        : `Suggested next topic: ${topRoadmap?.title || 'Core fundamentals'} for your next focused session.`);
    }

    const nextActionTasks = intelligence?.nextAction?.primary
      ? [
          {
            label: `${intelligence.nextAction.primary.title} (${intelligence.nextAction.primary.description || 'High impact action'})`
          },
          ...((intelligence.nextAction.alternatives || []).map((alt) => ({ label: alt.title })))
        ]
      : [];

    render(
      'continueLearningList',
      [
        `<article class="dash-item"><div class="dash-item-main"><span class="dash-item-icon"><i class="fa-solid fa-file-lines"></i></span><div><h3>Last opened note</h3><p>${personalizedNotes[0] ? `${htmlEscape(personalizedNotes[0].subject || 'Notes')}: ${htmlEscape(personalizedNotes[0].chapter || 'Start revision now')}` : (savedNotes > 0 ? `${savedNotes} saved notes available for revision.` : 'No saved notes yet. Start with your branch core module notes.')}</p></div></div><div class="dash-item-actions"><a class="dash-mini-btn" href="my-notes.html">Open Last Note</a><a class="dash-mini-btn" href="notes-library.html">Browse Notes</a></div></article>`,
        `<article class="dash-item"><div class="dash-item-main"><span class="dash-item-icon"><i class="fa-solid fa-clipboard-question"></i></span><div><h3>Next recommended quiz</h3><p>${personalizedQuizzes[0] ? htmlEscape(`${personalizedQuizzes[0].subject || 'Quiz'} - ${personalizedQuizzes[0].chapter || 'Practice set'}`) : (personalizedMockTests[0] ? htmlEscape(`${personalizedMockTests[0].title || 'Mock test'}${personalizedMockTests[0].subject ? ` (${personalizedMockTests[0].subject})` : ''}`) : 'Continue quiz preparation with branch-focused practice and timed attempts.')}</p></div></div><div class="dash-item-actions"><a class="dash-mini-btn" href="quiz-library.html">Take Quiz</a><a class="dash-mini-btn" href="mock-tests.html">Open Mock Tests</a></div></article>`,
        `<article class="dash-item"><div class="dash-item-main"><span class="dash-item-icon"><i class="fa-solid fa-route"></i></span><div><h3>Next roadmap step</h3><p>${htmlEscape(nextMilestone)}</p></div></div><div class="dash-item-actions"><a class="dash-mini-btn" href="study-roadmap.html">Continue Roadmap</a><a class="dash-mini-btn" href="ai-tools.html">Ask AI for Help</a></div></article>`
      ],
      '<div class="dash-empty">Continue learning suggestions will appear here.</div>'
    );

    render(
      'recommendedList',
      [
        ...recommendedRoadmaps.slice(0, 2).map((item) => `<article class="dash-item"><div class="dash-item-main"><span class="dash-item-icon"><i class="fa-solid ${htmlEscape(item.icon_name || item.iconName || 'fa-route')}"></i></span><div><h3>${htmlEscape(item.title || 'Career roadmap')}</h3><p>${htmlEscape(item.tagline || item.description || 'Recommended based on your current learning profile.')}</p><div class="dash-pill-row"><span class="dash-pill">${htmlEscape(branchName || 'All branches')}</span><span class="dash-pill">${htmlEscape(item.access_type || item.accessType || 'free')}</span></div></div></div><div class="dash-item-actions"><a class="dash-mini-btn" href="study-roadmap.html">Open Track</a></div></article>`),
        `<article class="dash-item"><div class="dash-item-main"><span class="dash-item-icon"><i class="fa-solid fa-book-open"></i></span><div><h3>Branch resources and notes</h3><p>Revision resources for ${htmlEscape(branchName || 'your course')} are prioritized to support your next milestone.</p><div class="dash-pill-row"><span class="dash-pill">${htmlEscape(semesterLabel || 'Current semester')}</span><span class="dash-pill">Progress ${roadmapProgress}%</span></div></div></div><div class="dash-item-actions"><a class="dash-mini-btn" href="notes-library.html">View Resources</a><a class="dash-mini-btn" href="quiz-library.html">Recommended Quizzes</a></div></article>`
      ],
      '<div class="dash-empty">No recommendations available yet.</div>'
    );

    render(
      'dashboardTaskList',
      ((nextActionTasks.length ? nextActionTasks : personalizedTasks).length
        ? (nextActionTasks.length ? nextActionTasks : personalizedTasks).map((task, index) => `<div class="task-row"><span class="task-check ${index === 0 && savedNotes > 0 ? 'done' : ''}">${index === 0 && savedNotes > 0 ? '<i class="fa-solid fa-check"></i>' : ''}</span><p>${htmlEscape(task.label || 'Complete learning task')}</p><i class="fa-solid fa-list-check"></i></div>`)
        : [
          `<div class="task-row"><span class="task-check ${savedNotes > 0 ? 'done' : ''}">${savedNotes > 0 ? '<i class="fa-solid fa-check"></i>' : ''}</span><p>Read one note from your ${htmlEscape(branchName || 'core')} module</p><i class="fa-solid fa-file-lines"></i></div>`,
          `<div class="task-row"><span class="task-check ${streak > 0 ? 'done' : ''}">${streak > 0 ? '<i class="fa-solid fa-check"></i>' : ''}</span><p>Attempt one quiz to maintain your streak</p><i class="fa-solid fa-clipboard-question"></i></div>`,
          `<div class="task-row"><span class="task-check ${roadmapProgress >= 25 ? 'done' : ''}">${roadmapProgress >= 25 ? '<i class="fa-solid fa-check"></i>' : ''}</span><p>Complete your next roadmap step: ${htmlEscape(nextMilestone)}</p><i class="fa-solid fa-route"></i></div>`
        ]),
      '<div class="dash-empty">Daily tasks unavailable.</div>'
    );

    render(
      'recentActivityList',
      [
        `<article class="timeline-item"><h4>Notes opened</h4><p>${savedNotes} saved notes available for quick revision.</p></article>`,
        `<article class="timeline-item"><h4>Quizzes attempted</h4><p>${quizAttempts.length} total attempts tracked so far.</p></article>`,
        `<article class="timeline-item"><h4>Roadmap steps completed</h4><p>Current roadmap completion is ${roadmapProgress}%. Next: ${htmlEscape(nextMilestone)}.</p></article>`,
        `<article class="timeline-item"><h4>Achievements unlocked</h4><p>${certCount} certificates earned and streak at ${streak} day(s).</p></article>`,
        ...(personalizedAnnouncements[0]
          ? [`<article class="timeline-item"><h4>Branch announcement</h4><p>${htmlEscape(personalizedAnnouncements[0].title || personalizedAnnouncements[0].message || 'New update')}</p></article>`]
          : [])
      ],
      '<div class="dash-empty">No activity yet. Start learning to populate your activity feed.</div>'
    );

    renderRecommendedColumn(
      'recommendedNotesList',
      personalizedNotes,
      'fa-file-lines',
      'No note recommendations available yet.',
      (item) => `notes-library.html?search=${encodeURIComponent(item.subject || item.chapter || '')}`
    );
    renderRecommendedColumn(
      'recommendedQuizzesList',
      personalizedQuizzes,
      'fa-clipboard-question',
      'No quiz recommendations available yet.',
      () => 'quiz-library.html'
    );
    renderRecommendedColumn(
      'recommendedMocksList',
      personalizedMockTests,
      'fa-flask',
      'No mock-test recommendations available yet.',
      () => 'mock-tests.html'
    );

    renderWeakTopics(weakTopics);

    const dayBuckets = last7Days().map((day) => ({
      key: day.toISOString().slice(0, 10),
      label: shortDay(day)
    }));

    const studySeries = dayBuckets.map((bucket) => {
      const totalSeconds = mockRecentAttempts
        .filter((item) => dateKey(item.attempted_at || item.attemptedAt) === bucket.key)
        .reduce((sum, item) => sum + Number(item.time_spent_seconds || item.timeSpentSeconds || 0), 0);
      return { label: bucket.label, value: totalSeconds / 3600 };
    });

    const accuracySeries = dayBuckets.map((bucket) => {
      const rows = quizAttempts.filter((item) => dateKey(item.attempted_at || item.attemptedAt) === bucket.key);
      if (!rows.length) return { label: bucket.label, value: 0 };
      const avg = rows.reduce((sum, row) => sum + Number(row.score_percent || row.scorePercent || 0), 0) / rows.length;
      return { label: bucket.label, value: avg };
    });

    const roadmapSeries = dayBuckets.map((bucket, idx) => {
      const base = Math.max(0, roadmapProgress - ((dayBuckets.length - 1 - idx) * 3));
      const normalized = Math.max(0, Math.min(roadmapProgress, base));
      return { label: bucket.label, value: normalized };
    });

    renderWeeklyBars('studyTimeBars', 'studyTimeAxis', studySeries, 2, (v) => `${v.toFixed(1)} hour(s)`);
    renderWeeklyBars('quizAccuracyBars', 'quizAccuracyAxis', accuracySeries, 100, (v) => `${Math.round(v)}%`);
    renderWeeklyBars('roadmapTrendBars', 'roadmapTrendAxis', roadmapSeries, 100, (v) => `${Math.round(v)}%`);

    render(
      'achievementList',
      [
        `<article class="dash-item"><div class="dash-item-main"><span class="dash-item-icon"><i class="fa-solid fa-star"></i></span><div><h3>${xp} XP earned</h3><p>Strong momentum from consistent practice and study sessions.</p></div></div></article>`,
        `<article class="dash-item"><div class="dash-item-main"><span class="dash-item-icon"><i class="fa-solid fa-fire"></i></span><div><h3>${streak} day streak</h3><p>Keep your daily rhythm alive with one focused learning block.</p></div></div></article>`,
        `<article class="dash-item"><div class="dash-item-main"><span class="dash-item-icon"><i class="fa-solid fa-certificate"></i></span><div><h3>${certCount} certificates</h3><p>Your credential portfolio keeps growing with completed milestones.</p></div></div></article>`
      ],
      '<div class="dash-empty">Achievements will appear as you complete tasks.</div>'
    );

    applyDashboardExperienceConfig(runtimeExperienceConfig);
  } catch {
    // Keep default dashboard state if API calls fail.
  } finally {
    setDashboardLoading(false);
  }
});
