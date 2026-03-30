document.addEventListener('DOMContentLoaded', () => {
  if (!window.CollegeOSApi) return;

  const byId = (id) => document.getElementById(id);
  const state = {
    filter: 'latest',
    category: 'all',
    search: '',
    selectedThreadId: null,
    selectedTags: new Set()
  };

  function setStatus(text, isErr = false) {
    const node = byId('forumStatus');
    if (!node) return;
    node.textContent = text;
    node.style.color = isErr ? '#b33737' : '#5f6f82';
  }

  async function emitForumEvent(eventType, eventPayload = {}) {
    if (!window.CollegeOSApi?.trackLearnerEvent) return;
    try {
      await window.CollegeOSApi.trackLearnerEvent({
        eventType,
        source: 'forum',
        eventPayload
      });
    } catch {
      // Keep forum interactions fast even if telemetry fails.
    }
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'U';
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  }

  function avatarStyle(name) {
    const colors = ['#0f7b6c', '#2f6fed', '#da4e3a', '#8c2ad8', '#006e8f', '#7b3f00'];
    const hash = String(name || '').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    return `background:${colors[hash % colors.length]}`;
  }

  function timeAgo(value) {
    const dt = new Date(value);
    const now = new Date();
    const diffMs = now - dt;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return dt.toLocaleDateString('en-IN');
  }

  function chipActive(containerId, dataKey, value) {
    const wrap = byId(containerId);
    if (!wrap) return;
    wrap.querySelectorAll(`[data-${dataKey}]`).forEach((chip) => {
      chip.classList.toggle('active', chip.dataset[dataKey] === value);
    });
  }

  function renderThreadCards(threads) {
    const list = byId('threadList');
    if (!threads.length) {
      list.innerHTML = '<div class="empty-state">No discussions found. Start a discussion to help peers and build your learning community.</div>';
      return;
    }

    list.innerHTML = threads.map((thread) => {
      const tags = Array.isArray(thread.tags) ? thread.tags : [];
      return `
        <article class="thread-item" data-open-thread="${thread.id}">
          <div style="display:flex;justify-content:space-between;gap:.6rem;align-items:flex-start;">
            <div>
              <h3 style="margin:0;font-size:1rem;">${thread.title}</h3>
              <div class="thread-meta">
                <span class="tiny-pill"><i class="fa-solid fa-folder"></i> ${thread.category}</span>
                <span class="tiny-pill"><i class="fa-regular fa-message"></i> ${thread.replies_count || 0} replies</span>
                <span class="tiny-pill"><i class="fa-regular fa-eye"></i> ${thread.views_count || 0} views</span>
                ${thread.has_best_answer ? '<span class="tiny-pill" style="background:#e3f7ea;color:#22693f;"><i class="fa-solid fa-circle-check"></i> Best Answer</span>' : ''}
              </div>
            </div>
            <div style="font-size:.75rem;color:#607489;white-space:nowrap;">${timeAgo(thread.created_at)}</div>
          </div>
          <p style="margin:.52rem 0;color:#41586f;">${thread.body.length > 170 ? `${thread.body.slice(0, 170)}...` : thread.body}</p>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;">
            <div class="author"><span class="avatar" style="${avatarStyle(thread.author)}">${initials(thread.author)}</span><span style="font-size:.84rem;">${thread.author}</span></div>
            <div class="thread-meta">${tags.map((tag) => `<span class="tiny-pill">${tag}</span>`).join('')}</div>
          </div>
        </article>
      `;
    }).join('');

    list.querySelectorAll('[data-open-thread]').forEach((card) => {
      card.addEventListener('click', async () => {
        const id = Number(card.dataset.openThread);
        if (!Number.isInteger(id)) return;
        state.selectedThreadId = id;
        await window.CollegeOSApi.incrementThreadViews(id);
        await renderThreadDetail(id, { trackView: true, entryPoint: 'thread_list' });
        await loadThreads();
      });
    });
  }

  function buildTree(replies) {
    const map = new Map();
    replies.forEach((r) => map.set(r.id, { ...r, children: [] }));
    const roots = [];
    map.forEach((r) => {
      if (r.parent_reply_id && map.has(r.parent_reply_id)) {
        map.get(r.parent_reply_id).children.push(r);
      } else {
        roots.push(r);
      }
    });
    return roots;
  }

  function replyNodeHtml(reply, level = 0, thread) {
    const indent = Math.min(level, 1);
    return `
      <div class="reply level-${indent}" data-reply-id="${reply.id}">
        <div class="reply-head">
          <div class="author"><span class="avatar" style="${avatarStyle(reply.author)}">${initials(reply.author)}</span><strong style="font-size:.84rem;">${reply.author}</strong></div>
          <div style="font-size:.75rem;color:#607489;">${timeAgo(reply.created_at)}</div>
        </div>
        <p style="margin:.45rem 0;color:#3f566f;">${reply.body}</p>
        <div class="reply-actions">
          <button class="btn-mini secondary" data-reply-btn="reply" data-id="${reply.id}"><i class="fa-solid fa-reply"></i> Reply</button>
          <button class="btn-mini secondary" data-reply-btn="upvote" data-id="${reply.id}"><i class="fa-regular fa-thumbs-up"></i> ${reply.upvotes || 0}</button>
          ${thread.is_mine ? `<button class="btn-mini good" data-reply-btn="best" data-id="${reply.id}"><i class="fa-solid fa-check"></i> ${reply.is_best_answer ? 'Best Answer' : 'Mark Best'}</button>` : ''}
          ${reply.is_best_answer ? '<span class="tiny-pill" style="background:#e3f7ea;color:#22693f;">Best Answer</span>' : ''}
        </div>
        <div data-reply-form="${reply.id}" style="display:none;margin-top:.45rem;">
          <textarea rows="2" data-reply-input="${reply.id}" placeholder="Add nested reply" style="width:100%;border:1px solid #d2deeb;border-radius:8px;padding:.42rem .52rem;"></textarea>
          <div style="margin-top:.35rem;"><button class="btn-mini secondary" data-reply-btn="submit-child" data-id="${reply.id}">Post Reply</button></div>
        </div>
        ${(reply.children || []).map((child) => replyNodeHtml(child, level + 1, thread)).join('')}
      </div>
    `;
  }

  async function renderThreadDetail(threadId, options = {}) {
    const mount = byId('threadDetail');
    const payload = await window.CollegeOSApi.getThreadDetail(threadId);
    const thread = payload.thread;
    const tree = buildTree(payload.replies || []);

    if (options.trackView) {
      emitForumEvent('forum_thread_opened', {
        threadId,
        category: thread?.category || null,
        repliesCount: thread?.replies_count || 0,
        viewsCount: thread?.views_count || 0,
        entryPoint: options.entryPoint || 'unknown'
      });
    }

    mount.innerHTML = `
      <article>
        <h3 style="margin:0 0 .35rem;">${thread.title}</h3>
        <div class="thread-meta">
          <span class="tiny-pill"><i class="fa-solid fa-folder"></i> ${thread.category}</span>
          <span class="tiny-pill"><i class="fa-regular fa-eye"></i> ${thread.views_count || 0}</span>
          <span class="tiny-pill"><i class="fa-regular fa-message"></i> ${thread.replies_count || 0}</span>
          <span class="tiny-pill">${timeAgo(thread.created_at)}</span>
        </div>
        <p style="margin:.6rem 0 .75rem;color:#3f566f;">${thread.body}</p>

        <div style="border:1px solid #dce5f0;border-radius:10px;padding:.58rem;background:#f9fcff;">
          <textarea id="rootReplyInput" rows="3" placeholder="Write your reply" style="width:100%;border:1px solid #d2deeb;border-radius:8px;padding:.45rem .55rem;"></textarea>
          <div style="margin-top:.45rem;"><button class="btn-mini secondary" id="postRootReplyBtn"><i class="fa-solid fa-paper-plane"></i> Reply</button></div>
        </div>

        <div class="reply-tree" style="margin-top:.7rem;">${tree.map((reply) => replyNodeHtml(reply, 0, thread)).join('') || '<div class="empty-state">No replies yet. Be the first one to help.</div>'}</div>
      </article>
    `;

    byId('postRootReplyBtn')?.addEventListener('click', async () => {
      const body = byId('rootReplyInput').value.trim();
      if (!body) return;
      await window.CollegeOSApi.createReply(threadId, { body });
      await renderThreadDetail(threadId);
      await loadThreads();
    });

    mount.querySelectorAll('[data-reply-btn]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const replyId = Number(btn.dataset.id);
        const action = btn.dataset.replyBtn;
        if (!Number.isInteger(replyId)) return;

        if (action === 'reply') {
          const box = mount.querySelector(`[data-reply-form="${replyId}"]`);
          if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
          return;
        }

        if (action === 'submit-child') {
          const input = mount.querySelector(`[data-reply-input="${replyId}"]`);
          const body = input?.value?.trim();
          if (!body) return;
          await window.CollegeOSApi.createReply(threadId, { body, parentReplyId: replyId });
          await renderThreadDetail(threadId);
          await loadThreads();
          return;
        }

        if (action === 'upvote') {
          await window.CollegeOSApi.upvoteReply(replyId);
          await renderThreadDetail(threadId);
          return;
        }

        if (action === 'best') {
          await window.CollegeOSApi.markBestAnswer(threadId, replyId);
          await renderThreadDetail(threadId);
          await loadThreads();
        }
      });
    });
  }

  async function loadTrending() {
    const mount = byId('trendingList');
    const payload = await window.CollegeOSApi.getTrendingThreads();
    const rows = payload.threads || [];
    if (!rows.length) {
      mount.innerHTML = '<div class="empty-state">No trending discussions yet.</div>';
      return;
    }

    mount.innerHTML = rows.map((t) => `
      <article class="thread-item" data-trend-open="${t.id}" style="padding:.6rem;">
        <strong style="font-size:.86rem;">${t.title}</strong>
        <div class="thread-meta" style="margin-top:.25rem;">
          <span class="tiny-pill">${t.category}</span>
          <span class="tiny-pill"><i class="fa-regular fa-message"></i> ${t.replies_count || 0}</span>
          <span class="tiny-pill"><i class="fa-regular fa-eye"></i> ${t.views_count || 0}</span>
        </div>
      </article>
    `).join('');

    mount.querySelectorAll('[data-trend-open]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.trendOpen);
        state.selectedThreadId = id;
        await window.CollegeOSApi.incrementThreadViews(id);
        await renderThreadDetail(id, { trackView: true, entryPoint: 'trending' });
        await loadThreads();
      });
    });
  }

  async function loadThreads() {
    const payload = await window.CollegeOSApi.getThreads({
      filter: state.filter,
      search: state.search,
      category: state.category
    });
    renderThreadCards(payload.threads || []);
  }

  function bindControls() {
    let searchTimer = null;
    byId('forumSearchInput')?.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        state.search = e.target.value.trim();
        await loadThreads();
      }, 260);
    });

    byId('forumFilterChips')?.querySelectorAll('[data-filter]').forEach((chip) => {
      chip.addEventListener('click', async () => {
        state.filter = chip.dataset.filter || 'latest';
        chipActive('forumFilterChips', 'filter', state.filter);
        await loadThreads();
      });
    });

    byId('forumCategoryChips')?.querySelectorAll('[data-category]').forEach((chip) => {
      chip.addEventListener('click', async () => {
        state.category = chip.dataset.category || 'all';
        chipActive('forumCategoryChips', 'category', state.category);
        await loadThreads();
      });
    });

    byId('tagPool')?.querySelectorAll('[data-tag]').forEach((tag) => {
      tag.addEventListener('click', () => {
        const val = tag.dataset.tag;
        if (state.selectedTags.has(val)) {
          state.selectedTags.delete(val);
          tag.classList.remove('active');
        } else {
          state.selectedTags.add(val);
          tag.classList.add('active');
        }
      });
    });

    byId('newThreadForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = byId('threadTitle').value.trim();
      const body = byId('threadBody').value.trim();
      const category = byId('threadCategory').value;
      const tags = [...state.selectedTags];

      if (!title || !body) return;

      try {
        await window.CollegeOSApi.createThread({ title, body, category, tags });
        byId('newThreadForm').reset();
        state.selectedTags.clear();
        byId('tagPool').querySelectorAll('.tag-item').forEach((x) => x.classList.remove('active'));
        setStatus('Discussion posted successfully.');
        await loadThreads();
        await loadTrending();
      } catch (error) {
        setStatus(error.message || 'Failed to create thread.', true);
      }
    });
  }

  async function init() {
    bindControls();
    try {
      await Promise.all([loadThreads(), loadTrending()]);
    } catch (error) {
      byId('threadList').innerHTML = `<div class="empty-state">${error.message}</div>`;
      byId('trendingList').innerHTML = `<div class="empty-state">${error.message}</div>`;
    }
  }

  init();
});
