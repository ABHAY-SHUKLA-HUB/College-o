async function ensureAdminSession() {
  try {
    await window.CollegeOSApi.adminDashboard();
  } catch (_error) {
    window.location.href = 'admin-login.html';
  }
}

async function loadAcademicOptions() {
  try {
    const [categoriesResponse, semestersResponse] = await Promise.all([
      window.CollegeOSApi.getAcademicCategories(),
      window.CollegeOSApi.getAcademicSemesters()
    ]);

    const categories = categoriesResponse.categories || [];
    const semesters = semestersResponse.semesters || [];

    const categorySelects = [
      document.getElementById('noteCategoryId'),
      document.getElementById('notesFilterCategoryId')
    ];

    categorySelects.forEach((select) => {
      if (!select) return;
      select.innerHTML = select.id.includes('Filter') ? '<option value="">All categories</option>' : '<option value="">Select category</option>';
      categories.forEach((category) => {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = category.name;
        select.appendChild(option);
      });
    });

    const semesterSelects = [
      document.getElementById('noteSemesterId'),
      document.getElementById('notesFilterSemesterId')
    ];

    semesterSelects.forEach((select) => {
      if (!select) return;
      select.innerHTML = select.id.includes('Filter') ? '<option value="">All semesters</option>' : '<option value="">Select semester</option>';
      semesters.forEach((semester) => {
        const option = document.createElement('option');
        option.value = semester.id;
        option.textContent = semester.label;
        select.appendChild(option);
      });
    });
  } catch (err) {
    console.error('Error loading academic options:', err);
  }
}

async function updateBranchSelect(categorySelectId, branchSelectId, emptyLabel) {
  const categorySelect = document.getElementById(categorySelectId);
  const branchSelect = document.getElementById(branchSelectId);
  if (!categorySelect || !branchSelect) return;

  const categoryId = categorySelect.value;
  branchSelect.innerHTML = `<option value="">${emptyLabel}</option>`;

  if (!categoryId) {
    branchSelect.disabled = true;
    return;
  }

  try {
    const branchesResponse = await window.CollegeOSApi.getAcademicBranches(categoryId);
    const branches = branchesResponse.branches || [];

    branches.forEach((branch) => {
      const option = document.createElement('option');
      option.value = branch.id;
      option.textContent = branch.name;
      branchSelect.appendChild(option);
    });

    branchSelect.disabled = false;
  } catch (err) {
    console.error('Error fetching branches:', err);
    branchSelect.disabled = true;
  }
}

document.getElementById('uploadNoteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById('uploadStatus');
  const submitBtn = document.getElementById('uploadSubmitBtn') || form.querySelector('button[type="submit"]');

  const formData = new FormData(form);
  const fileInput = document.getElementById('noteFileInput');
  const file = fileInput ? fileInput.files[0] : null;

  if (!file) {
    status.textContent = '✕ Please select a PDF file to upload.';
    status.style.color = '#c6342d';
    return;
  }

  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    status.textContent = '✕ Invalid file type. Only PDF documents are allowed.';
    status.style.color = '#c6342d';
    return;
  }

  // Prevent duplicate submissions
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading to Supabase Storage...';
  status.textContent = 'Uploading note file to Supabase Storage & database...';
  status.style.color = '#0ea5e9';

  try {
    const data = await window.CollegeOSApiClient.request('/api/admin/content/notes', {
      method: 'POST',
      body: formData
    });

    status.textContent = '✓ Note published successfully to Supabase Storage & Database!';
    status.style.color = '#157f37';
    form.reset();

    const branchSelect = document.getElementById('noteBranchId');
    if (branchSelect) {
      branchSelect.innerHTML = '<option value="">Select branch or course</option>';
      branchSelect.disabled = true;
    }

    await loadNotes();
  } catch (error) {
    console.error('Note upload error:', error);
    status.textContent = '✕ Upload failed: ' + (error.message || 'An error occurred during upload.');
    status.style.color = '#c6342d';
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-upload"></i> Upload Note';
  }
});

async function loadNotes() {
  const tbody = document.getElementById('notesTableBody');
  if (!tbody) return;

  try {
    const params = new URLSearchParams();
    const categoryId = document.getElementById('notesFilterCategoryId')?.value || '';
    const branchId = document.getElementById('notesFilterBranchId')?.value || '';
    const semesterId = document.getElementById('notesFilterSemesterId')?.value || '';
    const status = document.getElementById('notesFilterStatus')?.value || '';

    if (categoryId) params.set('categoryId', categoryId);
    if (branchId) params.set('branchId', branchId);
    if (semesterId) params.set('semesterId', semesterId);
    if (status) params.set('status', status);

    const suffix = params.toString() ? `?${params.toString()}` : '';
    const data = await window.CollegeOSApiClient.request(`/api/admin/content/notes${suffix}`);

    if (data.notes && data.notes.length > 0) {
      tbody.innerHTML = data.notes.map((note) => `
        <tr>
          <td><strong>${note.subject || 'N/A'}</strong></td>
          <td>${note.chapter || 'N/A'}</td>
          <td><span class="co-admin-badge">${note.category_name || 'N/A'}</span></td>
          <td>${note.branch_name || (note.is_common ? '<span style="color:#0ea5e9; font-weight:600;">Common</span>' : '-')}</td>
          <td>${note.semester_label || 'All Semesters'}</td>
          <td><span class="co-admin-badge">${note.difficulty || 'medium'}</span></td>
          <td><span class="co-admin-badge">${note.status || 'published'}</span></td>
          <td><button class="btn danger sm" data-action="delete-note" data-note-id="${note.id}"><i class="fa-solid fa-trash"></i> Delete</button></td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="8" class="co-admin-table-empty">No notes found matching filters.</td></tr>';
    }
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="8" class="co-admin-table-empty" style="color:#c6342d;"><i class="fa-solid fa-exclamation-circle"></i> ${error.message}</td></tr>`;
  }
}

async function deleteNote(id) {
  if (!confirm('Are you sure you want to delete this note?')) return;

  try {
    await window.CollegeOSApiClient.request(`/api/admin/content/notes/${id}`, {
      method: 'DELETE',
    });
    loadNotes();
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

document.getElementById('notesTableBody').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="delete-note"]');
  if (!button) return;
  const noteId = Number(button.dataset.noteId);
  if (!Number.isInteger(noteId) || noteId <= 0) return;
  await deleteNote(noteId);
});

document.getElementById('noteCategoryId').addEventListener('change', async () => {
  await updateBranchSelect('noteCategoryId', 'noteBranchId', 'Select branch or course');
});

document.getElementById('notesFilterCategoryId').addEventListener('change', async () => {
  await updateBranchSelect('notesFilterCategoryId', 'notesFilterBranchId', 'All branches/courses');
  await loadNotes();
});

document.getElementById('notesFilterBranchId').addEventListener('change', loadNotes);
document.getElementById('notesFilterSemesterId').addEventListener('change', loadNotes);
document.getElementById('notesFilterStatus').addEventListener('change', loadNotes);

document.getElementById('isCommonCheckbox')?.addEventListener('change', (e) => {
  const branchSelect = document.getElementById('noteBranchId');
  if (!branchSelect) return;
  if (e.target.checked) {
    branchSelect.disabled = true;
    branchSelect.value = '';
  } else {
    const categoryId = document.getElementById('noteCategoryId')?.value;
    if (categoryId) {
      branchSelect.disabled = false;
    }
  }
});

(async () => {
  await ensureAdminSession();
  await loadAcademicOptions();
  await loadNotes();
})();

window.addEventListener('collegeos:realtime', (event) => {
  if (event?.detail?.type !== 'content_changed') return;
  loadNotes();
});
