document.addEventListener('DOMContentLoaded', () => {
  if (!window.CollegeOSApi) return;

  const state = {
    tab: 'latest',
    posts: new Map(),
    collections: [],
    selectedCollectionId: null,
    viewTimers: new Map(),
    signalDebounce: new Map(),
    realtimeSource: null,
    observer: null
  };

  const byId = (id) => document.getElementById(id);

  function htmlEscape(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function formatTimeAgo(input) {
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return 'Just now';
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-IN');
  }

  function setStatus(id, text, isError = false) {
    const node = byId(id);
    if (!node) return;
    node.textContent = text;
    node.style.color = isError ? '#b43a3a' : '#5b7086';
  }

  function statusBadge(status) {
    if (status === 'approved') return '<span class="status-badge status-approved">Approved</span>';
    if (status === 'rejected') return '<span class="status-badge status-rejected">Rejected</span>';
    return '<span class="status-badge status-pending">Pending Review</span>';
  }

  function showFeedSkeleton() {
    const mount = byId('campusFeedList');
    if (!mount) return;
    mount.innerHTML = Array.from({ length: 3 }).map(() => `
      <article class="post-card">
        <div class="skeleton" style="height:18px; width:48%;"></div>
        <div class="skeleton" style="height:12px; width:32%; margin-top:.35rem;"></div>
        <div class="skeleton" style="height:70px; margin-top:.6rem;"></div>
        <div class="skeleton" style="height:36px; margin-top:.6rem;"></div>
      </article>
    `).join('');
  }

  function renderSummary(summary) {
    byId('feedCollegeLine').textContent = `Showing verified content from ${summary?.college?.name || 'your college'} only.`;

    const profile = summary?.creatorProfile || {};
    const stats = summary?.stats || {};

    byId('feedMetaPills').innerHTML = [
      `<span class="feed-pill"><i class="fa-solid fa-shield-check"></i> Trust: ${htmlEscape(profile.trust_level || 'new')}</span>`,
      `<span class="feed-pill"><i class="fa-solid fa-user-tag"></i> Role: ${htmlEscape(String(profile.campus_role || 'regular_student').replace(/_/g, ' '))}</span>`,
      `<span class="feed-pill"><i class="fa-solid fa-star"></i> Points: ${Number(profile.total_points || 0)}</span>`,
      `<span class="feed-pill"><i class="fa-solid fa-hourglass-half"></i> Pending: ${Number(stats.pendingPosts || 0)}</span>`,
      `<span class="feed-pill"><i class="fa-solid fa-fire"></i> Trending now: ${Number(stats.trendingNow || 0)}</span>`
    ].join('');
  }

  function cardMedia(post) {
    if (!post.media_url) return '';
    if (String(post.media_type || '').startsWith('video/')) {
      return `<div class="post-media"><video controls preload="metadata" data-video-post="${post.id}" src="${htmlEscape(post.media_url)}"></video></div>`;
    }
    return `<div class="post-media"><img src="${htmlEscape(post.media_url)}" alt="Campus post media" loading="lazy" /></div>`;
  }

  function pollBlock(post) {
    if (post.post_type !== 'poll' || !Array.isArray(post.poll_options) || !post.poll_options.length) return '';

    const votes = Array.isArray(post.poll_votes) ? post.poll_votes : [];
    const voteMap = new Map(votes.map((row) => [Number(row.selected_index), Number(row.votes)]));
    const totalVotes = votes.reduce((sum, row) => sum + Number(row.votes || 0), 0);

    const options = post.poll_options.map((option, index) => {
      const voteCount = voteMap.get(index) || 0;
      const percentage = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
      const selected = Number(post.my_poll_vote) === index;
      return `
        <button data-poll-vote="${post.id}" data-option-index="${index}" class="${selected ? 'active' : ''}" style="display:flex; justify-content:space-between; align-items:center; border:1px solid #d1deeb; border-radius:8px; background:#fff; padding:.34rem .55rem; cursor:pointer; width:100%; text-align:left;">
          <span>${htmlEscape(option)}</span>
          <span class="muted">${voteCount} (${percentage}%)</span>
        </button>
      `;
    }).join('');

    return `<div style="margin-top:.65rem; display:grid; gap:.38rem;"><strong style="font-size:.82rem;">Poll</strong>${options}<div class="muted" style="font-size:.74rem;">${totalVotes} total votes</div></div>`;
  }

  function getCollectionOptions() {
    return state.collections.map((collection) => `<option value="${collection.id}">${htmlEscape(collection.name)} (${Number(collection.post_count || 0)})</option>`).join('');
  }

  function renderFeed(posts) {
    const mount = byId('campusFeedList');
    if (!mount) return;

    if (!posts.length) {
      mount.innerHTML = '<div class="empty-state">No posts in this feed segment yet. Try another tab or be the first contributor.</div>';
      return;
    }

    mount.innerHTML = posts.map((post) => {
      const tags = Array.isArray(post.tags) ? post.tags : [];
      const eventLine = post.event_starts_at
        ? `<span class="feed-pill"><i class="fa-solid fa-calendar-day"></i> ${new Date(post.event_starts_at).toLocaleString('en-IN')}</span>`
        : '';
      const roleLabel = String(post.author_role || 'regular_student').replace(/_/g, ' ');

      return `
        <article class="post-card" data-post-id="${post.id}" data-author-id="${post.user_id}">
          <div class="post-head">
            <div>
              <h4 class="post-title">${htmlEscape(post.title)}</h4>
              <div class="post-meta">
                <span>${htmlEscape(post.author_name || 'Student')}</span>
                <span>•</span>
                <span>${htmlEscape(roleLabel)}</span>
                <span>•</span>
                <span>${formatTimeAgo(post.created_at)}</span>
                <span>•</span>
                <span>${htmlEscape(post.category || 'latest')}</span>
                ${post.is_urgent ? '<span class="feed-pill" style="border-color:#ffd3d3;color:#a83131;background:#fff1f1;">Urgent</span>' : ''}
                ${post.is_featured ? '<span class="feed-pill" style="border-color:#f5d08b;color:#875600;background:#fff8e8;">Featured</span>' : ''}
                ${post.is_trending ? '<span class="feed-pill" style="border-color:#f6c285;color:#9a4d00;background:#fff3e3;">Trending in your college</span>' : ''}
              </div>
            </div>
            <button class="btn secondary sm" data-view-creator="${post.user_id}" type="button">Creator</button>
          </div>
          <p style="margin:.58rem 0 0; color:#3d556d;">${htmlEscape(post.description)}</p>
          ${cardMedia(post)}
          ${pollBlock(post)}
          <div class="post-meta" style="margin-top:.55rem;">${tags.map((tag) => `<span class="feed-pill">#${htmlEscape(tag)}</span>`).join('')} ${eventLine}</div>
          <div class="post-actions">
            <button data-action="like" class="${post.liked_by_me ? 'active' : ''}"><i class="fa-regular fa-thumbs-up"></i> Like (${Number(post.like_count || 0)})</button>
            <button data-action="comment"><i class="fa-regular fa-comment"></i> Comment (${Number(post.comment_count || 0)})</button>
            <button data-action="share" class="${post.shared_by_me ? 'active' : ''}"><i class="fa-solid fa-share-nodes"></i> Share (${Number(post.share_count || 0)})</button>
            <button data-action="save" class="${post.saved_by_me ? 'active' : ''}"><i class="fa-regular fa-bookmark"></i> Save (${Number(post.save_count || 0)})</button>
            <button data-action="report"><i class="fa-regular fa-flag"></i> Report</button>
            <button data-action="copy-link"><i class="fa-solid fa-link"></i> Link</button>
          </div>
          <div class="comment-box" data-comments-box="${post.id}" style="display:none;">
            <div class="comment-list" data-comments-list="${post.id}"><div class="muted">No comments yet.</div></div>
            <div class="comment-row">
              <input data-comment-input="${post.id}" placeholder="Add a comment" maxlength="800" />
              <button class="btn secondary" data-comment-submit="${post.id}" type="button">Post</button>
            </div>
            <div class="comment-row">
              <select data-collection-select="${post.id}" style="max-width:220px;">${getCollectionOptions()}</select>
              <button class="btn secondary" data-collection-add="${post.id}" type="button">Add to Collection</button>
            </div>
          </div>
        </article>
      `;
    }).join('');

    bindPostInteractions();
    bindViewSignals();
  }

  function debounceSignal(postId, payload) {
    const key = String(postId);
    const existing = state.signalDebounce.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      try {
        await window.CollegeOSApi.submitCampusViewSignal(postId, payload);
      } catch {
        // Ignore telemetry failures.
      }
      state.signalDebounce.delete(key);
    }, 350);

    state.signalDebounce.set(key, timer);
  }

  function bindViewSignals() {
    if (state.observer) state.observer.disconnect();

    const cards = [...document.querySelectorAll('[data-post-id]')];
    state.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const postId = Number(entry.target.getAttribute('data-post-id'));
        if (!Number.isInteger(postId)) return;

        if (entry.isIntersecting) {
          state.viewTimers.set(postId, Date.now());
          debounceSignal(postId, {
            scrollDepth: Math.round(entry.intersectionRatio * 100),
            dwellSeconds: 0,
            watchSeconds: 0,
            completionRate: Math.round(entry.intersectionRatio * 100)
          });
        } else if (state.viewTimers.has(postId)) {
          const startedAt = state.viewTimers.get(postId);
          state.viewTimers.delete(postId);
          const dwellSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
          debounceSignal(postId, {
            scrollDepth: Math.round(entry.intersectionRatio * 100),
            dwellSeconds,
            watchSeconds: 0,
            completionRate: dwellSeconds > 20 ? 100 : Math.min(100, dwellSeconds * 4)
          });
        }
      });
    }, { threshold: [0.25, 0.5, 0.75, 1] });

    cards.forEach((card) => state.observer.observe(card));

    document.querySelectorAll('[data-video-post]').forEach((video) => {
      video.addEventListener('timeupdate', () => {
        const postId = Number(video.getAttribute('data-video-post'));
        if (!Number.isInteger(postId)) return;

        const duration = Number(video.duration || 0);
        const current = Number(video.currentTime || 0);
        if (!duration || !current) return;

        const completionRate = Math.round((current / duration) * 100);
        debounceSignal(postId, {
          watchSeconds: Math.round(current),
          dwellSeconds: Math.round(current),
          scrollDepth: 100,
          completionRate
        });
      });
    });
  }

  async function loadComments(postId, card) {
    const list = card?.querySelector(`[data-comments-list="${postId}"]`);
    if (!list) return;
    list.innerHTML = '<div class="muted">Loading comments...</div>';

    try {
      const payload = await window.CollegeOSApi.getCampusPostComments(postId);
      const rows = payload?.comments || [];
      if (!rows.length) {
        list.innerHTML = '<div class="muted">No comments yet.</div>';
        return;
      }
      list.innerHTML = rows.map((comment) => `
        <div class="comment-item">
          <strong>${htmlEscape(comment.full_name || 'Student')}</strong>
          <div class="muted" style="font-size:.72rem;">${formatTimeAgo(comment.created_at)}</div>
          <p style="margin:.2rem 0 0;">${htmlEscape(comment.body)}</p>
        </div>
      `).join('');
    } catch (error) {
      list.innerHTML = `<div class="muted">${htmlEscape(error.message || 'Unable to load comments')}</div>`;
    }
  }

  async function handleShare(postId) {
    const payload = await window.CollegeOSApi.getCampusShareLink(postId);
    const link = payload?.link;
    const whatsappLink = payload?.whatsappLink;

    if (navigator.share) {
      try {
        await navigator.share({ title: 'Campus Feed Post', url: link });
      } catch {
        // Ignore user-cancelled share.
      }
      return;
    }

    if (whatsappLink) {
      window.open(whatsappLink, '_blank', 'noopener');
      return;
    }

    if (link) {
      await navigator.clipboard.writeText(link);
      setStatus('campusFeedStatus', 'Post link copied.');
    }
  }

  async function handleReport(postId) {
    const reason = (window.prompt('Report reason: spam | abuse | fake | harassment | misinformation | other', 'spam') || '').trim().toLowerCase();
    if (!reason) return;
    const details = window.prompt('Optional details for admin moderation', '') || '';
    await window.CollegeOSApi.reportCampusPost(postId, reason, details);
    setStatus('campusFeedStatus', 'Report submitted for moderation review.');
  }

  async function openCreatorProfile(userId) {
    const panel = byId('creatorProfilePanel');
    panel.className = 'creator-card';
    panel.innerHTML = '<div class="muted">Loading creator profile...</div>';
    try {
      const payload = await window.CollegeOSApi.getCampusCreatorProfile(userId);
      const creator = payload?.creator || {};
      const stats = payload?.engagementStats || {};
      const topPosts = payload?.topPosts || [];

      panel.innerHTML = `
        <strong>${htmlEscape(creator.full_name || 'Creator')}</strong>
        <div class="muted">${htmlEscape(String(creator.campus_role || 'regular_student').replace(/_/g, ' '))} • Trust ${htmlEscape(creator.trust_level || 'new')}</div>
        <div class="creator-badges">${(creator.badges || []).map((badge) => `<span class="creator-badge">${htmlEscape(badge)}</span>`).join('') || '<span class="creator-badge">New Contributor</span>'}</div>
        <div class="muted">Posts: ${Number(stats.total_posts || 0)} | Likes: ${Number(stats.total_likes || 0)} | Shares: ${Number(stats.total_shares || 0)} | Avg Retention: ${Math.round(Number(stats.avg_retention || 0))}%</div>
        <div>
          <strong style="font-size:.82rem;">Top Posts</strong>
          <div class="submission-list" style="margin-top:.35rem;">${topPosts.map((post) => `<div class="submission-item"><strong>${htmlEscape(post.title)}</strong><div class="muted">Q ${Math.round(Number(post.quality_score || 0))} • ${Number(post.like_count || 0)} likes</div></div>`).join('') || '<div class="empty-state">No top posts yet.</div>'}</div>
        </div>
      `;
    } catch (error) {
      panel.className = 'creator-card empty-state';
      panel.textContent = error.message || 'Unable to load creator profile.';
    }
  }

  function bindPostInteractions() {
    const feed = byId('campusFeedList');
    if (!feed) return;

    feed.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const card = button.closest('[data-post-id]');
        const postId = Number(card?.dataset.postId);
        const action = button.dataset.action;
        if (!Number.isInteger(postId) || !action) return;

        try {
          if (action === 'comment') {
            const box = card.querySelector(`[data-comments-box="${postId}"]`);
            if (!box) return;
            box.style.display = box.style.display === 'none' ? 'grid' : 'none';
            if (box.style.display !== 'none') {
              await loadComments(postId, card);
            }
            return;
          }

          if (action === 'report') {
            await handleReport(postId);
            return;
          }

          if (action === 'copy-link') {
            await handleShare(postId);
            return;
          }

          if (action === 'share') {
            await handleShare(postId);
          }

          const payload = await window.CollegeOSApi.engageCampusPost(postId, action);
          if (payload?.ignoredForQuality) {
            setStatus('campusFeedStatus', 'Action registered but quality scoring ignored suspicious pattern.');
          }
          await loadFeed(true);
          await Promise.all([loadTrending(), loadSubmissions(), loadCollections()]);
        } catch (error) {
          setStatus('campusFeedStatus', error.message || 'Failed to update engagement', true);
        }
      });
    });

    feed.querySelectorAll('[data-comment-submit]').forEach((button) => {
      button.addEventListener('click', async () => {
        const postId = Number(button.dataset.commentSubmit);
        const card = button.closest('[data-post-id]');
        const input = card?.querySelector(`[data-comment-input="${postId}"]`);
        const text = input?.value?.trim();
        if (!Number.isInteger(postId) || !text) return;

        try {
          await window.CollegeOSApi.commentCampusPost(postId, text);
          input.value = '';
          await loadComments(postId, card);
          await loadFeed(true);
        } catch (error) {
          setStatus('campusFeedStatus', error.message || 'Unable to post comment', true);
        }
      });
    });

    feed.querySelectorAll('[data-collection-add]').forEach((button) => {
      button.addEventListener('click', async () => {
        const postId = Number(button.dataset.collectionAdd);
        const select = feed.querySelector(`[data-collection-select="${postId}"]`);
        const collectionId = Number(select?.value || state.selectedCollectionId || 0);
        if (!Number.isInteger(postId) || !Number.isInteger(collectionId) || collectionId <= 0) return;

        try {
          await window.CollegeOSApi.addCampusCollectionPost(collectionId, postId);
          setStatus('campusFeedStatus', 'Saved to collection.');
          await loadCollections();
        } catch (error) {
          setStatus('campusFeedStatus', error.message || 'Failed to add to collection', true);
        }
      });
    });

    feed.querySelectorAll('[data-view-creator]').forEach((button) => {
      button.addEventListener('click', async () => {
        const userId = Number(button.dataset.viewCreator);
        if (!Number.isInteger(userId)) return;
        await openCreatorProfile(userId);
      });
    });

    feed.querySelectorAll('[data-poll-vote]').forEach((button) => {
      button.addEventListener('click', async () => {
        const postId = Number(button.dataset.pollVote);
        const selectedIndex = Number(button.dataset.optionIndex);
        if (!Number.isInteger(postId) || !Number.isInteger(selectedIndex)) return;

        try {
          await window.CollegeOSApi.voteCampusPoll(postId, selectedIndex);
          await loadFeed(true);
        } catch (error) {
          setStatus('campusFeedStatus', error.message || 'Poll vote failed', true);
        }
      });
    });
  }

  function renderTrending(items) {
    const mount = byId('campusTrendingList');
    if (!mount) return;
    if (!items.length) {
      mount.innerHTML = '<div class="empty-state">No trending posts right now.</div>';
      return;
    }

    mount.innerHTML = items.map((item) => `
      <div class="submission-item">
        <strong>${htmlEscape(item.title)}</strong>
        <div class="muted" style="margin-top:.25rem;">${htmlEscape(item.author_name || 'Student')} • ${htmlEscape(item.category || 'latest')}</div>
        <div class="post-meta" style="margin-top:.35rem;">
          <span><i class="fa-regular fa-thumbs-up"></i> ${Number(item.like_count || 0)}</span>
          <span><i class="fa-regular fa-comment"></i> ${Number(item.comment_count || 0)}</span>
          <span><i class="fa-solid fa-share-nodes"></i> ${Number(item.share_count || 0)}</span>
        </div>
      </div>
    `).join('');
  }

  function renderSubmissions(rows) {
    const mount = byId('myCampusSubmissions');
    if (!mount) return;
    if (!rows.length) {
      mount.innerHTML = '<div class="empty-state">No submissions yet. Create your first campus post.</div>';
      return;
    }

    mount.innerHTML = rows.slice(0, 10).map((item) => `
      <div class="submission-item">
        <div style="display:flex; justify-content:space-between; gap:.5rem; align-items:flex-start;">
          <strong>${htmlEscape(item.title)}</strong>
          ${statusBadge(item.moderation_status)}
        </div>
        <div class="muted" style="margin-top:.3rem;">${formatTimeAgo(item.created_at)} • Points ${Number(item.points_earned || 0)}</div>
        ${item.moderation_reason ? `<p style="margin:.35rem 0 0; color:#92453f; font-size:.8rem;">Reason: ${htmlEscape(item.moderation_reason)}</p>` : ''}
      </div>
    `).join('');
  }

  function renderCollections(collections) {
    const mount = byId('campusCollectionsList');
    if (!mount) return;
    if (!collections.length) {
      mount.innerHTML = '<div class="empty-state">No collections yet.</div>';
      return;
    }

    mount.innerHTML = collections.map((collection) => `
      <div class="submission-item" data-collection-id="${collection.id}">
        <strong>${htmlEscape(collection.name)}</strong>
        <div class="muted" style="margin-top:.2rem;">${Number(collection.post_count || 0)} posts saved</div>
      </div>
    `).join('');

    mount.querySelectorAll('[data-collection-id]').forEach((node) => {
      node.addEventListener('click', async () => {
        const collectionId = Number(node.dataset.collectionId);
        if (!Number.isInteger(collectionId)) return;
        state.selectedCollectionId = collectionId;
        try {
          const payload = await window.CollegeOSApi.getCampusCollectionPosts(collectionId);
          const posts = payload?.posts || [];
          setStatus('campusFeedStatus', `Collection \"${payload?.collection?.name || 'Saved'}\" has ${posts.length} post(s).`);
        } catch (error) {
          setStatus('campusFeedStatus', error.message || 'Unable to open collection', true);
        }
      });
    });
  }

  async function loadFeed(skipSkeleton = false) {
    if (!skipSkeleton) showFeedSkeleton();
    setStatus('campusFeedStatus', 'Loading feed...');
    try {
      const payload = await window.CollegeOSApi.getCampusFeedPosts(state.tab, 25);
      const posts = payload?.posts || [];
      state.posts = new Map(posts.map((post) => [Number(post.id), post]));
      renderFeed(posts);
      setStatus('campusFeedStatus', `Loaded ${posts.length} posts from your college.`);
    } catch (error) {
      setStatus('campusFeedStatus', error.message || 'Failed to load feed', true);
      byId('campusFeedList').innerHTML = `<div class="empty-state">${htmlEscape(error.message || 'Unable to load feed')}</div>`;
    }
  }

  async function loadTrending() {
    try {
      const payload = await window.CollegeOSApi.getCampusTrending(8);
      renderTrending(payload?.trending || []);
    } catch {
      renderTrending([]);
    }
  }

  async function loadSubmissions() {
    try {
      const payload = await window.CollegeOSApi.getCampusMySubmissions();
      renderSubmissions(payload?.submissions || []);
    } catch {
      renderSubmissions([]);
    }
  }

  async function loadSummary() {
    const payload = await window.CollegeOSApi.getCampusFeedSummary();
    renderSummary(payload);
  }

  async function loadCollections() {
    try {
      const payload = await window.CollegeOSApi.getCampusCollections();
      state.collections = payload?.collections || [];
      if (!state.selectedCollectionId && state.collections[0]) {
        state.selectedCollectionId = Number(state.collections[0].id);
      }
      renderCollections(state.collections);
    } catch {
      state.collections = [];
      renderCollections([]);
    }
  }

  function bindTabs() {
    byId('feedTabs')?.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', async () => {
        state.tab = button.dataset.tab || 'latest';
        byId('feedTabs').querySelectorAll('[data-tab]').forEach((tabButton) => {
          tabButton.classList.toggle('active', tabButton === button);
        });
        await loadFeed();
      });
    });
  }

  function bindCreatePost() {
    const form = byId('createCampusPostForm');
    if (!form) return;

    const typeNode = byId('postType');
    const pollField = byId('pollOptionsField');
    typeNode?.addEventListener('change', () => {
      const type = typeNode.value;
      if (!pollField) return;
      pollField.style.display = type === 'poll' ? 'grid' : 'none';
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const statusNode = byId('createCampusPostStatus');
      form.classList.add('loading');
      statusNode.textContent = 'Submitting post for moderation...';
      statusNode.style.color = '#5b7086';

      try {
        const formData = new FormData();
        formData.append('postType', byId('postType').value);
        formData.append('category', byId('postCategory').value);
        formData.append('title', byId('postTitle').value.trim());
        formData.append('description', byId('postDescription').value.trim());
        formData.append('tags', byId('postTags').value.trim());
        formData.append('eventStartsAt', byId('postEventAt').value || '');
        formData.append('eventVenue', byId('postEventVenue').value.trim());
        formData.append('pollOptions', byId('postPollOptions').value.trim());
        formData.append('pollEndsAt', byId('postPollEndsAt').value || '');
        formData.append('isUrgent', String(Boolean(byId('postUrgent').checked)));

        const file = byId('postMedia').files?.[0];
        if (file) formData.append('media', file);

        await window.CollegeOSApi.createCampusPost(formData);
        statusNode.textContent = 'Submitted. Your post is pending admin approval.';
        statusNode.style.color = '#1f7b47';
        form.reset();
        pollField.style.display = 'none';
        await Promise.all([loadSummary(), loadSubmissions()]);
      } catch (error) {
        statusNode.textContent = error.message || 'Failed to submit post.';
        statusNode.style.color = '#b43a3a';
      } finally {
        form.classList.remove('loading');
      }
    });
  }

  function bindCollectionsUI() {
    byId('createCollectionBtn')?.addEventListener('click', async () => {
      const name = byId('newCollectionName').value.trim();
      if (!name) return;
      try {
        await window.CollegeOSApi.createCampusCollection(name);
        byId('newCollectionName').value = '';
        await loadCollections();
        await loadFeed(true);
      } catch (error) {
        setStatus('campusFeedStatus', error.message || 'Unable to create collection', true);
      }
    });

    byId('refreshCollectionsBtn')?.addEventListener('click', async () => {
      await loadCollections();
    });
  }

  function bindRealtime() {
    if (typeof window.EventSource !== 'function') return;
    const streamUrl = window.CollegeOSApi.getCampusRealtimeStreamUrl
      ? window.CollegeOSApi.getCampusRealtimeStreamUrl()
      : '/api/campus-feed/stream';

    const connect = () => {
      state.realtimeSource?.close();
      state.realtimeSource = new EventSource(streamUrl, { withCredentials: true });

      const softRefresh = () => {
        loadFeed(true).catch(() => {});
        loadTrending().catch(() => {});
        loadSubmissions().catch(() => {});
        loadSummary().catch(() => {});
      };

      ['campus_post_engagement', 'campus_post_comment', 'campus_post_moderated', 'campus_post_featured', 'campus_post_auto_held', 'campus_official_post_published', 'campus_poll_vote']
        .forEach((eventName) => state.realtimeSource.addEventListener(eventName, softRefresh));

      state.realtimeSource.onerror = () => {
        state.realtimeSource?.close();
        state.realtimeSource = null;
        setTimeout(connect, 2500);
      };
    };

    connect();
    window.addEventListener('beforeunload', () => state.realtimeSource?.close());
  }

  byId('refreshCampusFeedBtn')?.addEventListener('click', async () => {
    await Promise.all([loadFeed(), loadTrending(), loadSubmissions(), loadSummary(), loadCollections()]);
  });

  async function init() {
    bindTabs();
    bindCreatePost();
    bindCollectionsUI();

    try {
      await Promise.all([loadSummary(), loadFeed(), loadTrending(), loadSubmissions(), loadCollections()]);
      bindRealtime();
    } catch (error) {
      setStatus('campusFeedStatus', error.message || 'Unable to initialize campus feed', true);
    }
  }

  init();
});
