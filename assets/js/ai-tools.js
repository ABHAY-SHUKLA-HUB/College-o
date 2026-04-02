document.addEventListener('DOMContentLoaded', async () => {
  const api = window.CollegeOSApi;
  const aiClient = window.CollegeOSAiClient;
  if (!api || !aiClient) return;

  const refs = {
    grid: document.getElementById('aiToolsGrid'),
    recommendationGrid: document.getElementById('aiRecommendationGrid'),
    searchInput: document.getElementById('aiToolSearch'),
    filterSelect: document.getElementById('aiToolFilter'),
    workbenchTitle: document.getElementById('aiWorkbenchTitle'),
    workbenchDescription: document.getElementById('aiWorkbenchDescription'),
    workbenchBadge: document.getElementById('aiWorkbenchBadge'),
    workbenchForm: document.getElementById('aiWorkbenchForm'),
    output: document.getElementById('aiOutput'),
    outputMeta: document.getElementById('aiOutputMeta'),
    outputActions: document.getElementById('aiOutputActions'),
    runBtn: document.getElementById('runAiToolBtn'),
    clearBtn: document.getElementById('clearAiToolBtn'),
    membershipTitle: document.getElementById('aiMembershipTitle'),
    membershipSubtitle: document.getElementById('aiMembershipSubtitle'),
    heroSubtitle: document.getElementById('aiHeroSubtitle'),
    upgradeBanner: document.getElementById('aiUpgradeBanner'),
    runtimeCredits: document.getElementById('aiRuntimeCredits'),
    runtimeUsage: document.getElementById('aiRuntimeUsage'),
    runtimeProvider: document.getElementById('aiRuntimeProvider'),
    historyList: document.getElementById('aiHistoryList')
  };

  if (!refs.grid) return;

  const HISTORY_KEY = 'college_os_ai_history_v1';

  const state = {
    tools: [],
    filtered: [],
    selected: null,
    membership: null,
    profile: null,
    roadmaps: [],
    aiRuntime: null,
    sessionMemory: {
      recentTools: [],
      weakTopics: [],
      lastTopic: null,
      lastMode: 'Quick'
    },
    lastRun: null,
    history: []
  };

  const loadingCopy = {
    'notes-summary': 'Preparing summary...',
    'quiz-generator': 'Building quiz set...',
    'flashcards-generator': 'Crafting flashcards...',
    'doubt-solver': 'Solving your doubt...',
    'resume-builder': 'Drafting resume...',
    'career-suggestion': 'Computing career options...',
    'study-planner': 'Designing study plan...',
    'concept-explainer': 'Explaining concept...',
    'interview-generator': 'Generating interview prep...',
    'roadmap-recommender': 'Recommending roadmap...'
  };

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function safeText(value, max = 240) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function profileLabel() {
    const branch = state.profile?.branch_name || state.profile?.branch?.name || 'your branch';
    const semester = state.profile?.semester_label || state.profile?.semester?.label || 'current semester';
    return `${branch} · ${semester}`;
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      state.history = Array.isArray(parsed) ? parsed.slice(0, 25) : [];
    } catch {
      state.history = [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, 25)));
    } catch {
      // Best effort storage only.
    }
  }

  function addHistory(item) {
    const merged = [item].concat(state.history.filter((h) => h.id !== item.id));
    state.history = merged.slice(0, 25);
    saveHistory();
    renderHistory();
  }

  function renderHistory() {
    if (!refs.historyList) return;
    if (!state.history.length) {
      refs.historyList.innerHTML = '<div class="muted">No saved outputs yet.</div>';
      return;
    }

    refs.historyList.innerHTML = state.history.map((item) => `
      <button class="ai-history-item" data-history-id="${item.id}">
        <strong>${escapeHtml(item.toolTitle)}</strong>
        <span>${escapeHtml(item.snippet)}</span>
        <small>${new Date(item.createdAt).toLocaleString()}</small>
      </button>
    `).join('');

    refs.historyList.querySelectorAll('[data-history-id]').forEach((node) => {
      node.addEventListener('click', () => {
        const hit = state.history.find((h) => h.id === node.dataset.historyId);
        if (!hit) return;
        const tool = state.tools.find((t) => t.tool_key === hit.toolKey);
        if (tool) {
          state.selected = tool;
          renderToolCards();
          renderWorkbench();
        }
        renderStructuredResult(hit.payload);
      });
    });
  }

  async function emitAiEvent(eventType, eventPayload = {}) {
    if (!api.trackLearnerEvent) return;
    try {
      await api.trackLearnerEvent({ eventType, source: 'web', eventPayload });
    } catch {
      // Telemetry failures should not break UX.
    }
  }

  function mapResponseModeToLegacyMode(responseMode) {
    const mode = String(responseMode || '').toLowerCase();
    if (mode === 'short') return 'Quick';
    if (mode === 'detailed') return 'Deep';
    return 'Auto';
  }

  const fieldTemplates = {
    'notes-summary': [
      { key: 'topic', label: 'Topic or chapter', type: 'text', placeholder: 'Operating Systems - Deadlocks' },
      { key: 'content', label: 'Paste notes or text', type: 'textarea', placeholder: 'Paste long notes, textbook chunks, or class content here.' }
    ],
    'quiz-generator': [
      { key: 'subject', label: 'Subject', type: 'text', placeholder: 'DBMS' },
      { key: 'topic', label: 'Topic', type: 'text', placeholder: 'Normalization' },
      { key: 'difficulty', label: 'Difficulty', type: 'select', options: ['Easy', 'Medium', 'Hard'] },
      { key: 'questionCount', label: 'Question count', type: 'number', placeholder: '5' },
      { key: 'concepts', label: 'Concept list', type: 'textarea', placeholder: '1NF, 2NF, candidate key, etc.' }
    ],
    'flashcards-generator': [
      { key: 'topic', label: 'Topic', type: 'text', placeholder: 'TCP/IP model' },
      { key: 'content', label: 'Notes / concept points', type: 'textarea', placeholder: 'Paste key terms or definitions.' },
      { key: 'cardCount', label: 'Card count', type: 'number', placeholder: '6' }
    ],
    'doubt-solver': [
      { key: 'doubt', label: 'Ask your doubt', type: 'textarea', placeholder: 'Explain where exactly you are stuck.' },
      { key: 'subject', label: 'Subject (optional)', type: 'text', placeholder: 'Data Structures' },
      { key: 'level', label: 'Learner level', type: 'select', options: ['Beginner', 'Intermediate', 'Interview'] }
    ],
    'resume-builder': [
      { key: 'name', label: 'Full name', type: 'text', placeholder: 'Riya Sharma' },
      { key: 'education', label: 'Education', type: 'text', placeholder: 'B.Tech CSE, 6th semester' },
      { key: 'targetRole', label: 'Target role', type: 'text', placeholder: 'Software Developer Intern' },
      { key: 'skills', label: 'Skills', type: 'text', placeholder: 'JavaScript, React, Node.js, SQL' },
      { key: 'projects', label: 'Projects', type: 'textarea', placeholder: 'List projects with impact.' },
      { key: 'certifications', label: 'Certifications', type: 'textarea', placeholder: 'AWS, Hackathon wins, etc.' }
    ],
    'career-suggestion': [
      { key: 'interests', label: 'Interests', type: 'text', placeholder: 'Analytics, building products' },
      { key: 'skills', label: 'Current skills', type: 'text', placeholder: 'SQL, communication, Python basics' },
      { key: 'branchCourse', label: 'Branch/Course', type: 'text', placeholder: 'B.Tech IT' },
      { key: 'goals', label: 'Goals', type: 'textarea', placeholder: 'Placement in data role in 6 months' }
    ],
    'study-planner': [
      { key: 'goal', label: 'Study goal', type: 'text', placeholder: 'Semester exams + placement prep' },
      { key: 'topics', label: 'Topics', type: 'textarea', placeholder: 'DBMS, CN, OS, Aptitude' },
      { key: 'availableTime', label: 'Weekly hours', type: 'number', placeholder: '12' },
      { key: 'durationDays', label: 'Duration days', type: 'number', placeholder: '7' },
      { key: 'weakAreas', label: 'Weak areas', type: 'textarea', placeholder: 'SQL queries, CN numericals' }
    ],
    'concept-explainer': [
      { key: 'concept', label: 'Concept', type: 'text', placeholder: 'Virtual memory' },
      { key: 'difficulty', label: 'Depth', type: 'select', options: ['Beginner', 'Intermediate', 'Interview', 'Advanced'] },
      { key: 'context', label: 'Context', type: 'textarea', placeholder: 'Need this for exam and interview prep.' }
    ],
    'interview-generator': [
      { key: 'role', label: 'Role', type: 'text', placeholder: 'Data Analyst' },
      { key: 'skills', label: 'Skill focus', type: 'text', placeholder: 'SQL, Excel, Power BI' },
      { key: 'experienceLevel', label: 'Level', type: 'select', options: ['Fresher', 'Experienced'] },
      { key: 'round', label: 'Round type', type: 'select', options: ['Technical', 'HR', 'Project discussion', 'Mixed'] }
    ],
    'roadmap-recommender': [
      { key: 'targetGoal', label: 'Target goal', type: 'text', placeholder: 'Backend developer role' },
      { key: 'timeframe', label: 'Timeline', type: 'text', placeholder: '6 months' },
      { key: 'branchCourse', label: 'Branch/Course', type: 'text', placeholder: 'B.Tech CSE' },
      { key: 'skillInterests', label: 'Skill interests', type: 'text', placeholder: 'Backend, DSA, system design' },
      { key: 'currentLevel', label: 'Current level', type: 'select', options: ['Beginner', 'Intermediate', 'Advanced'] }
    ]
  };

  function renderToolSkeletons() {
    refs.grid.innerHTML = Array.from({ length: 6 }).map(() => `
      <article class="ai-tool-card ai-skeleton-card">
        <div class="ai-skeleton ai-skeleton-line" style="width:36%;height:14px;"></div>
        <div class="ai-skeleton ai-skeleton-line" style="width:80%;height:16px;margin-top:16px;"></div>
        <div class="ai-skeleton ai-skeleton-line" style="width:92%;height:12px;margin-top:10px;"></div>
        <div class="ai-skeleton ai-skeleton-line" style="width:76%;height:12px;margin-top:8px;"></div>
      </article>
    `).join('');
  }

  function renderOutputSkeleton() {
    refs.output.innerHTML = `
      <div class="ai-output-skeleton">
        <div class="ai-skeleton ai-skeleton-line" style="width: 46%;"></div>
        <div class="ai-skeleton ai-skeleton-line" style="width: 88%;"></div>
        <div class="ai-skeleton ai-skeleton-line" style="width: 91%;"></div>
        <div class="ai-skeleton ai-skeleton-line" style="width: 76%;"></div>
      </div>
    `;
  }

  function getRuntimeCreditsLabel() {
    if (!state.aiRuntime) return 'Credits: --';
    return `AI Credits Left: ${Number(state.aiRuntime.creditsLeft || 0)}`;
  }

  function getRuntimeUsageLabel() {
    if (!state.aiRuntime) return 'Uses Remaining: --';
    return `Plan: ${safeText(state.aiRuntime.planCode || 'free')}`;
  }

  function getRuntimeProviderLabel() {
    if (!state.aiRuntime) return 'Mode: fallback-ready';
    const mode = state.aiRuntime.abuseBlocked
      ? 'Restricted'
      : state.aiRuntime.hiddenTokenMode
        ? 'Credits Mode'
        : 'Detailed Mode';
    return `Experience: ${mode}`;
  }

  function renderRuntime() {
    if (refs.runtimeCredits) refs.runtimeCredits.textContent = getRuntimeCreditsLabel();
    if (refs.runtimeUsage) refs.runtimeUsage.textContent = getRuntimeUsageLabel();
    if (refs.runtimeProvider) refs.runtimeProvider.textContent = getRuntimeProviderLabel();
  }

  function renderToolCards() {
    const query = safeText(refs.searchInput?.value || '').toLowerCase();
    const filter = refs.filterSelect?.value || 'all';

    state.filtered = state.tools.filter((tool) => {
      const haystack = `${tool.title} ${tool.tagline} ${tool.description}`.toLowerCase();
      const matchesQuery = !query || haystack.includes(query);
      const matchesFilter =
        filter === 'all' ||
        (filter === 'free' && tool.access_type === 'free') ||
        (filter === 'premium' && tool.access_type === 'premium') ||
        (filter === 'featured' && tool.is_featured);
      return matchesQuery && matchesFilter;
    });

    if (!state.filtered.length) {
      refs.grid.innerHTML = '<article class="card"><p class="muted">No tools match your search right now.</p></article>';
      return;
    }

    refs.grid.innerHTML = state.filtered.map((tool) => {
      const badge = tool.locked ? 'Locked' : tool.access_type === 'premium' ? 'Premium' : 'Free';
      const badgeClass = tool.locked ? 'locked' : tool.access_type === 'premium' ? 'premium' : '';
      return `
        <article class="ai-tool-card ${state.selected?.id === tool.id ? 'active' : ''}" data-tool-id="${tool.id}">
          <div class="ai-tool-top">
            <div class="ai-tool-icon" style="background:${escapeHtml(tool.accent_color)};"><i class="fa-solid ${escapeHtml(tool.icon_name)}"></i></div>
            <span class="ai-badge ${badgeClass}">${badge}</span>
          </div>
          <h3>${escapeHtml(tool.title)}</h3>
          <p>${escapeHtml(tool.tagline || tool.description || '')}</p>
          <div class="ai-tool-benefits">${(tool.benefits || []).slice(0, 3).map((benefit) => `<span>${escapeHtml(benefit)}</span>`).join('')}</div>
        </article>
      `;
    }).join('');

    refs.grid.querySelectorAll('[data-tool-id]').forEach((node) => {
      node.addEventListener('click', () => {
        const tool = state.tools.find((item) => Number(item.id) === Number(node.dataset.toolId));
        if (!tool) return;
        state.selected = tool;
        renderToolCards();
        renderWorkbench();
        emitAiEvent('ai_tool_selected', {
          toolKey: tool.tool_key,
          accessType: tool.access_type,
          locked: Boolean(tool.locked)
        });
      });
    });
  }

  function renderRecommendations() {
    const recommended = state.tools.filter((tool) => !tool.locked).slice(0, 3);
    refs.recommendationGrid.innerHTML = recommended.map((tool) => `
      <article class="ai-tool-card" data-tool-reco="${tool.id}">
        <div class="ai-tool-top">
          <div class="ai-tool-icon" style="background:${escapeHtml(tool.accent_color)};"><i class="fa-solid ${escapeHtml(tool.icon_name)}"></i></div>
          <span class="ai-badge ${tool.access_type === 'premium' ? 'premium' : ''}">${escapeHtml(tool.access_type)}</span>
        </div>
        <h3>${escapeHtml(tool.title)}</h3>
        <p>${escapeHtml(tool.description)}</p>
      </article>
    `).join('');

    refs.recommendationGrid.querySelectorAll('[data-tool-reco]').forEach((node) => {
      node.addEventListener('click', () => {
        const tool = state.tools.find((item) => Number(item.id) === Number(node.dataset.toolReco));
        if (!tool) return;
        state.selected = tool;
        renderToolCards();
        renderWorkbench();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  function renderField(field) {
    if (field.type === 'textarea') {
      return `<label>${escapeHtml(field.label)}<textarea name="${escapeHtml(field.key)}" placeholder="${escapeHtml(field.placeholder || '')}"></textarea></label>`;
    }
    if (field.type === 'select') {
      return `<label>${escapeHtml(field.label)}<select name="${escapeHtml(field.key)}">${(field.options || []).map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}</select></label>`;
    }
    return `<label>${escapeHtml(field.label)}<input type="${escapeHtml(field.type || 'text')}" name="${escapeHtml(field.key)}" placeholder="${escapeHtml(field.placeholder || '')}" /></label>`;
  }

  function renderWorkbench() {
    const tool = state.selected;
    if (!tool) {
      refs.workbenchTitle.textContent = 'Choose a tool';
      refs.workbenchDescription.textContent = 'Select a tool from the left to generate structured output.';
      refs.workbenchBadge.textContent = 'Ready';
      refs.workbenchBadge.className = 'ai-badge';
      refs.workbenchForm.innerHTML = '';
      refs.upgradeBanner.style.display = 'none';
      refs.output.innerHTML = '<div class="ai-empty"><div><i class="fa-solid fa-sparkles"></i><p>Pick a tool and generate your first output.</p></div></div>';
      refs.outputMeta.textContent = '';
      refs.outputActions.style.display = 'none';
      return;
    }

    refs.workbenchTitle.textContent = tool.title;
    const memoryHint = [];
    if (state.sessionMemory.lastTopic) memoryHint.push(`Last topic: ${state.sessionMemory.lastTopic}`);
    if (Array.isArray(state.sessionMemory.weakTopics) && state.sessionMemory.weakTopics.length) {
      memoryHint.push(`Weak focus: ${state.sessionMemory.weakTopics.slice(0, 2).join(', ')}`);
    }

    refs.workbenchDescription.textContent = [tool.description || tool.tagline || '', memoryHint.join(' | ')].filter(Boolean).join(' ');
    refs.workbenchBadge.textContent = tool.locked ? 'Premium Feature' : (tool.access_type === 'premium' ? 'Premium' : 'Included');
    refs.workbenchBadge.className = `ai-badge ${tool.locked ? 'locked' : (tool.access_type === 'premium' ? 'premium' : '')}`;

    refs.workbenchForm.innerHTML = `
      <label>Response mode
        <select name="responseMode">
          <option value="short">short</option>
          <option value="medium" selected>medium</option>
          <option value="detailed">detailed</option>
        </select>
      </label>
      ${fieldTemplates[tool.tool_key] ? fieldTemplates[tool.tool_key].map(renderField).join('') : ''}
    `;

    if (tool.locked) {
      refs.upgradeBanner.style.display = '';
      refs.upgradeBanner.innerHTML = `<strong>${escapeHtml(tool.title)}</strong> is a Premium feature. <a href="pricing.html">Upgrade now</a> to unlock it.`;
    } else {
      refs.upgradeBanner.style.display = 'none';
    }
  }

  function collectInputs() {
    const payload = {};
    refs.workbenchForm.querySelectorAll('input, textarea, select').forEach((field) => {
      const key = safeText(field.name);
      if (!key) return;
      payload[key] = safeText(field.value, 6000);
    });

    payload.mode = mapResponseModeToLegacyMode(payload.responseMode || 'medium');
    return payload;
  }

  function renderValidationErrors(errors) {
    refs.output.innerHTML = `
      <h3>Input needed</h3>
      <ul>${errors.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      <p class="muted">Tip: complete missing fields and retry.</p>
    `;
  }

  function validateInputs(toolKey, inputs) {
    const errors = [];
    const hasAny = (...keys) => keys.some((key) => safeText(inputs[key]).length > 0);

    if (toolKey === 'notes-summary' && !hasAny('content', 'topic')) errors.push('Add notes or topic for summary generation.');
    if (toolKey === 'quiz-generator' && !hasAny('subject', 'topic', 'concepts')) errors.push('Add subject/topic/concepts to generate quiz.');
    if (toolKey === 'flashcards-generator' && !hasAny('topic', 'content')) errors.push('Add topic or notes to generate flashcards.');
    if (toolKey === 'doubt-solver' && safeText(inputs.doubt).length < 8) errors.push('Write your doubt clearly in one sentence.');
    if (toolKey === 'resume-builder') {
      const populated = ['name', 'education', 'skills', 'projects', 'targetRole'].filter((key) => safeText(inputs[key]).length > 0);
      if (populated.length < 2) errors.push('Provide at least two resume inputs like education and skills.');
    }
    if (toolKey === 'career-suggestion' && !hasAny('interests', 'skills', 'goals', 'branchCourse')) errors.push('Add interests/skills/goals for career suggestion.');
    if (toolKey === 'study-planner' && !hasAny('goal', 'topics', 'availableTime', 'weakAreas')) errors.push('Add goals/topics/time for study planner.');
    if (toolKey === 'concept-explainer' && safeText(inputs.concept).length < 3) errors.push('Enter concept to explain.');
    if (toolKey === 'interview-generator' && !hasAny('role', 'skills')) errors.push('Add role and skills for interview generation.');
    if (toolKey === 'roadmap-recommender' && !hasAny('targetGoal', 'goal', 'currentLevel', 'skillInterests')) errors.push('Add target goal or current level for roadmap recommendation.');

    return errors;
  }

  function inferToolFromSuggestion(text) {
    const lower = safeText(text, 300).toLowerCase();
    if (lower.includes('quiz')) return 'quiz-generator';
    if (lower.includes('flashcard')) return 'flashcards-generator';
    if (lower.includes('study plan') || lower.includes('plan')) return 'study-planner';
    if (lower.includes('concept')) return 'concept-explainer';
    if (lower.includes('resume')) return 'resume-builder';
    if (lower.includes('interview')) return 'interview-generator';
    if (lower.includes('roadmap')) return 'roadmap-recommender';
    if (lower.includes('doubt')) return 'doubt-solver';
    return null;
  }

  function wireFollowUpButtons() {
    refs.output.querySelectorAll('[data-followup-tool]').forEach((node) => {
      node.addEventListener('click', () => {
        const nextToolKey = node.getAttribute('data-followup-tool') || '';
        const nextTool = state.tools.find((tool) => tool.tool_key === nextToolKey && !tool.locked);
        if (!nextTool) return;
        state.selected = nextTool;
        renderToolCards();
        renderWorkbench();

        const topicSeed = state.sessionMemory?.lastTopic;
        if (topicSeed) {
          const topicField = refs.workbenchForm.querySelector('[name="topic"], [name="concept"], [name="goal"], [name="targetGoal"]');
          if (topicField && !topicField.value) topicField.value = topicSeed;
        }
      });
    });
  }

  function extractPlainTextFromResult(result) {
    if (!result) return '';
    const chunks = [];
    if (result.title) chunks.push(result.title);
    if (result.keyTakeaway) chunks.push(result.keyTakeaway);
    (result.sections || []).forEach((section) => {
      (section.items || []).forEach((item) => {
        if (typeof item === 'string') chunks.push(item);
        else if (item && typeof item === 'object') {
          chunks.push(Object.values(item).map((v) => safeText(v, 300)).join(' '));
        }
      });
    });
    return chunks.join('\n').trim();
  }

  function renderStructuredResult(payload) {
    const title = escapeHtml(payload?.result?.title || payload?.toolTitle || 'AI Output');
    const result = payload?.result || {};
    const sections = Array.isArray(result.sections) ? result.sections : [];
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    const badges = Array.isArray(result.badges) ? result.badges : [];
    const followUps = Array.isArray(result.followUps) ? result.followUps : [];
    const mode = payload?.meta?.mode || result.mode || 'Auto';

    let html = `<h3>${title}</h3>`;
    html += `<div class="contrib-pills" style="margin-bottom:10px;"><span class="contrib-pill">Mode: ${escapeHtml(mode)}</span>${badges.map((badge) => `<span class="contrib-pill">${escapeHtml(badge)}</span>`).join('')}</div>`;

    if (result.keyTakeaway) {
      html += `<div class="card" style="margin-bottom:12px;"><strong>Key Takeaway</strong><p style="margin-top:8px;">${escapeHtml(result.keyTakeaway)}</p></div>`;
    }

    if (warnings.length) {
      html += `<div class="card" style="margin-bottom:12px;"><strong>Input note</strong><ul>${warnings.map((warn) => `<li>${escapeHtml(warn)}</li>`).join('')}</ul></div>`;
    }

    sections.forEach((section) => {
      const heading = escapeHtml(section.heading || 'Section');
      const type = String(section.type || 'bullets');
      const items = Array.isArray(section.items) ? section.items : [];
      html += `<section style="margin-bottom:12px;"><h4>${heading}</h4>`;

      if (type === 'paragraphs') {
        html += items.map((item) => `<p>${escapeHtml(item)}</p>`).join('');
      } else if (type === 'numbered') {
        html += `<ol>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>`;
      } else if (type === 'quiz') {
        html += items.map((item) => `
          <div style="margin-bottom:10px;">
            <strong>${escapeHtml(item.question || '')}</strong>
            <ol type="A">${(item.options || []).map((option) => `<li>${escapeHtml(option)}</li>`).join('')}</ol>
            <p><strong>Answer:</strong> ${escapeHtml(item.answer || '-')}</p>
            <p class="muted">${escapeHtml(item.explanation || '')}</p>
          </div>
        `).join('');
      } else if (type === 'flashcards') {
        html += `<div class="ai-tools-grid">${items.map((item) => `<article class="card"><strong>${escapeHtml(item.front || 'Front')}</strong><p>${escapeHtml(item.back || '')}</p></article>`).join('')}</div>`;
      } else if (type === 'badges') {
        html += `<div class="contrib-pills">${items.map((item) => `<span class="contrib-pill">${escapeHtml(item)}</span>`).join('')}</div>`;
      } else {
        html += `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
      }

      html += '</section>';
    });

    if (followUps.length) {
      html += `<section style="margin-top:14px;"><h4>Next Step</h4><div class="contrib-actions">${followUps.map((item) => `<button type="button" class="btn secondary" data-followup-tool="${escapeHtml(inferToolFromSuggestion(item) || '')}">${escapeHtml(item)}</button>`).join('')}</div></section>`;
    }

    refs.output.innerHTML = html;
    wireFollowUpButtons();

    const provider = payload?.aiMeta?.provider || 'fallback';
    const fallbackActive = Boolean(payload?.aiMeta?.fallbackActive);
    const creditsText = payload?.aiMeta?.visibleCreditsLeft ? ` | AI Credits Left: ${Number(payload?.aiMeta?.creditsLeft || 0)}` : '';
    refs.outputMeta.textContent = `Provider: ${provider}${fallbackActive ? ' (fallback assisted)' : ''}${creditsText}`;

    refs.outputActions.style.display = '';
  }

  function renderErrorState(friendlyError, selectedTool) {
    const isPremium = friendlyError.code === 'UPGRADE_REQUIRED' || friendlyError.code === 'PLAN_TOOL_LOCKED' || friendlyError.code === 'CREDITS_EXHAUSTED';
    refs.output.innerHTML = `
      <h3>${escapeHtml(friendlyError.title)}</h3>
      <p>${escapeHtml(friendlyError.message)}</p>
      ${isPremium ? '<p><a class="btn secondary" href="pricing.html">View Premium Plans</a></p>' : ''}
      <p class="muted">Your input is preserved. You can retry anytime.</p>
    `;
    refs.outputMeta.textContent = selectedTool ? `Tool: ${selectedTool.title}` : '';
    refs.outputActions.style.display = state.lastRun ? '' : 'none';
  }

  function collectCurrentOutputText() {
    return safeText(refs.output?.innerText || '', 20000);
  }

  async function copyLatestOutput() {
    const text = collectCurrentOutputText();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    refs.outputMeta.textContent = `${refs.outputMeta.textContent} | Copied`;
  }

  async function regenerateLast() {
    if (!state.lastRun) return;
    const tool = state.tools.find((t) => t.tool_key === state.lastRun.toolKey);
    if (!tool) return;
    state.selected = tool;
    renderToolCards();
    renderWorkbench();
    await runGeneration(state.lastRun.inputs, true);
  }

  function saveCurrentResult() {
    if (!state.lastRun || !state.lastRun.payload) return;
    const payload = state.lastRun.payload;
    const snippet = safeText(payload?.result?.keyTakeaway || extractPlainTextFromResult(payload?.result), 110) || 'Saved AI result';
    addHistory({
      id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      toolKey: state.lastRun.toolKey,
      toolTitle: payload?.toolTitle || state.selected?.title || state.lastRun.toolKey,
      snippet,
      payload,
      createdAt: new Date().toISOString()
    });
    refs.outputMeta.textContent = `${refs.outputMeta.textContent} | Saved to history`;
  }

  function attachOutputActions() {
    document.getElementById('aiCopyBtn')?.addEventListener('click', async () => {
      try {
        await copyLatestOutput();
      } catch {
        refs.outputMeta.textContent = `${refs.outputMeta.textContent} | Copy failed`;
      }
    });

    document.getElementById('aiRegenerateBtn')?.addEventListener('click', async () => {
      await regenerateLast();
    });

    document.getElementById('aiSaveBtn')?.addEventListener('click', () => {
      saveCurrentResult();
    });
  }

  async function refreshRuntime() {
    const runtimeResult = await aiClient.fetchRuntime();
    state.aiRuntime = runtimeResult.runtime;
    renderRuntime();
  }

  async function runGeneration(forcedInputs = null, fromRegenerate = false) {
    const selectedTool = state.selected;
    if (!selectedTool) return;

    if (selectedTool.locked) {
      renderErrorState({
        title: 'Premium Feature',
        message: `${selectedTool.title} is available on Premium plan.`,
        code: 'UPGRADE_REQUIRED'
      }, selectedTool);
      await emitAiEvent('ai_tool_blocked', {
        toolKey: selectedTool.tool_key,
        reason: 'membership_locked'
      });
      return;
    }

    const inputs = forcedInputs || collectInputs();
    const validationErrors = validateInputs(selectedTool.tool_key, inputs);
    if (validationErrors.length) {
      renderValidationErrors(validationErrors);
      await emitAiEvent('ai_tool_used', {
        toolKey: selectedTool.tool_key,
        success: false,
        reason: 'validation_failed',
        tokensUsed: 0
      });
      return;
    }

    const originalBtnHtml = refs.runBtn.innerHTML;
    const startedAt = Date.now();

    try {
      refs.runBtn.disabled = true;
      refs.runBtn.textContent = loadingCopy[selectedTool.tool_key] || `Generating ${selectedTool.title}...`;
      renderOutputSkeleton();
      refs.outputMeta.textContent = 'Working on your request...';

      const generated = await aiClient.generateToolOutput(selectedTool.tool_key, inputs);
      if (!generated.ok) {
        renderErrorState(generated.error, selectedTool);
        await emitAiEvent('ai_tool_used', {
          toolKey: selectedTool.tool_key,
          success: false,
          reason: generated.error.code || 'runtime_error',
          durationMs: Date.now() - startedAt,
          tokensUsed: 0
        });
        return;
      }

      const payload = generated.payload;
      if (payload?.memory && typeof payload.memory === 'object') {
        state.sessionMemory = { ...state.sessionMemory, ...payload.memory };
      }

      state.lastRun = {
        toolKey: selectedTool.tool_key,
        inputs,
        payload
      };

      renderStructuredResult(payload);
      saveCurrentResult();
      await refreshRuntime();

      const outputChars = JSON.stringify(payload?.result || {}).length;
      const tokensEstimate = Math.max(32, Math.round(outputChars / 4));
      await emitAiEvent('ai_tool_used', {
        toolKey: selectedTool.tool_key,
        success: true,
        durationMs: Date.now() - startedAt,
        tokensUsed: tokensEstimate,
        fromRegenerate
      });
    } finally {
      refs.runBtn.disabled = false;
      refs.runBtn.innerHTML = originalBtnHtml;
    }
  }

  async function loadData() {
    renderToolSkeletons();
    loadHistory();
    renderHistory();

    const [toolsPayload, roadmapPayload, runtimeResult] = await Promise.all([
      api.getAiToolsCatalog(),
      api.getCareerRoadmaps().catch(() => ({ roadmaps: [] })),
      aiClient.fetchRuntime()
    ]);

    state.tools = toolsPayload.tools || [];
    state.membership = toolsPayload.membership || null;
    state.profile = toolsPayload.profile || null;
    state.roadmaps = roadmapPayload.roadmaps || [];
    state.aiRuntime = runtimeResult.runtime || toolsPayload.aiRuntime || null;

    if (state.membership) {
      refs.membershipTitle.textContent = state.membership.premiumActive ? 'Premium AI unlocked' : 'Membership aware';
      refs.membershipSubtitle.textContent = state.membership.premiumActive
        ? 'All AI tools are available for your current plan.'
        : 'Free tools are available now. Premium unlocks advanced tools and higher AI usage.';
    }

    if (state.profile) {
      refs.heroSubtitle.textContent = `AI workflows are personalized for ${profileLabel()} so your study and placement flow stays context-aware.`;
    }

    state.selected = state.tools.find((tool) => !tool.locked) || state.tools[0] || null;
    renderRuntime();
    renderToolCards();
    renderRecommendations();
    renderWorkbench();

    emitAiEvent('ai_tools_workspace_opened', {
      toolsVisible: state.tools.length,
      membershipTier: state.membership?.tier || 'free',
      premiumActive: Boolean(state.membership?.premiumActive)
    });
  }

  refs.runBtn?.addEventListener('click', async () => {
    await runGeneration();
  });

  refs.clearBtn?.addEventListener('click', () => {
    refs.workbenchForm.querySelectorAll('input, textarea, select').forEach((field) => {
      field.value = '';
      if (field.tagName === 'SELECT' && field.options.length) field.selectedIndex = 0;
    });
  });

  refs.searchInput?.addEventListener('input', renderToolCards);
  refs.filterSelect?.addEventListener('change', renderToolCards);

  attachOutputActions();

  try {
    await loadData();
  } catch (error) {
    refs.grid.innerHTML = `<article class="card"><p class="muted">${escapeHtml(error.message || 'Failed to load AI tools')}</p></article>`;
    refs.recommendationGrid.innerHTML = '';
  }
});
