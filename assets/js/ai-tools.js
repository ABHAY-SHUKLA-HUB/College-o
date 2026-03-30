document.addEventListener('DOMContentLoaded', async () => {
  const grid = document.getElementById('aiToolsGrid');
  const recommendationGrid = document.getElementById('aiRecommendationGrid');
  const searchInput = document.getElementById('aiToolSearch');
  const filterSelect = document.getElementById('aiToolFilter');
  const workbenchTitle = document.getElementById('aiWorkbenchTitle');
  const workbenchDescription = document.getElementById('aiWorkbenchDescription');
  const workbenchBadge = document.getElementById('aiWorkbenchBadge');
  const workbenchForm = document.getElementById('aiWorkbenchForm');
  const output = document.getElementById('aiOutput');
  const runBtn = document.getElementById('runAiToolBtn');
  const clearBtn = document.getElementById('clearAiToolBtn');
  const membershipTitle = document.getElementById('aiMembershipTitle');
  const membershipSubtitle = document.getElementById('aiMembershipSubtitle');
  const heroSubtitle = document.getElementById('aiHeroSubtitle');
  const upgradeBanner = document.getElementById('aiUpgradeBanner');
  if (!grid || !window.CollegeOSApi) return;

  const state = {
    tools: [],
    filtered: [],
    selected: null,
    membership: null,
    profile: null,
    roadmaps: [],
    sessionMemory: {
      recentTools: [],
      weakTopics: [],
      lastTopic: null,
      lastMode: 'Quick'
    }
  };

  const loadingCopy = {
    'notes-summary': 'Generating smart summary...',
    'quiz-generator': 'Generating adaptive quiz...',
    'flashcards-generator': 'Generating memory cards...',
    'doubt-solver': 'Solving your doubt...',
    'resume-builder': 'Optimizing resume output...',
    'career-suggestion': 'Analyzing your career fit...',
    'study-planner': 'Generating smart plan...',
    'concept-explainer': 'Building concept explanation...',
    'interview-generator': 'Generating interviewer-style questions...',
    'roadmap-recommender': 'Generating personalized roadmap...'
  };

  async function emitAiEvent(eventType, eventPayload = {}) {
    if (!window.CollegeOSApi?.trackLearnerEvent) return;
    try {
      await window.CollegeOSApi.trackLearnerEvent({
        eventType,
        source: 'web',
        eventPayload
      });
    } catch {
      // Keep AI tool UX uninterrupted when telemetry is unavailable.
    }
  }

  const fieldTemplates = {
    'notes-summary': [
      { key: 'topic', label: 'Topic or chapter', type: 'text', placeholder: 'Operating Systems - Deadlocks' },
      { key: 'content', label: 'Paste your note content', type: 'textarea', placeholder: 'Paste long notes, textbook paragraphs, or your own write-up here.' }
    ],
    'quiz-generator': [
      { key: 'subject', label: 'Subject', type: 'text', placeholder: 'DBMS' },
      { key: 'topic', label: 'Topic/Chapter', type: 'text', placeholder: 'Normalization in DBMS' },
      { key: 'difficulty', label: 'Difficulty', type: 'select', options: ['Easy', 'Medium', 'Hard'] },
      { key: 'questionCount', label: 'Number of questions', type: 'number', placeholder: '5' },
      { key: 'concepts', label: 'Key concepts or points', type: 'textarea', placeholder: 'Primary key, candidate key, 1NF, 2NF, 3NF...' }
    ],
    'flashcards-generator': [
      { key: 'topic', label: 'Topic', type: 'text', placeholder: 'TCP/IP model' },
      { key: 'content', label: 'Concept notes', type: 'textarea', placeholder: 'Add definitions, facts, formulas, or short notes.' },
      { key: 'cardCount', label: 'Number of flashcards', type: 'number', placeholder: '6' }
    ],
    'doubt-solver': [
      { key: 'doubt', label: 'What is your doubt?', type: 'textarea', placeholder: 'I do not understand how recursion unwinds in a stack.' },
      { key: 'subject', label: 'Subject/Topic (optional)', type: 'text', placeholder: 'Data Structures' },
      { key: 'level', label: 'Explain for', type: 'select', options: ['Beginner', 'Intermediate', 'Interview'] }
    ],
    'resume-builder': [
      { key: 'name', label: 'Full name', type: 'text', placeholder: 'Riya Sharma' },
      { key: 'education', label: 'Education', type: 'text', placeholder: 'B.Tech CSE, 6th semester' },
      { key: 'targetRole', label: 'Target role', type: 'text', placeholder: 'Software Developer Intern' },
      { key: 'skills', label: 'Skills', type: 'text', placeholder: 'JavaScript, React, Node.js, SQL' },
      { key: 'projects', label: 'Projects', type: 'textarea', placeholder: 'College portal, e-commerce dashboard, API project...' },
      { key: 'certifications', label: 'Certifications/Achievements', type: 'textarea', placeholder: 'AWS Cloud Practitioner, Hackathon finalist...' }
    ],
    'career-suggestion': [
      { key: 'interests', label: 'Your interests', type: 'text', placeholder: 'Problem solving, analytics, building products' },
      { key: 'skills', label: 'Your skills', type: 'text', placeholder: 'SQL, communication, Python basics' },
      { key: 'branchCourse', label: 'Branch/Course', type: 'text', placeholder: 'B.Tech IT' },
      { key: 'goals', label: 'Career goals', type: 'textarea', placeholder: 'Placement in data/analytics role within 6 months' },
      { key: 'workStyle', label: 'Preferred work style', type: 'select', options: ['Analytical', 'Creative', 'Technical', 'Business-oriented'] }
    ],
    'study-planner': [
      { key: 'goal', label: 'Exam goal', type: 'text', placeholder: 'Prepare for semester exams and placement aptitude' },
      { key: 'topics', label: 'Subject/topic list', type: 'textarea', placeholder: 'DBMS, CN, OS, Aptitude' },
      { key: 'availableTime', label: 'Weekly hours available', type: 'number', placeholder: '12' },
      { key: 'durationDays', label: 'Plan duration (days)', type: 'number', placeholder: '7' },
      { key: 'weakAreas', label: 'Weak areas', type: 'textarea', placeholder: 'DBMS SQL queries, CN numericals, aptitude speed math' }
    ],
    'concept-explainer': [
      { key: 'concept', label: 'Concept to explain', type: 'text', placeholder: 'Virtual memory' },
      { key: 'difficulty', label: 'Difficulty level', type: 'select', options: ['Beginner', 'Intermediate', 'Interview', 'Advanced'] },
      { key: 'context', label: 'Context', type: 'textarea', placeholder: 'Need this for interview + semester revision.' }
    ],
    'interview-generator': [
      { key: 'role', label: 'Role', type: 'text', placeholder: 'Data Analyst' },
      { key: 'skills', label: 'Focus skills/topic', type: 'text', placeholder: 'SQL, Excel, Power BI, communication' },
      { key: 'experienceLevel', label: 'Experience level', type: 'select', options: ['Fresher', 'Experienced'] },
      { key: 'round', label: 'Interview round', type: 'select', options: ['Technical', 'HR', 'Project discussion', 'Mixed'] }
    ],
    'roadmap-recommender': [
      { key: 'targetGoal', label: 'Target goal', type: 'text', placeholder: 'High-growth tech role with project building' },
      { key: 'timeframe', label: 'Target timeline', type: 'text', placeholder: '6 months' },
      { key: 'branchCourse', label: 'Branch/Course', type: 'text', placeholder: 'B.Tech CSE' },
      { key: 'skillInterests', label: 'Skill interests', type: 'text', placeholder: 'Backend, DSA, system design' },
      { key: 'currentLevel', label: 'Current level', type: 'select', options: ['Beginner', 'Intermediate', 'Advanced'] }
    ]
  };

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function profileLabel() {
    const branch = state.profile?.branch_name || state.profile?.branch?.name || 'your branch';
    const semester = state.profile?.semester_label || state.profile?.semester?.label || 'current semester';
    return `${branch} · ${semester}`;
  }

  function getFormValue(key) {
    const field = workbenchForm.querySelector(`[name="${key}"]`);
    return field ? String(field.value || '').trim() : '';
  }

  function splitList(value) {
    return String(value || '')
      .split(/\n|,|;/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function pickSentences(text) {
    return String(text || '')
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  }

  function renderToolCards() {
    const query = String(searchInput?.value || '').trim().toLowerCase();
    const filter = filterSelect?.value || 'all';
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
      grid.innerHTML = '<article class="card"><p class="muted">No tools match your search right now.</p></article>';
      return;
    }

    grid.innerHTML = state.filtered.map((tool) => {
      const badge = tool.locked ? 'Locked' : tool.access_type === 'premium' ? 'Premium' : 'Free';
      const badgeClass = tool.locked ? 'locked' : tool.access_type === 'premium' ? 'premium' : '';
      return `
        <article class="ai-tool-card ${state.selected?.id === tool.id ? 'active' : ''}" data-tool-id="${tool.id}">
          <div class="ai-tool-top">
            <div class="ai-tool-icon" style="background:${tool.accent_color};"><i class="fa-solid ${tool.icon_name}"></i></div>
            <span class="ai-badge ${badgeClass}">${badge}</span>
          </div>
          <h3>${escapeHtml(tool.title)}</h3>
          <p>${escapeHtml(tool.tagline || tool.description || '')}</p>
          <div class="ai-tool-benefits">
            ${(tool.benefits || []).slice(0, 3).map((benefit) => `<span>${escapeHtml(benefit)}</span>`).join('')}
          </div>
        </article>
      `;
    }).join('');

    grid.querySelectorAll('[data-tool-id]').forEach((node) => {
      node.addEventListener('click', () => {
        const tool = state.tools.find((item) => Number(item.id) === Number(node.dataset.toolId));
        if (tool) {
          state.selected = tool;
          renderToolCards();
          renderWorkbench();
          emitAiEvent('ai_tool_selected', {
            toolKey: tool.tool_key,
            title: tool.title,
            accessType: tool.access_type,
            locked: Boolean(tool.locked)
          });
        }
      });
    });
  }

  function renderRecommendations() {
    const recommended = state.tools.filter((tool) => !tool.locked).slice(0, 3);
    recommendationGrid.innerHTML = recommended.map((tool) => `
      <article class="ai-tool-card" data-tool-reco="${tool.id}">
        <div class="ai-tool-top">
          <div class="ai-tool-icon" style="background:${tool.accent_color};"><i class="fa-solid ${tool.icon_name}"></i></div>
          <span class="ai-badge ${tool.access_type === 'premium' ? 'premium' : ''}">${tool.access_type}</span>
        </div>
        <h3>${escapeHtml(tool.title)}</h3>
        <p>${escapeHtml(tool.description)}</p>
      </article>
    `).join('');

    recommendationGrid.querySelectorAll('[data-tool-reco]').forEach((node) => {
      node.addEventListener('click', () => {
        const tool = state.tools.find((item) => Number(item.id) === Number(node.dataset.toolReco));
        if (tool) {
          state.selected = tool;
          renderToolCards();
          renderWorkbench();
          emitAiEvent('ai_tool_selected', {
            toolKey: tool.tool_key,
            title: tool.title,
            accessType: tool.access_type,
            locked: Boolean(tool.locked),
            from: 'recommendation'
          });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  }

  function renderField(field) {
    if (field.type === 'textarea') {
      return `<label>${escapeHtml(field.label)}<textarea name="${field.key}" placeholder="${escapeHtml(field.placeholder || '')}"></textarea></label>`;
    }
    if (field.type === 'select') {
      return `<label>${escapeHtml(field.label)}<select name="${field.key}">${(field.options || []).map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}</select></label>`;
    }
    return `<label>${escapeHtml(field.label)}<input type="${field.type || 'text'}" name="${field.key}" placeholder="${escapeHtml(field.placeholder || '')}" /></label>`;
  }

  function renderWorkbench() {
    const tool = state.selected;
    if (!tool) {
      workbenchTitle.textContent = 'Choose a tool';
      workbenchDescription.textContent = 'Select a tool from the left to start generating useful study or career output.';
      workbenchBadge.textContent = 'Ready';
      workbenchBadge.className = 'ai-badge';
      workbenchForm.innerHTML = '';
      output.innerHTML = '<div class="ai-empty"><div><i class="fa-solid fa-sparkles"></i><p>Pick a tool, add a little input, and College OS will generate a practical first draft.</p></div></div>';
      upgradeBanner.style.display = 'none';
      return;
    }

    workbenchTitle.textContent = tool.title;
    const memoryHint = [];
    if (state.sessionMemory?.lastTopic) memoryHint.push(`Last topic: ${state.sessionMemory.lastTopic}`);
    if (Array.isArray(state.sessionMemory?.weakTopics) && state.sessionMemory.weakTopics.length) {
      memoryHint.push(`Weak focus: ${state.sessionMemory.weakTopics.slice(0, 2).join(', ')}`);
    }
    workbenchDescription.textContent = [tool.description || tool.tagline || '', memoryHint.join(' | ')].filter(Boolean).join(' ');
    workbenchBadge.textContent = tool.locked ? 'Upgrade required' : (tool.access_type === 'premium' ? 'Premium' : 'Included');
    workbenchBadge.className = `ai-badge ${tool.locked ? 'locked' : (tool.access_type === 'premium' ? 'premium' : '')}`;
    workbenchForm.innerHTML = `
      <label>Response mode
        <select name="mode">
          <option value="Auto">Auto</option>
          <option value="Quick">Quick</option>
          <option value="Exam">Exam</option>
          <option value="Deep">Deep</option>
          <option value="Practice">Practice</option>
        </select>
      </label>
      ${(fieldTemplates[tool.tool_key] || []).map(renderField).join('')}
    `;

    const modeField = workbenchForm.querySelector('[name="mode"]');
    if (modeField && state.sessionMemory?.lastMode) {
      modeField.value = 'Auto';
    }

    if (tool.locked) {
      upgradeBanner.style.display = '';
      upgradeBanner.innerHTML = `<strong>${escapeHtml(tool.title)}</strong> is part of Premium. Upgrade to unlock the full AI toolkit for ${escapeHtml(profileLabel())}. <a href="pricing.html">View membership</a>`;
    } else {
      upgradeBanner.style.display = 'none';
    }
  }

  function renderOutput(html) {
    output.innerHTML = html;
  }

  function collectInputs() {
    const payload = {};
    workbenchForm.querySelectorAll('input, textarea, select').forEach((field) => {
      const key = String(field.name || '').trim();
      if (!key) return;
      payload[key] = String(field.value || '').trim();
    });
    return payload;
  }

  function validateInputs(toolKey, inputs) {
    const errors = [];
    const hasAny = (...keys) => keys.some((key) => String(inputs[key] || '').trim().length > 0);

    if (toolKey === 'notes-summary' && !hasAny('content', 'topic')) {
      errors.push('Add note content or a meaningful topic before running Notes Summary.');
    }
    if (toolKey === 'quiz-generator' && !hasAny('subject', 'topic', 'concepts')) {
      errors.push('Add subject/topic/concepts before generating a quiz.');
    }
    if (toolKey === 'flashcards-generator' && !hasAny('topic', 'content')) {
      errors.push('Add topic or concept notes before generating flashcards.');
    }
    if (toolKey === 'doubt-solver' && String(inputs.doubt || '').trim().length < 8) {
      errors.push('Write your doubt clearly so the solver can respond accurately.');
    }
    if (toolKey === 'resume-builder') {
      const populated = ['name', 'education', 'skills', 'projects', 'certifications', 'targetRole']
        .filter((key) => String(inputs[key] || '').trim().length > 0);
      if (populated.length < 2) {
        errors.push('Provide at least two resume inputs (for example education + skills).');
      }
    }
    if (toolKey === 'career-suggestion' && !hasAny('interests', 'skills', 'goals', 'branchCourse')) {
      errors.push('Add your interests, skills, goals, or branch/course for career suggestions.');
    }
    if (toolKey === 'study-planner' && !hasAny('goal', 'topics', 'availableTime', 'durationDays', 'weakAreas')) {
      errors.push('Add at least goal/topics/time to generate a realistic study plan.');
    }
    if (toolKey === 'concept-explainer' && String(inputs.concept || '').trim().length < 3) {
      errors.push('Enter a concept/topic to explain.');
    }
    if (toolKey === 'interview-generator' && !hasAny('role', 'skills')) {
      errors.push('Enter role and skill/topic before generating interview questions.');
    }
    if (toolKey === 'roadmap-recommender' && !hasAny('targetGoal', 'goal', 'currentLevel', 'skillInterests', 'branchCourse')) {
      errors.push('Add target goal or level before requesting roadmap recommendations.');
    }

    return errors;
  }

  function renderValidationErrors(errors) {
    renderOutput(`
      <h3>Input needed</h3>
      <ul>${errors.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      <p class="muted">Tip: Fill the highlighted tool fields and run again.</p>
    `);
  }

  function inferToolFromSuggestion(text) {
    const lower = String(text || '').toLowerCase();
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

  function renderStructuredResult(payload) {
    const title = escapeHtml(payload?.result?.title || payload?.toolTitle || 'AI Output');
    const sections = Array.isArray(payload?.result?.sections) ? payload.result.sections : [];
    const warnings = Array.isArray(payload?.result?.warnings) ? payload.result.warnings : [];
    const badges = Array.isArray(payload?.result?.badges) ? payload.result.badges : [];
    const followUps = Array.isArray(payload?.result?.followUps) ? payload.result.followUps : [];
    const keyTakeaway = String(payload?.result?.keyTakeaway || '').trim();
    const quality = payload?.result?.quality || null;
    const mode = payload?.meta?.mode || payload?.result?.mode || 'Auto';

    let html = `<h3>${title}</h3>`;

    html += `<div class="contrib-pills" style="margin-bottom:10px;">`;
    html += `<span class="contrib-pill">Mode: ${escapeHtml(mode)}</span>`;
    badges.forEach((badge) => {
      html += `<span class="contrib-pill">${escapeHtml(badge)}</span>`;
    });
    if (quality?.score) {
      html += `<span class="contrib-pill">Quality ${escapeHtml(String(quality.score))}/100</span>`;
    }
    html += `</div>`;

    if (keyTakeaway) {
      html += `<div class="card" style="margin-bottom:12px;border:1px solid rgba(15,23,42,0.12);"><strong>Key Takeaway</strong><p style="margin:8px 0 0;">${escapeHtml(keyTakeaway)}</p></div>`;
    }

    if (warnings.length) {
      html += `<div class="card" style="margin-bottom:12px;"><strong>Input quality note</strong><ul>${warnings.map((warn) => `<li>${escapeHtml(warn)}</li>`).join('')}</ul></div>`;
    }

    sections.forEach((section) => {
      const heading = escapeHtml(section.heading || 'Section');
      const type = String(section.type || 'bullets');
      const items = Array.isArray(section.items) ? section.items : [];

      html += `<section style="margin-bottom:12px;"><h4>${heading}</h4>`;

      if (type === 'paragraphs') {
        const paragraphs = items.map((item) => `<p>${escapeHtml(item)}</p>`).join('');
        html += items.length > 3
          ? `<details><summary>Expand details</summary>${paragraphs}</details>`
          : paragraphs;
      } else if (type === 'numbered') {
        const body = `<ol>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>`;
        html += items.length > 6 ? `<details><summary>View all steps (${items.length})</summary>${body}</details>` : body;
      } else if (type === 'quiz') {
        html += items.map((item) => `
          <div style="margin-bottom:10px;">
            <strong>${escapeHtml(item.question || '')}</strong>
            <ol type="A">
              ${(item.options || []).map((option) => `<li>${escapeHtml(option)}</li>`).join('')}
            </ol>
            <p><strong>Answer:</strong> ${escapeHtml(item.answer || '-')}</p>
            <p class="muted">${escapeHtml(item.explanation || '')}</p>
          </div>
        `).join('');
      } else if (type === 'flashcards') {
        html += `<div class="ai-tools-grid">${items.map((item) => `<article class="card"><strong>${escapeHtml(item.front || 'Front')}</strong><p>${escapeHtml(item.back || '')}</p></article>`).join('')}</div>`;
      } else if (type === 'badges') {
        html += `<div class="contrib-pills">${items.map((item) => `<span class="contrib-pill">${escapeHtml(item)}</span>`).join('')}</div>`;
      } else {
        const body = `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
        html += items.length > 7 ? `<details><summary>View all points (${items.length})</summary>${body}</details>` : body;
      }

      html += '</section>';
    });

    if (followUps.length) {
      html += `<section style="margin-top:14px;"><h4>Next Step</h4><div class="contrib-actions">${followUps.map((item, idx) => `<button type="button" class="btn secondary" data-followup-index="${idx}" data-followup-tool="${escapeHtml(inferToolFromSuggestion(item) || '')}">${escapeHtml(item)}</button>`).join('')}</div></section>`;
    }

    renderOutput(html);

    output.querySelectorAll('[data-followup-index]').forEach((node) => {
      node.addEventListener('click', () => {
        const nextToolKey = node.getAttribute('data-followup-tool');
        if (!nextToolKey) return;
        const nextTool = state.tools.find((tool) => tool.tool_key === nextToolKey && !tool.locked) || null;
        if (!nextTool) return;

        state.selected = nextTool;
        renderToolCards();
        renderWorkbench();

        const topicSeed = state.sessionMemory?.lastTopic;
        if (topicSeed) {
          const topicField = workbenchForm.querySelector('[name="topic"], [name="concept"], [name="goal"], [name="targetGoal"]');
          if (topicField && !topicField.value) topicField.value = topicSeed;
        }
      });
    });
  }

  function buildSummary() {
    const topic = getFormValue('topic');
    const content = getFormValue('content');
    const sentences = pickSentences(content).slice(0, 5);
    const bullets = (sentences.length ? sentences : splitList(content)).slice(0, 6);
    return `
      <h3>${escapeHtml(topic || 'Summary')}</h3>
      <ul>${bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      <p><strong>Revision focus:</strong> Review this topic once more and create one self-test question from each bullet.</p>
    `;
  }

  function buildQuiz() {
    const topic = getFormValue('topic');
    const difficulty = getFormValue('difficulty') || 'Medium';
    const concepts = splitList(getFormValue('concepts'));
    const rows = (concepts.length ? concepts : [topic || 'Core concept']).slice(0, 5).map((concept, index) => ({
      question: `${index + 1}. Which statement best explains ${concept}?`,
      options: [
        `${concept} is used only for theoretical definitions`,
        `${concept} improves understanding of the topic in practice`,
        `${concept} is unrelated to exam questions`,
        `${concept} always replaces every other concept`
      ],
      answer: 'B'
    }));
    return `
      <h3>${escapeHtml(topic || 'Generated Quiz')} · ${escapeHtml(difficulty)}</h3>
      ${rows.map((row) => `<div style="margin-bottom:14px;"><strong>${escapeHtml(row.question)}</strong><ol type="A">${row.options.map((option) => `<li>${escapeHtml(option)}</li>`).join('')}</ol><p><strong>Answer:</strong> ${row.answer}</p></div>`).join('')}
    `;
  }

  function buildFlashcards() {
    const topic = getFormValue('topic');
    const concepts = splitList(getFormValue('content'));
    const cards = (concepts.length ? concepts : [topic || 'Concept']).slice(0, 6);
    return `
      <h3>${escapeHtml(topic || 'Flashcards')}</h3>
      <div class="ai-tools-grid">${cards.map((card, index) => `<article class="card"><strong>Card ${index + 1}</strong><p><strong>Front:</strong> Explain ${escapeHtml(card)}</p><p><strong>Back:</strong> ${escapeHtml(card)} in short, with one example and one common interview angle.</p></article>`).join('')}</div>
    `;
  }

  function buildDoubtSolver() {
    const doubt = getFormValue('doubt');
    const level = getFormValue('level');
    return `
      <h3>Doubt Solver</h3>
      <p><strong>Your doubt:</strong> ${escapeHtml(doubt)}</p>
      <ol>
        <li>What it means in simple words for a ${escapeHtml(level.toLowerCase())} learner.</li>
        <li>How it works step by step with one practical example.</li>
        <li>What usually confuses students and how to avoid that mistake.</li>
      </ol>
      <p><strong>Memory hook:</strong> Connect this topic to one real system or everyday analogy before revising formulas or definitions.</p>
    `;
  }

  function buildResume() {
    const role = getFormValue('targetRole');
    const skills = splitList(getFormValue('skills'));
    const projects = splitList(getFormValue('projects'));
    return `
      <h3>Resume Draft for ${escapeHtml(role || 'your target role')}</h3>
      <p><strong>Profile summary:</strong> Motivated student from ${escapeHtml(profileLabel())} building practical experience in ${escapeHtml(skills.slice(0, 4).join(', ') || 'relevant tools')} through academic and self-driven projects.</p>
      <ul>
        ${projects.slice(0, 4).map((project) => `<li>Built ${escapeHtml(project)} with focus on implementation quality, user value, and problem solving.</li>`).join('')}
        <li>Comfortable learning fast, documenting work, and presenting outcomes clearly during interviews.</li>
      </ul>
    `;
  }

  function buildCareerSuggestion() {
    const interests = getFormValue('interests').toLowerCase();
    const strengths = getFormValue('strengths').toLowerCase();
    const suggestions = [];
    if (interests.includes('data') || strengths.includes('sql') || strengths.includes('excel')) suggestions.push('Data Analyst');
    if (interests.includes('build') || interests.includes('product') || strengths.includes('javascript')) suggestions.push('Software Developer');
    if (interests.includes('ai') || strengths.includes('python')) suggestions.push('AI Engineer');
    if (interests.includes('cloud') || strengths.includes('linux')) suggestions.push('Cloud Engineer');
    if (!suggestions.length) suggestions.push('Software Developer', 'Data Analyst', 'Web Developer');
    return `
      <h3>Career Matches</h3>
      <ol>${suggestions.slice(0, 3).map((role) => `<li><strong>${escapeHtml(role)}</strong> - good fit based on your branch, interests, and current strengths.</li>`).join('')}</ol>
      <p><strong>Next step:</strong> Pick one path and spend the next 2 weeks on a small proof-of-work project.</p>
    `;
  }

  function buildStudyPlanner() {
    const goal = getFormValue('goal');
    const hours = Number(getFormValue('hours') || 10);
    const weakAreas = splitList(getFormValue('weakAreas'));
    const perDay = Math.max(1, Math.round(hours / 6));
    return `
      <h3>Weekly Study Plan</h3>
      <p><strong>Goal:</strong> ${escapeHtml(goal)}</p>
      <ul>
        <li>Monday to Wednesday: ${perDay} hours on core syllabus + one short practice block.</li>
        <li>Thursday: revise ${escapeHtml(weakAreas[0] || 'your weakest area')} and convert notes into flashcards.</li>
        <li>Friday: take one quiz or topic-wise test and review mistakes.</li>
        <li>Weekend: one long revision session, one roadmap milestone, and one career task.</li>
      </ul>
    `;
  }

  function buildConceptExplainer() {
    const concept = getFormValue('concept');
    const context = getFormValue('context');
    return `
      <h3>${escapeHtml(concept)}</h3>
      <p><strong>Simple explanation:</strong> ${escapeHtml(concept)} matters because it helps you understand how a system behaves when resources, data, or actions need coordination.</p>
      <p><strong>Analogy:</strong> Think of it like traffic control for information or tasks so everything happens in the right order with fewer conflicts.</p>
      <p><strong>Interview angle:</strong> Be ready to explain why it is used, one drawback, and one real-world example.</p>
      <p><strong>Your context:</strong> ${escapeHtml(context || 'General revision and interview preparation.')}</p>
    `;
  }

  function buildInterviewGenerator() {
    const role = getFormValue('role');
    const skills = splitList(getFormValue('skills'));
    const round = getFormValue('round');
    return `
      <h3>${escapeHtml(round)} questions for ${escapeHtml(role)}</h3>
      <ol>
        ${skills.slice(0, 4).map((skill) => `<li>Explain a project or problem where you used ${escapeHtml(skill)} and what you learned.</li>`).join('')}
        <li>What would make you a strong fit for a ${escapeHtml(role)} role in your first 90 days?</li>
        <li>Describe one mistake from a project and how you corrected it.</li>
      </ol>
    `;
  }

  function buildRoadmapRecommender() {
    const goal = getFormValue('goal').toLowerCase();
    const currentLevel = getFormValue('currentLevel');
    const match = state.roadmaps.find((roadmap) => goal.includes('data') ? roadmap.title.toLowerCase().includes('data') : goal.includes('cloud') ? roadmap.title.toLowerCase().includes('cloud') : goal.includes('finance') ? roadmap.title.toLowerCase().includes('finance') : roadmap.title.toLowerCase().includes('software')) || state.roadmaps[0];
    if (!match) {
      return '<h3>Roadmap recommendation</h3><p>No roadmap data available right now.</p>';
    }
    return `
      <h3>Recommended roadmap: ${escapeHtml(match.title)}</h3>
      <p><strong>Why this fits:</strong> It aligns with ${escapeHtml(profileLabel())}, your current ${escapeHtml(currentLevel.toLowerCase())} stage, and the goal you entered.</p>
      <ul>
        <li>Start with the first milestone this week.</li>
        <li>Use 1 AI tool per stage to accelerate revision and portfolio output.</li>
        <li>Review progress at the end of every 2 weeks.</li>
      </ul>
      <p><a class="btn secondary" href="study-roadmap.html?roadmap=${match.id}">Open this roadmap</a></p>
    `;
  }

  const generators = {
    'notes-summary': buildSummary,
    'quiz-generator': buildQuiz,
    'flashcards-generator': buildFlashcards,
    'doubt-solver': buildDoubtSolver,
    'resume-builder': buildResume,
    'career-suggestion': buildCareerSuggestion,
    'study-planner': buildStudyPlanner,
    'concept-explainer': buildConceptExplainer,
    'interview-generator': buildInterviewGenerator,
    'roadmap-recommender': buildRoadmapRecommender
  };

  async function loadData() {
    try {
      const [toolsPayload, roadmapPayload] = await Promise.all([
        window.CollegeOSApi.getAiToolsCatalog(),
        window.CollegeOSApi.getCareerRoadmaps().catch(() => ({ roadmaps: [] }))
      ]);
      state.tools = toolsPayload.tools || [];
      state.membership = toolsPayload.membership || null;
      state.profile = toolsPayload.profile || null;
      state.roadmaps = roadmapPayload.roadmaps || [];

      if (state.membership) {
        membershipTitle.textContent = state.membership.premiumActive ? 'Premium AI unlocked' : 'Membership aware';
        membershipSubtitle.textContent = state.membership.premiumActive
          ? 'All AI tools are available for your current plan.'
          : 'Free tools are available now. Premium unlocks roadmap recommendations, quiz generation, flashcards, resume builder, and interview drills.';
      }

      if (state.profile) {
        heroSubtitle.textContent = `AI workflows are personalised for ${profileLabel()} so your study, career, and placement support stays context-aware.`;
      }

      state.selected = state.tools.find((tool) => !tool.locked) || state.tools[0] || null;
      renderToolCards();
      renderRecommendations();
      renderWorkbench();

      emitAiEvent('ai_tools_workspace_opened', {
        toolsVisible: state.tools.length,
        membershipTier: state.membership?.tier || 'free',
        premiumActive: Boolean(state.membership?.premiumActive)
      });
    } catch (error) {
      grid.innerHTML = `<article class="card"><p class="muted">${escapeHtml(error.message)}</p></article>`;
      recommendationGrid.innerHTML = '';
    }
  }

  runBtn?.addEventListener('click', async () => {
    if (!state.selected) return;

    const startedAt = Date.now();
    const selectedTool = state.selected;

    if (state.selected.locked) {
      renderOutput(`<h3>Upgrade required</h3><p>${escapeHtml(state.selected.title)} is currently available on Premium. You can still use the free AI tools or <a href="pricing.html">upgrade your membership</a>.</p>`);
      await emitAiEvent('ai_tool_blocked', {
        toolKey: selectedTool.tool_key,
        intent: selectedTool.tool_key,
        reason: 'membership_locked'
      });
      return;
    }
    const inputs = collectInputs();
    const validationErrors = validateInputs(selectedTool.tool_key, inputs);
    if (validationErrors.length) {
      renderValidationErrors(validationErrors);
      await emitAiEvent('ai_tool_used', {
        toolKey: selectedTool.tool_key,
        intent: selectedTool.tool_key,
        success: false,
        reason: 'validation_failed',
        durationMs: Date.now() - startedAt,
        tokensUsed: 0
      });
      return;
    }

    const originalBtnHtml = runBtn.innerHTML;
    try {
      runBtn.disabled = true;
      runBtn.textContent = loadingCopy[selectedTool.tool_key] || `Generating ${selectedTool.title}...`;

      const generated = await window.CollegeOSApi.generateAiToolOutput(selectedTool.tool_key, inputs);
      if (generated?.memory && typeof generated.memory === 'object') {
        state.sessionMemory = {
          ...state.sessionMemory,
          ...generated.memory
        };
      }
      renderStructuredResult(generated);

      runBtn.disabled = false;
      runBtn.innerHTML = originalBtnHtml;

      const outputChars = JSON.stringify(generated?.result || {}).length;
      const tokensEstimate = Math.max(32, Math.round(outputChars / 4));
      await emitAiEvent('ai_tool_used', {
        toolKey: selectedTool.tool_key,
        intent: selectedTool.tool_key,
        success: true,
        durationMs: Date.now() - startedAt,
        tokensUsed: tokensEstimate,
        outputChars
      });
    } catch (error) {
      runBtn.disabled = false;
      runBtn.innerHTML = originalBtnHtml;

      const details = Array.isArray(error?.details) ? error.details : [];
      if (details.length) {
        renderValidationErrors(details);
      } else if (String(error?.code || '') === 'UPGRADE_REQUIRED') {
        renderOutput(`<h3>Premium tool</h3><p>${escapeHtml(error.message || 'This tool is available on Premium.')}</p><p><a class="btn secondary" href="pricing.html">See Premium Plans</a></p>`);
      } else {
        renderOutput(`<h3>Generation failed</h3><p>${escapeHtml(error.message || 'Unable to process your request right now.')}</p>`);
      }
      await emitAiEvent('ai_tool_used', {
        toolKey: selectedTool.tool_key,
        intent: selectedTool.tool_key,
        success: false,
        durationMs: Date.now() - startedAt,
        tokensUsed: 0,
        reason: 'runtime_error'
      });
    }
  });

  clearBtn?.addEventListener('click', () => {
    workbenchForm.querySelectorAll('input, textarea, select').forEach((field) => {
      field.value = '';
      if (field.tagName === 'SELECT' && field.options.length) field.selectedIndex = 0;
    });
    renderWorkbench();
  });

  searchInput?.addEventListener('input', renderToolCards);
  filterSelect?.addEventListener('change', renderToolCards);

  loadData();
});
