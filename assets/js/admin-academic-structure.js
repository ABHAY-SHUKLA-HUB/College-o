/**
 * Admin Academic Structure Management
 * Handles CRUD operations for colleges, courses, branches, years, and semesters
 */

// State management
const adminAcademicsState = {
  colleges: [],
  courses: [],
  branches: [],
  years: [],
  semesters: [],
  currentEditId: null,
  currentEditType: null,
  loading: false
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupTabSwitching();
  setupSearchFiltering();
  setupModalHandlers();
  loadAllData();
  loadAnalytics();
});

// Tab switching
function setupTabSwitching() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const tabName = e.target.dataset.tab;
      switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });

  // Remove active from all tab buttons
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.remove('active');
  });

  // Show selected tab
  document.getElementById(tabName).classList.add('active');
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

  // Load data if needed
  if (tabName === 'colleges') loadColleges();
  else if (tabName === 'courses') loadCourses();
  else if (tabName === 'branches') loadBranches();
  else if (tabName === 'years') loadYears();
  else if (tabName === 'semesters') loadSemesters();
}

// Search filtering
function setupSearchFiltering() {
  document.getElementById('collegeSearch')?.addEventListener('input', (e) => filterTable('collegesTable', e.target.value));
  document.getElementById('courseSearch')?.addEventListener('input', (e) => filterTable('coursesTable', e.target.value));
  document.getElementById('branchSearch')?.addEventListener('input', (e) => filterTable('branchesTable', e.target.value));
}

function filterTable(tableId, searchText) {
  const table = document.getElementById(tableId);
  const rows = table.querySelector('tbody').querySelectorAll('tr');
  const searchLower = searchText.toLowerCase();

  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(searchLower) ? '' : 'none';
  });
}

// Modal handlers
function setupModalHandlers() {
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      closeModal(e.target.closest('.modal').id);
    });
  });

  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal.id);
    });
  });
}

function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
  resetForm(modalId);
  adminAcademicsState.currentEditId = null;
  adminAcademicsState.currentEditType = null;
}

function resetForm(modalId) {
  const form = document.querySelector(`#${modalId} form`);
  if (form) form.reset();
}

// Alert helpers
function showAlert(message, type = 'success') {
  const alertEl = document.getElementById(`${type}Alert`);
  alertEl.textContent = message;
  alertEl.classList.add('show');

  setTimeout(() => {
    alertEl.classList.remove('show');
  }, 4000);
}

// ============================================
// COLLEGES
// ============================================

function openCollegeModal(id = null) {
  adminAcademicsState.currentEditId = id;
  adminAcademicsState.currentEditType = 'college';

  const modalTitle = document.getElementById('collegeModalTitle');
  const form = document.getElementById('collegeForm');

  if (id) {
    const college = adminAcademicsState.colleges.find(c => c.id === id);
    if (college) {
      modalTitle.textContent = 'Edit College';
      document.getElementById('collegeName').value = college.name;
      document.getElementById('collegeCode').value = college.code || '';
      document.getElementById('collegeLabel').value = college.label || '';
      document.getElementById('collegeDescription').value = college.description || '';
      document.getElementById('collegeDisplayOrder').value = college.display_order || 0;
      document.getElementById('collegeIsActive').checked = college.is_active !== false;
    }
  } else {
    modalTitle.textContent = 'Add College';
    form.reset();
  }

  openModal('collegeModal');
}

async function loadColleges() {
  try {
    const response = await fetch('/api/academics/admin/colleges');
    const data = await response.json();
    adminAcademicsState.colleges = data.colleges || [];
    renderCollegesTable();
  } catch (error) {
    console.error('Error loading colleges:', error);
    showAlert('Failed to load colleges', 'error');
  }
}

function renderCollegesTable() {
  const tbody = document.getElementById('collegesBody');
  
  if (!adminAcademicsState.colleges || adminAcademicsState.colleges.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 40px;">No colleges found</td></tr>';
    return;
  }

  tbody.innerHTML = adminAcademicsState.colleges.map(college => `
    <tr>
      <td><strong>${escapeHtml(college.name)}</strong></td>
      <td>${college.code || '-'}</td>
      <td>${college.label || '-'}</td>
      <td>${college.display_order || 0}</td>
      <td>
        <span class="status-badge ${college.is_active ? 'active' : 'inactive'}">
          ${college.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td>
        <div class="action-buttons">
          <button class="btn btn-sm btn-secondary" onclick="openCollegeModal(${college.id})">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteCollege(${college.id})">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function submitCollege() {
  const name = document.getElementById('collegeName').value.trim();
  const code = document.getElementById('collegeCode').value.trim();
  const label = document.getElementById('collegeLabel').value.trim();
  const description = document.getElementById('collegeDescription').value.trim();
  const displayOrder = Number(document.getElementById('collegeDisplayOrder').value) || 0;
  const isActive = document.getElementById('collegeIsActive').checked;

  if (!name) {
    showAlert('College name is required', 'error');
    return;
  }

  const method = adminAcademicsState.currentEditId ? 'PUT' : 'POST';
  const endpoint = adminAcademicsState.currentEditId
    ? `/api/academics/admin/colleges/${adminAcademicsState.currentEditId}`
    : '/api/academics/admin/colleges';

  try {
    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        code: code || null,
        label: label || null,
        description: description || null,
        displayOrder,
        isActive
      })
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error);

    showAlert(adminAcademicsState.currentEditId ? 'College updated successfully' : 'College created successfully');
    closeModal('collegeModal');
    loadColleges();
  } catch (error) {
    console.error('Error saving college:', error);
    showAlert(error.message || 'Failed to save college', 'error');
  }
}

async function deleteCollege(id) {
  if (!confirm('Are you sure you want to delete this college? This action cannot be undone.')) return;

  try {
    const response = await fetch(`/api/academics/admin/colleges/${id}`, { method: 'DELETE' });
    const data = await response.json();

    if (!response.ok) throw new Error(data.error);

    showAlert('College deleted successfully');
    loadColleges();
  } catch (error) {
    console.error('Error deleting college:', error);
    showAlert(error.message || 'Failed to delete college', 'error');
  }
}

// ============================================
// COURSES
// ============================================

function openCourseModal(id = null) {
  adminAcademicsState.currentEditId = id;
  adminAcademicsState.currentEditType = 'course';

  // Populate college dropdown
  const collegeSelect = document.getElementById('courseCollege');
  collegeSelect.innerHTML = '<option value="">Select a college</option>' +
    adminAcademicsState.colleges.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  const modalTitle = document.getElementById('courseModalTitle');
  const form = document.getElementById('courseForm');

  if (id) {
    const course = adminAcademicsState.courses.find(c => c.id === id);
    if (course) {
      modalTitle.textContent = 'Edit Course';
      collegeSelect.value = course.college_id || '';
      document.getElementById('courseName').value = course.name;
      document.getElementById('courseCode').value = course.code || '';
      document.getElementById('courseLabel').value = course.label || '';
      document.getElementById('courseDescription').value = course.description || '';
      document.getElementById('courseDisplayOrder').value = course.display_order || 0;
      document.getElementById('courseIsActive').checked = course.is_active !== false;
    }
  } else {
    modalTitle.textContent = 'Add Course';
    form.reset();
  }

  openModal('courseModal');
}

async function loadCourses() {
  try {
    const response = await fetch('/api/academics/admin/courses');
    const data = await response.json();
    adminAcademicsState.courses = data.courses || [];
    renderCoursesTable();
  } catch (error) {
    console.error('Error loading courses:', error);
    showAlert('Failed to load courses', 'error');
  }
}

function renderCoursesTable() {
  const tbody = document.getElementById('coursesBody');

  if (!adminAcademicsState.courses || adminAcademicsState.courses.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 40px;">No courses found</td></tr>';
    return;
  }

  tbody.innerHTML = adminAcademicsState.courses.map(course => {
    const college = adminAcademicsState.colleges.find(c => c.id === course.college_id);
    return `
      <tr>
        <td><strong>${escapeHtml(course.name)}</strong></td>
        <td>${college ? escapeHtml(college.name) : '-'}</td>
        <td>${course.code || '-'}</td>
        <td>${course.display_order || 0}</td>
        <td>
          <span class="status-badge ${course.is_active ? 'active' : 'inactive'}">
            ${course.is_active ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td>
          <div class="action-buttons">
            <button class="btn btn-sm btn-secondary" onclick="openCourseModal(${course.id})">Edit</button>
            <button class="btn btn-sm btn-danger" onclick="deleteCourse(${course.id})">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function submitCourse() {
  const collegeId = document.getElementById('courseCollege').value;
  const name = document.getElementById('courseName').value.trim();
  const code = document.getElementById('courseCode').value.trim();
  const label = document.getElementById('courseLabel').value.trim();
  const description = document.getElementById('courseDescription').value.trim();
  const displayOrder = Number(document.getElementById('courseDisplayOrder').value) || 0;
  const isActive = document.getElementById('courseIsActive').checked;

  if (!collegeId || !name) {
    showAlert('College and course name are required', 'error');
    return;
  }

  const method = adminAcademicsState.currentEditId ? 'PUT' : 'POST';
  const endpoint = adminAcademicsState.currentEditId
    ? `/api/academics/admin/courses/${adminAcademicsState.currentEditId}`
    : '/api/academics/admin/courses';

  try {
    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collegeId: Number(collegeId),
        name,
        code: code || null,
        label: label || null,
        description: description || null,
        displayOrder,
        isActive
      })
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error);

    showAlert(adminAcademicsState.currentEditId ? 'Course updated successfully' : 'Course created successfully');
    closeModal('courseModal');
    loadCourses();
  } catch (error) {
    console.error('Error saving course:', error);
    showAlert(error.message || 'Failed to save course', 'error');
  }
}

async function deleteCourse(id) {
  if (!confirm('Are you sure you want to delete this course?')) return;

  try {
    const response = await fetch(`/api/academics/admin/courses/${id}`, { method: 'DELETE' });
    const data = await response.json();

    if (!response.ok) throw new Error(data.error);

    showAlert('Course deleted successfully');
    loadCourses();
  } catch (error) {
    console.error('Error deleting course:', error);
    showAlert(error.message || 'Failed to delete course', 'error');
  }
}

// ============================================
// BRANCHES
// ============================================

function openBranchModal(id = null) {
  adminAcademicsState.currentEditId = id;
  adminAcademicsState.currentEditType = 'branch';

  // Populate course dropdown
  const courseSelect = document.getElementById('branchCourse');
  courseSelect.innerHTML = '<option value="">Select a course</option>' +
    adminAcademicsState.courses.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  const modalTitle = document.getElementById('branchModalTitle');
  const form = document.getElementById('branchForm');

  if (id) {
    const branch = adminAcademicsState.branches.find(b => b.id === id);
    if (branch) {
      modalTitle.textContent = 'Edit Branch';
      courseSelect.value = branch.course_id || '';
      document.getElementById('branchName').value = branch.name;
      document.getElementById('branchCode').value = branch.code || '';
      document.getElementById('branchLabel').value = branch.label || '';
      document.getElementById('branchDescription').value = branch.description || '';
      document.getElementById('branchDisplayOrder').value = branch.display_order || 0;
      document.getElementById('branchIsActive').checked = branch.is_active !== false;
    }
  } else {
    modalTitle.textContent = 'Add Branch';
    form.reset();
  }

  openModal('branchModal');
}

async function loadBranches() {
  try {
    const response = await fetch('/api/academics/admin/branches');
    const data = await response.json();
    adminAcademicsState.branches = data.branches || [];
    renderBranchesTable();
  } catch (error) {
    console.error('Error loading branches:', error);
    showAlert('Failed to load branches', 'error');
  }
}

function renderBranchesTable() {
  const tbody = document.getElementById('branchesBody');

  if (!adminAcademicsState.branches || adminAcademicsState.branches.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 40px;">No branches found</td></tr>';
    return;
  }

  tbody.innerHTML = adminAcademicsState.branches.map(branch => {
    const course = adminAcademicsState.courses.find(c => c.id === branch.course_id);
    return `
      <tr>
        <td><strong>${escapeHtml(branch.name)}</strong></td>
        <td>${course ? escapeHtml(course.name) : '-'}</td>
        <td>${branch.code || '-'}</td>
        <td>${branch.display_order || 0}</td>
        <td>
          <span class="status-badge ${branch.is_active ? 'active' : 'inactive'}">
            ${branch.is_active ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td>
          <div class="action-buttons">
            <button class="btn btn-sm btn-secondary" onclick="openBranchModal(${branch.id})">Edit</button>
            <button class="btn btn-sm btn-danger" onclick="deleteBranch(${branch.id})">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function submitBranch() {
  const courseId = document.getElementById('branchCourse').value;
  const name = document.getElementById('branchName').value.trim();
  const code = document.getElementById('branchCode').value.trim();
  const label = document.getElementById('branchLabel').value.trim();
  const description = document.getElementById('branchDescription').value.trim();
  const displayOrder = Number(document.getElementById('branchDisplayOrder').value) || 0;
  const isActive = document.getElementById('branchIsActive').checked;

  if (!courseId || !name) {
    showAlert('Course and branch name are required', 'error');
    return;
  }

  const method = adminAcademicsState.currentEditId ? 'PUT' : 'POST';
  const endpoint = adminAcademicsState.currentEditId
    ? `/api/academics/admin/branches/${adminAcademicsState.currentEditId}`
    : '/api/academics/admin/branches';

  try {
    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseId: Number(courseId),
        name,
        code: code || null,
        label: label || null,
        description: description || null,
        displayOrder,
        isActive
      })
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error);

    showAlert(adminAcademicsState.currentEditId ? 'Branch updated successfully' : 'Branch created successfully');
    closeModal('branchModal');
    loadBranches();
  } catch (error) {
    console.error('Error saving branch:', error);
    showAlert(error.message || 'Failed to save branch', 'error');
  }
}

async function deleteBranch(id) {
  if (!confirm('Are you sure you want to delete this branch?')) return;

  try {
    const response = await fetch(`/api/academics/admin/branches/${id}`, { method: 'DELETE' });
    const data = await response.json();

    if (!response.ok) throw new Error(data.error);

    showAlert('Branch deleted successfully');
    loadBranches();
  } catch (error) {
    console.error('Error deleting branch:', error);
    showAlert(error.message || 'Failed to delete branch', 'error');
  }
}

// ============================================
// YEARS
// ============================================

function openYearModal(id = null) {
  adminAcademicsState.currentEditId = id;
  adminAcademicsState.currentEditType = 'year';

  const modalTitle = document.getElementById('yearModalTitle');
  const form = document.getElementById('yearForm');

  if (id) {
    const year = adminAcademicsState.years.find(y => y.id === id);
    if (year) {
      modalTitle.textContent = 'Edit Year';
      document.getElementById('yearValue').value = year.year_value;
      document.getElementById('yearLabel').value = year.label;
      document.getElementById('yearDescription').value = year.description || '';
      document.getElementById('yearDisplayOrder').value = year.display_order || 0;
      document.getElementById('yearIsActive').checked = year.is_active !== false;
    }
  } else {
    modalTitle.textContent = 'Add Year';
    form.reset();
  }

  openModal('yearModal');
}

async function loadYears() {
  try {
    const response = await fetch('/api/academics/admin/years');
    const data = await response.json();
    adminAcademicsState.years = data.years || [];
    renderYearsTable();
  } catch (error) {
    console.error('Error loading years:', error);
    showAlert('Failed to load years', 'error');
  }
}

function renderYearsTable() {
  const tbody = document.getElementById('yearsBody');

  if (!adminAcademicsState.years || adminAcademicsState.years.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px;">No years found</td></tr>';
    return;
  }

  tbody.innerHTML = adminAcademicsState.years.map(year => `
    <tr>
      <td><strong>${year.year_value}</strong></td>
      <td>${escapeHtml(year.label)}</td>
      <td>${year.display_order || 0}</td>
      <td>
        <span class="status-badge ${year.is_active ? 'active' : 'inactive'}">
          ${year.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td>
        <div class="action-buttons">
          <button class="btn btn-sm btn-secondary" onclick="openYearModal(${year.id})">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteYear(${year.id})">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function submitYear() {
  const yearValue = document.getElementById('yearValue').value.trim();
  const label = document.getElementById('yearLabel').value.trim();
  const description = document.getElementById('yearDescription').value.trim();
  const displayOrder = Number(document.getElementById('yearDisplayOrder').value) || 0;
  const isActive = document.getElementById('yearIsActive').checked;

  if (!yearValue || !label) {
    showAlert('Year value and label are required', 'error');
    return;
  }

  const method = adminAcademicsState.currentEditId ? 'PUT' : 'POST';
  const endpoint = adminAcademicsState.currentEditId
    ? `/api/academics/admin/years/${adminAcademicsState.currentEditId}`
    : '/api/academics/admin/years';

  try {
    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        yearValue,
        label,
        description: description || null,
        displayOrder,
        isActive
      })
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error);

    showAlert(adminAcademicsState.currentEditId ? 'Year updated successfully' : 'Year created successfully');
    closeModal('yearModal');
    loadYears();
  } catch (error) {
    console.error('Error saving year:', error);
    showAlert(error.message || 'Failed to save year', 'error');
  }
}

async function deleteYear(id) {
  if (!confirm('Are you sure you want to delete this year?')) return;

  try {
    const response = await fetch(`/api/academics/admin/years/${id}`, { method: 'DELETE' });
    const data = await response.json();

    if (!response.ok) throw new Error(data.error);

    showAlert('Year deleted successfully');
    loadYears();
  } catch (error) {
    console.error('Error deleting year:', error);
    showAlert(error.message || 'Failed to delete year', 'error');
  }
}

// ============================================
// SEMESTERS
// ============================================

function openSemesterModal(id = null) {
  adminAcademicsState.currentEditId = id;
  adminAcademicsState.currentEditType = 'semester';

  const modalTitle = document.getElementById('semesterModalTitle');
  const form = document.getElementById('semesterForm');

  if (id) {
    const semester = adminAcademicsState.semesters.find(s => s.id === id);
    if (semester) {
      modalTitle.textContent = 'Edit Semester';
      document.getElementById('semesterNumber').value = semester.semester_number;
      document.getElementById('semesterLabel').value = semester.label;
      document.getElementById('semesterDescription').value = semester.description || '';
      document.getElementById('semesterDisplayOrder').value = semester.display_order || 0;
      document.getElementById('semesterIsActive').checked = semester.is_active !== false;
    }
  } else {
    modalTitle.textContent = 'Add Semester';
    form.reset();
  }

  openModal('semesterModal');
}

async function loadSemesters() {
  try {
    const response = await fetch('/api/academics/admin/semesters');
    const data = await response.json();
    adminAcademicsState.semesters = data.semesters || [];
    renderSemestersTable();
  } catch (error) {
    console.error('Error loading semesters:', error);
    showAlert('Failed to load semesters', 'error');
  }
}

function renderSemestersTable() {
  const tbody = document.getElementById('semestersBody');

  if (!adminAcademicsState.semesters || adminAcademicsState.semesters.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px;">No semesters found</td></tr>';
    return;
  }

  tbody.innerHTML = adminAcademicsState.semesters.map(semester => `
    <tr>
      <td><strong>Semester ${semester.semester_number}</strong></td>
      <td>${escapeHtml(semester.label)}</td>
      <td>${semester.display_order || 0}</td>
      <td>
        <span class="status-badge ${semester.is_active ? 'active' : 'inactive'}">
          ${semester.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td>
        <div class="action-buttons">
          <button class="btn btn-sm btn-secondary" onclick="openSemesterModal(${semester.id})">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteSemester(${semester.id})">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function submitSemester() {
  const semesterNumber = Number(document.getElementById('semesterNumber').value);
  const label = document.getElementById('semesterLabel').value.trim();
  const description = document.getElementById('semesterDescription').value.trim();
  const displayOrder = Number(document.getElementById('semesterDisplayOrder').value) || 0;
  const isActive = document.getElementById('semesterIsActive').checked;

  if (!semesterNumber || !label) {
    showAlert('Semester number and label are required', 'error');
    return;
  }

  const method = adminAcademicsState.currentEditId ? 'PUT' : 'POST';
  const endpoint = adminAcademicsState.currentEditId
    ? `/api/academics/admin/semesters/${adminAcademicsState.currentEditId}`
    : '/api/academics/admin/semesters';

  try {
    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        semesterNumber,
        label,
        description: description || null,
        displayOrder,
        isActive
      })
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error);

    showAlert(adminAcademicsState.currentEditId ? 'Semester updated successfully' : 'Semester created successfully');
    closeModal('semesterModal');
    loadSemesters();
  } catch (error) {
    console.error('Error saving semester:', error);
    showAlert(error.message || 'Failed to save semester', 'error');
  }
}

async function deleteSemester(id) {
  if (!confirm('Are you sure you want to delete this semester?')) return;

  try {
    const response = await fetch(`/api/academics/admin/semesters/${id}`, { method: 'DELETE' });
    const data = await response.json();

    if (!response.ok) throw new Error(data.error);

    showAlert('Semester deleted successfully');
    loadSemesters();
  } catch (error) {
    console.error('Error deleting semester:', error);
    showAlert(error.message || 'Failed to delete semester', 'error');
  }
}

// ============================================
// ANALYTICS
// ============================================

async function loadAnalytics() {
  try {
    const response = await fetch('/api/academics/admin/analytics');
    const data = await response.json();

    document.getElementById('collegesCount').textContent = data.colleges || 0;
    document.getElementById('coursesCount').textContent = data.courses || 0;
    document.getElementById('branchesCount').textContent = data.branches || 0;
    document.getElementById('studentsCount').textContent = data.activeStudents || 0;

    document.getElementById('analyticsGrid').style.display = 'grid';
  } catch (error) {
    console.error('Error loading analytics:', error);
  }
}

// ============================================
// HELPERS
// ============================================

async function loadAllData() {
  try {
    await Promise.all([
      loadColleges(),
      loadCourses(),
      loadBranches(),
      loadYears(),
      loadSemesters()
    ]);
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Export for global use
window.adminAcademics = {
  openCollegeModal,
  openCourseModal,
  openBranchModal,
  openYearModal,
  openSemesterModal,
  closeModal,
  submitCollege,
  submitCourse,
  submitBranch,
  submitYear,
  submitSemester,
  deleteCollege,
  deleteCourse,
  deleteBranch,
  deleteYear,
  deleteSemester
};
