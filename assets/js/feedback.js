document.addEventListener('DOMContentLoaded', () => {
  if (!window.CollegeOSApi) return;

  const byId = (id) => document.getElementById(id);
  const state = {
    activeFilter: 'all',
    feedbackRows: [],
    currentRating: 5,
    editingId: null
  };

  function statusClass(status) {
    const s = String(status || 'Submitted');
    if (s === 'Resolved') return 'status status-resolved';
    if (s === 'Replied') return 'status status-replied';
    if (s === 'Under Review') return 'status status-review';
    return 'status status-submitted';
  }

  function setStatus(text, isError = false) {
    const node = byId('feedbackStatus');
    if (!node) return;
    node.textContent = text;
    node.style.color = isError ? '#b33737' : '#5f6f82';
  }

  function timeText(value) {
    const dt = new Date(value);
    return `${dt.toLocaleDateString('en-IN')} ${dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  }

  function canEdit(row) {
    return !row.admin_reply && String(row.status || 'Submitted') === 'Submitted';
  }

  function initStars() {
    const wrap = byId('ratingStars');
    if (!wrap) return;

    wrap.innerHTML = Array.from({ length: 5 }, (_, i) => `<button type="button" class="star" data-star="${i + 1}"><i class="fa-solid fa-star"></i></button>`).join('');
    const apply = (value) => {
      state.currentRating = value;
      byId('feedbackRating').value = String(value);
      wrap.querySelectorAll('[data-star]').forEach((btn) => {
        btn.classList.toggle('active', Number(btn.dataset.star) <= value);
      });
    };

    wrap.querySelectorAll('[data-star]').forEach((btn) => {
      btn.addEventListener('click', () => apply(Number(btn.dataset.star)));
    });

    apply(state.currentRating);
  }

  function updateStats(stats) {
    byId('statTotalFeedback').textContent = String(stats?.total_submitted || 0);
    byId('statResolved').textContent = String(stats?.resolved_issues || 0);
    byId('statPending').textContent = String(stats?.pending_reviews || 0);
    byId('statAvgRating').textContent = Number(stats?.average_rating || 0).toFixed(2);
  }

  function cardActions(row) {
    const actions = [`<button class="btn-mini secondary" data-action="view" data-id="${row.id}"><i class="fa-regular fa-eye"></i> View Full Feedback</button>`];
    if (canEdit(row)) {
      actions.push(`<button class="btn-mini warn" data-action="edit" data-id="${row.id}"><i class="fa-regular fa-pen-to-square"></i> Edit Feedback</button>`);
      actions.push(`<button class="btn-mini danger" data-action="delete" data-id="${row.id}"><i class="fa-regular fa-trash-can"></i> Delete Feedback</button>`);
    }
    if (row.admin_reply) {
      actions.push(`<button class="btn-mini secondary" data-action="reply" data-id="${row.id}"><i class="fa-regular fa-message"></i> View Reply</button>`);
    }
    return actions.join('');
  }

  function renderList(rows) {
    const mount = byId('myFeedbackList');
    if (!rows.length) {
      mount.innerHTML = '<div class="empty"><h3 style="margin:.2rem 0;">No feedback yet</h3><p style="margin:0;">Share your learning experience, report issues, or suggest new features to help us improve College OS.</p></div>';
      return;
    }

    mount.innerHTML = rows.map((row) => {
      const preview = row.message.length > 150 ? `${row.message.slice(0, 150)}...` : row.message;
      return `
        <article class="feedback-card">
          <div style="display:flex;justify-content:space-between;gap:.5rem;align-items:flex-start;">
            <div>
              <strong>${row.rating}/5 <i class="fa-solid fa-star" style="color:#efb022;"></i></strong>
              <div class="meta" style="margin-top:.25rem;">
                <span class="pill">${row.category || 'General Feedback'}</span>
                <span class="${statusClass(row.status)}">${row.status || 'Submitted'}</span>
                <span>${timeText(row.created_at)}</span>
                ${row.is_anonymous ? '<span class="pill"><i class="fa-regular fa-user-secret"></i> Anonymous</span>' : ''}
              </div>
            </div>
          </div>
          <p style="margin:.55rem 0;color:#3f566f;">${preview}</p>
          <p style="margin:0;color:#5f6f82;font-size:.78rem;">Admin reply: ${row.admin_reply ? 'Available' : 'Pending'}</p>
          <div class="card-actions">${cardActions(row)}</div>
        </article>
      `;
    }).join('');

    mount.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        const action = btn.dataset.action;
        const row = state.feedbackRows.find((x) => Number(x.id) === id);
        if (!row) return;

        if (action === 'view') {
          alert(`Feedback\n\nCategory: ${row.category}\nRating: ${row.rating}/5\nStatus: ${row.status}\nDate: ${timeText(row.created_at)}\n\n${row.message}`);
          return;
        }
        if (action === 'reply') {
          alert(`Admin Reply\n\n${row.admin_reply}`);
          return;
        }
        if (action === 'edit') {
          startEdit(row);
          return;
        }
        if (action === 'delete') {
          try {
            await window.CollegeOSApi.deleteFeedback(id);
            setStatus('Feedback deleted successfully.');
            await reload();
          } catch (error) {
            setStatus(error.message, true);
          }
        }
      });
    });
  }

  function filteredRows() {
    const f = state.activeFilter;
    if (f === 'my' || f === 'all') return state.feedbackRows;
    if (f === 'replied') return state.feedbackRows.filter((x) => x.admin_reply || x.status === 'Replied');
    if (f === 'pending') return state.feedbackRows.filter((x) => !x.admin_reply && ['Submitted', 'Under Review'].includes(String(x.status || 'Submitted')));
    if (f === 'resolved') return state.feedbackRows.filter((x) => String(x.status || '') === 'Resolved');
    return state.feedbackRows;
  }

  function render() {
    renderList(filteredRows());
  }

  function resetForm() {
    state.editingId = null;
    byId('feedbackEditId').value = '';
    byId('feedbackForm').reset();
    state.currentRating = 5;
    byId('feedbackRating').value = '5';
    byId('feedbackSubmitBtn').textContent = 'Submit Feedback';
    byId('feedbackCancelEditBtn').style.display = 'none';
    initStars();
  }

  function startEdit(row) {
    state.editingId = Number(row.id);
    byId('feedbackEditId').value = String(row.id);
    byId('feedbackCategory').value = row.category || 'General Feedback';
    byId('feedbackMessage').value = row.message || '';
    byId('feedbackScreenshot').value = row.screenshot_url || '';
    byId('feedbackAnonymous').checked = Boolean(row.is_anonymous);
    state.currentRating = Number(row.rating) || 5;
    initStars();
    byId('feedbackSubmitBtn').textContent = 'Update Feedback';
    byId('feedbackCancelEditBtn').style.display = 'inline-flex';
    setStatus('Editing feedback. You can update before review starts.');
  }

  async function submitForm(event) {
    event.preventDefault();

    const rating = Number(byId('feedbackRating').value || 5);
    const category = byId('feedbackCategory').value;
    const message = byId('feedbackMessage').value.trim();
    const isAnonymous = byId('feedbackAnonymous').checked;

    if (!message) {
      setStatus('Please add your feedback message.', true);
      return;
    }

    let screenshotUrl = byId('feedbackScreenshot').value.trim();
    const screenshotFile = byId('feedbackScreenshotFile').files[0];

    try {
      if (screenshotFile) {
        const uploaded = await window.CollegeOSApi.uploadFeedbackScreenshot(screenshotFile);
        screenshotUrl = uploaded.screenshotUrl;
      }

      const payload = { rating, message, screenshotUrl, category, isAnonymous };
      if (state.editingId) {
        await window.CollegeOSApi.updateFeedback(state.editingId, payload);
        setStatus('Feedback updated successfully.');
      } else {
        await window.CollegeOSApi.submitFeedback(payload);
        setStatus('Thank you for your feedback. We have received your report.');
      }

      resetForm();
      await reload();
    } catch (error) {
      setStatus(error.message || 'Unable to submit feedback.', true);
    }
  }

  async function reload() {
    const [list, stats] = await Promise.all([
      window.CollegeOSApi.getMyFeedbackByFilter('all'),
      window.CollegeOSApi.getFeedbackStats()
    ]);

    state.feedbackRows = list.feedback || [];
    updateStats(stats.stats || {});
    render();
  }

  function bindFilters() {
    byId('feedbackFilters')?.querySelectorAll('[data-filter]').forEach((chip) => {
      chip.addEventListener('click', () => {
        state.activeFilter = chip.dataset.filter || 'all';
        byId('feedbackFilters').querySelectorAll('[data-filter]').forEach((x) => x.classList.remove('active'));
        chip.classList.add('active');
        render();
      });
    });
  }

  function init() {
    initStars();
    bindFilters();
    byId('feedbackForm')?.addEventListener('submit', submitForm);
    byId('feedbackCancelEditBtn')?.addEventListener('click', resetForm);

    reload().catch((error) => {
      setStatus(error.message, true);
      byId('myFeedbackList').innerHTML = `<div class="empty">${error.message}</div>`;
    });
  }

  init();
});
