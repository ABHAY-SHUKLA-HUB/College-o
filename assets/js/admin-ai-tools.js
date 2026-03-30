document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('aiToolAdminForm');
  const list = document.getElementById('aiToolAdminGrid');
  const statusNode = document.getElementById('aiToolAdminStatus');
  const metricsNode = document.getElementById('aiToolMetrics');
  const categorySelect = document.getElementById('aiToolCategoryId');
  const branchSelect = document.getElementById('aiToolBranchId');
  const semesterSelect = document.getElementById('aiToolSemesterId');
  const submitBtn = document.getElementById('aiToolSubmitBtn');
  if (!form || !window.CollegeOSApi) return;

  const state = {
    editingId: null,
    tools: []
  };

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
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

  async function loadBranches(categoryId, selected = '') {
    if (!categoryId) {
      branchSelect.innerHTML = '<option value="">All branches</option>';
      return;
    }
    const payload = await window.CollegeOSApi.getAcademicBranches(categoryId);
    renderOptions(branchSelect, payload.branches || [], 'All branches');
    if (selected) branchSelect.value = String(selected);
  }

  function slugify(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
  }

  function resetForm() {
    state.editingId = null;
    form.reset();
    branchSelect.innerHTML = '<option value="">All branches</option>';
    submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save tool';
    setStatus('Ready to add or update AI tools.');
  }

  function payloadFromForm() {
    const formData = new FormData(form);
    return {
      toolKey: slugify(formData.get('title') || formData.get('toolKey')),
      title: formData.get('title'),
      tagline: formData.get('tagline'),
      description: formData.get('description'),
      iconName: formData.get('iconName') || 'fa-sparkles',
      accentColor: formData.get('accentColor') || '#7c3aed',
      accessType: formData.get('accessType'),
      status: formData.get('status'),
      isEnabled: formData.get('isEnabled') === 'true',
      isVisible: formData.get('isVisible') === 'true',
      isFeatured: formData.get('isFeatured') === 'true',
      sortOrder: Number(formData.get('sortOrder') || 0),
      categoryId: Number(formData.get('categoryId') || 0) || null,
      branchId: Number(formData.get('branchId') || 0) || null,
      semesterId: Number(formData.get('semesterId') || 0) || null,
      benefits: splitList(formData.get('benefits')),
      promptTemplate: formData.get('promptTemplate')
    };
  }

  async function loadTools() {
    const payload = await window.CollegeOSApi.adminGetAiTools();
    state.tools = payload.tools || [];
    metricsNode.innerHTML = [
      ['Total tools', state.tools.length],
      ['Enabled', state.tools.filter((tool) => tool.is_enabled).length],
      ['Premium', state.tools.filter((tool) => tool.access_type === 'premium').length],
      ['Visible', state.tools.filter((tool) => tool.is_visible).length]
    ].map((item) => `<article class="kpi-card"><div class="kpi-label">${item[0]}</div><div class="kpi-value">${item[1]}</div></article>`).join('');

    if (!state.tools.length) {
      list.innerHTML = '<div class="co-admin-empty">No AI tools configured yet.</div>';
      return;
    }

    list.innerHTML = state.tools.map((tool) => `
      <article class="co-admin-showcase-card">
        <div class="co-admin-showcase-top">
          <span class="co-admin-icon-badge" style="background:${tool.accent_color}; color:#fff;"><i class="fa-solid ${tool.icon_name || 'fa-sparkles'}"></i></span>
          <div class="co-admin-chip-row">
            <span class="co-admin-chip-soft">${escapeHtml(tool.access_type)}</span>
            <span class="co-admin-chip-soft">${tool.is_enabled ? 'Enabled' : 'Disabled'}</span>
            <span class="co-admin-chip-soft">${tool.is_visible ? 'Visible' : 'Hidden'}</span>
          </div>
        </div>
        <h3>${escapeHtml(tool.title)}</h3>
        <p>${escapeHtml(tool.tagline || tool.description || '')}</p>
        <div class="co-admin-chip-row" style="margin:12px 0;">
          <span class="co-admin-chip-soft">${escapeHtml(tool.branch_name || 'All branches')}</span>
          <span class="co-admin-chip-soft">${escapeHtml(tool.semester_label || 'All semesters')}</span>
        </div>
        <div class="control-actions">
          <button class="btn secondary sm" data-edit-tool="${tool.id}">Edit</button>
          <button class="btn secondary sm" data-toggle-tool="${tool.id}">${tool.is_enabled ? 'Disable' : 'Enable'}</button>
          <button class="btn danger sm" data-delete-tool="${tool.id}">Delete</button>
        </div>
      </article>
    `).join('');

    list.querySelectorAll('[data-edit-tool]').forEach((node) => {
      node.addEventListener('click', () => {
        const tool = state.tools.find((item) => Number(item.id) === Number(node.dataset.editTool));
        if (!tool) return;
        state.editingId = tool.id;
        form.toolKey.value = tool.tool_key || '';
        form.title.value = tool.title || '';
        form.tagline.value = tool.tagline || '';
        form.description.value = tool.description || '';
        form.iconName.value = tool.icon_name || 'fa-sparkles';
        form.accentColor.value = tool.accent_color || '#7c3aed';
        form.accessType.value = tool.access_type || 'free';
        form.status.value = tool.status || 'published';
        form.isEnabled.value = String(Boolean(tool.is_enabled));
        form.isVisible.value = String(Boolean(tool.is_visible));
        form.isFeatured.value = String(Boolean(tool.is_featured));
        form.sortOrder.value = tool.sort_order || 0;
        form.benefits.value = (tool.benefits || []).join(', ');
        form.promptTemplate.value = tool.prompt_template || '';
        categorySelect.value = tool.category_id || '';
        loadBranches(tool.category_id || '', tool.branch_id || '');
        semesterSelect.value = tool.semester_id || '';
        submitBtn.innerHTML = '<i class="fa-solid fa-pen"></i> Update tool';
        setStatus(`Editing ${tool.title}.`, 'success');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    list.querySelectorAll('[data-toggle-tool]').forEach((node) => {
      node.addEventListener('click', async () => {
        const tool = state.tools.find((item) => Number(item.id) === Number(node.dataset.toggleTool));
        if (!tool) return;
        await window.CollegeOSApi.adminUpdateAiTool(tool.id, {
          toolKey: tool.tool_key,
          title: tool.title,
          tagline: tool.tagline,
          description: tool.description,
          iconName: tool.icon_name,
          accentColor: tool.accent_color,
          accessType: tool.access_type,
          status: tool.status,
          isEnabled: !tool.is_enabled,
          isVisible: tool.is_visible,
          isFeatured: tool.is_featured,
          sortOrder: tool.sort_order,
          categoryId: tool.category_id,
          branchId: tool.branch_id,
          semesterId: tool.semester_id,
          benefits: tool.benefits,
          promptTemplate: tool.prompt_template
        });
        setStatus(`${tool.title} updated.`, 'success');
        await loadTools();
      });
    });

    list.querySelectorAll('[data-delete-tool]').forEach((node) => {
      node.addEventListener('click', async () => {
        if (!window.confirm('Archive this AI tool?')) return;
        await window.CollegeOSApi.adminDeleteAiTool(Number(node.dataset.deleteTool));
        setStatus('AI tool archived.', 'success');
        await loadTools();
      });
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = payloadFromForm();
    if (!payload.title) {
      setStatus('Tool title is required.', 'error');
      return;
    }

    submitBtn.disabled = true;
    try {
      if (state.editingId) {
        await window.CollegeOSApi.adminUpdateAiTool(state.editingId, payload);
        setStatus('AI tool updated successfully.', 'success');
      } else {
        await window.CollegeOSApi.adminCreateAiTool(payload);
        setStatus('AI tool created successfully.', 'success');
      }
      resetForm();
      await loadTools();
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });

  categorySelect.addEventListener('change', async () => {
    await loadBranches(categorySelect.value);
  });

  document.getElementById('aiToolResetBtn')?.addEventListener('click', resetForm);

  await loadAcademicOptions();
  resetForm();
  await loadTools();
});
