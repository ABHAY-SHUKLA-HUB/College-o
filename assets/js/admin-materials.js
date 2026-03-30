async function ensureAdminSession() {
      try {
        await window.CollegeOSApi.adminDashboard();
      } catch (_error) {
        window.location.href = 'admin-login.html';
      }
    }

    async function loadAcademicOptions() {
      const [categoriesResponse, semestersResponse] = await Promise.all([
        window.CollegeOSApi.getAcademicCategories(),
        window.CollegeOSApi.getAcademicSemesters()
      ]);

      const categories = categoriesResponse.categories || [];
      const semesters = semestersResponse.semesters || [];

      [document.getElementById('materialCategoryId'), document.getElementById('materialsFilterCategoryId')].forEach((select) => {
        categories.forEach((category) => {
          const option = document.createElement('option');
          option.value = category.id;
          option.textContent = category.name;
          select.appendChild(option);
        });
      });

      [document.getElementById('materialSemesterId'), document.getElementById('materialsFilterSemesterId')].forEach((select) => {
        semesters.forEach((semester) => {
          const option = document.createElement('option');
          option.value = semester.id;
          option.textContent = semester.label;
          select.appendChild(option);
        });
      });
    }

    async function updateBranchSelect(categorySelectId, branchSelectId, emptyLabel) {
      const categoryId = document.getElementById(categorySelectId).value;
      const branchSelect = document.getElementById(branchSelectId);
      branchSelect.innerHTML = `<option value="">${emptyLabel}</option>`;

      if (!categoryId) {
        branchSelect.disabled = true;
        return;
      }

      const branchesResponse = await window.CollegeOSApi.getAcademicBranches(categoryId);
      const branches = branchesResponse.branches || [];
      branches.forEach((branch) => {
        const option = document.createElement('option');
        option.value = branch.id;
        option.textContent = branch.name;
        branchSelect.appendChild(option);
      });
      branchSelect.disabled = false;
    }

    document.getElementById('uploadMaterialForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = document.getElementById('uploadStatus');
      const formData = new FormData(e.target);

      try {
        status.textContent = 'Uploading...';
        const response = await fetch('/api/admin/materials', {
          method: 'POST',
          credentials: 'include',
          body: formData
        });

        const data = await response.json();
        if (response.ok) {
          status.textContent = 'Material uploaded successfully!';
          status.style.color = '#157f37';
          e.target.reset();
          document.getElementById('materialBranchId').innerHTML = '<option value="">Select branch or course</option>';
          document.getElementById('materialBranchId').disabled = true;
          loadMaterials();
        } else {
          throw new Error(data.error);
        }
      } catch (error) {
        status.textContent = 'Error: ' + error.message;
        status.style.color = '#c6342d';
      }
    });

    async function loadMaterials() {
      const tbody = document.getElementById('materialsTableBody');
      try {
        const params = new URLSearchParams();
        const materialType = document.getElementById('materialsFilterType').value;
        const categoryId = document.getElementById('materialsFilterCategoryId').value;
        const branchId = document.getElementById('materialsFilterBranchId').value;
        const semesterId = document.getElementById('materialsFilterSemesterId').value;
        const status = document.getElementById('materialsFilterStatus').value;
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
            const typeLabel = m.material_type === 'book' ? '📚 Book' : m.material_type === 'ppt' ? '🎯 PPT' : 'Document';
            const typeBadgeColor = m.material_type === 'book' ? '#0ea5e9' : m.material_type === 'ppt' ? '#06b6d4' : '#94a3b8';
            return `
            <tr>
              <td><strong>${m.title || 'N/A'}</strong></td>
              <td><span class="co-admin-badge" style="background:${typeBadgeColor}20; color:${typeBadgeColor}; border-color:${typeBadgeColor}40;">${typeLabel}</span></td>
              <td><span class="co-admin-badge">${m.category || 'N/A'}</span></td>
              <td>${m.branch_name || (m.is_common ? 'Common' : '-')}</td>
              <td>${m.semester_label || 'All'}</td>
              <td>${(m.description || '').substring(0, 50)}${(m.description || '').length > 50 ? '...' : ''}</td>
              <td><a href="${m.file_url}" target="_blank" class="btn secondary sm">View</a></td>
              <td><button class="btn danger sm" data-action="delete-material" data-material-id="${m.id}"><i class="fa-solid fa-trash"></i> Delete</button></td>
            </tr>
          `}).join('');
        } else {
          tbody.innerHTML = '<tr><td colspan="8" class="co-admin-table-empty">No materials found.</td></tr>';
        }
      } catch (error) {
        tbody.innerHTML = `<tr><td colspan="8" class="co-admin-table-empty" style="color:#c6342d;">${error.message}</td></tr>`;
      }
    }

    async function deleteMaterial(id) {
      if (!confirm('Delete this material?')) return;
      try {
        await fetch(`/api/admin/materials/${id}`, { method: 'DELETE', credentials: 'include' });
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
  
