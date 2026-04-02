document.addEventListener('DOMContentLoaded', async () => {
  const api = window.CollegeOSApi;
  if (!api) return;

  const state = {
    toolsCatalog: [],
    featureSettings: [],
    selectedToolKey: 'notes-summary',
    selectedPromptVersions: [],
    analytics: null,
    editingToolId: null,
    globalSettings: null,
    catalogFilter: {
      query: '',
      access: 'all',
      status: 'all'
    }
  };

  const refs = {
    status: document.getElementById('aiOpsStatus'),
    globalForm: document.getElementById('aiGlobalSettingsForm'),
    connectionTestBtn: document.getElementById('aiConnectionTestBtn'),
    connectionTestStatus: document.getElementById('aiConnectionTestStatus'),
    featureToolSelect: document.getElementById('aiFeatureToolKey'),
    featureForm: document.getElementById('aiFeatureForm'),
    promptForm: document.getElementById('aiPromptForm'),
    promptVersionList: document.getElementById('aiPromptVersionList'),
    promptTestOutput: document.getElementById('aiPromptTestOutput'),
    walletForm: document.getElementById('aiWalletForm'),
    walletOutput: document.getElementById('aiWalletOutput'),
    planEditorWrap: document.getElementById('aiPlanEditorWrap'),
    analyticsSummary: document.getElementById('aiAnalyticsSummary'),
    analyticsFeatureTable: document.getElementById('aiFeatureUsageRows'),
    analyticsProviderTable: document.getElementById('aiProviderUsageRows'),
    analyticsTopUsers: document.getElementById('aiTopUsersRows'),
    analyticsSuspiciousUsers: document.getElementById('aiSuspiciousUsersRows'),
    requestLogsBody: document.getElementById('aiRequestLogsRows'),
    auditLogsBody: document.getElementById('aiAuditLogsRows'),
    catalogGrid: document.getElementById('aiToolAdminGrid'),
    toolForm: document.getElementById('aiToolAdminForm'),
    toolSubmitBtn: document.getElementById('aiToolSubmitBtn'),
    toolResetBtn: document.getElementById('aiToolResetBtn'),
    toolStatus: document.getElementById('aiToolAdminStatus'),
    categorySelect: document.getElementById('aiToolCategoryId'),
    branchSelect: document.getElementById('aiToolBranchId'),
    semesterSelect: document.getElementById('aiToolSemesterId'),
    healthPills: document.getElementById('aiOpsHealthPills'),
    refreshBtn: document.getElementById('aiOpsRefreshBtn'),
    jumpBuilderBtn: document.getElementById('aiOpsJumpBuilderBtn'),
    jumpLogsBtn: document.getElementById('aiOpsJumpLogsBtn'),
    sectionNav: document.getElementById('aiAdminSectionNav'),
    sectionLinks: Array.from(document.querySelectorAll('[data-section-target]')),
    toolSearchInput: document.getElementById('aiToolSearchInput'),
    toolAccessFilter: document.getElementById('aiToolAccessFilter'),
    toolStatusFilter: document.getElementById('aiToolStatusFilter'),
    toolFilterResetBtn: document.getElementById('aiToolFilterResetBtn'),
    catalogMeta: document.getElementById('aiToolCatalogMeta')
  };

  function safeText(value) {
    return String(value || '').trim();
  }

  function esc(value) {
    return String(value || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function setStatus(message, tone = 'muted') {
    if (!refs.status) return;
    refs.status.textContent = message;
    refs.status.className = tone === 'error'
      ? 'message error'
      : tone === 'success'
        ? 'message success'
        : 'muted';
  }

  function boolToString(value) {
    return value ? 'true' : 'false';
  }

  function setToolStatus(message, tone = 'muted') {
    if (!refs.toolStatus) return;
    refs.toolStatus.textContent = message;
    refs.toolStatus.className = tone === 'error'
      ? 'message error'
      : tone === 'success'
        ? 'message success'
        : 'muted';
  }

  function renderOptions(node, rows, placeholder, valueKey = 'id', labelKey = 'name') {
    if (!node) return;
    node.innerHTML = [`<option value="">${esc(placeholder)}</option>`]
      .concat((rows || []).map((row) => `<option value="${esc(row[valueKey])}">${esc(row[labelKey])}</option>`))
      .join('');
  }

  async function loadAcademicOptions() {
    if (!refs.categorySelect || !refs.semesterSelect) return;
    const [categoriesPayload, semestersPayload] = await Promise.all([
      api.getAcademicCategories(),
      api.getAcademicSemesters()
    ]);
    renderOptions(refs.categorySelect, categoriesPayload.categories || [], 'All categories');
    renderOptions(refs.semesterSelect, semestersPayload.semesters || [], 'All semesters', 'id', 'label');
  }

  async function loadBranches(categoryId, selectedValue = '') {
    if (!refs.branchSelect) return;
    if (!categoryId) {
      refs.branchSelect.innerHTML = '<option value="">All branches</option>';
      return;
    }
    const payload = await api.getAcademicBranches(categoryId);
    renderOptions(refs.branchSelect, payload.branches || [], 'All branches');
    if (selectedValue) refs.branchSelect.value = String(selectedValue);
  }

  function renderHealthPills() {
    if (!refs.healthPills) return;
    const totals = state.analytics?.totals || {};
    const global = state.globalSettings || {};
    const providerMode = safeText(global.providerMode || 'fallback_only');
    const aiEnabled = Boolean(global.aiEnabled);
    const failureCount = Number(totals.failureCount || 0);
    const totalRequests = Number(totals.totalRequests || 0);
    const failureRate = totalRequests > 0 ? ((failureCount / totalRequests) * 100).toFixed(1) : '0.0';

    const cards = [
      {
        label: 'Runtime State',
        value: aiEnabled ? 'AI Enabled' : 'AI Disabled',
        tone: aiEnabled ? 'ok' : 'warn'
      },
      {
        label: 'Provider Mode',
        value: providerMode,
        tone: providerMode === 'azure_openai' ? 'ok' : 'warn'
      },
      {
        label: 'Failure Rate',
        value: `${failureRate}%`,
        tone: Number(failureRate) > 4 ? 'warn' : 'ok'
      },
      {
        label: 'Catalog Health',
        value: `${state.toolsCatalog.length} tools`,
        tone: state.toolsCatalog.length ? 'ok' : 'warn'
      }
    ];

    refs.healthPills.innerHTML = cards.map((card) => `
      <article class="ai-admin-pill ${card.tone}">
        <span class="label">${esc(card.label)}</span>
        <span class="value">${esc(card.value)}</span>
      </article>
    `).join('');
  }

  function activateSectionLink(targetId) {
    refs.sectionLinks.forEach((node) => {
      const isActive = node.dataset.sectionTarget === targetId;
      node.classList.toggle('active', isActive);
    });
  }

  function setupSectionNav() {
    refs.sectionLinks.forEach((node) => {
      node.addEventListener('click', () => {
        const targetId = node.dataset.sectionTarget;
        const target = targetId ? document.getElementById(targetId) : null;
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        activateSectionLink(targetId);
      });
    });

    const trackedSections = refs.sectionLinks
      .map((node) => document.getElementById(node.dataset.sectionTarget || ''))
      .filter(Boolean);

    if (!trackedSections.length || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible?.target?.id) return;
      activateSectionLink(visible.target.id);
    }, { rootMargin: '-25% 0px -55% 0px', threshold: [0.2, 0.45, 0.7] });

    trackedSections.forEach((section) => observer.observe(section));
  }

  function filteredCatalog() {
    const query = state.catalogFilter.query;
    const access = state.catalogFilter.access;
    const status = state.catalogFilter.status;

    return state.toolsCatalog.filter((tool) => {
      if (access !== 'all' && safeText(tool.access_type) !== access) return false;
      if (status !== 'all' && safeText(tool.status) !== status) return false;
      if (!query) return true;
      const haystack = [
        tool.title,
        tool.tool_key,
        tool.tagline,
        tool.description,
        tool.category_name,
        tool.branch_name,
        tool.semester_label
      ].map((item) => safeText(item).toLowerCase()).join(' ');
      return haystack.includes(query);
    });
  }

  function updateCatalogMeta(list) {
    if (!refs.catalogMeta) return;
    const total = state.toolsCatalog.length;
    const visible = list.length;
    const premium = list.filter((tool) => safeText(tool.access_type) === 'premium').length;
    refs.catalogMeta.textContent = `Showing ${visible} of ${total} tools | Premium: ${premium}`;
  }

  function renderCatalogCards(list) {
    if (!refs.catalogGrid) return;
    if (!list.length) {
      refs.catalogGrid.innerHTML = '<div class="co-admin-empty">No tools match current filters.</div>';
      updateCatalogMeta(list);
      return;
    }

    refs.catalogGrid.innerHTML = list.map((tool) => `
      <article class="co-admin-showcase-card">
        <div class="co-admin-showcase-top">
          <span class="co-admin-icon-badge" style="background:${esc(tool.accent_color || '#2563eb')}; color:#fff;"><i class="fa-solid ${esc(tool.icon_name || 'fa-sparkles')}"></i></span>
          <div class="co-admin-chip-row">
            <span class="co-admin-chip-soft">${esc(tool.access_type || 'free')}</span>
            <span class="co-admin-chip-soft">${tool.is_enabled ? 'Enabled' : 'Disabled'}</span>
            <span class="co-admin-chip-soft">${tool.is_visible ? 'Visible' : 'Hidden'}</span>
          </div>
        </div>
        <h3>${esc(tool.title)}</h3>
        <p>${esc(tool.tagline || tool.description || '')}</p>
        <div class="co-admin-chip-row" style="margin-top:8px;">
          <span class="co-admin-chip-soft">${esc(tool.category_name || 'All categories')}</span>
          <span class="co-admin-chip-soft">${esc(tool.branch_name || 'All branches')}</span>
          <span class="co-admin-chip-soft">${esc(tool.semester_label || 'All semesters')}</span>
        </div>
        <div class="control-actions" style="margin-top:12px;">
          <button class="btn secondary sm" type="button" data-edit-tool="${esc(tool.id)}">Edit</button>
          <button class="btn danger sm" type="button" data-archive-tool="${esc(tool.id)}">Archive</button>
        </div>
      </article>
    `).join('');

    refs.catalogGrid.querySelectorAll('[data-edit-tool]').forEach((node) => {
      node.addEventListener('click', async () => {
        const id = Number(node.dataset.editTool);
        const tool = state.toolsCatalog.find((item) => Number(item.id) === id);
        if (!tool) return;
        await populateToolForm(tool);
      });
    });

    refs.catalogGrid.querySelectorAll('[data-archive-tool]').forEach((node) => {
      node.addEventListener('click', async () => {
        const id = Number(node.dataset.archiveTool);
        const tool = state.toolsCatalog.find((item) => Number(item.id) === id);
        if (!tool) return;
        const confirmed = window.confirm(`Archive "${tool.title}"?`);
        if (!confirmed) return;
        await api.adminDeleteAiTool(id);
        setToolStatus(`Archived ${tool.title}.`, 'success');
        await loadCatalogCards();
      });
    });

    updateCatalogMeta(list);
  }

  function applyCatalogFilters() {
    renderCatalogCards(filteredCatalog());
  }

  function fillGlobalSettings(settings) {
    if (!refs.globalForm) return;
    refs.globalForm.aiEnabled.value = boolToString(Boolean(settings.aiEnabled));
    refs.globalForm.providerMode.value = settings.providerMode || 'fallback_only';
    refs.globalForm.azureEndpoint.value = settings.azureEndpoint || '';
    refs.globalForm.azureApiKey.value = '';
    refs.globalForm.azureApiKey.placeholder = settings.azureApiKeyConfigured ? 'Key is configured. Paste new key only when rotating.' : 'Paste new key only when rotating';
    refs.globalForm.azureDeployment.value = settings.azureDeployment || '';
    refs.globalForm.azureApiVersion.value = settings.azureApiVersion || '2024-02-15-preview';
  }

  function currentFeature() {
    return state.featureSettings.find((f) => f.tool_key === state.selectedToolKey) || null;
  }

  function fillFeatureForm() {
    const feature = currentFeature();
    if (!feature || !refs.featureForm) return;
    refs.featureForm.featureEnabled.value = boolToString(Boolean(feature.feature_enabled));
    refs.featureForm.maintenanceMode.value = boolToString(Boolean(feature.maintenance_mode));
    refs.featureForm.planAccess.value = feature.plan_access || 'free';
    refs.featureForm.isFree.value = boolToString(Boolean(feature.is_free));
    refs.featureForm.monthlyCreditCost.value = feature.monthly_credit_cost ?? 1;
    refs.featureForm.perRequestMessageCost.value = feature.per_request_message_cost ?? 0;
    refs.featureForm.dailyUsageLimit.value = feature.daily_usage_limit ?? 30;
    refs.featureForm.monthlyUsageLimit.value = feature.monthly_usage_limit ?? 500;
    refs.featureForm.maxOutputTokens.value = feature.max_output_tokens ?? 700;
    refs.featureForm.responseMode.value = feature.response_mode || 'medium';
    refs.featureForm.temperature.value = feature.temperature ?? 0.3;
    refs.featureForm.timeoutMs.value = feature.timeout_ms ?? 12000;
    refs.featureForm.retryCount.value = feature.retry_count ?? 1;
    refs.featureForm.providerPreference.value = feature.provider_preference || 'azure_openai';
    refs.featureForm.allowAzure.value = boolToString(Boolean(feature.allow_azure));
    refs.featureForm.adminNotes.value = feature.admin_notes || '';
  }

  async function loadGlobalSettings() {
    const payload = await api.adminAiOpsGlobalSettings();
    state.globalSettings = payload.settings || {};
    fillGlobalSettings(state.globalSettings);
    renderHealthPills();
  }

  async function loadFeatureSettings() {
    const payload = await api.adminAiOpsFeatures();
    state.featureSettings = payload.features || [];

    if (refs.featureToolSelect) {
      refs.featureToolSelect.innerHTML = state.featureSettings
        .map((feature) => `<option value="${esc(feature.tool_key)}">${esc(feature.tool_key)}</option>`)
        .join('');

      if (!state.featureSettings.some((feature) => feature.tool_key === state.selectedToolKey)) {
        state.selectedToolKey = state.featureSettings[0]?.tool_key || 'notes-summary';
      }

      refs.featureToolSelect.value = state.selectedToolKey;
    }

    fillFeatureForm();
    await loadPromptForSelectedTool();
  }

  async function loadPromptForSelectedTool() {
    const payload = await api.adminAiOpsPrompt(state.selectedToolKey);
    const prompt = payload.prompt || {};
    state.selectedPromptVersions = payload.versions || [];

    if (refs.promptForm) {
      refs.promptForm.systemPrompt.value = prompt.system_prompt || '';
      refs.promptForm.userPromptTemplate.value = prompt.user_prompt_template || '';
      refs.promptForm.fallbackPrompt.value = prompt.fallback_prompt || '';
      refs.promptForm.outputStyleRules.value = prompt.output_style_rules || '';
      refs.promptForm.tone.value = prompt.tone || 'exam-oriented';
    }

    if (refs.promptVersionList) {
      if (!state.selectedPromptVersions.length) {
        refs.promptVersionList.innerHTML = '<div class="muted">No prompt versions yet.</div>';
      } else {
        refs.promptVersionList.innerHTML = state.selectedPromptVersions.map((version) => `
          <button class="btn secondary sm" data-restore-version="${version.id}">
            v${version.version_number} · ${esc(version.tone)} · ${new Date(version.created_at).toLocaleString()}
          </button>
        `).join('');

        refs.promptVersionList.querySelectorAll('[data-restore-version]').forEach((node) => {
          node.addEventListener('click', async () => {
            const versionId = Number(node.dataset.restoreVersion);
            await api.adminAiOpsRestorePromptVersion(state.selectedToolKey, versionId);
            setStatus(`Prompt restored for ${state.selectedToolKey}.`, 'success');
            await loadPromptForSelectedTool();
          });
        });
      }
    }
  }

  async function loadCatalogCards() {
    const payload = await api.adminGetAiTools();
    state.toolsCatalog = payload.tools || [];
    applyCatalogFilters();
    renderHealthPills();
  }

  async function populateToolForm(tool) {
    if (!refs.toolForm) return;
    state.editingToolId = Number(tool.id);
    refs.toolForm.title.value = tool.title || '';
    refs.toolForm.toolKey.value = tool.tool_key || '';
    refs.toolForm.tagline.value = tool.tagline || '';
    refs.toolForm.description.value = tool.description || '';
    refs.toolForm.iconName.value = tool.icon_name || 'fa-sparkles';
    refs.toolForm.accentColor.value = tool.accent_color || '#0f766e';
    refs.toolForm.accessType.value = tool.access_type || 'free';
    refs.toolForm.status.value = tool.status || 'published';
    refs.toolForm.isEnabled.value = boolToString(Boolean(tool.is_enabled));
    refs.toolForm.isVisible.value = boolToString(Boolean(tool.is_visible));
    refs.toolForm.isFeatured.value = boolToString(Boolean(tool.is_featured));
    refs.toolForm.sortOrder.value = Number(tool.sort_order || 0);
    refs.toolForm.benefits.value = Array.isArray(tool.benefits) ? tool.benefits.join(', ') : '';
    refs.toolForm.promptTemplate.value = tool.prompt_template || '';

    refs.categorySelect.value = tool.category_id ? String(tool.category_id) : '';
    await loadBranches(refs.categorySelect.value, tool.branch_id ? String(tool.branch_id) : '');
    refs.semesterSelect.value = tool.semester_id ? String(tool.semester_id) : '';

    if (refs.toolSubmitBtn) refs.toolSubmitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Update AI tool';
    setToolStatus(`Editing ${tool.title}.`, 'success');
    refs.toolForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function toolPayloadFromForm() {
    if (!refs.toolForm) return {};
    const data = new FormData(refs.toolForm);
    const toolKey = safeText(data.get('toolKey')) || safeText(data.get('title')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    return {
      title: safeText(data.get('title')),
      toolKey,
      tagline: safeText(data.get('tagline')),
      description: safeText(data.get('description')),
      iconName: safeText(data.get('iconName')) || 'fa-sparkles',
      accentColor: safeText(data.get('accentColor')) || '#0f766e',
      accessType: safeText(data.get('accessType')) || 'free',
      status: safeText(data.get('status')) || 'published',
      isEnabled: safeText(data.get('isEnabled')) === 'true',
      isVisible: safeText(data.get('isVisible')) === 'true',
      isFeatured: safeText(data.get('isFeatured')) === 'true',
      sortOrder: Number(data.get('sortOrder') || 0),
      categoryId: data.get('categoryId') ? Number(data.get('categoryId')) : null,
      branchId: data.get('branchId') ? Number(data.get('branchId')) : null,
      semesterId: data.get('semesterId') ? Number(data.get('semesterId')) : null,
      benefits: safeText(data.get('benefits')).split(/,|\n|;/).map((item) => item.trim()).filter(Boolean),
      promptTemplate: safeText(data.get('promptTemplate'))
    };
  }

  function resetToolForm() {
    if (!refs.toolForm) return;
    refs.toolForm.reset();
    state.editingToolId = null;
    refs.categorySelect.value = '';
    refs.branchSelect.innerHTML = '<option value="">All branches</option>';
    refs.semesterSelect.value = '';
    if (refs.toolSubmitBtn) refs.toolSubmitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save AI tool';
    setToolStatus('Ready to create a new AI tool.');
  }

  function renderAnalyticsCards(analytics) {
    if (!refs.analyticsSummary) return;
    const totals = analytics?.totals || {};
    refs.analyticsSummary.innerHTML = [
      ['Total AI Requests', totals.totalRequests || 0],
      ['Failures', totals.failureCount || 0],
      ['Avg Response (ms)', Math.round(Number(totals.avgResponseMs || 0))],
      ['Credits Consumed', totals.creditsConsumed || 0],
      ['Est. AI Cost', `INR ${Number(totals.estimatedAiCost || 0).toFixed(2)}`],
      ['Premium Impact', `${totals.premiumConversionImpactPercent || 0}%`]
    ].map((item) => `<article class="kpi-card"><div class="kpi-label">${item[0]}</div><div class="kpi-value">${item[1]}</div></article>`).join('');
  }

  function renderSimpleTable(target, rows, columns, emptyMsg) {
    if (!target) return;
    if (!rows || !rows.length) {
      target.innerHTML = `<tr><td colspan="${columns.length}">${esc(emptyMsg)}</td></tr>`;
      return;
    }
    target.innerHTML = rows.map((row) => `<tr>${columns.map((column) => `<td>${esc(row[column])}</td>`).join('')}</tr>`).join('');
  }

  async function loadAnalyticsAndLogs() {
    const [analytics, reqLogs, auditLogs] = await Promise.all([
      api.adminAiOpsAnalyticsOverview(30),
      api.adminAiOpsRequestLogs({ limit: 50 }),
      api.adminAiOpsAuditLogs(50)
    ]);

    state.analytics = analytics;
    renderAnalyticsCards(analytics);
    renderHealthPills();

    renderSimpleTable(refs.analyticsFeatureTable, analytics.featureUsage || [], ['tool_key', 'uses', 'failures', 'credits'], 'No feature usage yet.');
    renderSimpleTable(refs.analyticsProviderTable, analytics.providerHealth || [], ['provider_used', 'requests', 'success', 'failures'], 'No provider data yet.');
    renderSimpleTable(refs.analyticsTopUsers, analytics.topUsers || [], ['user_id', 'requests', 'credits'], 'No top users yet.');
    renderSimpleTable(refs.analyticsSuspiciousUsers, analytics.suspiciousUsers || [], ['user_id', 'requests', 'failures', 'credits'], 'No suspicious users detected.');

    renderSimpleTable(refs.requestLogsBody, reqLogs.logs || [], ['id', 'tool_key', 'provider_used', 'success', 'error_code', 'response_ms', 'credits_charged', 'created_at'], 'No request logs yet.');
    renderSimpleTable(refs.auditLogsBody, auditLogs.logs || [], ['id', 'actor_user_id', 'action', 'target_type', 'target_key', 'created_at'], 'No audit logs yet.');
  }

  async function loadPlanEntitlements() {
    const payload = await api.adminAiOpsPlanEntitlements();
    const rows = payload.entitlements || [];

    if (!refs.planEditorWrap) return;
    if (!rows.length) {
      refs.planEditorWrap.innerHTML = '<div class="muted">No plan entitlements configured.</div>';
      return;
    }

    const grouped = rows.reduce((acc, row) => {
      const key = row.plan_code || 'free';
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});

    refs.planEditorWrap.innerHTML = Object.keys(grouped).map((planCode) => {
      const tableRows = grouped[planCode].map((row) => `
        <tr>
          <td>${esc(row.tool_key)}</td>
          <td>
            <select data-entitlement-unlocked="${esc(planCode)}::${esc(row.tool_key)}">
              <option value="true" ${row.unlocked ? 'selected' : ''}>Unlocked</option>
              <option value="false" ${!row.unlocked ? 'selected' : ''}>Locked</option>
            </select>
          </td>
          <td><input type="number" data-entitlement-credits="${esc(planCode)}::${esc(row.tool_key)}" value="${esc(row.monthly_credits)}" /></td>
          <td><input type="number" data-entitlement-day-limit="${esc(planCode)}::${esc(row.tool_key)}" value="${esc(row.per_day_limit)}" /></td>
        </tr>
      `).join('');

      return `
        <section class="co-admin-panel" style="margin-top:12px;">
          <div class="co-admin-section-head">
            <div>
              <h3>Plan: ${esc(planCode)}</h3>
              <p>Control unlocks and limits for this plan.</p>
            </div>
            <button class="btn primary sm" data-save-plan="${esc(planCode)}">Save ${esc(planCode)}</button>
          </div>
          <table class="co-admin-table">
            <thead><tr><th>Tool</th><th>Access</th><th>Monthly Credits</th><th>Daily Limit</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </section>
      `;
    }).join('');

    refs.planEditorWrap.querySelectorAll('[data-save-plan]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const planCode = String(btn.dataset.savePlan || '').trim();
        const planRows = grouped[planCode] || [];
        const entitlements = planRows.map((row) => {
          const key = `${planCode}::${row.tool_key}`;
          return {
            toolKey: row.tool_key,
            unlocked: document.querySelector(`[data-entitlement-unlocked="${key}"]`)?.value === 'true',
            monthlyCredits: Number(document.querySelector(`[data-entitlement-credits="${key}"]`)?.value || row.monthly_credits),
            perDayLimit: Number(document.querySelector(`[data-entitlement-day-limit="${key}"]`)?.value || row.per_day_limit),
            planLabel: row.plan_label,
            priceInr: row.price_inr,
            freeUserLimit: row.free_user_limit,
            paidUserLimit: row.paid_user_limit
          };
        });

        await api.adminAiOpsUpdatePlanEntitlements(planCode, entitlements);
        setStatus(`Plan entitlements saved for ${planCode}.`, 'success');
        await loadPlanEntitlements();
      });
    });
  }

  refs.globalForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      aiEnabled: refs.globalForm.aiEnabled.value === 'true',
      providerMode: refs.globalForm.providerMode.value,
      azureEndpoint: refs.globalForm.azureEndpoint.value.trim(),
      azureDeployment: refs.globalForm.azureDeployment.value.trim(),
      azureApiVersion: refs.globalForm.azureApiVersion.value.trim()
    };

    const rotatedKey = refs.globalForm.azureApiKey.value.trim();
    if (rotatedKey) {
      payload.azureApiKey = rotatedKey;
    }

    await api.adminAiOpsUpdateGlobalSettings(payload);
    setStatus('Global AI settings saved.', 'success');
    await loadGlobalSettings();
  });

  refs.connectionTestBtn?.addEventListener('click', async () => {
    refs.connectionTestBtn.disabled = true;
    refs.connectionTestStatus.textContent = 'Running connection test...';
    try {
      const payload = {
        aiEnabled: refs.globalForm.aiEnabled.value === 'true',
        providerMode: refs.globalForm.providerMode.value,
        azureEndpoint: refs.globalForm.azureEndpoint.value.trim(),
        azureDeployment: refs.globalForm.azureDeployment.value.trim(),
        azureApiVersion: refs.globalForm.azureApiVersion.value.trim()
      };
      const rotatedKey = refs.globalForm.azureApiKey.value.trim();
      if (rotatedKey) {
        payload.azureApiKey = rotatedKey;
      }
      const result = await api.adminAiOpsTestConnection(payload);
      refs.connectionTestStatus.textContent = result.message || (result.ok ? 'Connection healthy.' : 'Connection failed; fallback mode active.');
    } catch (error) {
      refs.connectionTestStatus.textContent = error.message || 'Connection test failed.';
    } finally {
      refs.connectionTestBtn.disabled = false;
    }
  });

  refs.featureToolSelect?.addEventListener('change', async () => {
    state.selectedToolKey = refs.featureToolSelect.value;
    fillFeatureForm();
    await loadPromptForSelectedTool();
  });

  refs.featureForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      featureEnabled: refs.featureForm.featureEnabled.value === 'true',
      maintenanceMode: refs.featureForm.maintenanceMode.value === 'true',
      planAccess: refs.featureForm.planAccess.value,
      isFree: refs.featureForm.isFree.value === 'true',
      monthlyCreditCost: Number(refs.featureForm.monthlyCreditCost.value || 1),
      perRequestMessageCost: Number(refs.featureForm.perRequestMessageCost.value || 0),
      dailyUsageLimit: Number(refs.featureForm.dailyUsageLimit.value || 30),
      monthlyUsageLimit: Number(refs.featureForm.monthlyUsageLimit.value || 500),
      maxOutputTokens: Number(refs.featureForm.maxOutputTokens.value || 700),
      responseMode: refs.featureForm.responseMode.value,
      temperature: Number(refs.featureForm.temperature.value || 0.3),
      timeoutMs: Number(refs.featureForm.timeoutMs.value || 12000),
      retryCount: Number(refs.featureForm.retryCount.value || 1),
      providerPreference: refs.featureForm.providerPreference.value,
      allowAzure: refs.featureForm.allowAzure.value === 'true',
      adminNotes: refs.featureForm.adminNotes.value
    };

    await api.adminAiOpsUpdateFeature(state.selectedToolKey, payload);
    setStatus(`Feature settings saved for ${state.selectedToolKey}.`, 'success');
    await loadFeatureSettings();
  });

  refs.promptForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await api.adminAiOpsUpdatePrompt(state.selectedToolKey, {
      systemPrompt: refs.promptForm.systemPrompt.value,
      userPromptTemplate: refs.promptForm.userPromptTemplate.value,
      fallbackPrompt: refs.promptForm.fallbackPrompt.value,
      outputStyleRules: refs.promptForm.outputStyleRules.value,
      tone: refs.promptForm.tone.value
    });
    setStatus(`Prompt saved for ${state.selectedToolKey}.`, 'success');
    await loadPromptForSelectedTool();
  });

  document.getElementById('aiPromptTestBtn')?.addEventListener('click', async () => {
    const simulation = await api.adminAiOpsSimulate({
      toolKey: state.selectedToolKey,
      inputs: {
        topic: 'Database Normalization',
        question: 'How should I revise this quickly?',
        notes: '1NF, 2NF, 3NF examples and conversion steps',
        goal: 'semester exam prep',
        skills: 'sql, dbms',
        projects: 'student portal'
      },
      profile: {
        branch_name: 'CSE',
        semester_label: '6'
      },
      membership: {
        premiumActive: true,
        isAdmin: true
      },
      userMeta: {
        full_name: 'Admin Preview'
      }
    });

    const fallbackPreview = simulation.fallbackPreview || {};
    refs.promptTestOutput.textContent = JSON.stringify({
      renderedPrompt: simulation.renderedPrompt,
      fallbackPreview: {
        title: fallbackPreview.title,
        mode: fallbackPreview.mode,
        sectionCount: Array.isArray(fallbackPreview.sections) ? fallbackPreview.sections.length : 0
      }
    }, null, 2);
  });

  refs.walletForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const userId = Number(refs.walletForm.userId.value || 0);
    if (!userId) {
      setStatus('Enter a valid user id for wallet operations.', 'error');
      return;
    }

    const action = refs.walletForm.walletAction.value;
    let wallet;

    if (action === 'lookup') {
      wallet = (await api.adminAiOpsUserCredits(userId)).wallet;
    } else if (action === 'reset') {
      wallet = (await api.adminAiOpsResetUserCredits(userId, {
        resetTo: Number(refs.walletForm.resetTo.value || 120),
        freeTrialCredits: Number(refs.walletForm.freeTrialCredits.value || 50),
        monthlyPlanCredits: Number(refs.walletForm.monthlyPlanCredits.value || 120)
      })).wallet;
    } else if (action === 'bonus') {
      wallet = (await api.adminAiOpsBonusUserCredits(userId, {
        bonusCredits: Number(refs.walletForm.bonusCredits.value || 0),
        note: refs.walletForm.note.value
      })).wallet;
    } else if (action === 'override') {
      wallet = (await api.adminAiOpsUpdateUserOverride(userId, {
        dailyLimitOverride: Number(refs.walletForm.dailyLimitOverride.value || 0),
        monthlyLimitOverride: Number(refs.walletForm.monthlyLimitOverride.value || 0),
        hiddenTokenMode: refs.walletForm.hiddenTokenMode.value === 'true',
        visibleCreditsLeft: refs.walletForm.visibleCreditsLeft.value === 'true'
      })).wallet;
    } else if (action === 'block') {
      wallet = (await api.adminAiOpsBlockUser(userId, {
        blocked: refs.walletForm.blocked.value === 'true',
        reason: refs.walletForm.blockReason.value
      })).wallet;
    }

    refs.walletOutput.textContent = JSON.stringify(wallet || {}, null, 2);
    setStatus('Wallet operation completed.', 'success');
  });

  refs.categorySelect?.addEventListener('change', async () => {
    await loadBranches(refs.categorySelect.value);
  });

  refs.toolForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = toolPayloadFromForm();
    if (!payload.title) {
      setToolStatus('Tool title is required.', 'error');
      return;
    }

    if (state.editingToolId) {
      await api.adminUpdateAiTool(state.editingToolId, payload);
      setToolStatus('AI tool updated.', 'success');
    } else {
      await api.adminCreateAiTool(payload);
      setToolStatus('AI tool created.', 'success');
    }

    await loadCatalogCards();
    resetToolForm();
  });

  refs.toolResetBtn?.addEventListener('click', () => {
    resetToolForm();
  });

  refs.toolSearchInput?.addEventListener('input', () => {
    state.catalogFilter.query = safeText(refs.toolSearchInput.value).toLowerCase();
    applyCatalogFilters();
  });

  refs.toolAccessFilter?.addEventListener('change', () => {
    state.catalogFilter.access = refs.toolAccessFilter.value || 'all';
    applyCatalogFilters();
  });

  refs.toolStatusFilter?.addEventListener('change', () => {
    state.catalogFilter.status = refs.toolStatusFilter.value || 'all';
    applyCatalogFilters();
  });

  refs.toolFilterResetBtn?.addEventListener('click', () => {
    state.catalogFilter = { query: '', access: 'all', status: 'all' };
    if (refs.toolSearchInput) refs.toolSearchInput.value = '';
    if (refs.toolAccessFilter) refs.toolAccessFilter.value = 'all';
    if (refs.toolStatusFilter) refs.toolStatusFilter.value = 'all';
    applyCatalogFilters();
  });

  refs.refreshBtn?.addEventListener('click', async () => {
    refs.refreshBtn.disabled = true;
    try {
      setStatus('Refreshing AI operations data...');
      await Promise.all([
        loadGlobalSettings(),
        loadFeatureSettings(),
        loadCatalogCards(),
        loadAnalyticsAndLogs(),
        loadPlanEntitlements()
      ]);
      setStatus('AI operations data refreshed.', 'success');
    } catch (error) {
      setStatus(error.message || 'Refresh failed.', 'error');
    } finally {
      refs.refreshBtn.disabled = false;
    }
  });

  refs.jumpBuilderBtn?.addEventListener('click', () => {
    document.getElementById('aiToolsSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    activateSectionLink('aiToolsSection');
  });

  refs.jumpLogsBtn?.addEventListener('click', () => {
    document.getElementById('aiAuditSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    activateSectionLink('aiAuditSection');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== refs.toolSearchInput && refs.toolSearchInput) {
      event.preventDefault();
      refs.toolSearchInput.focus();
    }
  });

  setupSectionNav();

  try {
    setStatus('Loading AI operations panel...');
    await Promise.all([
      loadAcademicOptions(),
      loadGlobalSettings(),
      loadFeatureSettings(),
      loadCatalogCards(),
      loadAnalyticsAndLogs(),
      loadPlanEntitlements()
    ]);
    resetToolForm();
    setStatus('AI operations panel ready.', 'success');
  } catch (error) {
    setStatus(error.message || 'Failed to load AI operations panel.', 'error');
  }
});
