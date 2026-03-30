// Initialize
    document.addEventListener('DOMContentLoaded', () => {
      initializeAdmin();
      setupContributionLaneTabs();
      setupContributionDomainTabs();
      filterContributions();
    });

    function setupContributionDomainTabs() {
      const tabs = document.getElementById('contributionDomainTabs');
      if (!tabs) return;

      tabs.querySelectorAll('.contrib-lane-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          tabs.querySelectorAll('.contrib-lane-btn').forEach((node) => node.classList.remove('active'));
          btn.classList.add('active');

          const target = btn.dataset.target;
          const notesPanel = document.getElementById('notesPipelinePanel');
          const papersPanel = document.getElementById('papersPipelinePanel');
          if (!notesPanel || !papersPanel) return;

          notesPanel.style.display = target === 'notesPipelinePanel' ? '' : 'none';
          papersPanel.style.display = target === 'papersPipelinePanel' ? '' : 'none';

          const selectAll = document.getElementById('contribSelectAll');
          if (selectAll) selectAll.checked = false;
        });
      });
    }

    async function initializeAdmin() {
      try {
        await window.CollegeOSApi.adminDashboard();
      } catch (_error) {
        window.location.href = '/admin-login.html';
      }
    }

    async function loadContentOverview() {
      try {
        const data = await window.CollegeOSApi.getAcademicContentOverview();
        renderOverviewCards(data.overview);
      } catch (error) {
        console.error('Failed to load overview:', error);
        document.getElementById('contentOverview').innerHTML =
          `<div class="message error">Failed to load overview: ${error.message}</div>`;
      }
    }

    function renderOverviewCards(overview) {
      if (!overview || overview.length === 0) {
        document.getElementById('contentOverview').innerHTML =
          '<p>No content data available</p>';
        return;
      }

      const html = overview.map(item => `
        <div class="stat-card">
          <h3>${item.category} - ${item.branch}</h3>
          <div style="font-size: 12px; color: #999; margin: 10px 0;">
            <div>📝 Notes: <strong>${item.notes_count}</strong></div>
            <div>📊 Quizzes: <strong>${item.quizzes_count}</strong></div>
            <div>📚 Materials: <strong>${item.materials_count}</strong></div>
            <div>📄 Papers: <strong>${item.papers_count}</strong></div>
          </div>
        </div>
      `).join('');

      document.getElementById('contentOverview').innerHTML = html;
    }

    async function loadFilterDropdowns() {
      try {
        const categoriesResponse = await window.CollegeOSApi.getAcademicCategories();
        const semestersResponse = await window.CollegeOSApi.getAcademicSemesters();
        
        const categories = categoriesResponse.categories || [];
        const semesters = semestersResponse.semesters || [];

        // Populate category filters
        const categorySelects = document.querySelectorAll('[id$="CategoryFilter"]');
        categorySelects.forEach(select => {
          categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat.id;
            option.text = cat.name;
            select.appendChild(option);
          });
        });

        // Populate semester filters
        const semesterSelects = document.querySelectorAll('[id$="SemesterFilter"]');
        semesterSelects.forEach(select => {
          semesters.forEach(sem => {
            const option = document.createElement('option');
            option.value = sem.id;
            option.text = sem.label;
            select.appendChild(option);
          });
        });

        // Setup category change listeners
        document.querySelectorAll('[id$="CategoryFilter"]').forEach(select => {
          select.addEventListener('change', async (e) => {
            if (e.target.value) {
              const branchesResponse = await window.CollegeOSApi.getAcademicBranches(e.target.value);
              const branches = branchesResponse.branches || [];
              const branchSelect = e.target.parentElement.parentElement.querySelector('[id$="BranchFilter"]');
              branchSelect.innerHTML = '<option value="">All Branches</option>';
              branches.forEach(branch => {
                const option = document.createElement('option');
                option.value = branch.id;
                option.text = branch.name;
                branchSelect.appendChild(option);
              });
            }
          });
        });
      } catch (error) {
        console.error('Failed to load filter options:', error);
      }
    }

    async function filterNotes() {
      try {
        const params = {
          categoryId: document.getElementById('notesCategoryFilter').value,
          branchId: document.getElementById('notesBranchFilter').value,
          semesterId: document.getElementById('notesSemesterFilter').value,
          status: document.getElementById('notesStatusFilter').value
        };

        // Remove empty values
        Object.keys(params).forEach(key => !params[key] && delete params[key]);

        const data = await window.CollegeOSApi.adminGetAcademicNotes(params);
        renderNotesTable(data.notes);
      } catch (error) {
        console.error('Failed to load notes:', error);
        document.getElementById('notesTableBody').innerHTML =
          `<tr><td colspan="8" class="message error">Failed to load notes: ${error.message}</td></tr>`;
      }
    }

    function renderNotesTable(notes) {
      if (!notes || notes.length === 0) {
        document.getElementById('notesTableBody').innerHTML =
          '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #999;">No notes found</td></tr>';
        return;
      }

      const html = notes.map(note => `
        <tr>
          <td>${note.subject}</td>
          <td>${note.chapter}</td>
          <td>${note.branch_name || '-'}</td>
          <td>${note.semester_label || '-'}</td>
          <td><span class="badge badge-${note.status === 'published' ? 'success' : 'warning'}">${note.status}</span></td>
          <td>${note.access_type}</td>
          <td>${new Date(note.created_at).toLocaleDateString()}</td>
          <td>
            <div class="action-buttons">
              <button class="btn-sm btn-edit" data-action="edit-note" data-note-id="${note.id}">Edit</button>
              <button class="btn-sm btn-delete" data-action="delete-note" data-note-id="${note.id}">Delete</button>
            </div>
          </td>
        </tr>
      `).join('');

      document.getElementById('notesTableBody').innerHTML = html;
    }

    async function filterQuizzes() {
      try {
        const params = {
          categoryId: document.getElementById('quizzesCategoryFilter').value,
          branchId: document.getElementById('quizzesBranchFilter').value,
          status: document.getElementById('quizzesStatusFilter').value
        };

        Object.keys(params).forEach(key => !params[key] && delete params[key]);

        const data = await window.CollegeOSApi.adminGetAcademicQuizzes(params);
        renderQuizzesTable(data.quizzes);
      } catch (error) {
        console.error('Failed to load quizzes:', error);
        document.getElementById('quizzesTableBody').innerHTML =
          `<tr><td colspan="7" class="message error">Failed to load quizzes: ${error.message}</td></tr>`;
      }
    }

    function renderQuizzesTable(quizzes) {
      if (!quizzes || quizzes.length === 0) {
        document.getElementById('quizzesTableBody').innerHTML =
          '<tr><td colspan="7" style="text-align: center; padding: 20px; color: #999;">No quizzes found</td></tr>';
        return;
      }

      const html = quizzes.map(quiz => `
        <tr>
          <td>${quiz.subject}</td>
          <td>${quiz.branch_name || '-'}</td>
          <td>${quiz.question_count}</td>
          <td>${quiz.difficulty || '-'}</td>
          <td><span class="badge badge-${quiz.status === 'published' ? 'success' : 'warning'}">${quiz.status}</span></td>
          <td>${new Date(quiz.created_at).toLocaleDateString()}</td>
          <td>
            <div class="action-buttons">
              <button class="btn-sm btn-edit" data-action="edit-quiz" data-quiz-id="${quiz.id}">Edit</button>
              <button class="btn-sm btn-delete" data-action="delete-quiz" data-quiz-id="${quiz.id}">Delete</button>
            </div>
          </td>
        </tr>
      `).join('');

      document.getElementById('quizzesTableBody').innerHTML = html;
    }

    const NOTE_RESOURCE_TYPES = new Set(['class_notes', 'handwritten_notes', 'assignment', 'lab_file', 'other']);
    const PAPER_RESOURCE_TYPES = new Set(['mst1_paper', 'mst2_paper', 'final_exam_paper', 'pyq']);

    function isNotesContribution(item) {
      return NOTE_RESOURCE_TYPES.has(String(item?.resource_type || '').toLowerCase());
    }

    function isPapersContribution(item) {
      return PAPER_RESOURCE_TYPES.has(String(item?.resource_type || '').toLowerCase());
    }

    function setupContributionLaneTabs() {
      ['contributionLaneTabsNotes', 'contributionLaneTabsPapers'].forEach((barId) => {
        const bar = document.getElementById(barId);
        if (!bar) return;

        bar.querySelectorAll('.contrib-lane-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            bar.querySelectorAll('.contrib-lane-btn').forEach((node) => node.classList.remove('active'));
            btn.classList.add('active');
            applyContributionLanePreset(btn.dataset.domain || 'notes', btn.dataset.lane || 'pending');
            filterContributions();
          });
        });
      });
    }

    function applyContributionLanePreset(domain, lane) {
      const status = document.getElementById(domain === 'notes' ? 'contributionStatusFilterNotes' : 'contributionStatusFilterPapers');
      const risk = document.getElementById(domain === 'notes' ? 'contributionRiskFilterNotes' : 'contributionRiskFilterPapers');
      if (!status || !risk) return;

      status.value = 'all';
      risk.value = '';

      if (['pending', 'approved', 'rejected', 'needs_correction'].includes(lane)) {
        status.value = lane;
        return;
      }

      if (lane === 'risk') {
        risk.value = 'quality';
      }
    }

    function textIncludes(source, needle) {
      return String(source || '').toLowerCase().includes(String(needle || '').toLowerCase());
    }

    function applyDomainFilters(rows, domain) {
      const subject = document.getElementById(domain === 'notes' ? 'contributionSubjectFilterNotes' : 'contributionSubjectFilterPapers')?.value?.trim() || '';
      const semester = document.getElementById(domain === 'notes' ? 'contributionSemesterFilterNotes' : 'contributionSemesterFilterPapers')?.value?.trim() || '';
      const branch = document.getElementById(domain === 'notes' ? 'contributionBranchFilterNotes' : 'contributionBranchFilterPapers')?.value?.trim() || '';
      const uploader = document.getElementById(domain === 'notes' ? 'contributionUploaderFilterNotes' : 'contributionUploaderFilterPapers')?.value?.trim() || '';
      const risk = document.getElementById(domain === 'notes' ? 'contributionRiskFilterNotes' : 'contributionRiskFilterPapers')?.value || '';
      const status = document.getElementById(domain === 'notes' ? 'contributionStatusFilterNotes' : 'contributionStatusFilterPapers')?.value || 'all';

      return rows.filter((item) => {
        if (status && status !== 'all' && String(item.status || '') !== status) return false;
        if (subject && !textIncludes(item.subject_name, subject) && !textIncludes(item.title, subject)) return false;
        if (semester && !textIncludes(item.semester_label, semester)) return false;
        if (branch && !textIncludes(item.branch_name, branch)) return false;
        if (uploader && !textIncludes(item.uploader_name, uploader) && !textIncludes(item.uploader_email, uploader)) return false;
        if (risk === 'duplicate' && Number(item.duplicate_score || 0) < 60) return false;
        if (risk === 'quality' && Number(item.quality_score || 100) > 45) return false;
        return true;
      });
    }

    async function filterContributions() {
      try {
        const notesLane = document.querySelector('#contributionLaneTabsNotes .contrib-lane-btn.active')?.dataset?.lane || 'pending';
        const papersLane = document.querySelector('#contributionLaneTabsPapers .contrib-lane-btn.active')?.dataset?.lane || 'pending';

        const notesParams = {
          status: document.getElementById('contributionStatusFilterNotes')?.value || 'pending'
        };
        const papersParams = {
          status: document.getElementById('contributionStatusFilterPapers')?.value || 'pending'
        };

        if (notesLane === 'risk') notesParams.queueType = 'low_quality';
        if (papersLane === 'risk') papersParams.queueType = 'low_quality';

        const [notesQueueRes, papersQueueRes, analyticsRes] = await Promise.all([
          window.CollegeOSApi.adminGetContributionModerationQueue(notesParams),
          window.CollegeOSApi.adminGetContributionModerationQueue(papersParams),
          window.CollegeOSApi.adminContributionAnalyticsOverview()
        ]);

        let notesRows = (notesQueueRes.queue || []).filter(isNotesContribution);
        let papersRows = (papersQueueRes.queue || []).filter(isPapersContribution);

        notesRows = applyDomainFilters(notesRows, 'notes');
        papersRows = applyDomainFilters(papersRows, 'papers');

        if (notesLane === 'risk') {
          notesRows = notesRows.filter((item) => Number(item.duplicate_score || 0) >= 60 || Number(item.quality_score || 100) <= 45);
        }
        if (papersLane === 'risk') {
          papersRows = papersRows.filter((item) => Number(item.duplicate_score || 0) >= 60 || Number(item.quality_score || 100) <= 45);
        }

        renderContributionsTable('contributionsNotesTableBody', notesRows, 'notes');
        renderContributionsTable('contributionsPapersTableBody', papersRows, 'papers');
        renderContributionOverview(analyticsRes || {}, notesRows, papersRows);
      } catch (error) {
        const notesNode = document.getElementById('contributionsNotesTableBody');
        const papersNode = document.getElementById('contributionsPapersTableBody');
        if (notesNode) notesNode.innerHTML = `<tr><td colspan="9" class="message error">Failed to load student notes pipeline: ${error.message}</td></tr>`;
        if (papersNode) papersNode.innerHTML = `<tr><td colspan="9" class="message error">Failed to load student papers pipeline: ${error.message}</td></tr>`;
      }
    }

    function selectedContributionIds() {
      const activeTarget = document.querySelector('#contributionDomainTabs .contrib-lane-btn.active')?.dataset?.target || 'notesPipelinePanel';
      const activePanel = document.getElementById(activeTarget);
      const selector = activePanel ? '#'+activeTarget+' .contrib-select:checked' : '.contrib-select:checked';
      return Array.from(document.querySelectorAll(selector))
        .map(el => Number(el.value))
        .filter(id => Number.isInteger(id) && id > 0);
    }

    function selectedContributorIds() {
      return Array.from(document.querySelectorAll('.contributor-select:checked'))
        .map(el => Number(el.value))
        .filter(id => Number.isInteger(id) && id > 0);
    }

    function escapeHtml(text) {
      return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function detectPreviewKind(fileUrl, previewUrl) {
      const target = String(previewUrl || fileUrl || '').toLowerCase();
      if (target.endsWith('.pdf')) return 'pdf';
      if (/(\.png|\.jpg|\.jpeg|\.webp)$/i.test(target)) return 'image';
      return 'other';
    }

    function renderContributionOverview(analytics, notesRows, papersRows) {
      const node = document.getElementById('contributionOverview');
      if (!node) return;

      const totals = analytics.totals || {};
      const ratioBase = Number(totals.approved || 0) + Number(totals.rejected || 0);
      const rejectionRatio = ratioBase > 0 ? Math.round((Number(totals.rejected || 0) / ratioBase) * 100) : 0;
      const notesCount = Array.isArray(notesRows) ? notesRows.length : 0;
      const papersCount = Array.isArray(papersRows) ? papersRows.length : 0;
      const pendingApprovals = Number(totals.pending || 0);
      const totalStudentUploads = Number(totals.total || 0);

      node.innerHTML = `
        <div class="stat-card"><h3>Total Student Uploads</h3><div class="value">${totalStudentUploads}</div></div>
        <div class="stat-card"><h3>Student Notes</h3><div class="value">${notesCount}</div></div>
        <div class="stat-card"><h3>Student Question Papers</h3><div class="value">${papersCount}</div></div>
        <div class="stat-card"><h3>Pending Approvals</h3><div class="value">${pendingApprovals}</div></div>
        <div class="stat-card"><h3>Rejection Ratio</h3><div class="value">${rejectionRatio}%</div></div>
        <div class="stat-card"><h3>Risk Items</h3><div class="value">${Number(totals.duplicate_risk || 0) + Number(totals.quality_risk || 0)}</div></div>
      `;

      const insights = document.getElementById('contributionInsights');
      if (!insights) return;

      const topContributors = (analytics.topContributors || []).slice(0, 3).map(c => `${c.full_name} (${c.contribution_points})`).join(', ');
      const topSubjects = (analytics.mostUploadedSubjects || []).slice(0, 4).map(s => `${s.subject_name} (${s.total})`).join(', ');
      const notesPending = notesRows.filter((x) => String(x.status || '') === 'pending').length;
      const papersPending = papersRows.filter((x) => String(x.status || '') === 'pending').length;

      insights.innerHTML = `
        <div><strong>Top Contributors:</strong> ${topContributors || 'No contributor data'}</div>
        <div><strong>Top Subjects:</strong> ${topSubjects || 'No subject data'}</div>
        <div><strong>Notes Pending:</strong> ${notesPending} | <strong>Papers Pending:</strong> ${papersPending}</div>
      `;
    }

    async function loadContributionGovernanceSummary() {
      try {
        const [overview, advanced, contributorsPayload] = await Promise.all([
          window.CollegeOSApi.adminContributionAnalyticsOverview(),
          window.CollegeOSApi.adminContributionAnalyticsAdvanced(),
          window.CollegeOSApi.adminContributionContributors({})
        ]);

        const totals = overview?.totals || {};
        const contributorRows = contributorsPayload?.contributors || [];
        const suspendedCount = contributorRows.filter((item) => item.contribution_upload_suspended).length;
        const duplicateRate = Number(totals.total || 0) > 0 ? Math.round((Number(totals.duplicate_risk || 0) / Number(totals.total || 1)) * 100) : 0;
        const qualityRate = Number(totals.total || 0) > 0 ? Math.round((Number(totals.quality_risk || 0) / Number(totals.total || 1)) * 100) : 0;
        const moderationTrend = (overview?.moderationActions30d || []).slice(0, 3).map((row) => `${row.action}:${row.total}`).join(', ');
        const topContributor = (overview?.topContributors || [])[0];
        const abuseSignals = (advanced?.lowQualityUploadPatterns || []).slice(0, 3).map((row) => `${row.resource_type} ${row.low_quality_rate}%`).join(', ');

        const grid = document.getElementById('governanceHealthGrid');
        if (grid) {
          grid.innerHTML = `
            <div class="stat-card"><h3>Quality Risk Rate</h3><div class="value">${qualityRate}%</div></div>
            <div class="stat-card"><h3>Duplicate Risk Rate</h3><div class="value">${duplicateRate}%</div></div>
            <div class="stat-card"><h3>Correction Queue</h3><div class="value">${totals.needs_correction || 0}</div></div>
            <div class="stat-card"><h3>Suspended Contributors</h3><div class="value">${suspendedCount}</div></div>
            <div class="stat-card"><h3>Approval Ratio</h3><div class="value">${totals.approved || 0}/${(Number(totals.approved || 0) + Number(totals.rejected || 0)) || 0}</div></div>
            <div class="stat-card"><h3>Top Contributor</h3><div class="value">${topContributor?.full_name || '-'}</div></div>
          `;
        }

        const insight = document.getElementById('governanceInsightText');
        if (insight) {
          insight.innerHTML = `
            <div><strong>Moderation Trend (30d):</strong> ${moderationTrend || 'No trend data'}</div>
            <div><strong>Abuse Detection Signals:</strong> ${abuseSignals || 'No abuse patterns detected'}</div>
            <div><strong>Contributor Performance Scope:</strong> ${contributorRows.length} active contributor profiles tracked.</div>
          `;
        }
      } catch (error) {
        const insight = document.getElementById('governanceInsightText');
        if (insight) {
          insight.textContent = `Failed to load governance summary: ${error.message}`;
        }
      }
    }

    function formatResourceType(value) {
      return String(value || '').replaceAll('_', ' ');
    }

    function formatDate(value) {
      if (!value) return '-';
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return '-';
      return d.toLocaleString();
    }

    function statusBadge(status) {
      const s = String(status || '').toLowerCase();
      if (s === 'approved') return 'success';
      if (s === 'pending') return 'warning';
      if (s === 'needs_correction') return 'info';
      return 'warning';
    }

    function renderContributionsTable(targetBodyId, items, domain) {
      const node = document.getElementById(targetBodyId);
      if (!node) return;

      if (!items.length) {
        const emptyText = domain === 'papers'
          ? 'No question paper contributions found for this pipeline state.'
          : 'No student notes contributions found for this pipeline state.';
        node.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:20px; color:#999;">${emptyText}</td></tr>`;
        return;
      }

      node.innerHTML = items.map(item => `
        <tr>
          <td><input class="contrib-select" type="checkbox" value="${item.id}" /></td>
          <td>
            <strong>${item.title}</strong>
            <div class="muted" style="font-size:11px; margin-top:4px;">${item.subject_name || '-'} | ${formatDate(item.created_at)}</div>
            <div class="muted" style="font-size:11px; margin-top:4px;">${item.exam_type || '-'} ${item.exam_session || ''}</div>
          </td>
          <td>
            <div><strong>${item.uploader_name || '-'}</strong></div>
            <div class="muted" style="font-size:11px;">${item.uploader_email || ''}</div>
            <div class="muted" style="font-size:11px;">${item.contributor_level || 'New Contributor'} | Trust ${item.contribution_trust_score || 0}</div>
          </td>
          <td>${item.college_name || '-'}</td>
          <td>
            <div>${formatResourceType(item.resource_type)}</div>
            <div class="muted" style="font-size:11px;">${item.branch_name || '-'} | ${item.semester_label || '-'}</div>
          </td>
          <td>
            <span class="badge badge-${statusBadge(item.status)}">${item.status}</span>
            ${item.is_featured ? '<span class="badge badge-info" style="margin-left:4px;">featured</span>' : ''}
            ${item.is_premium ? '<span class="badge badge-warning" style="margin-left:4px;">premium</span>' : ''}
            ${item.is_hidden ? '<span class="badge badge-warning" style="margin-left:4px;">archived</span>' : ''}
          </td>
          <td>
            <div>Q:${item.quality_score || 0} | D:${item.duplicate_score || 0}</div>
            <div class="muted" style="font-size:11px;">${Array.isArray(item.quality_flags) ? item.quality_flags.join(', ') : '-'}</div>
            <div class="muted" style="font-size:11px;">AI: ${Array.isArray(item.aiSuggestions) && item.aiSuggestions.length ? item.aiSuggestions.join(', ') : 'none'} | P:${item.priorityScore || 0}</div>
          </td>
          <td>${item.points_awarded || 0}</td>
          <td>
            <div class="action-buttons" style="flex-wrap:wrap;">
              <a class="btn-sm btn-edit" target="_blank" href="${item.file_url}">View</a>
              <button class="btn-sm btn-edit" data-action="preview-contribution" data-id="${item.id}" data-file-url="${escapeHtml(item.file_url)}" data-preview-url="${escapeHtml(item.preview_image_url || '')}">Preview</button>
              <button class="btn-sm btn-edit" data-action="moderate-contribution" data-id="${item.id}" data-moderation="approve">Approve</button>
              <button class="btn-sm btn-edit" data-action="moderate-contribution" data-id="${item.id}" data-moderation="needs_correction">Correction</button>
              <button class="btn-sm btn-delete" data-action="moderate-contribution" data-id="${item.id}" data-moderation="reject">Reject</button>
              <button class="btn-sm btn-edit" data-action="toggle-contribution" data-id="${item.id}" data-toggle="${item.is_featured ? 'unfeature' : 'feature'}">${item.is_featured ? 'Unfeature' : 'Feature'}</button>
              <button class="btn-sm btn-edit" data-action="toggle-contribution" data-id="${item.id}" data-toggle="${item.is_premium ? 'unmark_premium' : 'mark_premium'}">${item.is_premium ? 'Unpremium' : 'Premium'}</button>
              <button class="btn-sm btn-delete" data-action="toggle-contribution" data-id="${item.id}" data-toggle="${item.is_hidden ? 'unhide' : 'hide'}">${item.is_hidden ? 'Restore' : 'Archive'}</button>
              <button class="btn-sm btn-edit" data-action="edit-contribution" data-id="${item.id}">Edit</button>
              <button class="btn-sm btn-edit" data-action="open-contributor" data-user-id="${item.user_id}">Contributor</button>
            </div>
          </td>
        </tr>
        <tr id="preview-row-${item.id}" style="display:none; background:#f8fbff;">
          <td colspan="9">
            <div id="preview-box-${item.id}" style="padding:8px;"></div>
          </td>
        </tr>
      `).join('');

      const selectAll = document.getElementById('contribSelectAll');
      if (selectAll) {
        selectAll.checked = false;
        selectAll.onchange = () => {
          const activeTarget = document.querySelector('#contributionDomainTabs .contrib-lane-btn.active')?.dataset?.target || 'notesPipelinePanel';
          const activePanel = document.getElementById(activeTarget);
          const scope = activePanel || document;
          scope.querySelectorAll('.contrib-select').forEach(box => {
            box.checked = selectAll.checked;
          });
        };
      }
    }

    function inlineContributionPreview(id, fileUrl, previewUrl) {
      const row = document.getElementById(`preview-row-${id}`);
      const box = document.getElementById(`preview-box-${id}`);
      if (!row || !box) return;

      const expanded = row.style.display !== 'none';
      if (expanded) {
        row.style.display = 'none';
        box.innerHTML = '';
        return;
      }

      const kind = detectPreviewKind(fileUrl, previewUrl);
      if (kind === 'pdf') {
        box.innerHTML = `
          <div class="muted" style="margin-bottom:8px;">Inline PDF preview is disabled by security policy.</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <a class="btn-sm btn-edit" href="${fileUrl}" target="_blank" rel="noopener noreferrer">Open PDF</a>
            <a class="btn-sm btn-edit" href="${fileUrl}" download>Download PDF</a>
          </div>
        `;
      } else if (kind === 'image') {
        const src = previewUrl || fileUrl;
        box.innerHTML = `<img src="${src}" alt="Preview" style="max-width:100%; max-height:420px; object-fit:contain; border:1px solid #dbe4ef; border-radius:8px; background:#fff;" />`;
      } else {
        box.innerHTML = '<div class="muted">Inline preview available for PDF/image only. Use View to open file.</div>';
      }
      row.style.display = '';
    }

    async function runBulkContributionAction(action) {
      try {
        const ids = selectedContributionIds();
        if (!ids.length) {
          alert('Select at least one contribution first.');
          return;
        }

        let reason = '';
        if (action === 'reject' || action === 'needs_correction') {
          reason = prompt('Reason for bulk action:', '') || '';
        }

        const pointsInput = action === 'approve' ? (prompt('Bulk approved points override (optional):', '') || '') : '';
        await window.CollegeOSApi.adminBulkModerateContributions({
          ids,
          action,
          reason,
          pointsAwarded: pointsInput ? Number(pointsInput) : null
        });

        await filterContributions();
        await loadContributors();
      } catch (error) {
        alert(error.message || 'Bulk action failed');
      }
    }

    async function runBulkContributorTrust() {
      try {
        const userIds = selectedContributorIds();
        if (!userIds.length) {
          alert('Select at least one contributor first.');
          return;
        }

        const trustScore = prompt('Trust score (optional)', '');
        const level = prompt('Contributor level override (optional)', '');
        const suspendInput = prompt('Suspend uploads for selected contributors? (yes/no/skip)', 'skip');

        const payload = {
          userIds,
          trustScore: trustScore ? Number(trustScore) : null,
          contributorLevel: level || null
        };
        if (suspendInput.toLowerCase() !== 'skip') {
          payload.suspendUploads = ['yes', 'y', 'true', '1'].includes(suspendInput.toLowerCase());
          if (payload.suspendUploads) {
            payload.suspensionReason = prompt('Suspension reason (optional):', '') || '';
          }
        }

        await window.CollegeOSApi.adminBulkContributionContributorControl(payload);
        await loadContributors();
      } catch (error) {
        alert(error.message || 'Bulk contributor update failed');
      }
    }

    async function quickToggle(id, action) {
      try {
        await window.CollegeOSApi.adminModerateContribution(id, { action });
        await filterContributions();
      } catch (error) {
        alert(error.message || 'Action failed');
      }
    }

    async function moderateContribution(id, action) {
      try {
        let reason = '';
        let pointsAwarded = null;
        let moderationNotes = '';
        let isFeatured = null;
        let isPremium = null;
        let qualityScore = null;
        let usefulnessScore = null;
        let qualityFlags = '';

        if (action === 'reject' || action === 'needs_correction') {
          reason = prompt('Enter moderation reason:', '') || '';
          if (!reason) {
            alert('Reason is required for this action.');
            return;
          }
        }

        moderationNotes = prompt('Moderator notes (optional):', '') || '';

        if (action === 'approve') {
          let suggestedPoints = '';
          try {
            const suggestion = await window.CollegeOSApi.adminContributionRewardSuggestion(id);
            suggestedPoints = String(suggestion?.suggestion?.suggestedPoints || '');
          } catch (_error) {
            suggestedPoints = '';
          }

          const pointsInput = prompt('Points to award (leave blank for default auto points):', '');
          const finalPointsInput = (pointsInput !== null && String(pointsInput).trim() !== '') ? pointsInput : suggestedPoints;
          if (finalPointsInput !== null && String(finalPointsInput).trim() !== '') {
            pointsAwarded = Number(finalPointsInput);
          }

          const featureInput = prompt('Feature this resource? (yes/no/skip)', 'skip');
          if (featureInput && featureInput.toLowerCase() !== 'skip') {
            isFeatured = ['yes', 'y', 'true', '1'].includes(featureInput.toLowerCase());
          }

          const premiumInput = prompt('Mark this resource as premium? (yes/no/skip)', 'skip');
          if (premiumInput && premiumInput.toLowerCase() !== 'skip') {
            isPremium = ['yes', 'y', 'true', '1'].includes(premiumInput.toLowerCase());
          }

          const qualityInput = prompt('Quality score override (0-100, optional):', '');
          if (qualityInput !== null && String(qualityInput).trim() !== '') qualityScore = Number(qualityInput);

          const usefulInput = prompt('Usefulness score override (0-100, optional):', '');
          if (usefulInput !== null && String(usefulInput).trim() !== '') usefulnessScore = Number(usefulInput);

          qualityFlags = prompt('Quality flags CSV (optional):', '') || '';
        }

        await window.CollegeOSApi.adminModerateContribution(id, {
          action,
          reason,
          pointsAwarded,
          moderationNotes,
          isFeatured,
          isPremium,
          qualityScore,
          usefulnessScore,
          qualityFlags
        });

        await filterContributions();
        await loadContributors();
      } catch (error) {
        alert(error.message || 'Moderation failed');
      }
    }

    async function editContributionMetadata(id) {
      try {
        const payload = await window.CollegeOSApi.adminGetContributionModerationDetail(id);
        const c = payload.contribution;
        if (!c) return;

        const title = prompt('Title', c.title || '');
        if (title === null) return;
        const subjectName = prompt('Subject', c.subject_name || '');
        if (subjectName === null) return;
        const resourceType = prompt('Resource Type', c.resource_type || '');
        if (resourceType === null) return;
        const examType = prompt('Exam Type', c.exam_type || '');
        const examSession = prompt('Exam Session', c.exam_session || '');
        const qualityScoreInput = prompt('Quality Score (0-100)', String(c.quality_score || 0));
        const duplicateScoreInput = prompt('Duplicate Score (0-100)', String(c.duplicate_score || 0));
        const qualityFlags = prompt('Quality Flags CSV', Array.isArray(c.quality_flags) ? c.quality_flags.join(',') : '');
        const moderationNotes = prompt('Moderation Notes', c.moderation_notes || '');
        const isFeatured = confirm('Should this resource be featured? Click Cancel for no.');
        const isPremium = confirm('Should this resource be premium? Click Cancel for no.');
        const isHidden = confirm('Should this resource be archived/hidden? Click Cancel for no.');

        await window.CollegeOSApi.adminUpdateContributionMetadata(id, {
          title,
          subjectName,
          resourceType,
          examType: examType || null,
          examSession: examSession || null,
          qualityScore: Number(qualityScoreInput),
          duplicateScore: Number(duplicateScoreInput),
          qualityFlags,
          moderationNotes,
          isFeatured,
          isPremium,
          isHidden
        });

        await filterContributions();
      } catch (error) {
        alert(error.message || 'Metadata update failed');
      }
    }

    async function openContributorControl(userId) {
      try {
        const level = prompt('Contributor level override (optional)', '');
        const trustScore = prompt('Trust score (0-100, optional)', '');
        const isTrustedInput = prompt('Mark trusted? (yes/no/skip)', 'skip');
        const isVerifiedInput = prompt('Mark verified? (yes/no/skip)', 'skip');
        const suspendInput = prompt('Suspend uploads? (yes/no/skip)', 'skip');
        const suspensionReason = prompt('Suspension reason (optional)', '') || '';

        const payload = {
          contributorLevel: level || null,
          trustScore: trustScore ? Number(trustScore) : null,
          suspensionReason
        };

        if (isTrustedInput && isTrustedInput.toLowerCase() !== 'skip') {
          payload.isTrusted = ['yes', 'y', 'true', '1'].includes(isTrustedInput.toLowerCase());
        }
        if (isVerifiedInput && isVerifiedInput.toLowerCase() !== 'skip') {
          payload.isVerified = ['yes', 'y', 'true', '1'].includes(isVerifiedInput.toLowerCase());
        }
        if (suspendInput && suspendInput.toLowerCase() !== 'skip') {
          payload.suspendUploads = ['yes', 'y', 'true', '1'].includes(suspendInput.toLowerCase());
        }

        await window.CollegeOSApi.adminControlContributionContributor(userId, payload);

        const adjustInput = prompt('Optional point adjustment (e.g. 20 or -10). Leave blank to skip.', '');
        if (adjustInput !== null && String(adjustInput).trim() !== '') {
          await window.CollegeOSApi.adminAdjustContributionPoints(userId, {
            pointsDelta: Number(adjustInput),
            reason: 'manual_admin_contributor_adjustment'
          });
        }

        await loadContributors();
        await filterContributions();
      } catch (error) {
        alert(error.message || 'Contributor control update failed');
      }
    }

    async function loadContributors() {
      try {
        const [payload, performance] = await Promise.all([
          window.CollegeOSApi.adminContributionContributors({
            search: document.getElementById('contributorSearchFilter').value.trim(),
            status: document.getElementById('contributorStatusFilter').value
          }),
          window.CollegeOSApi.adminContributionContributorPerformance()
        ]);

        const perfMap = new Map((performance.contributors || []).map(item => [Number(item.id), item]));

        const node = document.getElementById('contributorsTableBody');
        const rows = payload.contributors || [];
        if (!rows.length) {
          node.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:20px; color:#999;">No contributors found</td></tr>';
          return;
        }

        node.innerHTML = rows.map(row => `
          <tr>
            <td><input class="contributor-select" type="checkbox" value="${row.id}" /></td>
            <td>
              <strong>${row.full_name || '-'}</strong>
              <div class="muted" style="font-size:11px;">${row.email || '-'}</div>
            </td>
            <td>${row.college_name || '-'}</td>
            <td>${row.contributor_level || 'New Contributor'}</td>
            <td>${row.contribution_trust_score || 0}${row.contribution_upload_suspended ? ' (Suspended)' : ''}</td>
            <td>${row.total_submissions || 0}</td>
            <td>${row.approved_submissions || 0}</td>
            <td>${(perfMap.get(Number(row.id))?.approval_rate ?? 0)}%</td>
            <td>${(perfMap.get(Number(row.id))?.rejection_rate ?? 0)}%</td>
            <td>
              <div class="action-buttons">
                <button class="btn-sm btn-edit" data-action="open-contributor" data-user-id="${row.id}">Control</button>
              </div>
            </td>
          </tr>
        `).join('');
      } catch (error) {
        document.getElementById('contributorsTableBody').innerHTML =
          `<tr><td colspan="10" class="message error">Failed to load contributors: ${error.message}</td></tr>`;
      }
    }

    async function loadContributionConfig() {
      try {
        const payload = await window.CollegeOSApi.adminGetContributionConfig();
        const cfg = payload.config || {};
        const allow = cfg.allowByType || {};
        const visibility = cfg.visibility || {};
        const seasonalControl = cfg.seasonalControl || {};

        document.getElementById('cfgContribEnabled').checked = cfg.enabled !== false;
        document.getElementById('cfgContribEntry').checked = visibility.showHubEntryPoint !== false;
        document.getElementById('cfgSeasonalEnabled').checked = seasonalControl.enabled === true;
        document.getElementById('cfgTypeNotes').checked = Boolean(allow.class_notes || allow.handwritten_notes);
        document.getElementById('cfgTypePapers').checked = Boolean(allow.mst1_paper || allow.mst2_paper || allow.final_exam_paper || allow.pyq);
        document.getElementById('cfgTypeAssignments').checked = Boolean(allow.assignment || allow.other);
        document.getElementById('cfgTypeLabs').checked = Boolean(allow.lab_file);
        document.getElementById('cfgTypeOther').checked = Boolean(allow.other);
        document.getElementById('cfgCampaignLabel').value = seasonalControl.examCampaignLabel || '';
        document.getElementById('cfgCampaignMessage').value = seasonalControl.campaignMessage || '';
        document.getElementById('contribConfigStatus').textContent = '';
      } catch (error) {
        document.getElementById('contribConfigStatus').textContent = error.message;
      }
    }

    async function saveContributionConfig() {
      try {
        const enabled = document.getElementById('cfgContribEnabled').checked;
        const showHubEntryPoint = document.getElementById('cfgContribEntry').checked;
        const seasonalEnabled = document.getElementById('cfgSeasonalEnabled').checked;
        const notesEnabled = document.getElementById('cfgTypeNotes').checked;
        const papersEnabled = document.getElementById('cfgTypePapers').checked;
        const assignmentsEnabled = document.getElementById('cfgTypeAssignments').checked;
        const labsEnabled = document.getElementById('cfgTypeLabs').checked;
        const otherEnabled = document.getElementById('cfgTypeOther').checked;
        const campaignLabel = document.getElementById('cfgCampaignLabel').value.trim();
        const campaignMessage = document.getElementById('cfgCampaignMessage').value.trim();

        await window.CollegeOSApi.adminUpdateContributionConfig({
          enabled,
          visibility: {
            showHubEntryPoint
          },
          seasonalControl: {
            enabled: seasonalEnabled,
            mode: seasonalEnabled ? 'exam' : 'normal',
            examCampaignLabel: campaignLabel,
            campaignMessage
          },
          allowByType: {
            class_notes: notesEnabled,
            handwritten_notes: notesEnabled,
            mst1_paper: papersEnabled,
            mst2_paper: papersEnabled,
            final_exam_paper: papersEnabled,
            pyq: papersEnabled,
            assignment: assignmentsEnabled,
            lab_file: labsEnabled,
            other: otherEnabled
          }
        });

        document.getElementById('contribConfigStatus').textContent = 'Contribution controls saved successfully.';
        await filterContributions();
      } catch (error) {
        document.getElementById('contribConfigStatus').textContent = error.message || 'Failed to save contribution controls.';
      }
    }

    async function loadArchiveIntelligence() {
      try {
        const payload = await window.CollegeOSApi.adminContributionArchiveIntelligence();
        const data = payload.archiveSuggestions || {};
        const duplicateRows = (data.duplicateCandidates || []).slice(0, 5);
        const lowValueRows = (data.lowValueCandidates || []).slice(0, 5);
        const bestRows = (data.bestVersionCandidates || []).slice(0, 5);
        const duplicate = duplicateRows.map(x => `#${x.id} ${x.title}`).join(', ');
        const lowValue = lowValueRows.map(x => `#${x.id} ${x.title}`).join(', ');
        const best = bestRows.map(x => `#${x.id} ${x.title}`).join(', ');
        document.getElementById('archiveIntelView').innerHTML = `
          <div><strong>Duplicate Candidates:</strong> ${duplicate || 'None'}</div>
          <div><strong>Low-Value Archive Candidates:</strong> ${lowValue || 'None'}</div>
          <div><strong>Best Version Suggestions:</strong> ${best || 'None'}</div>
          <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-primary" data-action="merge-duplicate-set">Merge Duplicates</button>
            <button class="btn-primary" data-action="archive-low-value-set">Archive Low-Value Set</button>
            <button class="btn-primary" data-action="highlight-best-version">Highlight Best Version</button>
          </div>
        `;
      } catch (error) {
        document.getElementById('archiveIntelView').textContent = `Failed to load archive intelligence: ${error.message}`;
      }
    }

    async function mergeDuplicateSet() {
      const source = prompt('Enter duplicate IDs to merge (comma-separated):', '');
      const target = prompt('Enter target contribution ID (best version):', '');
      if (!source || !target) return;
      try {
        await window.CollegeOSApi.adminContributionMergeDuplicates({
          sourceIds: source,
          targetId: Number(target)
        });
        await Promise.all([filterContributions(), loadArchiveIntelligence(), loadContributionAuditLogs()]);
      } catch (error) {
        alert(error.message || 'Duplicate merge failed');
      }
    }

    async function archiveLowValueSet() {
      try {
        const payload = await window.CollegeOSApi.adminContributionArchiveIntelligence();
        const ids = (payload.archiveSuggestions?.lowValueCandidates || []).slice(0, 20).map(item => item.id);
        if (!ids.length) {
          alert('No low-value candidates found.');
          return;
        }
        await window.CollegeOSApi.adminBulkModerateContributions({ ids, action: 'archive', reason: 'archive_intelligence_low_value' });
        await Promise.all([filterContributions(), loadArchiveIntelligence(), loadContributionAuditLogs()]);
      } catch (error) {
        alert(error.message || 'Low-value archive action failed');
      }
    }

    async function highlightBestVersionPrompt() {
      const id = prompt('Enter contribution ID to mark as best version:', '');
      if (!id) return;
      try {
        await window.CollegeOSApi.adminContributionHighlightBestVersion(Number(id));
        await Promise.all([filterContributions(), loadArchiveIntelligence(), loadContributionAuditLogs()]);
      } catch (error) {
        alert(error.message || 'Failed to highlight best version');
      }
    }

    async function loadContributionAdvancedAnalytics() {
      try {
        const payload = await window.CollegeOSApi.adminContributionAnalyticsAdvanced();
        const subjects = (payload.subjectDemandTrends || []).slice(0, 5).map(x => `${x.subject_name} (${x.downloads})`).join(', ');
        const exams = (payload.examWiseUsage || []).slice(0, 5).map(x => `${x.exam_type} (${x.downloads})`).join(', ');
        const useful = (payload.topUsefulResources || []).slice(0, 5).map(x => `#${x.id} ${x.title}`).join(', ');
        const patterns = (payload.lowQualityUploadPatterns || []).slice(0, 5).map(x => `${x.resource_type}: ${x.low_quality_rate}%`).join(', ');

        document.getElementById('advancedAnalyticsView').innerHTML = `
          <div><strong>Subject Demand:</strong> ${subjects || 'No data'}</div>
          <div><strong>Exam-wise Usage:</strong> ${exams || 'No data'}</div>
          <div><strong>Top Useful Resources:</strong> ${useful || 'No data'}</div>
          <div><strong>Low-Quality Patterns:</strong> ${patterns || 'No data'}</div>
        `;
      } catch (error) {
        document.getElementById('advancedAnalyticsView').textContent = `Failed to load advanced analytics: ${error.message}`;
      }
    }

    async function loadContributionAuditLogs() {
      try {
        const payload = await window.CollegeOSApi.adminContributionAuditLogs(60);
        const rows = payload.logs || [];
        if (!rows.length) {
          document.getElementById('auditLogsView').textContent = 'No audit logs found.';
          return;
        }

        document.getElementById('auditLogsView').innerHTML = rows.slice(0, 15).map(log => {
          return `<div style="margin-bottom:6px;"><strong>${log.action}</strong> | ${new Date(log.created_at).toLocaleString()} | actor: ${log.actor_name || 'system'} | contribution: ${log.contribution_id || '-'} <button class="btn-sm btn-edit" data-action="rollback-contribution" data-id="${log.contribution_id || 0}">Rollback</button></div>`;
        }).join('');
      } catch (error) {
        document.getElementById('auditLogsView').textContent = `Failed to load audit logs: ${error.message}`;
      }
    }

    async function rollbackContribution(id) {
      if (!id) return;
      if (!confirm(`Rollback last moderation action for contribution #${id}?`)) return;
      try {
        await window.CollegeOSApi.adminRollbackContributionModeration(id);
        await filterContributions();
        await loadContributionAuditLogs();
      } catch (error) {
        alert(error.message || 'Rollback failed');
      }
    }

    let lastFocusedContributionId = null;
    document.addEventListener('click', async (event) => {
      const bulkButton = event.target.closest('[data-bulk-action]');
      if (bulkButton) {
        event.preventDefault();
        await runBulkContributionAction(bulkButton.dataset.bulkAction);
        return;
      }

      const applyFiltersButton = event.target.closest('#applyNotesFiltersBtn, #applyPapersFiltersBtn');
      if (applyFiltersButton) {
        event.preventDefault();
        await filterContributions();
        return;
      }

      const actionButton = event.target.closest('[data-action]');
      if (!actionButton) return;

      event.preventDefault();
      const action = actionButton.dataset.action;

      if (action === 'edit-note') {
        editNote(Number(actionButton.dataset.noteId));
        return;
      }

      if (action === 'delete-note') {
        deleteNote(Number(actionButton.dataset.noteId));
        return;
      }

      if (action === 'edit-quiz') {
        editQuiz(Number(actionButton.dataset.quizId));
        return;
      }

      if (action === 'delete-quiz') {
        deleteQuiz(Number(actionButton.dataset.quizId));
        return;
      }

      if (action === 'preview-contribution') {
        inlineContributionPreview(
          Number(actionButton.dataset.id),
          actionButton.dataset.fileUrl || '',
          actionButton.dataset.previewUrl || ''
        );
        return;
      }

      if (action === 'moderate-contribution') {
        const contributionId = Number(actionButton.dataset.id);
        if (Number.isInteger(contributionId) && contributionId > 0) {
          lastFocusedContributionId = contributionId;
        }
        await moderateContribution(contributionId, actionButton.dataset.moderation || 'pending');
        return;
      }

      if (action === 'toggle-contribution') {
        const contributionId = Number(actionButton.dataset.id);
        if (Number.isInteger(contributionId) && contributionId > 0) {
          lastFocusedContributionId = contributionId;
        }
        await quickToggle(contributionId, actionButton.dataset.toggle || 'feature');
        return;
      }

      if (action === 'edit-contribution') {
        const contributionId = Number(actionButton.dataset.id);
        if (Number.isInteger(contributionId) && contributionId > 0) {
          lastFocusedContributionId = contributionId;
        }
        await editContributionMetadata(contributionId);
        return;
      }

      if (action === 'open-contributor') {
        await openContributorControl(Number(actionButton.dataset.userId));
        return;
      }

      if (action === 'merge-duplicate-set') {
        await mergeDuplicateSet();
        return;
      }

      if (action === 'archive-low-value-set') {
        await archiveLowValueSet();
        return;
      }

      if (action === 'highlight-best-version') {
        await highlightBestVersionPrompt();
        return;
      }

      if (action === 'rollback-contribution') {
        await rollbackContribution(Number(actionButton.dataset.id));
      }
    });

    document.addEventListener('keydown', async (event) => {
      if (!lastFocusedContributionId) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      try {
        if (event.key === 'a') {
          event.preventDefault();
          await moderateContribution(lastFocusedContributionId, 'approve');
        }
        if (event.key === 'r') {
          event.preventDefault();
          await moderateContribution(lastFocusedContributionId, 'reject');
        }
        if (event.key === 'c') {
          event.preventDefault();
          await moderateContribution(lastFocusedContributionId, 'needs_correction');
        }
        if (event.key === 'f') {
          event.preventDefault();
          await quickToggle(lastFocusedContributionId, 'feature');
        }
        if (event.key === 'h') {
          event.preventDefault();
          await quickToggle(lastFocusedContributionId, 'hide');
        }
      } catch (_error) {
        // Keep keyboard workflow non-blocking.
      }
    });

    async function loadAnalytics() {
      try {
        const data = await window.CollegeOSApi.adminGetAcademicsDashboard();
        renderAnalytics(data);
      } catch (error) {
        console.error('Failed to load analytics:', error);
        document.getElementById('analyticsContent').innerHTML =
          `<div class="message error">Failed to load analytics: ${error.message}</div>`;
      }
    }

    function renderAnalytics(data) {
      let html = '<h3>Students by Branch</h3>';
      html += '<table style="margin-bottom: 30px;"><thead><tr><th>Category</th><th>Branch</th><th>Students</th></tr></thead><tbody>';
      data.studentsByBranch.forEach(row => {
        html += `<tr><td>${row.category}</td><td>${row.branch || '-'}</td><td>${row.student_count || 0}</td></tr>`;
      });
      html += '</tbody></table>';

      html += '<h3>Content by Branch</h3>';
      html += '<table style="margin-bottom: 30px;"><thead><tr><th>Branch</th><th>Notes</th><th>Quizzes</th><th>Papers</th></tr></thead><tbody>';
      data.contentByBranch.forEach(row => {
        html += `<tr><td>${row.branch}</td><td>${row.notes || 0}</td><td>${row.quizzes || 0}</td><td>${row.papers || 0}</td></tr>`;
      });
      html += '</tbody></table>';

      html += '<h3>Active Users by Branch</h3>';
      html += '<table><thead><tr><th>Category</th><th>Branch</th><th>Active Users</th></tr></thead><tbody>';
      data.activeUsers.forEach(row => {
        html += `<tr><td>${row.category}</td><td>${row.branch || '-'}</td><td>${row.users_attempted_quizzes || 0}</td></tr>`;
      });
      html += '</tbody></table>';

      document.getElementById('analyticsContent').innerHTML = html;
    }

    function showCreateNoteForm() {
      alert('Create note form - To be implemented');
    }

    function showCreateQuizForm() {
      alert('Create quiz form - To be implemented');
    }

    function editNote(noteId) {
      alert(`Edit note ${noteId} - To be implemented`);
    }

    function deleteNote(noteId) {
      if (confirm('Are you sure you want to delete this note?')) {
        // Implement delete
      }
    }

    function editQuiz(quizId) {
      alert(`Edit quiz ${quizId} - To be implemented`);
    }

    function deleteQuiz(quizId) {
      if (confirm('Are you sure you want to delete this quiz?')) {
        // Implement delete
      }
    }
  
