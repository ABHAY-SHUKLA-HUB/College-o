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
      document.getElementById('paperCategoryId'),
      document.getElementById('papersFilterCategoryId')
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
      document.getElementById('paperSemesterId'),
      document.getElementById('papersFilterSemesterId')
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
    console.error('Error loading academic options for papers:', err);
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

document.getElementById('uploadPaperForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById('uploadStatus');
  const submitBtn = document.getElementById('uploadSubmitBtn') || form.querySelector('button[type="submit"]');

  const formData = new FormData(form);
  const fileInput = document.getElementById('paperFileInput') || form.querySelector('input[type="file"]');
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

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading to Supabase Storage...';
  status.textContent = 'Uploading question paper to Supabase Storage & database...';
  status.style.color = '#0ea5e9';

  try {
    await window.CollegeOSApiClient.request('/api/admin/content/papers', {
      method: 'POST',
      body: formData
    });

    status.textContent = '✓ Question paper published successfully!';
    status.style.color = '#157f37';
    form.reset();

    const branchSelect = document.getElementById('paperBranchId');
    if (branchSelect) {
      branchSelect.innerHTML = '<option value="">Select branch or course</option>';
      branchSelect.disabled = true;
    }

    await loadPapers();
  } catch (error) {
    console.error('Paper upload error:', error);
    status.textContent = '✕ Upload failed: ' + (error.message || 'An error occurred during upload.');
    status.style.color = '#c6342d';
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-upload"></i> Upload Paper';
  }
});

async function loadPapers() {
  const tbody = document.getElementById('papersTableBody');
  if (!tbody) return;

  try {
    const params = new URLSearchParams();
    const categoryId = document.getElementById('papersFilterCategoryId')?.value || '';
    const branchId = document.getElementById('papersFilterBranchId')?.value || '';
    const semesterId = document.getElementById('papersFilterSemesterId')?.value || '';
    const status = document.getElementById('papersFilterStatus')?.value || '';

    if (categoryId) params.set('categoryId', categoryId);
    if (branchId) params.set('branchId', branchId);
    if (semesterId) params.set('semesterId', semesterId);
    if (status) params.set('status', status);

    const suffix = params.toString() ? `?${params.toString()}` : '';
    const data = await window.CollegeOSApiClient.request(`/api/admin/content/papers${suffix}`);

    if (data.papers && data.papers.length > 0) {
      tbody.innerHTML = data.papers.map((paper) => `
        <tr>
          <td><strong>${paper.subject || 'N/A'}</strong></td>
          <td>${paper.exam_name || 'N/A'}</td>
          <td>${paper.year || 'N/A'}</td>
          <td><span class="co-admin-badge">${paper.category_name || 'N/A'}</span></td>
          <td>${paper.branch_name || (paper.is_common ? '<span style="color:#0ea5e9; font-weight:600;">Common</span>' : '-')}</td>
          <td>${paper.semester_label || 'All Semesters'}</td>
          <td><span class="co-admin-badge">${paper.status || 'published'}</span></td>
          <td><button class="btn danger sm" data-action="delete-paper" data-paper-id="${paper.id}"><i class="fa-solid fa-trash"></i> Delete</button></td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="8" class="co-admin-table-empty">No question papers found.</td></tr>';
    }
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="8" class="co-admin-table-empty" style="color:#c6342d;"><i class="fa-solid fa-exclamation-circle"></i> ${error.message}</td></tr>`;
  }
}

async function deletePaper(id) {
  if (!confirm('Are you sure you want to delete this question paper?')) return;

  try {
    await window.CollegeOSApiClient.request(`/api/admin/content/papers/${id}`, {
      method: 'DELETE',
    });
    loadPapers();
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

document.getElementById('papersTableBody')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="delete-paper"]');
  if (!button) return;
  const paperId = Number(button.dataset.paperId);
  if (!Number.isInteger(paperId) || paperId <= 0) return;
  await deletePaper(paperId);
});

document.getElementById('paperCategoryId')?.addEventListener('change', async () => {
  await updateBranchSelect('paperCategoryId', 'paperBranchId', 'Select branch or course');
});

document.getElementById('papersFilterCategoryId')?.addEventListener('change', async () => {
  await updateBranchSelect('papersFilterCategoryId', 'papersFilterBranchId', 'All branches/courses');
  await loadPapers();
});

document.getElementById('papersFilterBranchId')?.addEventListener('change', loadPapers);
document.getElementById('papersFilterSemesterId')?.addEventListener('change', loadPapers);
document.getElementById('papersFilterStatus')?.addEventListener('change', loadPapers);

document.getElementById('isCommonCheckbox')?.addEventListener('change', (e) => {
  const branchSelect = document.getElementById('paperBranchId');
  if (!branchSelect) return;
  if (e.target.checked) {
    branchSelect.disabled = true;
    branchSelect.value = '';
  } else {
    const categoryId = document.getElementById('paperCategoryId')?.value;
    if (categoryId) {
      branchSelect.disabled = false;
    }
  }
});

(async () => {
  await ensureAdminSession();
  await loadAcademicOptions();
  await loadPapers();
})();

window.addEventListener('collegeos:realtime', (event) => {
  if (event?.detail?.type !== 'content_changed') return;
  loadPapers();
});
  
