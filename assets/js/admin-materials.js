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

    [document.getElementById('materialCategoryId'), document.getElementById('materialsFilterCategoryId')].forEach((select) => {
      if (!select) return;
      select.innerHTML = select.id.includes('Filter') ? '<option value="">All categories</option>' : '<option value="">Select category</option>';
      categories.forEach((category) => {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = category.name;
        select.appendChild(option);
      });
    });

    [document.getElementById('materialSemesterId'), document.getElementById('materialsFilterSemesterId')].forEach((select) => {
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

document.getElementById('uploadMaterialForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById('uploadStatus');
  const submitBtn = document.getElementById('uploadSubmitBtn') || form.querySelector('button[type="submit"]');

  const formData = new FormData(form);
  const fileInput = document.getElementById('materialFileInput');
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
  status.textContent = 'Uploading file to Supabase Storage & creating material database record...';
  status.style.color = '#0ea5e9';

  try {
    const data = await window.CollegeOSApiClient.request('/api/admin/materials', {
      method: 'POST',
      body: formData
    });

    status.textContent = '✓ Material published successfully to Supabase Storage & Database!';
    status.style.color = '#157f37';
    form.reset();

    const branchSelect = document.getElementById('materialBranchId');
    if (branchSelect) {
      branchSelect.innerHTML = '<option value="">Select branch or course</option>';
      branchSelect.disabled = true;
    }

    await loadMaterials();
  } catch (error) {
    console.error('Material upload error:', error);
    status.textContent = '✕ Upload failed: ' + (error.message || 'An error occurred during upload.');
    status.style.color = '#c6342d';
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-upload"></i> Upload Material';
  }
});

async function loadMaterials() {
  const tbody = document.getElementById('materialsTableBody');
  if (!tbody) return;

  try {
    const params = new URLSearchParams();
    const materialType = document.getElementById('materialsFilterType')?.value || '';
    const categoryId = document.getElementById('materialsFilterCategoryId')?.value || '';
    const branchId = document.getElementById('materialsFilterBranchId')?.value || '';
    const semesterId = document.getElementById('materialsFilterSemesterId')?.value || '';
    const status = document.getElementById('materialsFilterStatus')?.value || '';

    if (materialType) params.set('materialType', materialType);
    if (categoryId) params.set('categoryId', categoryId);
    if (branchId) params.set('branchId', branchId);
    if (semesterId) params.set('semesterId', semesterId);
    if (status) params.set('status', status);

    const suffix = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(`/api/admin/materials${suffix}`, { credentials: 'include' });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to load materials');
    }

    if (data.materials && data.materials.length > 0) {
      tbody.innerHTML = data.materials.map(m => {
        const isBook = m.material_type === 'book';
        const isPpt = m.material_type === 'ppt';
        const typeLabel = isBook ? '📚 Book' : isPpt ? '🎯 PPT' : '📄 Document';
        const typeBadgeColor = isBook ? '#0ea5e9' : isPpt ? '#d97706' : '#64748b';
        
        return `
        <tr>
          <td><strong>${m.title || 'N/A'}</strong></td>
          <td><span class="co-admin-badge" style="background:${typeBadgeColor}15; color:${typeBadgeColor}; border-color:${typeBadgeColor}30;">${typeLabel}</span></td>
          <td><span class="co-admin-badge">${m.category_name || m.category || 'N/A'}</span></td>
          <td>${m.branch_name || (m.is_common ? '<span style="color:#0ea5e9; font-weight:600;">Common</span>' : '-')}</td>
          <td>${m.semester_label || 'All Semesters'}</td>
          <td>${(m.description || '').substring(0, 50)}${(m.description || '').length > 50 ? '...' : ''}</td>
          <td><a href="${m.file_url}" target="_blank" class="btn secondary sm"><i class="fa-solid fa-eye"></i> View PDF</a></td>
          <td><button class="btn danger sm" data-action="delete-material" data-material-id="${m.id}"><i class="fa-solid fa-trash"></i> Delete</button></td>
        </tr>
      `}).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="8" class="co-admin-table-empty">No study materials found matching filters.</td></tr>';
    }
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="8" class="co-admin-table-empty" style="color:#c6342d;"><i class="fa-solid fa-exclamation-circle"></i> ${error.message}</td></tr>`;
  }
}

async function deleteMaterial(id) {
  if (!confirm('Are you sure you want to delete this study material?')) return;
  try {
    const res = await fetch(`/api/admin/materials/${id}`, { method: 'DELETE', credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete material');
    loadMaterials();
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

document.getElementById('materialsTableBody').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="delete-material"]');
  if (!button) return;
  const materialId = Number(button.dataset.materialId);
  if (!Number.isInteger(materialId) || materialId <= 0) return;
  await deleteMaterial(materialId);
});

document.getElementById('materialCategoryId').addEventListener('change', async () => {
  await updateBranchSelect('materialCategoryId', 'materialBranchId', 'Select branch or course');
});

document.getElementById('materialsFilterCategoryId').addEventListener('change', async () => {
  await updateBranchSelect('materialsFilterCategoryId', 'materialsFilterBranchId', 'All branches/courses');
  await loadMaterials();
});

document.getElementById('materialsFilterType').addEventListener('change', loadMaterials);
document.getElementById('materialsFilterBranchId').addEventListener('change', loadMaterials);
document.getElementById('materialsFilterSemesterId').addEventListener('change', loadMaterials);
document.getElementById('materialsFilterStatus').addEventListener('change', loadMaterials);

(async () => {
  await ensureAdminSession();
  await loadAcademicOptions();
  await loadMaterials();
})();

window.addEventListener('collegeos:realtime', (event) => {
  if (event?.detail?.type !== 'content_changed') return;
  loadMaterials();
});
