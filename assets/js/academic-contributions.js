(function () {
  const QUESTION_TYPES = new Set(['mst1_paper', 'mst2_paper', 'final_exam_paper', 'pyq']);

  const state = {
    config: null,
    collections: [],
    selectedCollectionId: null
  };
  let uploadPreviewObjectUrl = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const node = byId(id);
    if (node) node.textContent = value;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function statusClass(status) {
    return `status-${String(status || '').toLowerCase()}`;
  }

  function formatDate(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function humanizeResourceType(type) {
    return String(type || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function debounce(fn, delay) {
    let timeout;
    return function debounced(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), delay);
    };
  }

  /**
   * INSTANT SEARCH: Display real-time search suggestions and results.
   */
  let lastInstantSearchQuery = '';

  async function loadInstantSearch(query) {
    const q = String(query || '').trim();
    const dropdown = byId('instantSearchDropdown');
    if (!dropdown) return;

    if (!q || q === lastInstantSearchQuery) {
      dropdown.classList.add('hidden');
      return;
    }

    lastInstantSearchQuery = q;

    try {
      const payload = await window.CollegeOSApi.getContributionInstantSearch(q);
      const results = payload?.results || [];
      const suggestions = payload?.suggestions || {};

      if (!results.length && !suggestions.subjectSuggestions?.length) {
        dropdown.innerHTML = '<div class="instant-search-item"><em>No results found</em></div>';
        dropdown.classList.remove('hidden');
        return;
      }

      let html = '';

      if (suggestions.correctedQuery) {
        html += `<div class="instant-search-item" style="background:#f0f8ff;padding:0.5rem;"><strong>Did you mean?</strong><br/><em>${escapeHtml(suggestions.correctedQuery)}</em></div>`;
      }

      if (Array.isArray(suggestions.subjectSuggestions) && suggestions.subjectSuggestions.length > 0) {
        html += `<div class="instant-search-item" style="background:#f5f5f5;padding:0.5rem;"><strong>Suggested Subjects</strong></div>`;
        suggestions.subjectSuggestions.forEach((subj) => {
          html += `<div class="instant-search-item" data-instant-subject="${escapeHtml(subj)}"><em>${escapeHtml(subj)}</em></div>`;
        });
      }

      if (results.length > 0) {
        html += `<div class="instant-search-item" style="background:#f5f5f5;padding:0.5rem;"><strong>Resources (${results.length})</strong></div>`;
        results.slice(0, 8).forEach((res) => {
          const badges = (res.badges || []).map((b) => `<span class="contrib-pill">${escapeHtml(String(b).replace(/_/g, ' '))}</span>`).join('');
          html += `<div class="instant-search-item" data-instant-id="${res.id}">
            <strong>${escapeHtml(res.title)}</strong>
            <div class="muted">${escapeHtml(res.subject_name || '-')} | ${res.download_count || 0} downloads</div>
            <div class="contrib-pills">${badges}</div>
          </div>`;
        });
      }

      dropdown.innerHTML = html;
      dropdown.classList.remove('hidden');

      dropdown.querySelectorAll('[data-instant-id]').forEach((item) => {
        item.addEventListener('click', () => {
          byId('librarySearchFilter').value = '';
          dropdown.classList.add('hidden');
          lastInstantSearchQuery = '';
          loadLibrary();
        });
      });

      dropdown.querySelectorAll('[data-instant-subject]').forEach((item) => {
        item.addEventListener('click', () => {
          const subj = item.getAttribute('data-instant-subject');
          byId('librarySubjectFilter').value = subj;
          byId('librarySearchFilter').value = '';
          dropdown.classList.add('hidden');
          lastInstantSearchQuery = '';
          loadLibrary();
        });
      });
    } catch (error) {
      dropdown.innerHTML = `<div class="instant-search-item"><em>${escapeHtml(error.message || 'Search error')}</em></div>`;
      dropdown.classList.remove('hidden');
    }
  }

  /**
   * COMMUNITY: Render and interact with resource comments, Q&A threads.
   */
  async function loadAndShowCommunity(resourceId) {
    try {
      const payload = await window.CollegeOSApi.getContributionCommunity(resourceId);
      const comments = payload?.comments || [];
      renderCommunityPanel(resourceId, comments);
    } catch (error) {
      console.warn('Community not available:', error.message);
    }
  }

  function renderCommunityPanel(resourceId, comments) {
    const mount = byId(`community-panel-${resourceId}`);
    if (!mount) return;

    const rootComments = comments.filter((c) => !c.parent_comment_id);

    let html = '<div style="margin-bottom: 0.75rem;"><strong>Discussion & Questions</strong></div>';

    if (!rootComments.length) {
      html += '<div class="muted">No comments yet. Be the first to ask a question!</div>';
    } else {
      rootComments.forEach((thread) => {
        const kindLabel = thread.kind === 'question' ? '❓' : thread.kind === 'answer' ? '✓' : '💬';
        const isAnswer = thread.kind === 'answer';
        const replies = comments.filter((c) => c.parent_comment_id === thread.id);

        html += `<div class="community-comment ${isAnswer ? 'is-answer' : ''}">
          <div style="display:flex;gap:0.5rem;align-items:start;">
            <span>${kindLabel}</span>
            <div style="flex:1;">
              <div><strong>${escapeHtml(thread.user_full_name || 'Anonymous')}</strong></div>
              <div class="muted">${escapeHtml(thread.body)}</div>
              <div class="contrib-pills" style="margin-top:0.35rem;">
                <span class="contrib-pill">👍 ${thread.upvote_count || 0}</span>
                <button class="contrib-pill" data-upvote-comment="${thread.id}" style="border:none;background:transparent;cursor:pointer;">Helpful</button>
              </div>`;

        replies.forEach((reply) => {
          html += `<div style="margin-top:0.5rem;padding-left:0.75rem;border-left:2px solid rgba(0,0,0,0.1);">
            <div><strong>${escapeHtml(reply.user_full_name || 'Anonymous')}</strong></div>
            <div class="muted">${escapeHtml(reply.body)}</div>
          </div>`;
        });

        html += `</div></div>`;
      });
    }

    html += `<div style="margin-top:0.75rem;border-top:1px solid rgba(0,0,0,0.08);padding-top:0.75rem;">
      <textarea id="communityCommentText-${resourceId}" maxlength="1000" placeholder="Ask a question or share insights..." style="width:100%;padding:0.5rem;border:1px solid rgba(0,0,0,0.12);border-radius:6px;font-family:inherit;font-size:0.9rem;min-height:60px;"></textarea>
      <div style="margin-top:0.45rem;display:flex;gap:0.45rem;">
        <select id="communityCommentKind-${resourceId}" style="padding:0.45rem;border:1px solid rgba(0,0,0,0.12);border-radius:6px;">
          <option value="comment">Comment</option>
          <option value="question">Question</option>
          <option value="answer">Answer</option>
        </select>
        <button class="btn primary" data-post-comment="${resourceId}" style="flex:1;">Post</button>
      </div>
    </div>`;

    mount.innerHTML = html;
    mount.classList.add('active');

    mount.querySelectorAll('[data-upvote-comment]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const commentId = Number(btn.getAttribute('data-upvote-comment'));
        try {
          await window.CollegeOSApi.upvoteContributionCommunityComment(commentId);
          await loadAndShowCommunity(resourceId);
        } catch (error) {
          alert(error.message || 'Could not upvote comment.');
        }
      });
    });

    const postBtn = mount.querySelector(`[data-post-comment="${resourceId}"]`);
    if (postBtn) {
      postBtn.addEventListener('click', async () => {
        const text = byId(`communityCommentText-${resourceId}`)?.value?.trim() || '';
        const kind = byId(`communityCommentKind-${resourceId}`)?.value || 'comment';
        if (!text) {
          alert('Please write a comment.');
          return;
        }
        try {
          await window.CollegeOSApi.postContributionCommunity(resourceId, { kind, body: text });
          await loadAndShowCommunity(resourceId);
        } catch (error) {
          alert(error.message || 'Could not post comment.');
        }
      });
    }
  }

  /**
   * AI INSIGHTS: Display auto-extracted summary, key points, Q&A, revision guide.
   */
  async function loadAndShowAiInsights(resourceId) {
    try {
      const payload = await window.CollegeOSApi.getContributionAiInsights(resourceId);
      renderAiInsightsPanel(resourceId, payload);
    } catch (error) {
      console.warn('AI insights not available:', error.message);
    }
  }

  function renderAiInsightsPanel(resourceId, insights) {
    const mount = byId(`ai-insights-panel-${resourceId}`);
    if (!mount) return;

    const summary = insights?.summary || '';
    const keyPoints = insights?.keyPoints || [];
    const importantQuestions = insights?.importantQuestions || [];
    const revisionMode = insights?.revisionMode || '';

    let html = '<div style="margin-bottom: 0.75rem;"><strong>🤖 AI-Powered Insights</strong></div>';

    if (summary) {
      html += `<div><strong>Quick Summary</strong><div class="muted">${escapeHtml(summary)}</div></div>`;
    }

    if (keyPoints.length > 0) {
      html += `<div style="margin-top:0.5rem;"><strong>Key Points</strong><ul style="margin:0.35rem 0;padding-left:1.2rem;">`;
      keyPoints.forEach((pt) => {
        html += `<li class="muted">${escapeHtml(pt)}</li>`;
      });
      html += `</ul></div>`;
    }

    if (importantQuestions.length > 0) {
      html += `<div style="margin-top:0.5rem;"><strong>Important Questions</strong><ul style="margin:0.35rem 0;padding-left:1.2rem;">`;
      importantQuestions.forEach((q) => {
        html += `<li class="muted">${escapeHtml(q)}</li>`;
      });
      html += `</ul></div>`;
    }

    if (revisionMode) {
      html += `<div style="margin-top:0.5rem;background:rgba(76,175,80,0.1);padding:0.6rem;border-radius:6px;"><strong>Quick Revision</strong><div class="muted">${escapeHtml(revisionMode)}</div></div>`;
    }

    mount.innerHTML = html;
    mount.classList.add('active');
  }

  /**
   * GROWTH: Display milestone progress, unlocked rewards, contribution status.
   */
  async function loadAndShowGrowth() {
    try {
      const payload = await window.CollegeOSApi.getContributionGrowthStatus();
      renderGrowthTracker(payload);
    } catch (error) {
      console.warn('Growth status not available:', error.message);
    }
  }

  function renderGrowthTracker(growth) {
    const mount = byId('growthTrackerMount');
    if (!mount) return;

    const milestones = growth?.milestones || [];

    let html = '<div style="margin-bottom: 0.75rem;"><strong>🏆 Growth Milestones</strong></div>';

    if (!milestones.length) {
      html += '<div class="muted">No milestones available yet.</div>';
    } else {
      milestones.forEach((ms) => {
        const percentDone = Math.min(100, Math.round((ms.progress || 0) * 100));
        const isComplete = ms.isComplete ? '✓ Unlocked!' : `${percentDone}%`;
        const rewardLabel = ms.rewardPoints ? `+${ms.rewardPoints} pts` : '';

        html += `<div class="milestone-item">
          <div style="flex:1;">
            <strong>${escapeHtml(ms.label || ms.eventKey)}</strong>
            <div class="muted">${escapeHtml(ms.description || '')}</div>
          </div>
          <div style="min-width:200px;">
            <div class="milestone-bar">
              <div class="milestone-bar-fill" style="width:${percentDone}%"></div>
            </div>
          </div>
          <span class="contrib-pill" style="min-width:100px;text-align:center;">${isComplete} ${rewardLabel}</span>
        </div>`;
      });
    }

    mount.innerHTML = html;
  }

  /**
   * DOWNLOAD INTELLIGENCE: Show download trends, exam spikes, library insights.
   */
  async function loadAndShowDownloadIntelligence() {
    try {
      const payload = await window.CollegeOSApi.getContributionDownloadIntelligence(30);
      renderDownloadIntelligence(payload);
    } catch (error) {
      console.warn('Download intelligence not available:', error.message);
    }
  }

  function renderDownloadIntelligence(intel) {
    const mount = byId('downloadIntelligenceMount');
    if (!mount) return;

    const trending = intel?.trendingBySubject || [];
    const examSpikes = intel?.examSpikes || [];
    const mostDownloaded = intel?.mostDownloadedBeforeExam || [];

    let html = '<div><strong>📊 Download Intelligence</strong></div>';

    if (trending.length > 0) {
      html += `<div style="margin-top:0.5rem;"><strong>Trending Subjects</strong><div class="contrib-pills">`;
      trending.slice(0, 5).forEach((t) => {
        html += `<span class="contrib-pill">${escapeHtml(t.subject_name)} (${t.download_count})</span>`;
      });
      html += `</div></div>`;
    }

    if (examSpikes.length > 0) {
      html += `<div style="margin-top:0.5rem;"><strong>Exam-Time Activity</strong><div class="muted">`;
      examSpikes.forEach((spike) => {
        html += `<div>${escapeHtml(spike.subject_name)}: ${spike.spike_factor || 1}x normal (${spike.download_count || 0} downloads)</div>`;
      });
      html += `</div></div>`;
    }

    if (mostDownloaded.length > 0) {
      html += `<div style="margin-top:0.5rem;"><strong>Most Downloaded Before Exams</strong><ul style="margin:0.35rem 0;padding-left:1.2rem;">`;
      mostDownloaded.slice(0, 5).forEach((md) => {
        html += `<li class="muted">${escapeHtml(md.title)} (${md.download_count} downloads)</li>`;
      });
      html += `</ul></div>`;
    }

    mount.innerHTML = html;
  }

  function canUseImageAsResource(resourceType) {
    return /(handwritten|notes|lab|assignment|other)/.test(String(resourceType || ''));
  }

  function detectFileKind(fileName, mime) {
    const lowerName = String(fileName || '').toLowerCase();
    const lowerMime = String(mime || '').toLowerCase();
    if (lowerMime.includes('pdf') || lowerName.endsWith('.pdf')) return 'pdf';
    if (lowerMime.startsWith('image/') || /\.(png|jpg|jpeg|webp)$/i.test(lowerName)) return 'image';
    return 'other';
  }

  function renderBadges(badges) {
    if (!Array.isArray(badges) || !badges.length) return '';
    return badges.map((badge) => `<span class="badge-chip">${escapeHtml(String(badge).replace(/_/g, ' '))}</span>`).join('');
  }

  function syncUploadPreview(file) {
    const pdf = byId('uploadPdfPreview');
    const img = byId('uploadImagePreview');
    const pdfLink = byId('uploadPdfPreviewLink');
    const hint = byId('uploadPreviewHint');
    if (!pdf || !img || !pdfLink || !hint) return;

    if (uploadPreviewObjectUrl) {
      URL.revokeObjectURL(uploadPreviewObjectUrl);
      uploadPreviewObjectUrl = null;
    }

    pdf.classList.add('hidden');
    pdf.removeAttribute('src');
    pdfLink.classList.add('hidden');
    pdfLink.removeAttribute('href');
    img.classList.add('hidden');
    img.removeAttribute('src');

    if (!file) {
      hint.textContent = 'Select a file to preview PDF/image before submission.';
      return;
    }

    const kind = detectFileKind(file.name, file.type);
    const objectUrl = URL.createObjectURL(file);
    uploadPreviewObjectUrl = objectUrl;
    hint.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;

    if (kind === 'pdf') {
      // CSP blocks blob frames; provide safe open/download link instead.
      pdfLink.href = objectUrl;
      pdfLink.classList.remove('hidden');
      return;
    }

    if (kind === 'image') {
      img.src = objectUrl;
      img.classList.remove('hidden');
      return;
    }

    hint.textContent = `${file.name} selected. Inline preview is available for PDF/images only.`;
  }

  async function loadProfileDefaults() {
    try {
      const payload = await window.CollegeOSApi.getStudentAcademicProfile();
      const profile = payload?.profile;
      if (!profile) return null;

      if (profile.categoryId) byId('contribCategory').value = String(profile.categoryId);
      if (profile.semesterId) byId('contribSemester').value = String(profile.semesterId);
      return profile;
    } catch {
      return null;
    }
  }

  function renderContributionTypes(types, config) {
    const resourceSelect = byId('contribResourceType');
    const libraryType = byId('libraryTypeFilter');
    if (!resourceSelect || !libraryType) return;

    resourceSelect.innerHTML = '<option value="">Select Resource Type</option>';
    libraryType.innerHTML = '<option value="">All Types</option>';

    const allowByType = config?.allowByType || {};

    (types || []).forEach((type) => {
      if (allowByType[type] === false) return;
      const label = humanizeResourceType(type);
      resourceSelect.insertAdjacentHTML('beforeend', `<option value="${type}">${label}</option>`);
      libraryType.insertAdjacentHTML('beforeend', `<option value="${type}">${label}</option>`);
    });
  }

  function renderCategoryOptions(categories) {
    const select = byId('contribCategory');
    if (!select) return;

    select.innerHTML = '<option value="">Select Category</option>';
    (categories || []).forEach((cat) => {
      select.insertAdjacentHTML('beforeend', `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`);
    });
  }

  function renderSemesterOptions(semesters) {
    const formSelect = byId('contribSemester');
    const librarySelect = byId('librarySemesterFilter');
    if (!formSelect || !librarySelect) return;

    formSelect.innerHTML = '<option value="">Select Semester</option>';
    librarySelect.innerHTML = '<option value="">All Semesters</option>';

    (semesters || []).forEach((sem) => {
      formSelect.insertAdjacentHTML('beforeend', `<option value="${sem.id}">${escapeHtml(sem.label)}</option>`);
      librarySelect.insertAdjacentHTML('beforeend', `<option value="${sem.id}">${escapeHtml(sem.label)}</option>`);
    });
  }

  async function loadBranches(categoryId = '') {
    const formSelect = byId('contribBranch');
    const librarySelect = byId('libraryBranchFilter');
    if (!formSelect || !librarySelect) return;

    formSelect.innerHTML = '<option value="">Select Branch</option>';
    librarySelect.innerHTML = '<option value="">All Branches</option>';

    if (!categoryId) return;

    try {
      const payload = await window.CollegeOSApi.getAcademicBranches(categoryId);
      const branches = payload?.branches || [];
      branches.forEach((branch) => {
        const html = `<option value="${branch.id}">${escapeHtml(branch.name)}</option>`;
        formSelect.insertAdjacentHTML('beforeend', html);
        librarySelect.insertAdjacentHTML('beforeend', html);
      });
    } catch {
      // Ignore branch load fallback.
    }
  }

  async function loadDashboard() {
    try {
      const payload = await window.CollegeOSApi.getAcademicContributionDashboard();
      const stats = payload?.stats || {};

      setText('kpiTotal', String(stats.totalUploads || 0));
      setText('kpiApproved', String(stats.approvedUploads || 0));
      setText('kpiPending', String(stats.pendingUploads || 0));
      setText('kpiRejected', String(stats.rejectedUploads || 0));
      setText('kpiPoints', String(stats.totalPoints || 0));
      setText('contributorLevelLabel', `${stats.contributorLevel || 'New Contributor'}`);
    } catch (error) {
      setText('contribFormStatus', error.message || 'Failed to load contribution stats.');
    }
  }

  function renderResubmitBoxFromSubmission(item) {
    const box = byId('resubmitBox');
    const context = byId('resubmitContext');
    const idInput = byId('resubmitTargetId');
    if (!box || !context || !idInput) return;

    box.classList.remove('hidden');
    idInput.value = String(item.id);
    context.innerHTML = `Targeting submission #${item.id} (${escapeHtml(item.title)}), current v${item.current_version || 1}. Moderator: ${escapeHtml(item.moderation_reason || item.moderation_notes || 'Needs correction details available in moderation comments.')}`;
  }

  function renderSubmissions(items) {
    const mount = byId('mySubmissionsList');
    if (!mount) return;

    if (!items?.length) {
      mount.innerHTML = '<div class="empty-state">No submissions yet. Publish your first academic contribution.</div>';
      return;
    }

    mount.innerHTML = items
      .map((item) => {
        const reason = item.moderation_reason
          ? `<div class="muted"><strong>Moderator reason:</strong> ${escapeHtml(item.moderation_reason)}</div>`
          : '';
        const notes = item.moderation_notes
          ? `<div class="muted"><strong>Moderator notes:</strong> ${escapeHtml(item.moderation_notes)}</div>`
          : '';

        return `
          <article class="contrib-item">
            <div class="contrib-item-head">
              <div>
                <strong>${escapeHtml(item.title)}</strong>
                <div class="muted">${humanizeResourceType(item.resource_type)} | ${escapeHtml(item.subject_name || '-')}</div>
              </div>
              <span class="contrib-pill status-pill ${statusClass(item.status)}">${String(item.status || '').replace('_', ' ')}</span>
            </div>
            <div class="contrib-pills">
              <span class="contrib-pill">Points: ${item.points_awarded || 0}</span>
              <span class="contrib-pill">Quality: ${item.quality_score || 0}</span>
              <span class="contrib-pill">Duplicate Risk: ${item.duplicate_score || 0}</span>
              <span class="contrib-pill">Downloads: ${item.download_count || 0}</span>
              <span class="contrib-pill">Version: v${item.current_version || 1}</span>
            </div>
            <div class="muted">Submitted: ${formatDate(item.created_at)} | Updated: ${formatDate(item.updated_at)}</div>
            ${reason}
            ${notes}
            <div class="contrib-actions">
              ${item.file_url ? `<a class="btn secondary" target="_blank" rel="noreferrer" href="${item.file_url}">Open Current File</a>` : ''}
              ${item.status === 'needs_correction' ? `<button class="btn primary" data-resubmit-id="${item.id}">Resubmit This Record</button>` : ''}
            </div>
          </article>
        `;
      })
      .join('');

    mount.querySelectorAll('[data-resubmit-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = Number(button.getAttribute('data-resubmit-id'));
        const target = (items || []).find((row) => Number(row.id) === id);
        if (target) renderResubmitBoxFromSubmission(target);
      });
    });
  }

  async function loadMySubmissions() {
    const status = String(byId('submissionStatusFilter')?.value || '').trim();
    try {
      const payload = await window.CollegeOSApi.getMyAcademicContributions(status);
      renderSubmissions(payload?.submissions || []);
    } catch (error) {
      const mount = byId('mySubmissionsList');
      if (mount) mount.innerHTML = `<div class="empty-state">${escapeHtml(error.message || 'Failed to load submissions.')}</div>`;
    }
  }

  function toggleInlinePreview(container, item) {
    const target = container.querySelector(`[data-preview-target="${item.id}"]`);
    if (!target) return;

    const expanded = target.dataset.open === 'true';
    if (expanded) {
      target.dataset.open = 'false';
      target.classList.add('hidden');
      target.innerHTML = '';
      return;
    }

    const kind = detectFileKind(item.file_url, item.file_url);
    let body = '<div class="muted">Preview unavailable for this file type.</div>';
    if (kind === 'pdf') {
      body = `<iframe class="preview-frame" src="${item.file_url}"></iframe>`;
    } else if (kind === 'image') {
      body = `<img class="preview-image" src="${item.file_url}" alt="Resource preview" />`;
    }

    target.innerHTML = body;
    target.dataset.open = 'true';
    target.classList.remove('hidden');
  }

  async function quickFeedback(resourceId, payload, messageOnDone = '') {
    try {
      await window.CollegeOSApi.submitContributionFeedback(resourceId, payload);
      if (messageOnDone) setText('contribFormStatus', messageOnDone);
      await loadLibrary();
    } catch (error) {
      alert(error.message || 'Could not update feedback.');
    }
  }

  async function saveToCollection(resourceId) {
    try {
      if (!state.collections.length) {
        const name = window.prompt('No collections found. Create one now:', 'My Exam Prep');
        if (!name) return;
        await window.CollegeOSApi.createContributionCollection({ name });
        await loadCollections();
      }

      const selected = byId(`collectionSelect-${resourceId}`)?.value || state.collections[0]?.id;
      if (!selected) return;
      await window.CollegeOSApi.addContributionToCollection(selected, { contributionId: resourceId });
      await quickFeedback(resourceId, { saved: true }, 'Saved to your collection.');
      await loadCollections();
    } catch (error) {
      alert(error.message || 'Could not save resource.');
    }
  }

  function renderLibrary(items) {
    const mount = byId('resourceLibraryList');
    if (!mount) return;

    if (!items?.length) {
      mount.innerHTML = '<div class="empty-state">No approved resources found for selected filters.</div>';
      return;
    }

    mount.innerHTML = items
      .map((item) => {
        const tags = Array.isArray(item.tags_json)
          ? item.tags_json.map((tag) => `<span class="contrib-pill">${escapeHtml(tag)}</span>`).join('')
          : '';

        const collectionsOptions = (state.collections || [])
          .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
          .join('');

        return `
          <article class="contrib-item">
            <div class="contrib-item-head">
              <div>
                <strong>${escapeHtml(item.title)}</strong>
                <div class="muted">${escapeHtml(item.subject_name || '-')} | ${escapeHtml(item.branch_name || '-')} | ${escapeHtml(item.semester_label || '-')}</div>
              </div>
              <div class="contrib-pills">
                <span class="contrib-pill">${humanizeResourceType(item.resource_type)}</span>
                ${item.exam_type ? `<span class="contrib-pill">${escapeHtml(String(item.exam_type).toUpperCase())}</span>` : ''}
              </div>
            </div>
            <div class="contrib-pills">
              ${renderBadges(item.badges)}
            </div>
            <div class="muted">${escapeHtml(item.description || 'No description provided.')}</div>
            <div class="contrib-pills">
              ${tags}
              <span class="contrib-pill">By ${escapeHtml(item.contributor_name || 'Contributor')}</span>
              <span class="contrib-pill">Level: ${escapeHtml(item.contributor_level || 'New Contributor')}</span>
              <span class="contrib-pill">Downloads: ${item.download_count || 0}</span>
              <span class="contrib-pill">Saves: ${item.save_count || 0}</span>
              <span class="contrib-pill">Helpful: ${item.helpful_count || 0}</span>
            </div>
            <div class="contrib-actions">
              <button class="btn secondary" data-preview-id="${item.id}">Inline Preview</button>
              <a class="btn secondary" target="_blank" rel="noreferrer" href="${item.file_url}">Open File</a>
              <button class="btn primary" data-download-id="${item.id}">Download + Track</button>
              <button class="btn secondary" data-helpful-id="${item.id}">Helpful</button>
              <button class="btn secondary" data-not-helpful-id="${item.id}">Not Helpful</button>
              <select id="collectionSelect-${item.id}" style="max-width:180px;">${collectionsOptions}</select>
              <button class="btn secondary" data-save-id="${item.id}">Save</button>
              <button class="btn secondary" data-profile-id="${item.id}" data-user-name="${escapeHtml(item.contributor_name || '')}">Profile</button>
              <button class="btn secondary" data-community-id="${item.id}">Discussion</button>
            </div>
            <div class="preview-panel hidden" data-preview-target="${item.id}" data-open="false"></div>
            <div class="community-panel" id="community-panel-${item.id}"></div>
            <div class="ai-insights-panel" id="ai-insights-panel-${item.id}"></div>
          </article>
        `;
      })
      .join('');

    mount.querySelectorAll('[data-download-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = Number(button.getAttribute('data-download-id'));
        if (!id) return;
        try {
          const payload = await window.CollegeOSApi.registerContributionDownload(id);
          const url = payload?.downloadUrl || payload?.resource?.file_url;
          if (url) window.open(url, '_blank', 'noopener,noreferrer');
          await loadLibrary();
          await Promise.all([loadLeaderboard(), loadSeasonMode(), loadAndShowGrowth(), loadAndShowDownloadIntelligence()]);
        } catch (error) {
          alert(error.message || 'Download failed.');
        }
      });
    });

    mount.querySelectorAll('[data-preview-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = Number(button.getAttribute('data-preview-id'));
        const item = (items || []).find((r) => Number(r.id) === id);
        if (!item) return;
        toggleInlinePreview(mount, item);
      });
    });

    mount.querySelectorAll('[data-helpful-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = Number(button.getAttribute('data-helpful-id'));
        if (!id) return;
        quickFeedback(id, { helpful: true }, 'Thanks for your feedback.');
      });
    });

    mount.querySelectorAll('[data-not-helpful-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = Number(button.getAttribute('data-not-helpful-id'));
        if (!id) return;
        quickFeedback(id, { helpful: false }, 'Feedback submitted.');
      });
    });

    mount.querySelectorAll('[data-save-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = Number(button.getAttribute('data-save-id'));
        if (!id) return;
        saveToCollection(id);
      });
    });

    mount.querySelectorAll('[data-community-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = Number(button.getAttribute('data-community-id'));
        if (!id) return;
        await loadAndShowCommunity(id);
        await loadAndShowAiInsights(id);
      });
    });

    mount.querySelectorAll('[data-profile-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = Number(button.getAttribute('data-profile-id'));
        const item = (items || []).find((r) => Number(r.id) === id);
        if (!item) return;
        try {
          const detail = await window.CollegeOSApi.getAcademicContributionResourceDetail(id);
          const userId = detail?.resource?.user_id;
          if (!userId) return;
          const profile = await window.CollegeOSApi.getContributionContributorProfile(userId);
          const m = profile?.metrics || {};
          alert(`Contributor: ${profile?.contributor?.full_name || 'Contributor'}\nLevel: ${profile?.contributor?.contributor_level || '-'}\nUploads: ${m.totalUploads || 0}\nApproval Rate: ${m.approvalRate || 0}%\nPoints: ${profile?.contributor?.contribution_points || 0}`);
        } catch (error) {
          alert(error.message || 'Failed to load contributor profile.');
        }
      });
    });
  }

  async function loadLibrary() {
    const params = {
      branchId: byId('libraryBranchFilter')?.value || '',
      semesterId: byId('librarySemesterFilter')?.value || '',
      resourceType: byId('libraryTypeFilter')?.value || '',
      examType: byId('libraryExamFilter')?.value || '',
      subject: byId('librarySubjectFilter')?.value?.trim() || '',
      search: byId('librarySearchFilter')?.value?.trim() || '',
      sortBy: byId('librarySortBy')?.value || 'latest'
    };

    try {
      const payload = await window.CollegeOSApi.getAcademicContributionLibrary(params);
      renderLibrary(payload?.resources || []);
    } catch (error) {
      const mount = byId('resourceLibraryList');
      if (mount) mount.innerHTML = `<div class="empty-state">${escapeHtml(error.message || 'Failed to load library.')}</div>`;
    }
  }

  function syncQuestionPaperFields() {
    const type = byId('contribResourceType')?.value || '';
    const isQuestion = QUESTION_TYPES.has(type);
    document.querySelectorAll('.question-only').forEach((node) => {
      node.classList.toggle('hidden', !isQuestion);
    });

    const examType = byId('contribExamType');
    const examSession = byId('contribExamSession');
    if (examType) examType.required = isQuestion;
    if (examSession) examSession.required = isQuestion;
  }

  function validateForm(config) {
    const title = byId('contribTitle')?.value?.trim() || '';
    const resourceType = byId('contribResourceType')?.value || '';
    const branchId = byId('contribBranch')?.value || '';
    const semesterId = byId('contribSemester')?.value || '';
    const subject = byId('contribSubject')?.value?.trim() || '';
    const examType = byId('contribExamType')?.value || '';
    const examSession = byId('contribExamSession')?.value?.trim() || '';
    const file = byId('contribFile')?.files?.[0] || null;

    if (title.length < 5) return 'Title must be at least 5 characters long.';
    if (!resourceType) return 'Select a resource type.';
    if (!branchId || !semesterId || !subject) return 'Branch, semester, and subject are required.';
    if (!file) return 'Upload an academic resource file.';

    const allowedExt = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
    const lowerName = String(file.name || '').toLowerCase();
    const extOk = allowedExt.some((ext) => lowerName.endsWith(ext));
    if (!extOk) return 'File must be PDF, PNG, JPG, JPEG, or WEBP.';

    const maxFileSizeMb = Number(config?.limits?.maxFileSizeMb || 12);
    if (file.size > maxFileSizeMb * 1024 * 1024) return `File exceeds ${maxFileSizeMb}MB limit.`;

    if (file.type.startsWith('image/') && !canUseImageAsResource(resourceType)) {
      return 'Image-only resources are allowed for note-style categories only.';
    }

    if (QUESTION_TYPES.has(resourceType)) {
      if (!examType) return 'Exam type is required for question papers.';
      if (!examSession) return 'Exam session/year is required for question papers.';
    }

    return null;
  }

  async function submitContribution() {
    const error = validateForm(state.config);
    if (error) {
      setText('contribFormStatus', error);
      return;
    }

    const button = byId('contribSubmitBtn');
    const form = byId('contributionForm');
    if (!form || !button) return;

    button.disabled = true;
    button.textContent = 'Publishing draft for moderation...';

    try {
      const data = new FormData(form);
      const payload = await window.CollegeOSApi.submitAcademicContribution(data);
      setText('contribFormStatus', payload?.message || 'Contribution submitted for moderation.');
      form.reset();
      syncQuestionPaperFields();
      syncUploadPreview(null);
      await Promise.all([loadDashboard(), loadMySubmissions(), loadLibrary(), loadLeaderboard(), loadSeasonMode()]);
    } catch (submitError) {
      setText('contribFormStatus', submitError.message || 'Failed to submit contribution.');
    } finally {
      button.disabled = false;
      button.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Submit For Moderation';
    }
  }

  async function submitResubmission() {
    const id = Number(byId('resubmitTargetId')?.value || 0);
    if (!id) {
      alert('Enter a valid submission ID for resubmission.');
      return;
    }

    const button = byId('resubmitBtn');
    if (!button) return;
    button.disabled = true;

    try {
      const form = byId('contributionForm');
      const data = new FormData(form);
      data.set('changeNotes', byId('resubmitChangeNotes')?.value?.trim() || 'Updated and improved content quality');
      const payload = await window.CollegeOSApi.resubmitAcademicContribution(id, data);
      setText('contribFormStatus', payload?.message || 'Resubmitted for moderation.');
      await Promise.all([loadDashboard(), loadMySubmissions(), loadLibrary()]);
    } catch (error) {
      setText('contribFormStatus', error.message || 'Resubmission failed.');
    } finally {
      button.disabled = false;
    }
  }

  async function loadUploadGuidance() {
    try {
      const payload = await window.CollegeOSApi.getContributionUploadGuidance();
      const list = byId('uploadTipsList');
      if (!list) return;
      const tips = payload?.tips || [];
      list.innerHTML = tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join('');
    } catch {
      // Keep static fallback.
    }
  }

  function renderCollections(items) {
    const mount = byId('collectionsList');
    if (!mount) return;

    if (!items?.length) {
      mount.innerHTML = '<div class="empty-state">No collections yet. Create your first one.</div>';
      return;
    }

    mount.innerHTML = items
      .map((item) => `
        <article class="contrib-item">
          <div class="contrib-item-head">
            <strong>${escapeHtml(item.name)}</strong>
            <span class="contrib-pill">${item.item_count || 0} saved</span>
          </div>
          <div class="muted">${escapeHtml(item.description || 'Personal study collection')}</div>
        </article>
      `)
      .join('');
  }

  async function loadCollections() {
    try {
      const payload = await window.CollegeOSApi.getContributionCollections();
      state.collections = payload?.collections || [];
      renderCollections(state.collections);
    } catch (error) {
      const mount = byId('collectionsList');
      if (mount) mount.innerHTML = `<div class="empty-state">${escapeHtml(error.message || 'Failed to load collections.')}</div>`;
    }
  }

  async function createCollection() {
    const input = byId('newCollectionName');
    const name = input?.value?.trim() || '';
    if (!name) return;
    try {
      await window.CollegeOSApi.createContributionCollection({ name });
      if (input) input.value = '';
      await loadCollections();
      await loadLibrary();
    } catch (error) {
      alert(error.message || 'Could not create collection.');
    }
  }

  function renderLeaderboard(rows, highlights) {
    const mount = byId('leaderboardList');
    if (!mount) return;

    if (!rows?.length) {
      mount.innerHTML = '<div class="empty-state">No leaderboard data yet.</div>';
      return;
    }

    const banner = highlights?.bestNotesUploader
      ? `<div class="quality-tips"><strong>Top This Cycle:</strong> ${escapeHtml(highlights.bestNotesUploader.full_name)} (${highlights.bestNotesUploader.points || 0} pts)</div>`
      : '';

    mount.innerHTML = banner + rows
      .slice(0, 12)
      .map((row, idx) => `
        <article class="contrib-item">
          <div class="contrib-item-head">
            <strong>#${idx + 1} ${escapeHtml(row.full_name)}</strong>
            <span class="contrib-pill">${row.points || 0} pts</span>
          </div>
          <div class="muted">${escapeHtml(row.contributor_level || 'Contributor')} | ${row.downloads || 0} downloads | ${row.helpful || 0} helpful</div>
        </article>
      `)
      .join('');
  }

  async function loadLeaderboard() {
    try {
      const range = byId('leaderboardRange')?.value || 'monthly';
      const payload = await window.CollegeOSApi.getContributionLeaderboard(range);
      renderLeaderboard(payload?.leaderboard || [], payload?.highlights || {});
    } catch (error) {
      const mount = byId('leaderboardList');
      if (mount) mount.innerHTML = `<div class="empty-state">${escapeHtml(error.message || 'Failed to load leaderboard.')}</div>`;
    }
  }

  function renderSeasonMode(panel) {
    const mount = byId('seasonModePanel');
    if (!mount) return;

    const subjects = (panel?.trendingBySubject || []).slice(0, 5);
    const exams = (panel?.mostUsedBeforeExam || []).slice(0, 5);

    mount.innerHTML = `
      <div class="quality-tips"><strong>${escapeHtml(panel?.modeLabel || 'Season Mode')}</strong> | ${panel?.examMode ? 'High exam activity detected' : 'Steady learning mode'}</div>
      <article class="contrib-item">
        <strong>Trending Subjects</strong>
        <div class="muted">${subjects.map((s) => `${escapeHtml(s.subject_name)} (${s.recent_downloads})`).join(', ') || 'No data'}</div>
      </article>
      <article class="contrib-item">
        <strong>Most Used Before Exams</strong>
        <div class="muted">${exams.map((e) => `${escapeHtml(e.exam_type)} (${e.recent_downloads})`).join(', ') || 'No data'}</div>
      </article>
    `;
  }

  async function loadSeasonMode() {
    try {
      const payload = await window.CollegeOSApi.getContributionSeasonMode(30);
      renderSeasonMode(payload || {});
    } catch (error) {
      const mount = byId('seasonModePanel');
      if (mount) mount.innerHTML = `<div class="empty-state">${escapeHtml(error.message || 'Failed to load season mode.')}</div>`;
    }
  }

  async function initialize() {
    if (!window.CollegeOSApi) return;

    try {
      const me = await window.CollegeOSApi.getMe();
      if (!me?.user) {
        window.location.href = 'login.html';
        return;
      }
    } catch {
      window.location.href = 'login.html';
      return;
    }

    try {
      const [contribConfig, options, categoriesPayload, semestersPayload] = await Promise.all([
        window.CollegeOSApi.getContributionConfig(),
        window.CollegeOSApi.getContributionOptions(),
        window.CollegeOSApi.getAcademicCategories(),
        window.CollegeOSApi.getAcademicSemesters()
      ]);

      state.config = contribConfig?.config || null;
      if (state.config && state.config.enabled === false) {
        const card = byId('uploadCard');
        if (card) {
          card.innerHTML = '<div class="empty-state"><h3>Contribution Hub Temporarily Disabled</h3><p>Admin has paused submissions for your campus.</p></div>';
        }
      }

      renderContributionTypes(options?.resourceTypes || [], state.config);
      renderCategoryOptions(categoriesPayload?.categories || []);
      renderSemesterOptions(semestersPayload?.semesters || []);
      const profile = await loadProfileDefaults();
      await loadBranches(byId('contribCategory')?.value || '');
      if (profile?.branchId && byId('contribBranch')) {
        byId('contribBranch').value = String(profile.branchId);
      }
    } catch (error) {
      setText('contribFormStatus', error.message || 'Failed to initialize contribution hub.');
    }

    byId('contribCategory')?.addEventListener('change', () => {
      loadBranches(byId('contribCategory')?.value || '');
    });

    byId('contribResourceType')?.addEventListener('change', syncQuestionPaperFields);
    byId('submissionStatusFilter')?.addEventListener('change', loadMySubmissions);
    byId('libraryRefreshBtn')?.addEventListener('click', loadLibrary);
    byId('leaderboardRange')?.addEventListener('change', loadLeaderboard);
    byId('createCollectionBtn')?.addEventListener('click', createCollection);
    byId('resubmitBtn')?.addEventListener('click', submitResubmission);

    ['libraryBranchFilter', 'librarySemesterFilter', 'libraryTypeFilter', 'libraryExamFilter', 'librarySortBy']
      .forEach((id) => byId(id)?.addEventListener('change', loadLibrary));

    ['librarySubjectFilter', 'librarySearchFilter']
      .forEach((id) => byId(id)?.addEventListener('input', loadLibrary));

    // Add instant search listener (debounced)
    byId('librarySearchFilter')?.addEventListener('input', debounce((e) => {
      loadInstantSearch(e.target?.value || '');
    }, 300));

    // Close instant search dropdown on click outside
    document.addEventListener('click', (e) => {
      const dropdown = byId('instantSearchDropdown');
      if (dropdown && !e.target.closest('#librarySearchFilter') && !e.target.closest('#instantSearchDropdown')) {
        dropdown.classList.add('hidden');
      }
    });

    byId('contribFile')?.addEventListener('change', (event) => {
      const file = event.target?.files?.[0] || null;
      syncUploadPreview(file);
    });

    byId('contribResetBtn')?.addEventListener('click', () => {
      byId('contributionForm')?.reset();
      setText('contribFormStatus', '');
      syncQuestionPaperFields();
      syncUploadPreview(null);
    });

    byId('contributionForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      await submitContribution();
    });

    await Promise.all([
      loadUploadGuidance(),
      loadDashboard(),
      loadMySubmissions(),
      loadCollections(),
      loadLibrary(),
      loadLeaderboard(),
      loadSeasonMode(),
      loadAndShowGrowth(),
      loadAndShowDownloadIntelligence()
    ]);
    syncQuestionPaperFields();
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();