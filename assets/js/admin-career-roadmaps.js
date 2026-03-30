document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('careerRoadmapForm');
  const grid = document.getElementById('careerRoadmapAdminGrid');
  const stageContainer = document.getElementById('careerStageContainer');
  const categorySelect = document.getElementById('careerCategoryId');
  const branchSelect = document.getElementById('careerBranchId');
  const semesterSelect = document.getElementById('careerSemesterId');
  const statusNode = document.getElementById('careerRoadmapStatus');
  const metricsNode = document.getElementById('careerRoadmapMetrics');
  const submitBtn = document.getElementById('careerRoadmapSubmitBtn');
  const resetBtn = document.getElementById('careerRoadmapResetBtn');
  const addStageBtn = document.getElementById('careerAddStageBtn');
  if (!form || !window.CollegeOSApi) return;

  const state = {
    editingId: null,
    roadmaps: []
  };

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function slugify(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
  }

  function splitList(value) {
    return String(value || '')
      .split(/\n|,|;/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function setStatus(message, tone = 'muted') {
    statusNode.textContent = message;
    statusNode.style.color = tone === 'error' ? '#b91c1c' : tone === 'success' ? '#166534' : '#64748b';
  }

  function renderOptions(node, rows, placeholder, valueKey = 'id', labelKey = 'name') {
    node.innerHTML = [`<option value="">${placeholder}</option>`]
      .concat(rows.map((row) => `<option value="${row[valueKey]}">${escapeHtml(row[labelKey])}</option>`))
      .join('');
  }

  async function loadAcademicOptions() {
    const [categories, semesters] = await Promise.all([
      window.CollegeOSApi.getAcademicCategories(),
      window.CollegeOSApi.getAcademicSemesters()
    ]);
    renderOptions(categorySelect, categories.categories || [], 'All categories');
    renderOptions(semesterSelect, semesters.semesters || [], 'All semesters', 'id', 'label');
  }

  async function loadBranches(categoryId, selectedValue = '') {
    if (!categoryId) {
      branchSelect.innerHTML = '<option value="">All branches</option>';
      return;
    }
    const branches = await window.CollegeOSApi.getAcademicBranches(categoryId);
    renderOptions(branchSelect, branches.branches || [], 'All branches');
    if (selectedValue) branchSelect.value = String(selectedValue);
  }

  function stageBlock(stage = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'co-admin-builder-block';
    wrapper.innerHTML = `
      <div class="co-admin-form-grid co-admin-form-grid-tight">
        <div class="co-admin-field full"><label>Stage title</label><input class="stage-title" value="${escapeHtml(stage.stageTitle || '')}" placeholder="Build foundations" /></div>
        <div class="co-admin-field full"><label>Stage summary</label><textarea class="stage-summary" rows="2" placeholder="What this stage is focused on">${escapeHtml(stage.stageSummary || '')}</textarea></div>
        <div class="co-admin-field"><label>Skills</label><textarea class="stage-skills" rows="2" placeholder="Comma separated">${escapeHtml((stage.skills || []).join(', '))}</textarea></div>
        <div class="co-admin-field"><label>Tools</label><textarea class="stage-tools" rows="2" placeholder="Comma separated">${escapeHtml((stage.tools || []).join(', '))}</textarea></div>
        <div class="co-admin-field"><label>Projects</label><textarea class="stage-projects" rows="2" placeholder="Comma separated">${escapeHtml((stage.projects || []).join(', '))}</textarea></div>
        <div class="co-admin-field"><label>Certifications</label><textarea class="stage-certs" rows="2" placeholder="Comma separated">${escapeHtml((stage.certifications || []).join(', '))}</textarea></div>
        <div class="co-admin-field"><label>Interview prep</label><textarea class="stage-interview" rows="2">${escapeHtml(stage.interviewPrep || '')}</textarea></div>
        <div class="co-admin-field"><label>Placement readiness</label><textarea class="stage-placement" rows="2">${escapeHtml(stage.placementReadiness || '')}</textarea></div>
      </div>
      <div class="control-actions" style="margin-top:12px; justify-content:flex-end;"><button class="btn danger sm remove-stage-btn" type="button">Remove stage</button></div>
    `;
    wrapper.querySelector('.remove-stage-btn').addEventListener('click', () => {
      wrapper.remove();
      renumberStageBlocks();
    });
    return wrapper;
  }

  function renumberStageBlocks() {
    Array.from(stageContainer.children).forEach((block, index) => {
      const label = block.querySelector('.stage-title')?.closest('.co-admin-field')?.querySelector('label');
      if (label) label.textContent = `Stage ${index + 1} title`;
    });
  }

  function addStage(stage) {
    stageContainer.appendChild(stageBlock(stage));
    renumberStageBlocks();
  }

  function collectStages() {
    return Array.from(stageContainer.children).map((block) => ({
      stageTitle: block.querySelector('.stage-title')?.value?.trim(),
      stageSummary: block.querySelector('.stage-summary')?.value?.trim(),
      skills: splitList(block.querySelector('.stage-skills')?.value),
      tools: splitList(block.querySelector('.stage-tools')?.value),
      projects: splitList(block.querySelector('.stage-projects')?.value),
      certifications: splitList(block.querySelector('.stage-certs')?.value),
      interviewPrep: block.querySelector('.stage-interview')?.value?.trim(),
      placementReadiness: block.querySelector('.stage-placement')?.value?.trim()
    })).filter((stage) => stage.stageTitle);
  }

  function resetForm() {
    state.editingId = null;
    form.reset();
    stageContainer.innerHTML = '';
    addStage();
    branchSelect.innerHTML = '<option value="">All branches</option>';
    submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save roadmap';
    setStatus('Ready to create a new career roadmap.');
  }

  function buildPayload() {
    const formData = new FormData(form);
    return {
      slug: slugify(formData.get('title')),
      title: formData.get('title'),
      careerTrack: formData.get('careerTrack'),
      tagline: formData.get('tagline'),
      description: formData.get('description'),
      iconName: formData.get('iconName') || 'fa-route',
      accentColor: formData.get('accentColor') || '#2563eb',
      difficultyLevel: formData.get('difficultyLevel'),
      estimatedDuration: formData.get('estimatedDuration'),
      accessType: formData.get('accessType'),
      status: formData.get('status'),
      isPublished: formData.get('isPublished') === 'true',
      isFeatured: formData.get('isFeatured') === 'true',
      sortOrder: Number(formData.get('sortOrder') || 0),
      categoryId: Number(formData.get('categoryId') || 0) || null,
      branchId: Number(formData.get('branchId') || 0) || null,
      semesterId: Number(formData.get('semesterId') || 0) || null,
      skills: splitList(formData.get('skills')),
      tools: splitList(formData.get('tools')),
      projects: splitList(formData.get('projects')),
      certifications: splitList(formData.get('certifications')),
      interviewPrep: formData.get('interviewPrep'),
      placementReadiness: formData.get('placementReadiness'),
      stages: collectStages()
    };
  }

  async function loadRoadmaps() {
    const payload = await window.CollegeOSApi.adminGetCareerRoadmaps();
    state.roadmaps = payload.roadmaps || [];
    metricsNode.innerHTML = [
      ['Total tracks', state.roadmaps.length],
      ['Published', state.roadmaps.filter((item) => item.is_published).length],
      ['Premium', state.roadmaps.filter((item) => item.access_type === 'premium').length],
      ['Featured', state.roadmaps.filter((item) => item.is_featured).length]
    ].map((item) => `<article class="kpi-card"><div class="kpi-label">${item[0]}</div><div class="kpi-value">${item[1]}</div></article>`).join('');

    if (!state.roadmaps.length) {
      grid.innerHTML = '<div class="co-admin-empty">No career roadmaps yet.</div>';
      return;
    }

    grid.innerHTML = state.roadmaps.map((roadmap) => `
      <article class="co-admin-showcase-card">
        <div class="co-admin-showcase-top">
          <span class="co-admin-icon-badge" style="background:${roadmap.accent_color}; color:#fff;"><i class="fa-solid ${roadmap.icon_name || 'fa-route'}"></i></span>
          <div class="co-admin-chip-row">
            <span class="co-admin-chip-soft">${escapeHtml(roadmap.access_type)}</span>
            <span class="co-admin-chip-soft">${roadmap.is_published ? 'Published' : 'Hidden'}</span>
          </div>
        </div>
        <h3>${escapeHtml(roadmap.title)}</h3>
        <p>${escapeHtml(roadmap.tagline || roadmap.description || '')}</p>
        <div class="co-admin-chip-row" style="margin:12px 0;">
          <span class="co-admin-chip-soft">${escapeHtml(roadmap.career_track || 'Track')}</span>
          <span class="co-admin-chip-soft">${escapeHtml(roadmap.branch_name || 'All branches')}</span>
          <span class="co-admin-chip-soft">${roadmap.stage_count} stages</span>
        </div>
        <div class="control-actions">
          <button class="btn secondary sm" data-edit-roadmap="${roadmap.id}">Edit</button>
          <button class="btn secondary sm" data-toggle-roadmap="${roadmap.id}">${roadmap.is_published ? 'Hide' : 'Publish'}</button>
          <button class="btn danger sm" data-delete-roadmap="${roadmap.id}">Delete</button>
        </div>
      </article>
    `).join('');

    grid.querySelectorAll('[data-edit-roadmap]').forEach((node) => {
      node.addEventListener('click', async () => {
        const detail = await window.CollegeOSApi.adminGetCareerRoadmap(Number(node.dataset.editRoadmap));
        const roadmap = detail.roadmap;
        state.editingId = roadmap.id;
        form.title.value = roadmap.title || '';
        form.careerTrack.value = roadmap.career_track || '';
        form.tagline.value = roadmap.tagline || '';
        form.description.value = roadmap.description || '';
        form.iconName.value = roadmap.icon_name || 'fa-route';
        form.accentColor.value = roadmap.accent_color || '#2563eb';
        form.difficultyLevel.value = roadmap.difficulty_level || 'Beginner';
        form.estimatedDuration.value = roadmap.estimated_duration || '';
        form.accessType.value = roadmap.access_type || 'free';
        form.status.value = roadmap.status || 'published';
        form.isPublished.value = String(Boolean(roadmap.is_published));
        form.isFeatured.value = String(Boolean(roadmap.is_featured));
        form.sortOrder.value = roadmap.sort_order || 0;
        form.skills.value = (roadmap.skills || []).join(', ');
        form.tools.value = (roadmap.tools || []).join(', ');
        form.projects.value = (roadmap.projects || []).join(', ');
        form.certifications.value = (roadmap.certifications || []).join(', ');
        form.interviewPrep.value = roadmap.interview_prep || '';
        form.placementReadiness.value = roadmap.placement_readiness || '';
        categorySelect.value = roadmap.category_id || '';
        await loadBranches(roadmap.category_id || '', roadmap.branch_id || '');
        semesterSelect.value = roadmap.semester_id || '';
        stageContainer.innerHTML = '';
        (roadmap.stages || []).forEach((stage) => addStage(stage));
        if (!stageContainer.children.length) addStage();
        submitBtn.innerHTML = '<i class="fa-solid fa-pen"></i> Update roadmap';
        setStatus(`Editing ${roadmap.title}.`, 'success');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    grid.querySelectorAll('[data-toggle-roadmap]').forEach((node) => {
      node.addEventListener('click', async () => {
        const detail = await window.CollegeOSApi.adminGetCareerRoadmap(Number(node.dataset.toggleRoadmap));
        const roadmap = detail.roadmap;
        await window.CollegeOSApi.adminUpdateCareerRoadmap(roadmap.id, {
          slug: roadmap.slug,
          title: roadmap.title,
          careerTrack: roadmap.career_track,
          tagline: roadmap.tagline,
          description: roadmap.description,
          iconName: roadmap.icon_name,
          accentColor: roadmap.accent_color,
          difficultyLevel: roadmap.difficulty_level,
          estimatedDuration: roadmap.estimated_duration,
          accessType: roadmap.access_type,
          status: roadmap.is_published ? 'hidden' : 'published',
          isPublished: !roadmap.is_published,
          isFeatured: roadmap.is_featured,
          sortOrder: roadmap.sort_order,
          categoryId: roadmap.category_id,
          branchId: roadmap.branch_id,
          semesterId: roadmap.semester_id,
          skills: roadmap.skills,
          tools: roadmap.tools,
          projects: roadmap.projects,
          certifications: roadmap.certifications,
          interviewPrep: roadmap.interview_prep,
          placementReadiness: roadmap.placement_readiness,
          stages: roadmap.stages || []
        });
        setStatus(`${roadmap.title} updated.`, 'success');
        await loadRoadmaps();
      });
    });

    grid.querySelectorAll('[data-delete-roadmap]').forEach((node) => {
      node.addEventListener('click', async () => {
        const id = Number(node.dataset.deleteRoadmap);
        if (!window.confirm('Archive this roadmap?')) return;
        await window.CollegeOSApi.adminDeleteCareerRoadmap(id);
        setStatus('Roadmap archived.', 'success');
        await loadRoadmaps();
      });
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = buildPayload();
    if (!payload.title || !payload.careerTrack || !payload.stages.length) {
      setStatus('Title, career track, and at least one stage are required.', 'error');
      return;
    }

    submitBtn.disabled = true;
    try {
      if (state.editingId) {
        await window.CollegeOSApi.adminUpdateCareerRoadmap(state.editingId, payload);
        setStatus('Career roadmap updated successfully.', 'success');
      } else {
        await window.CollegeOSApi.adminCreateCareerRoadmap(payload);
        setStatus('Career roadmap created successfully.', 'success');
      }
      resetForm();
      await loadRoadmaps();
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });

  categorySelect.addEventListener('change', async () => {
    await loadBranches(categorySelect.value);
  });

  addStageBtn.addEventListener('click', () => addStage());
  resetBtn.addEventListener('click', resetForm);

  await loadAcademicOptions();
  resetForm();
  await loadRoadmaps();
});
