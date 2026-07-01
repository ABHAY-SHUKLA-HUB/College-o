/**
 * Admin Academic Structure Management - Integrated with admin-control.html
 * Handles CRUD operations for colleges, courses, branches, years, and semesters
 * Uses inline modal and tab switching within the existing admin panel structure
 */

const academicState = {
  colleges: [],
  courses: [],
  branches: [],
  years: [],
  semesters: [],
  currentEditId: null,
  currentEditType: null,
  filters: {
    colleges: '',
    courses: '',
    branches: ''
  }
};

function academicList(response, keys = ['data']) {
  if (!response || typeof response !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(response[key])) return response[key];
  }
  return [];
}

async function fetchAcademicJSON(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options
  });

  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : { message: await response.text() };

  if (!response.ok) {
    throw new Error(body?.error || body?.message || `Request failed with status ${response.status}`);
  }

  return body;
}

// Initialize when panel is activated
function initializeAcademicStructure() {
  if (!academicState.colleges.length) {
    loadAllAcademicData();
  }
}

// Tab switching for academic structure sections
function switchAcademicTab(tabName) {
  // Hide all sections
  document.querySelectorAll('.acad-section').forEach(section => {
    section.style.display = 'none';
  });

  // Deactivate all tab buttons
  document.querySelectorAll('[id^="acadTab-"]').forEach(btn => {
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-secondary');
    btn.style.background = '';
    btn.style.color = '';
  });

  // Show selected section
  const section = document.getElementById(`acadSection-${tabName}`);
  if (section) {
    section.style.display = 'block';
    // Activate button
    const btn = document.getElementById(`acadTab-${tabName}`);
    if (btn) {
      btn.classList.add('btn-primary');
      btn.classList.remove('btn-secondary');
      btn.style.background = '#2f6fed';
      btn.style.color = 'white';
    }

    // Reload data for this section
    switch (tabName) {
      case 'colleges':
        loadCollegesData();
        break;
      case 'courses':
        loadCoursesData();
        break;
      case 'branches':
        loadBranchesData();
        break;
      case 'years':
        loadYearsData();
        break;
      case 'semesters':
        loadSemestersData();
        break;
    }
  }
}

// Load all academic data
async function loadAllAcademicData() {
  try {
    const results = await Promise.allSettled([
      fetchAcademicJSON('/api/academics/admin/colleges'),
      fetchAcademicJSON('/api/academics/admin/courses'),
      fetchAcademicJSON('/api/academics/admin/branches'),
      fetchAcademicJSON('/api/academics/admin/years'),
      fetchAcademicJSON('/api/academics/admin/semesters')
    ]);

    const [colleges, courses, branches, years, semesters] = results;
    academicState.colleges = colleges.status === 'fulfilled' ? academicList(colleges.value, ['data', 'colleges']) : [];
    academicState.courses = courses.status === 'fulfilled' ? academicList(courses.value, ['data', 'courses']) : [];
    academicState.branches = branches.status === 'fulfilled' ? academicList(branches.value, ['data', 'branches']) : [];
    academicState.years = years.status === 'fulfilled' ? academicList(years.value, ['data', 'years']) : [];
    academicState.semesters = semesters.status === 'fulfilled' ? academicList(semesters.value, ['data', 'semesters']) : [];

    // Load initial colleges table
    loadCollegesData();
    // Populate dropdowns
    populateCollegeSelects();
  } catch (error) {
    console.error('Error loading academic data:', error);
    showAlert('Error loading academic data', 'error');
  }
}

// === COLLEGES ===
async function loadCollegesData() {
  try {
    const result = await fetchAcademicJSON('/api/academics/admin/colleges');
    academicState.colleges = academicList(result, ['data', 'colleges']);
    renderCollegesTable();
  } catch (error) {
    console.error('Error loading colleges:', error);
  }
}

function renderCollegesTable() {
  const tbody = document.getElementById('collegesTableBody');
  if (!tbody) return;

  const searchTerm = document.getElementById('collegeSearch')?.value.toLowerCase() || '';
  const filtered = academicState.colleges.filter(c =>
    c.name.toLowerCase().includes(searchTerm) ||
    (c.code && c.code.toLowerCase().includes(searchTerm))
  );

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: #999;">No colleges found</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(college => `
    <tr>
      <td><strong>${college.name}</strong></td>
      <td>${college.code || '-'}</td>
      <td>${college.display_order || 0}</td>
      <td><span class="badge ${college.is_active ? 'success' : 'disabled'}">${college.is_active ? 'Active' : 'Inactive'}</span></td>
      <td style="white-space: nowrap;">
        <button class="btn-sm" onclick="editAcademicItem('colleges', ${college.id})">Edit</button>
        <button class="btn-sm danger" onclick="deleteAcademicItem('colleges', ${college.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

// Setup search listener for colleges
document.addEventListener('DOMContentLoaded', () => {
  const collegeSearch = document.getElementById('collegeSearch');
  if (collegeSearch) {
    collegeSearch.addEventListener('input', renderCollegesTable);
  }
});

// === COURSES ===
async function loadCoursesData() {
  try {
    const result = await fetchAcademicJSON('/api/academics/admin/courses');
    academicState.courses = academicList(result, ['data', 'courses']);
    renderCoursesTable();
  } catch (error) {
    console.error('Error loading courses:', error);
  }
}

function renderCoursesTable() {
  const tbody = document.getElementById('coursesTableBody');
  if (!tbody) return;

  const searchTerm = document.getElementById('courseSearch')?.value.toLowerCase() || '';
  const filtered = academicState.courses.filter(c =>
    c.name.toLowerCase().includes(searchTerm) ||
    (c.code && c.code.toLowerCase().includes(searchTerm))
  );

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: #999;">No courses found</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(course => {
    const college = academicState.colleges.find(c => c.id === course.college_id);
    return `
      <tr>
        <td><strong>${course.name}</strong></td>
        <td>${college?.name || '-'}</td>
        <td>${course.code || '-'}</td>
        <td>${course.display_order || 0}</td>
        <td><span class="badge ${course.is_active ? 'success' : 'disabled'}">${course.is_active ? 'Active' : 'Inactive'}</span></td>
        <td style="white-space: nowrap;">
          <button class="btn-sm" onclick="editAcademicItem('courses', ${course.id})">Edit</button>
          <button class="btn-sm danger" onclick="deleteAcademicItem('courses', ${course.id})">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  const courseSearch = document.getElementById('courseSearch');
  if (courseSearch) {
    courseSearch.addEventListener('input', renderCoursesTable);
  }
});

// === BRANCHES ===
async function loadBranchesData() {
  try {
    const result = await fetchAcademicJSON('/api/academics/admin/branches');
    academicState.branches = academicList(result, ['data', 'branches']);
    renderBranchesTable();
  } catch (error) {
    console.error('Error loading branches:', error);
  }
}

function renderBranchesTable() {
  const tbody = document.getElementById('academicBranchesTableBody');
  if (!tbody) return;

  const searchTerm = document.getElementById('branchSearch')?.value.toLowerCase() || '';
  const filtered = academicState.branches.filter(b =>
    b.name.toLowerCase().includes(searchTerm) ||
    (b.code && b.code.toLowerCase().includes(searchTerm))
  );

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: #999;">No branches found</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(branch => {
    const course = academicState.courses.find(c => c.id === branch.course_id);
    return `
      <tr>
        <td><strong>${branch.name}</strong></td>
        <td>${course?.name || '-'}</td>
        <td>${branch.code || '-'}</td>
        <td>${branch.display_order || 0}</td>
        <td><span class="badge ${branch.is_active ? 'success' : 'disabled'}">${branch.is_active ? 'Active' : 'Inactive'}</span></td>
        <td style="white-space: nowrap;">
          <button class="btn-sm" onclick="editAcademicItem('branches', ${branch.id})">Edit</button>
          <button class="btn-sm danger" onclick="deleteAcademicItem('branches', ${branch.id})">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  const branchSearch = document.getElementById('branchSearch');
  if (branchSearch) {
    branchSearch.addEventListener('input', renderBranchesTable);
  }
});

// === YEARS ===
async function loadYearsData() {
  try {
    const result = await fetchAcademicJSON('/api/academics/admin/years');
    academicState.years = academicList(result, ['data', 'years']);
    renderYearsTable();
  } catch (error) {
    console.error('Error loading years:', error);
  }
}

function renderYearsTable() {
  const tbody = document.getElementById('yearsTableBody');
  if (!tbody) return;

  if (!academicState.years.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: #999;">No academic years found</td></tr>';
    return;
  }

  tbody.innerHTML = academicState.years.map(year => `
    <tr>
      <td><strong>Year ${year.year}</strong></td>
      <td>${year.label || '-'}</td>
      <td>${year.display_order || 0}</td>
      <td><span class="badge ${year.is_active ? 'success' : 'disabled'}">${year.is_active ? 'Active' : 'Inactive'}</span></td>
      <td style="white-space: nowrap;">
        <button class="btn-sm" onclick="editAcademicItem('years', ${year.id})">Edit</button>
        <button class="btn-sm danger" onclick="deleteAcademicItem('years', ${year.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

// === SEMESTERS ===
async function loadSemestersData() {
  try {
    const result = await fetchAcademicJSON('/api/academics/admin/semesters');
    academicState.semesters = academicList(result, ['data', 'semesters']);
    renderSemestersTable();
  } catch (error) {
    console.error('Error loading semesters:', error);
  }
}

function renderSemestersTable() {
  const tbody = document.getElementById('semestersTableBody');
  if (!tbody) return;

  if (!academicState.semesters.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: #999;">No semesters found</td></tr>';
    return;
  }

  tbody.innerHTML = academicState.semesters.map(sem => `
    <tr>
      <td><strong>Semester ${sem.semester}</strong></td>
      <td>${sem.label || '-'}</td>
      <td>${sem.display_order || 0}</td>
      <td><span class="badge ${sem.is_active ? 'success' : 'disabled'}">${sem.is_active ? 'Active' : 'Inactive'}</span></td>
      <td style="white-space: nowrap;">
        <button class="btn-sm" onclick="editAcademicItem('semesters', ${sem.id})">Edit</button>
        <button class="btn-sm danger" onclick="deleteAcademicItem('semesters', ${sem.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

// === MODAL FUNCTIONS ===
function openAcademicModal(type) {
  const modal = document.getElementById('academicModal');
  if (!modal) return;

  const form = document.getElementById('academicForm');
  form.reset();

  academicState.currentEditId = null;
  academicState.currentEditType = type;

  // Hide all fields first
  document.getElementById('collegeSelect').style.display = 'none';
  document.getElementById('courseSelect').style.display = 'none';
  document.getElementById('nameField').style.display = 'none';
  document.getElementById('codeField').style.display = 'none';
  document.getElementById('labelField').style.display = 'none';
  document.getElementById('orderField').style.display = 'none';
  document.getElementById('yearField').style.display = 'none';
  document.getElementById('semesterField').style.display = 'none';

  // Update title and show relevant fields
  const titles = {
    colleges: 'Add College',
    courses: 'Add Course',
    branches: 'Add Branch',
    years: 'Add Academic Year',
    semesters: 'Add Semester'
  };

  document.getElementById('modalTitle').textContent = titles[type] || 'Add Item';

  // Show fields based on type
  if (type === 'colleges') {
    document.getElementById('nameField').style.display = 'block';
    document.getElementById('codeField').style.display = 'block';
    document.getElementById('orderField').style.display = 'block';
  } else if (type === 'courses') {
    document.getElementById('collegeSelect').style.display = 'block';
    document.getElementById('nameField').style.display = 'block';
    document.getElementById('codeField').style.display = 'block';
    document.getElementById('orderField').style.display = 'block';
    populateCollegeDropdown('academicCollegeSelect');
  } else if (type === 'branches') {
    document.getElementById('courseSelect').style.display = 'block';
    document.getElementById('nameField').style.display = 'block';
    document.getElementById('codeField').style.display = 'block';
    document.getElementById('orderField').style.display = 'block';
    populateCourseDropdown('academicCourseSelect');
  } else if (type === 'years') {
    document.getElementById('yearField').style.display = 'block';
    document.getElementById('labelField').style.display = 'block';
    document.getElementById('orderField').style.display = 'block';
  } else if (type === 'semesters') {
    document.getElementById('semesterField').style.display = 'block';
    document.getElementById('labelField').style.display = 'block';
    document.getElementById('orderField').style.display = 'block';
  }

  modal.style.display = 'flex';
  form.onsubmit = (e) => saveAcademicItem(e, type);
}

function closeAcademicModal() {
  const modal = document.getElementById('academicModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

async function editAcademicItem(type, id) {
  const allData = {
    colleges: academicState.colleges,
    courses: academicState.courses,
    branches: academicState.branches,
    years: academicState.years,
    semesters: academicState.semesters
  };

  const item = allData[type]?.find(i => i.id === id);
  if (!item) return;

  academicState.currentEditId = id;
  academicState.currentEditType = type;

  // Open modal with item data
  openAcademicModal(type);

  // Populate form with item data
  document.getElementById('academicName').value = item.name || '';
  document.getElementById('academicCode').value = item.code || '';
  document.getElementById('academicLabel').value = item.label || '';
  document.getElementById('academicOrder').value = item.display_order || 0;
  document.getElementById('academicYear').value = item.year_value || item.year || '';
  document.getElementById('academicSemesterNum').value = item.semester_number || item.semester || '';
  document.getElementById('academicActive').checked = item.is_active !== false;

  if (item.college_id) {
    document.getElementById('academicCollegeSelect').value = item.college_id;
  }
  if (item.course_id) {
    document.getElementById('academicCourseSelect').value = item.course_id;
  }

  document.getElementById('modalTitle').textContent = `Edit ${type.slice(0, -1)}`;
}

async function deleteAcademicItem(type, id) {
  if (!confirm('Are you sure you want to delete this item? This action cannot be undone.')) {
    return;
  }

  try {
    const endpoints = {
      colleges: `/api/academics/admin/colleges/${id}`,
      courses: `/api/academics/admin/courses/${id}`,
      branches: `/api/academics/admin/branches/${id}`,
      years: `/api/academics/admin/years/${id}`,
      semesters: `/api/academics/admin/semesters/${id}`
    };

    const response = await fetch(endpoints[type], { method: 'DELETE' });
    
    if (!response.ok) throw new Error('Delete failed');

    showAlert(`${type.slice(0, -1)} deleted successfully`, 'success');
    
    // Reload the table
    if (type === 'colleges') loadCollegesData();
    else if (type === 'courses') loadCoursesData();
    else if (type === 'branches') loadBranchesData();
    else if (type === 'years') loadYearsData();
    else if (type === 'semesters') loadSemestersData();
  } catch (error) {
    console.error('Error deleting item:', error);
    showAlert('Error deleting item', 'error');
  }
}

async function saveAcademicItem(e, type) {
  e.preventDefault();

  const form = document.getElementById('academicForm');
  const isEdit = academicState.currentEditId !== null;

  try {
    const payload = {
      is_active: document.getElementById('academicActive').checked
    };

    if (type === 'colleges') {
      payload.name = document.getElementById('academicName').value;
      payload.code = document.getElementById('academicCode').value;
      payload.display_order = parseInt(document.getElementById('academicOrder').value) || 0;
    } else if (type === 'courses') {
      payload.college_id = parseInt(document.getElementById('academicCollegeSelect').value);
      payload.name = document.getElementById('academicName').value;
      payload.code = document.getElementById('academicCode').value;
      payload.display_order = parseInt(document.getElementById('academicOrder').value) || 0;
    } else if (type === 'branches') {
      payload.course_id = parseInt(document.getElementById('academicCourseSelect').value);
      payload.name = document.getElementById('academicName').value;
      payload.code = document.getElementById('academicCode').value;
      payload.display_order = parseInt(document.getElementById('academicOrder').value) || 0;
    } else if (type === 'years') {
      payload.yearValue = parseInt(document.getElementById('academicYear').value, 10);
      payload.label = document.getElementById('academicLabel').value;
      payload.display_order = parseInt(document.getElementById('academicOrder').value) || 0;
    } else if (type === 'semesters') {
      payload.semesterNumber = parseInt(document.getElementById('academicSemesterNum').value, 10);
      payload.label = document.getElementById('academicLabel').value;
      payload.display_order = parseInt(document.getElementById('academicOrder').value) || 0;
    }

    const endpoints = {
      colleges: '/api/academics/admin/colleges',
      courses: '/api/academics/admin/courses',
      branches: '/api/academics/admin/branches',
      years: '/api/academics/admin/years',
      semesters: '/api/academics/admin/semesters'
    };

    const url = isEdit ? `${endpoints[type]}/${academicState.currentEditId}` : endpoints[type];
    const method = isEdit ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || error.message || 'Save failed');
    }

    showAlert(`${type.slice(0, -1)} saved successfully`, 'success');
    closeAcademicModal();

    // Reload data
    if (type === 'colleges') loadCollegesData();
    else if (type === 'courses') { loadCoursesData(); populateCollegeSelects(); }
    else if (type === 'branches') loadBranchesData();
    else if (type === 'years') loadYearsData();
    else if (type === 'semesters') loadSemestersData();
  } catch (error) {
    console.error('Error saving item:', error);
    showAlert(error.message || 'Error saving item', 'error');
  }
}

// === HELPER FUNCTIONS ===
function populateCollegeDropdown(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;

  select.innerHTML = '<option value="">-- Select College --</option>' +
    academicState.colleges
      .filter(c => c.is_active !== false)
      .map(c => `<option value="${c.id}">${c.name}</option>`)
      .join('');
}

function populateCourseDropdown(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;

  select.innerHTML = '<option value="">-- Select Course --</option>' +
    academicState.courses
      .filter(c => c.is_active !== false)
      .map(c => `<option value="${c.id}">${c.name}</option>`)
      .join('');
}

function populateCollegeSelects() {
  populateCollegeDropdown('academicCollegeSelect');
}

function showAlert(message, type = 'info') {
  const alertDiv = document.createElement('div');
  alertDiv.style.cssText = `
    position: fixed; top: 20px; right: 20px; z-index: 10000;
    padding: 16px 20px; border-radius: 8px; color: white; max-width: 300px;
    background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6'};
    animation: slideIn 0.3s ease;
  `;
  alertDiv.textContent = message;
  document.body.appendChild(alertDiv);

  setTimeout(() => alertDiv.remove(), 3000);
}

// Close modal when clicking outside
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('academicModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeAcademicModal();
    });
  }

  document.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-academic-tab]');
    if (tab) {
      switchAcademicTab(tab.getAttribute('data-academic-tab'));
      return;
    }

    const action = event.target.closest('[data-academic-action]');
    if (!action) return;

    const actionName = action.getAttribute('data-academic-action');
    if (actionName === 'open-modal') {
      openAcademicModal(action.getAttribute('data-academic-type'));
      return;
    }
    if (actionName === 'close-modal') {
      closeAcademicModal();
    }
  });

  // Initial load
  initializeAcademicStructure();
});
