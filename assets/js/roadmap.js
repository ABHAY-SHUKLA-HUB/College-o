document.addEventListener('DOMContentLoaded', async () => {
  const roadmapGrid = document.getElementById('careerRoadmapGrid');
  const stageList = document.getElementById('roadmapStageList');
  if (!roadmapGrid || !window.CollegeOSApi) return;

  const nodes = {
    search: document.getElementById('roadmapSearchInput'),
    filter: document.getElementById('roadmapFilterSelect'),
    heroTitle: document.getElementById('careerHeroTitle'),
    heroSubtitle: document.getElementById('careerHeroSubtitle'),
    heroChips: document.getElementById('careerHeroChips'),
    statRow: document.getElementById('careerStatRow'),
    lockBanner: document.getElementById('careerLockBanner'),
    detailTitle: document.getElementById('roadmapDetailTitle'),
    detailDescription: document.getElementById('roadmapDetailDescription'),
    detailMeta: document.getElementById('roadmapDetailMeta'),
    progressRing: document.getElementById('careerProgressRing'),
    progressPct: document.getElementById('careerProgressPct'),
    progressCopy: document.getElementById('careerProgressCopy'),
    progressFacts: document.getElementById('careerProgressFacts'),
    skillList: document.getElementById('careerSkillList'),
    toolList: document.getElementById('careerToolList'),
    projectList: document.getElementById('careerProjectList'),
    certList: document.getElementById('careerCertList'),
    interviewPrep: document.getElementById('careerInterviewPrep'),
    placementReadiness: document.getElementById('careerPlacementReadiness'),
    recommendedGrid: document.getElementById('careerRecommendedGrid'),
    saveBtn: document.getElementById('roadmapSaveProgressBtn')
  };

  const state = {
    roadmaps: [],
    filtered: [],
    selected: null,
    profile: null,
    membership: null,
    persistedRecordId: null,
    completedStageIds: new Set(),
    localKey: 'collegeos_career_progress_v1'
  };

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function getProfileLabel() {
    const branch = state.profile?.branch_name || 'Your branch';
    const semester = state.profile?.semester_label || 'Current semester';
    return `${branch} · ${semester}`;
  }

  function readLocalProgress() {
    try {
      const raw = window.localStorage.getItem(state.localKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function writeLocalProgress(payload) {
    try {
      window.localStorage.setItem(state.localKey, JSON.stringify(payload));
    } catch {
      // Ignore storage failures.
    }
  }

  async function persistProgress() {
    if (!state.selected) return;
    const completedStageIds = Array.from(state.completedStageIds);
    const payload = {
      roadmapData: completedStageIds,
      progress: Math.round((completedStageIds.length / Math.max(state.selected.stages.length, 1)) * 100),
      goals: {
        careerRoadmapId: state.selected.id,
        careerRoadmapTitle: state.selected.title,
        careerTrack: state.selected.career_track,
        completedStageIds
      }
    };

    writeLocalProgress(payload.goals);

    try {
      if (state.persistedRecordId) {
        await window.CollegeOSApi.updateRoadmap(state.persistedRecordId, payload);
      } else {
        const created = await window.CollegeOSApi.createRoadmap(payload);
        state.persistedRecordId = created?.roadmap?.id || null;
      }
    } catch {
      // Local persistence already stored.
    }
  }

  function roadmapBadge(roadmap) {
    if (roadmap.locked) return '<span class="career-badge locked">Locked</span>';
    if (roadmap.access_type === 'premium') return '<span class="career-badge premium">Premium</span>';
    return '<span class="career-badge">Free</span>';
  }

  function selectRoadmap(roadmap) {
    state.selected = roadmap;
    const local = readLocalProgress();
    if (Number(local.careerRoadmapId) === Number(roadmap.id) && Array.isArray(local.completedStageIds)) {
      state.completedStageIds = new Set(local.completedStageIds.map((value) => Number(value)));
    } else {
      state.completedStageIds = new Set();
    }
    renderRoadmapGrid();
    renderSelectedRoadmap();
  }

  function renderRoadmapGrid() {
    const query = String(nodes.search?.value || '').trim().toLowerCase();
    const filter = nodes.filter?.value || 'all';
    state.filtered = state.roadmaps.filter((roadmap) => {
      const haystack = `${roadmap.title} ${roadmap.career_track} ${roadmap.tagline} ${roadmap.description}`.toLowerCase();
      const matchesQuery = !query || haystack.includes(query);
      const matchesFilter = filter === 'all' || (filter === 'free' && roadmap.access_type === 'free') || (filter === 'premium' && roadmap.access_type === 'premium') || (filter === 'featured' && roadmap.is_featured);
      return matchesQuery && matchesFilter;
    });

    if (!state.filtered.length) {
      roadmapGrid.innerHTML = '<div class="career-empty">No roadmaps match your current filters.</div>';
      return;
    }

    roadmapGrid.innerHTML = state.filtered.map((roadmap) => `
      <article class="career-card ${state.selected?.id === roadmap.id ? 'active' : ''}" data-roadmap-id="${roadmap.id}">
        <div class="career-card-top">
          <div class="career-icon" style="background:${roadmap.accent_color};"><i class="fa-solid ${roadmap.icon_name}"></i></div>
          ${roadmapBadge(roadmap)}
        </div>
        <h3>${escapeHtml(roadmap.title)}</h3>
        <p>${escapeHtml(roadmap.tagline || roadmap.description || '')}</p>
        <div class="career-pill-list">
          <span class="career-pill">${escapeHtml(roadmap.career_track)}</span>
          <span class="career-pill">${escapeHtml(roadmap.estimated_duration || 'Flexible')}</span>
          <span class="career-pill">${roadmap.stage_count} stages</span>
        </div>
      </article>
    `).join('');

    roadmapGrid.querySelectorAll('[data-roadmap-id]').forEach((node) => {
      node.addEventListener('click', async () => {
        const roadmap = state.roadmaps.find((item) => Number(item.id) === Number(node.dataset.roadmapId));
        if (!roadmap) return;
        try {
          const detail = await window.CollegeOSApi.getCareerRoadmap(roadmap.id);
          selectRoadmap(detail.roadmap || roadmap);
        } catch {
          selectRoadmap(roadmap);
        }
      });
    });
  }

  function renderList(node, items, emptyText) {
    if (!node) return;
    node.innerHTML = (items || []).length
      ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
      : `<li>${escapeHtml(emptyText)}</li>`;
  }

  function renderSelectedRoadmap() {
    const roadmap = state.selected;
    if (!roadmap) {
      nodes.detailTitle.textContent = 'Select a roadmap';
      nodes.detailDescription.textContent = 'Choose a career path from the left to see its milestones, required skills, project ideas, and interview plan.';
      nodes.detailMeta.innerHTML = '';
      stageList.innerHTML = '<div class="career-empty">Roadmap stages will appear here.</div>';
      return;
    }

    nodes.detailTitle.textContent = roadmap.title;
    nodes.detailDescription.textContent = roadmap.description || roadmap.tagline || '';
    nodes.detailMeta.innerHTML = [
      roadmap.career_track,
      roadmap.difficulty_level || 'Open level',
      roadmap.estimated_duration || 'Flexible duration',
      getProfileLabel()
    ].filter(Boolean).map((item) => `<span class="career-meta-pill">${escapeHtml(item)}</span>`).join('');

    if (roadmap.locked) {
      nodes.lockBanner.style.display = '';
      nodes.lockBanner.innerHTML = `<strong>${escapeHtml(roadmap.title)}</strong> is available on Premium. Upgrade to unlock the full roadmap, advanced milestones, and AI-based recommendations. <a href="pricing.html">Upgrade now</a>`;
    } else {
      nodes.lockBanner.style.display = 'none';
    }

    const completed = state.completedStageIds;
    stageList.innerHTML = (roadmap.stages || []).map((stage, index) => {
      const done = completed.has(Number(stage.id));
      return `
        <article class="career-stage-card">
          <div class="career-stage-top">
            <div style="display:flex; align-items:center; gap:12px;">
              <span class="career-stage-index">${index + 1}</span>
              <div>
                <h3>${escapeHtml(stage.stageTitle)}</h3>
                <p>${escapeHtml(stage.stageSummary || '')}</p>
              </div>
            </div>
            <div>
              <span class="career-stage-status ${done ? 'done' : 'todo'}">${done ? 'Completed' : 'Pending'}</span>
            </div>
          </div>
          <div class="career-pill-list" style="margin-bottom:12px;">
            ${(stage.skills || []).slice(0, 3).map((skill) => `<span class="career-pill">${escapeHtml(skill)}</span>`).join('')}
          </div>
          <div class="career-support-links">
            <button class="btn ${done ? 'secondary' : 'primary'} roadmap-stage-toggle" data-stage-id="${stage.id}">${done ? 'Mark Pending' : 'Mark Done'}</button>
          </div>
        </article>
      `;
    }).join('');

    stageList.querySelectorAll('.roadmap-stage-toggle').forEach((button) => {
      button.addEventListener('click', async () => {
        const stageId = Number(button.dataset.stageId);
        if (state.completedStageIds.has(stageId)) state.completedStageIds.delete(stageId);
        else state.completedStageIds.add(stageId);
        renderSelectedRoadmap();
        await persistProgress();
      });
    });

    const totalStages = Math.max((roadmap.stages || []).length, 1);
    const pct = Math.round((state.completedStageIds.size / totalStages) * 100);
    const nextStage = (roadmap.stages || []).find((stage) => !state.completedStageIds.has(Number(stage.id)));
    nodes.progressRing.style.setProperty('--pct', `${pct}%`);
    nodes.progressPct.textContent = `${pct}%`;
    nodes.progressCopy.textContent = nextStage
      ? `Next priority: ${nextStage.stageTitle}. Keep moving one milestone at a time.`
      : 'All milestones completed. Time to switch to the next roadmap or refine interview depth.';
    nodes.progressFacts.innerHTML = [
      `${state.completedStageIds.size}/${totalStages} milestones done`,
      roadmap.access_type === 'premium' ? 'Premium track' : 'Free track',
      roadmap.estimated_duration || 'Flexible plan'
    ].map((item) => `<span class="career-meta-pill">${escapeHtml(item)}</span>`).join('');

    renderList(nodes.skillList, roadmap.skills, 'Skills will appear here.');
    renderList(nodes.toolList, roadmap.tools, 'Tools will appear here.');
    renderList(nodes.projectList, roadmap.projects, 'Projects will appear here.');
    renderList(nodes.certList, roadmap.certifications, 'Certifications will appear here.');
    nodes.interviewPrep.textContent = roadmap.interview_prep || 'Interview guidance will appear here for the selected roadmap.';
    nodes.placementReadiness.textContent = roadmap.placement_readiness || 'Placement readiness guidance will appear here for the selected roadmap.';

    const related = state.roadmaps.filter((item) => item.id !== roadmap.id).slice(0, 2);
    nodes.recommendedGrid.innerHTML = related.map((item) => `
      <article class="career-card" data-related-roadmap="${item.id}">
        <div class="career-card-top">
          <div class="career-icon" style="background:${item.accent_color};"><i class="fa-solid ${item.icon_name}"></i></div>
          ${roadmapBadge(item)}
        </div>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.tagline || item.description || '')}</p>
      </article>
    `).join('');

    nodes.recommendedGrid.querySelectorAll('[data-related-roadmap]').forEach((node) => {
      node.addEventListener('click', async () => {
        const item = state.roadmaps.find((entry) => Number(entry.id) === Number(node.dataset.relatedRoadmap));
        if (!item) return;
        try {
          const detail = await window.CollegeOSApi.getCareerRoadmap(item.id);
          selectRoadmap(detail.roadmap || item);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch {
          selectRoadmap(item);
        }
      });
    });
  }

  async function loadPersistedProgress() {
    try {
      const stored = await window.CollegeOSApi.getRoadmap();
      const roadmap = stored?.roadmap;
      if (roadmap) {
        state.persistedRecordId = roadmap.id;
        const completedStageIds = roadmap.goals?.completedStageIds || roadmap.roadmap_data || [];
        writeLocalProgress(roadmap.goals || {});
        return {
          roadmapId: Number(roadmap.goals?.careerRoadmapId || 0),
          completedStageIds: completedStageIds.map((value) => Number(value))
        };
      }
    } catch {
      // Fall back to local storage when roadmap persistence is unavailable.
    }
    const local = readLocalProgress();
    return {
      roadmapId: Number(local.careerRoadmapId || 0),
      completedStageIds: Array.isArray(local.completedStageIds) ? local.completedStageIds.map((value) => Number(value)) : []
    };
  }

  async function init() {
    try {
      const [roadmapPayload, persisted] = await Promise.all([
        window.CollegeOSApi.getCareerRoadmaps(),
        loadPersistedProgress()
      ]);

      state.roadmaps = roadmapPayload.roadmaps || [];
      state.profile = roadmapPayload.profile || null;
      state.membership = roadmapPayload.membership || null;

      nodes.heroTitle.textContent = state.profile?.branch_name
        ? `${state.profile.branch_name} career roadmaps for real placement outcomes`
        : 'Career roadmaps that match your branch and goals';
      nodes.heroSubtitle.textContent = `Stage-by-stage tracks with skills, tools, projects, certifications, interview prep, and placement readiness for ${getProfileLabel()}.`;
      nodes.heroChips.innerHTML = [
        `<span class="career-chip"><i class="fa-solid fa-graduation-cap"></i> ${escapeHtml(getProfileLabel())}</span>`,
        `<span class="career-chip"><i class="fa-solid fa-crown"></i> ${escapeHtml(state.membership?.premiumActive ? 'Premium unlocked' : 'Free + Premium mix')}</span>`,
        `<span class="career-chip"><i class="fa-solid fa-route"></i> ${state.roadmaps.length} career tracks</span>`
      ].join('');
      nodes.statRow.innerHTML = [
        `<span class="career-stat">${state.roadmaps.filter((item) => !item.locked).length} ready to start</span>`,
        `<span class="career-stat">${state.roadmaps.filter((item) => item.is_featured).length} featured tracks</span>`,
        `<span class="career-stat">${state.roadmaps.filter((item) => item.access_type === 'premium').length} premium accelerators</span>`
      ].join('');

      renderRoadmapGrid();

      const queryId = Number(new URLSearchParams(window.location.search).get('roadmap') || 0);
      const selected = state.roadmaps.find((item) => Number(item.id) === queryId)
        || state.roadmaps.find((item) => Number(item.id) === persisted.roadmapId)
        || roadmapPayload.recommended?.[0]
        || state.roadmaps[0];

      if (selected) {
        try {
          const detail = await window.CollegeOSApi.getCareerRoadmap(selected.id);
          state.completedStageIds = new Set(persisted.completedStageIds || []);
          selectRoadmap(detail.roadmap || selected);
        } catch {
          state.completedStageIds = new Set(persisted.completedStageIds || []);
          selectRoadmap(selected);
        }
      }
    } catch (error) {
      roadmapGrid.innerHTML = `<div class="career-empty">${escapeHtml(error.message)}</div>`;
      stageList.innerHTML = '<div class="career-empty">Roadmap detail is unavailable right now.</div>';
    }
  }

  nodes.search?.addEventListener('input', renderRoadmapGrid);
  nodes.filter?.addEventListener('change', renderRoadmapGrid);
  nodes.saveBtn?.addEventListener('click', async () => {
    await persistProgress();
    nodes.saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Saved';
    window.setTimeout(() => {
      nodes.saveBtn.innerHTML = '<i class="fa-solid fa-bookmark"></i> Save Progress';
    }, 1400);
  });

  init();
});