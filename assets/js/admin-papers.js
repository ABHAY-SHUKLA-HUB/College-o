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

      [document.getElementById('paperCategoryId'), document.getElementById('papersFilterCategoryId')].forEach((select) => {
        categories.forEach((category) => {
          const option = document.createElement('option');
          option.value = category.id;
          option.textContent = category.name;
          select.appendChild(option);
        });
      });

      [document.getElementById('paperSemesterId'), document.getElementById('papersFilterSemesterId')].forEach((select) => {
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

    document.getElementById('uploadPaperForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = document.getElementById('uploadStatus');
      const formData = new FormData(e.target);

      try {
        status.textContent = 'Uploading...';
        const data = await window.CollegeOSApiClient.request('/api/admin/content/papers', {
          method: 'POST',
          body: formData
        });

        status.textContent = 'Paper uploaded successfully!';
        status.style.color = '#157f37';
        e.target.reset();
        document.getElementById('paperBranchId').innerHTML = '<option value="">Select branch or course</option>';
        document.getElementById('paperBranchId').disabled = true;
        loadPapers();
      } catch (error) {
        status.textContent = 'Error: ' + error.message;
        status.style.color = '#c6342d';
      }
    });

    async function loadPapers() {
      const tbody = document.getElementById('papersTableBody');
      try {
        const params = new URLSearchParams();
        const categoryId = document.getElementById('papersFilterCategoryId').value;
        const branchId = document.getElementById('papersFilterBranchId').value;
        const semesterId = document.getElementById('papersFilterSemesterId').value;
        const status = document.getElementById('papersFilterStatus').value;
        if (categoryId) params.set('categoryId', categoryId);
        if (branchId) params.set('branchId', branchId);
        if (semesterId) params.set('semesterId', semesterId);
        if (status) params.set('status', status);

        const suffix = params.toString() ? `?${params.toString()}` : '';
        const response = await fetch(`/api/admin/papers${suffix}`, { credentials: 'include' });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load papers');
        }

        if (data.papers && data.papers.length > 0) {
          tbody.innerHTML = data.papers.map(paper => `
            <tr>
              <td>${paper.subject || 'N/A'}</td>
              <td>${paper.exam_name || 'N/A'}</td>
              <td>${paper.year || 'N/A'}</td>
              <td>${paper.branch_name || (paper.is_common ? 'Common' : '-')}</td>
              <td>${paper.semester_label || 'All'}</td>
              <td><a href="${paper.paper_url}" target="_blank" class="btn secondary sm">View PDF</a></td>
              <td><button class="btn danger sm" data-action="delete-paper" data-paper-id="${paper.id}"><i class="fa-solid fa-trash"></i> Delete</button></td>
            </tr>
          `).join('');
        } else {
          tbody.innerHTML = '<tr><td colspan="7" class="co-admin-table-empty">No papers found.</td></tr>';
        }
      } catch (error) {
        tbody.innerHTML = `<tr><td colspan="7" class="co-admin-table-empty" style="color:#c6342d;">${error.message}</td></tr>`;
      }
    }

    async function deletePaper(id) {
      if (!confirm('Delete this paper?')) return;
      try {
        await fetch(`/api/admin/papers/${id}`, { method: 'DELETE', credentials: 'include' });
        loadPapers();
      } catch (error) {
        alert('Error: ' + error.message);
      }
    }

    document.getElementById('papersTableBody').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action="delete-paper"]');
      if (!button) return;
      const paperId = Number(button.dataset.paperId);
      if (!Number.isInteger(paperId) || paperId <= 0) return;
      await deletePaper(paperId);
    });

    document.getElementById('paperCategoryId').addEventListener('change', async () => {
      await updateBranchSelect('paperCategoryId', 'paperBranchId', 'Select branch or course');
    });

    document.getElementById('papersFilterCategoryId').addEventListener('change', async () => {
      await updateBranchSelect('papersFilterCategoryId', 'papersFilterBranchId', 'All branches/courses');
      await loadPapers();
    });

    document.getElementById('papersFilterBranchId').addEventListener('change', loadPapers);
    document.getElementById('papersFilterSemesterId').addEventListener('change', loadPapers);
    document.getElementById('papersFilterStatus').addEventListener('change', loadPapers);

    (async () => {
      await ensureAdminSession();
      await loadAcademicOptions();
      await loadPapers();
    })();

    window.addEventListener('collegeos:realtime', (event) => {
      if (event?.detail?.type !== 'content_changed') return;
      loadPapers();
    });
  
