// Academic Structure State for New System
const academicStructureState = {
  colleges: [],
  courses: [],
  branches: [],
  years: [],
  semesters: []
};

// Load new academic structure data
async function loadAcademicStructure() {
  try {
    const [colleges, courses, branches, years, semesters] = await Promise.all([
      fetch('/api/academics/admin/colleges').then(r => r.json()),
      fetch('/api/academics/admin/courses').then(r => r.json()),
      fetch('/api/academics/admin/branches').then(r => r.json()),
      fetch('/api/academics/admin/years').then(r => r.json()),
      fetch('/api/academics/admin/semesters').then(r => r.json())
    ]);

    academicStructureState.colleges = colleges.data || [];
    academicStructureState.courses = courses.data || [];
    academicStructureState.branches = branches.data || [];
    academicStructureState.years = years.data || [];
    academicStructureState.semesters = semesters.data || [];

    populateAcademicStructureDropdowns();
  } catch (error) {
    console.error('Error loading academic structure:', error);
  }
}

// Populate academic structure dropdowns
function populateAcademicStructureDropdowns() {
  const collegeSelect = document.getElementById('noteCollegeId');
  if (collegeSelect) {
    collegeSelect.innerHTML = '<option value="">All Colleges (Common)</option>' +
      academicStructureState.colleges
        .filter(c => c.is_active !== false)
        .map(c => `<option value="${c.id}">${c.name}</option>`)
        .join('');

    collegeSelect.addEventListener('change', (e) => {
      const courseSelect = document.getElementById('noteCourseId');
      const collegeId = e.target.value;
      
      if (collegeId) {
        const filtered = academicStructureState.courses.filter(c => c.college_id == collegeId && c.is_active !== false);
        courseSelect.innerHTML = '<option value="">All Courses</option>' +
          filtered.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      } else {
        courseSelect.innerHTML = '<option value="">All Courses (Common)</option>';
      }
    });
  }

  const courseSelect = document.getElementById('noteCourseId');
  if (courseSelect) {
    courseSelect.addEventListener('change', (e) => {
      const branchSelect = document.getElementById('noteBranchId');
      const courseId = e.target.value;
      
      if (courseId) {
        const filtered = academicStructureState.branches.filter(b => b.course_id == courseId && b.is_active !== false);
        branchSelect.innerHTML = '<option value="">All Branches</option>' +
          filtered.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
      } else {
        branchSelect.innerHTML = '<option value="">All Branches (Common)</option>';
      }
    });
  }

  const yearSelect = document.getElementById('noteYearId');
  if (yearSelect) {
    yearSelect.innerHTML = '<option value="">All Years (Common)</option>' +
      academicStructureState.years
        .filter(y => y.is_active !== false)
        .map(y => `<option value="${y.id}">Year ${y.year}</option>`)
        .join('');
  }

  const semesterSelect = document.getElementById('noteSemesterId');
  if (semesterSelect) {
    semesterSelect.innerHTML = '<option value="">All Semesters (Common)</option>' +
      academicStructureState.semesters
        .filter(s => s.is_active !== false)
        .map(s => `<option value="${s.id}">Semester ${s.semester}</option>`)
        .join('');
  }
}

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

  const categorySelects = [
    document.getElementById('noteCategoryId'),
    document.getElementById('notesFilterCategoryId')
  ];

  categorySelects.forEach((select) => {
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

async function loadNotes() {
  const tbody = document.getElementById('notesTableBody');
  try {
    const params = new URLSearchParams();
    const categoryId = document.getElementById('notesFilterCategoryId').value;
    const branchId = document.getElementById('notesFilterBranchId').value;
    const semesterId = document.getElementById('notesFilterSemesterId').value;
    const status = document.getElementById('notesFilterStatus').value;

    if (categoryId) params.set('categoryId', categoryId);
    if (branchId) params.set('branchId', branchId);
    if (semesterId) params.set('semesterId', semesterId);
    if (status) params.set('status', status);

    const suffix = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(`/api/admin/academics/notes${suffix}`, { credentials: 'include' });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to load notes');
    }

    if (data.notes && data.notes.length > 0) {
      tbody.innerHTML = data.notes.map((note) => `
        <tr>
          <td>${note.subject || 'N/A'}</td>
          <td>${note.chapter || 'N/A'}</td>
          <td>${note.branch_name || (note.is_common ? 'Common' : '-')}</td>
          <td>${note.semester_label || 'All'}</td>
          <td><span class="co-admin-badge">${note.difficulty || 'medium'}</span></td>
          <td><span class="co-admin-badge">${note.status || 'published'}</span></td>
          <td>${note.pdf_url ? `<a href="${note.pdf_url}" target="_blank" class="btn secondary sm">View PDF</a>` : 'N/A'}</td>
          <td><button class="btn danger sm" data-action="delete-note" data-note-id="${note.id}"><i class="fa-solid fa-trash"></i> Delete</button></td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="8" class="co-admin-table-empty">No notes found.</td></tr>';
    }
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="8" class="co-admin-table-empty" style="color:#c6342d;">${error.message}</td></tr>`;
  }
}

async function deleteNote(id) {
  if (!confirm('Are you sure you want to delete this note?')) return;

  try {
    const response = await fetch(`/api/admin/academics/notes/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    });

    if (response.ok) {
      loadNotes();
    } else {
      alert('Failed to delete note');
    }
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

document.getElementById('uploadNoteForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.getElementById('uploadStatus');
  const formData = new FormData(event.target);

  try {
    status.textContent = 'Uploading...';
    const response = await fetch('/api/admin/content/notes', {
      method: 'POST',
      credentials: 'include',
      body: formData
    });

    const data = await response.json();
    if (response.ok) {
      status.textContent = 'Note uploaded successfully!';
      status.style.color = '#157f37';
      event.target.reset();
      document.getElementById('noteBranchId').innerHTML = '<option value="">Select branch or course</option>';
      document.getElementById('noteBranchId').disabled = true;
      loadNotes();
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    status.textContent = 'Error: ' + error.message;
    status.style.color = '#c6342d';
  }
});

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

(async () => {
  await ensureAdminSession();
  await loadAcademicStructure(); // Load new academic structure
  await loadAcademicOptions();   // Load legacy options
  await loadNotes();
})();
