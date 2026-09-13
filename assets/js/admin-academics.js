// College OS — Admin Academic Management & Enrolments Oversight Workspace

document.addEventListener('DOMContentLoaded', () => {
  setupAcademicWorkspaceTabs();
  setupStudentEnrolments();
  setupUniversitiesManagement();
  setupCoursesManagement();
  setupBatchesManagement();

  // Load initial default panel data
  loadStudentEnrolments();
  populateAdminFilterDropdowns();
});

// ----------------------------------------------------
// WORKSPACE TAB SWITCHER
// ----------------------------------------------------
function setupAcademicWorkspaceTabs() {
  const tabs = document.getElementById('academicWorkspaceTabs');
  if (!tabs) return;

  tabs.querySelectorAll('button[data-workspace-panel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetPanelId = btn.dataset.workspacePanel;
      document.querySelectorAll('.academic-workspace-panel').forEach(panel => {
        panel.style.display = panel.id === targetPanelId ? 'block' : 'none';
      });

      if (targetPanelId === 'enrolmentsPanel') loadStudentEnrolments();
      if (targetPanelId === 'universitiesPanel') loadUniversitiesData();
      if (targetPanelId === 'coursesPanel') loadCoursesData();
      if (targetPanelId === 'batchesPanel') loadBatchesData();
      if (targetPanelId === 'contributionsPanel') filterContributions();
    });
  });
}

// ----------------------------------------------------
// 1. STUDENT ENROLMENTS OVERSIGHT
// ----------------------------------------------------
function setupStudentEnrolments() {
  document.getElementById('refreshEnrolmentsBtn')?.addEventListener('click', loadStudentEnrolments);
  document.getElementById('applyEnrolmentFiltersBtn')?.addEventListener('click', loadStudentEnrolments);
  document.getElementById('enrolmentSearch')?.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') loadStudentEnrolments();
  });

  // Setup Reassign Form Submit
  const form = document.getElementById('reassignStudentForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const studentId = parseInt(document.getElementById('reassignStudentId').value, 10);
      const universityId = parseInt(document.getElementById('reassignUniSelect').value, 10);
      const courseId = parseInt(document.getElementById('reassignCourseSelect').value, 10);
      const batchId = parseInt(document.getElementById('reassignBatchSelect').value, 10);

      try {
        const url = '/api/admin/academic-structure/reassign-student';
        const body = JSON.stringify({ studentId, universityId, courseId, batchId, reason: 'Admin manual re-assignment' });
        
        if (window.CollegeOSApiClient?.request) {
          await window.CollegeOSApiClient.request(url, { method: 'POST', body });
        } else {
          const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, credentials: 'include' });
          if (!res.ok) throw new Error('Reassignment failed');
        }

        alert('Student academic profile reassigned successfully!');
        document.getElementById('reassignStudentModal').style.display = 'none';
        loadStudentEnrolments();
      } catch (err) {
        alert('Failed to reassign student profile: ' + err.message);
      }
    });
  }
}

async function loadStudentEnrolments() {
  const tbody = document.getElementById('enrolmentsTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" class="co-admin-table-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading enroled students...</td></tr>`;

  try {
    const search = document.getElementById('enrolmentSearch')?.value || '';
    const universityId = document.getElementById('enrolmentUniFilter')?.value || '';
    const profileStatus = document.getElementById('enrolmentStatusFilter')?.value || 'complete';

    let url = `/api/admin/academic-structure/student-assignments?profileStatus=${encodeURIComponent(profileStatus)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (universityId) url += `&universityId=${encodeURIComponent(universityId)}`;

    const data = window.CollegeOSApiClient?.request ? 
      await window.CollegeOSApiClient.request(url) : 
      await fetch(url, { credentials: 'include' }).then(r => r.json());

    const list = data.students || [];
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="co-admin-table-empty">No student enrolments found matching filter criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(st => {
      const p = st.academicProfile;
      const dateStr = st.profileCompletedAt ? new Date(st.profileCompletedAt).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : 'Pending';
      return `
        <tr>
          <td>
            <strong>${escapeHtml(st.fullName || 'Student')}</strong>
            <div style="font-size:0.75rem; color:#94a3b8;">${escapeHtml(st.email)}</div>
          </td>
          <td>${p ? `<strong>${escapeHtml(p.universityName)}</strong>` : '<span style="color:#f87171;">Not Selected</span>'}</td>
          <td>${p ? `<strong>${escapeHtml(p.courseName)}</strong>` : '-'}</td>
          <td>${p ? `Batch ${escapeHtml(p.batchName)}` : '-'}</td>
          <td>${dateStr}</td>
          <td>
            <span class="co-admin-badge ${st.isComplete ? 'published' : 'draft'}" style="padding: 2px 8px; border-radius: 6px; font-size: 0.75rem;">
              ${st.isComplete ? 'Enroled' : 'Pending Setup'}
            </span>
          </td>
          <td>
            <button class="btn secondary btn-sm" onclick="openReassignModal(${st.studentId}, '${escapeHtml(st.fullName || 'Student')}')">
              <i class="fa-solid fa-pen-to-square"></i> Reassign
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load enrolments:', err);
    tbody.innerHTML = `<tr><td colspan="7" class="co-admin-table-empty" style="color:#f87171;">Failed to load enrolments: ${err.message}</td></tr>`;
  }
}

async function openReassignModal(studentId, studentName) {
  document.getElementById('reassignStudentId').value = studentId;
  document.getElementById('reassignStudentName').value = studentName;
  document.getElementById('reassignStudentModal').style.display = 'flex';

  try {
    const unisRes = window.CollegeOSApiClient?.request ? 
      await window.CollegeOSApiClient.request('/api/student/academic-options/universities') : 
      await fetch('/api/student/academic-options/universities').then(r => r.json());
    
    const uniSelect = document.getElementById('reassignUniSelect');
    uniSelect.innerHTML = '<option value="">-- Select University --</option>' + 
      (unisRes.universities || []).map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');

    uniSelect.onchange = async () => {
      const uId = uniSelect.value;
      if (!uId) return;
      const crsRes = window.CollegeOSApiClient?.request ? 
        await window.CollegeOSApiClient.request(`/api/student/academic-options/courses?universityId=${uId}`) : 
        await fetch(`/api/student/academic-options/courses?universityId=${uId}`).then(r => r.json());
      
      const crsSelect = document.getElementById('reassignCourseSelect');
      crsSelect.innerHTML = '<option value="">-- Select Course --</option>' + 
        (crsRes.courses || []).map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

      crsSelect.onchange = async () => {
        const cId = crsSelect.value;
        if (!cId) return;
        const bRes = window.CollegeOSApiClient?.request ? 
          await window.CollegeOSApiClient.request(`/api/student/academic-options/batches?universityId=${uId}&courseId=${cId}`) : 
          await fetch(`/api/student/academic-options/batches?universityId=${uId}&courseId=${cId}`).then(r => r.json());
        
        const bSelect = document.getElementById('reassignBatchSelect');
        bSelect.innerHTML = '<option value="">-- Select Batch --</option>' + 
          (bRes.batches || []).map(b => `<option value="${b.id}">Batch ${escapeHtml(b.name)}</option>`).join('');
      };
    };
  } catch (err) {
    console.error(err);
  }
}

// ----------------------------------------------------
// 2. UNIVERSITIES & COLLEGES MANAGEMENT (CRUD)
// ----------------------------------------------------
function setupUniversitiesManagement() {
  document.getElementById('btnAddUniversity')?.addEventListener('click', () => {
    document.getElementById('adminUniId').value = '';
    document.getElementById('adminUniName').value = '';
    document.getElementById('adminUniCode').value = '';
    document.getElementById('adminUniState').value = '';
    document.getElementById('adminUniCity').value = '';
    document.getElementById('adminUniCampus').value = '';
    document.getElementById('adminUniStatus').value = 'ACTIVE';
    document.getElementById('adminUniModalTitle').textContent = 'Add University / College';
    document.getElementById('adminUniModal').style.display = 'flex';
  });

  document.getElementById('uniSearch')?.addEventListener('keyup', loadUniversitiesData);
  document.getElementById('uniStatusFilter')?.addEventListener('change', loadUniversitiesData);

  document.getElementById('adminUniForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('adminUniId').value;
    const payload = {
      name: document.getElementById('adminUniName').value,
      code: document.getElementById('adminUniCode').value,
      state: document.getElementById('adminUniState').value,
      city: document.getElementById('adminUniCity').value,
      campus: document.getElementById('adminUniCampus').value,
      status: document.getElementById('adminUniStatus').value
    };

    try {
      const method = id ? 'PUT' : 'POST';
      const url = id ? `/api/admin/academic-structure/universities/${id}` : '/api/admin/academic-structure/universities';
      const body = JSON.stringify(payload);

      if (window.CollegeOSApiClient?.request) {
        await window.CollegeOSApiClient.request(url, { method, body });
      } else {
        await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body, credentials: 'include' });
      }

      document.getElementById('adminUniModal').style.display = 'none';
      loadUniversitiesData();
      populateAdminFilterDropdowns();
    } catch (err) {
      alert('Failed to save university: ' + err.message);
    }
  });
}

async function loadUniversitiesData() {
  const tbody = document.getElementById('universitiesTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="8" class="co-admin-table-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading universities...</td></tr>`;

  try {
    const search = document.getElementById('uniSearch')?.value || '';
    const status = document.getElementById('uniStatusFilter')?.value || 'ALL';

    let url = `/api/admin/academic-structure/universities?status=${encodeURIComponent(status)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    const data = window.CollegeOSApiClient?.request ? 
      await window.CollegeOSApiClient.request(url) : 
      await fetch(url, { credentials: 'include' }).then(r => r.json());

    const list = data.universities || [];
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="co-admin-table-empty">No universities found.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(u => `
      <tr>
        <td><code>${escapeHtml(u.code)}</code></td>
        <td><strong>${escapeHtml(u.name)}</strong></td>
        <td>${escapeHtml(u.city ? u.city + ', ' + (u.state || '') : u.state || '-')}</td>
        <td>${escapeHtml(u.campus || '-')}</td>
        <td>${u.courses_count || 0}</td>
        <td>${u.students_count || 0}</td>
        <td>
          <span class="co-admin-badge ${u.status === 'ACTIVE' ? 'published' : 'rejected'}" style="padding:2px 8px; border-radius:6px; font-size:0.75rem;">
            ${u.status || 'ACTIVE'}
          </span>
        </td>
        <td>
          <button class="btn secondary btn-sm" onclick="editUniversity(${u.id}, '${escapeHtml(u.name)}', '${escapeHtml(u.code)}', '${escapeHtml(u.state || '')}', '${escapeHtml(u.city || '')}', '${escapeHtml(u.campus || '')}', '${u.status || 'ACTIVE'}')">
            <i class="fa-solid fa-pen"></i> Edit
          </button>
          <button class="btn ${u.status === 'ACTIVE' ? 'danger' : 'primary'} btn-sm" onclick="toggleUniStatus(${u.id}, '${u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'}')">
            ${u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load universities:', err);
    tbody.innerHTML = `<tr><td colspan="8" class="co-admin-table-empty" style="color:#f87171;">Failed to load universities: ${err.message}</td></tr>`;
  }
}

function editUniversity(id, name, code, state, city, campus, status) {
  document.getElementById('adminUniId').value = id;
  document.getElementById('adminUniName').value = name;
  document.getElementById('adminUniCode').value = code;
  document.getElementById('adminUniState').value = state;
  document.getElementById('adminUniCity').value = city;
  document.getElementById('adminUniCampus').value = campus;
  document.getElementById('adminUniStatus').value = status;
  document.getElementById('adminUniModalTitle').textContent = 'Edit University / College';
  document.getElementById('adminUniModal').style.display = 'flex';
}

async function toggleUniStatus(id, newStatus) {
  try {
    const url = `/api/admin/academic-structure/universities/${id}`;
    const body = JSON.stringify({ status: newStatus });
    if (window.CollegeOSApiClient?.request) {
      await window.CollegeOSApiClient.request(url, { method: 'PUT', body });
    } else {
      await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, credentials: 'include' });
    }
    loadUniversitiesData();
  } catch (err) {
    alert('Failed to update status: ' + err.message);
  }
}

// ----------------------------------------------------
// 3. DEPARTMENTS & COURSES MANAGEMENT (CRUD)
// ----------------------------------------------------
function setupCoursesManagement() {
  document.getElementById('btnAddCourse')?.addEventListener('click', async () => {
    document.getElementById('adminCourseId').value = '';
    document.getElementById('adminCourseName').value = '';
    document.getElementById('adminCourseDept').value = '';
    document.getElementById('adminCourseCode').value = '';
    document.getElementById('adminCourseDegree').value = 'B.Tech';
    document.getElementById('adminCourseDuration').value = 4;
    document.getElementById('adminCourseStatus').value = 'ACTIVE';

    await populateUniSelect('adminCourseUniSelect');
    document.getElementById('adminCourseModalTitle').textContent = 'Add Department Course';
    document.getElementById('adminCourseModal').style.display = 'flex';
  });

  document.getElementById('courseSearch')?.addEventListener('keyup', loadCoursesData);
  document.getElementById('courseUniFilter')?.addEventListener('change', loadCoursesData);
  document.getElementById('courseStatusFilter')?.addEventListener('change', loadCoursesData);

  document.getElementById('adminCourseForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('adminCourseId').value;
    const payload = {
      universityId: parseInt(document.getElementById('adminCourseUniSelect').value, 10),
      name: document.getElementById('adminCourseName').value,
      department: document.getElementById('adminCourseDept').value,
      code: document.getElementById('adminCourseCode').value,
      degreeType: document.getElementById('adminCourseDegree').value,
      durationYears: parseInt(document.getElementById('adminCourseDuration').value, 10),
      status: document.getElementById('adminCourseStatus').value
    };

    try {
      const method = id ? 'PUT' : 'POST';
      const url = id ? `/api/admin/academic-structure/courses/${id}` : '/api/admin/academic-structure/courses';
      const body = JSON.stringify(payload);

      if (window.CollegeOSApiClient?.request) {
        await window.CollegeOSApiClient.request(url, { method, body });
      } else {
        await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body, credentials: 'include' });
      }

      document.getElementById('adminCourseModal').style.display = 'none';
      loadCoursesData();
    } catch (err) {
      alert('Failed to save course: ' + err.message);
    }
  });
}

async function loadCoursesData() {
  const tbody = document.getElementById('coursesTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="8" class="co-admin-table-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading courses...</td></tr>`;

  try {
    const search = document.getElementById('courseSearch')?.value || '';
    const universityId = document.getElementById('courseUniFilter')?.value || '';
    const status = document.getElementById('courseStatusFilter')?.value || 'ALL';

    let url = `/api/admin/academic-structure/courses?status=${encodeURIComponent(status)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (universityId) url += `&universityId=${encodeURIComponent(universityId)}`;

    const data = window.CollegeOSApiClient?.request ? 
      await window.CollegeOSApiClient.request(url) : 
      await fetch(url, { credentials: 'include' }).then(r => r.json());

    const list = data.courses || [];
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="co-admin-table-empty">No courses found.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(c => `
      <tr>
        <td><strong>${escapeHtml(c.university_name)}</strong></td>
        <td>${escapeHtml(c.department || 'General')}</td>
        <td>
          <strong>${escapeHtml(c.name)}</strong>
          <div style="font-size:0.75rem; color:#94a3b8;">Code: ${escapeHtml(c.code)}</div>
        </td>
        <td><span class="co-admin-badge" style="background:rgba(99,102,241,0.2); color:#c7d2fe; padding:2px 6px; border-radius:4px; font-size:0.75rem;">${escapeHtml(c.degree_type || 'UG')}</span></td>
        <td>${c.duration_years || 4} Years</td>
        <td>${c.students_count || 0}</td>
        <td>
          <span class="co-admin-badge ${c.status === 'ACTIVE' ? 'published' : 'rejected'}" style="padding:2px 8px; border-radius:6px; font-size:0.75rem;">
            ${c.status || 'ACTIVE'}
          </span>
        </td>
        <td>
          <button class="btn secondary btn-sm" onclick="editCourse(${c.id}, ${c.university_id}, '${escapeHtml(c.name)}', '${escapeHtml(c.department || '')}', '${escapeHtml(c.code)}', '${escapeHtml(c.degree_type || '')}', ${c.duration_years || 4}, '${c.status || 'ACTIVE'}')">
            <i class="fa-solid fa-pen"></i> Edit
          </button>
          <button class="btn ${c.status === 'ACTIVE' ? 'danger' : 'primary'} btn-sm" onclick="toggleCourseStatus(${c.id}, '${c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'}')">
            ${c.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load courses:', err);
    tbody.innerHTML = `<tr><td colspan="8" class="co-admin-table-empty" style="color:#f87171;">Failed to load courses: ${err.message}</td></tr>`;
  }
}

async function editCourse(id, uniId, name, dept, code, degree, duration, status) {
  document.getElementById('adminCourseId').value = id;
  document.getElementById('adminCourseName').value = name;
  document.getElementById('adminCourseDept').value = dept;
  document.getElementById('adminCourseCode').value = code;
  document.getElementById('adminCourseDegree').value = degree;
  document.getElementById('adminCourseDuration').value = duration;
  document.getElementById('adminCourseStatus').value = status;

  await populateUniSelect('adminCourseUniSelect', uniId);
  document.getElementById('adminCourseModalTitle').textContent = 'Edit Department Course';
  document.getElementById('adminCourseModal').style.display = 'flex';
}

async function toggleCourseStatus(id, newStatus) {
  try {
    const url = `/api/admin/academic-structure/courses/${id}`;
    const body = JSON.stringify({ status: newStatus });
    if (window.CollegeOSApiClient?.request) {
      await window.CollegeOSApiClient.request(url, { method: 'PUT', body });
    } else {
      await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, credentials: 'include' });
    }
    loadCoursesData();
  } catch (err) {
    alert('Failed to update status: ' + err.message);
  }
}

// ----------------------------------------------------
// 4. ACADEMIC BATCHES MANAGEMENT (CRUD)
// ----------------------------------------------------
function setupBatchesManagement() {
  document.getElementById('btnAddBatch')?.addEventListener('click', async () => {
    document.getElementById('adminBatchId').value = '';
    document.getElementById('adminBatchName').value = '2026-2030';
    document.getElementById('adminBatchStartYear').value = 2026;
    document.getElementById('adminBatchEndYear').value = 2030;
    document.getElementById('adminBatchStatus').value = 'ACTIVE';

    await populateUniSelect('adminBatchUniSelect');
    document.getElementById('adminBatchModalTitle').textContent = 'Add Academic Batch';
    document.getElementById('adminBatchModal').style.display = 'flex';
  });

  document.getElementById('adminBatchUniSelect')?.addEventListener('change', async (e) => {
    const uId = e.target.value;
    if (uId) await populateCourseSelect('adminBatchCourseSelect', uId);
  });

  document.getElementById('batchSearch')?.addEventListener('keyup', loadBatchesData);
  document.getElementById('batchUniFilter')?.addEventListener('change', loadBatchesData);
  document.getElementById('batchCourseFilter')?.addEventListener('change', loadBatchesData);

  document.getElementById('adminBatchForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('adminBatchId').value;
    const payload = {
      universityId: parseInt(document.getElementById('adminBatchUniSelect').value, 10),
      courseId: parseInt(document.getElementById('adminBatchCourseSelect').value, 10),
      name: document.getElementById('adminBatchName').value,
      startYear: parseInt(document.getElementById('adminBatchStartYear').value, 10),
      endYear: parseInt(document.getElementById('adminBatchEndYear').value, 10),
      status: document.getElementById('adminBatchStatus').value
    };

    try {
      const method = id ? 'PUT' : 'POST';
      const url = id ? `/api/admin/academic-structure/batches/${id}` : '/api/admin/academic-structure/batches';
      const body = JSON.stringify(payload);

      if (window.CollegeOSApiClient?.request) {
        await window.CollegeOSApiClient.request(url, { method, body });
      } else {
        await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body, credentials: 'include' });
      }

      document.getElementById('adminBatchModal').style.display = 'none';
      loadBatchesData();
    } catch (err) {
      alert('Failed to save batch: ' + err.message);
    }
  });
}

async function loadBatchesData() {
  const tbody = document.getElementById('batchesTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" class="co-admin-table-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading batches...</td></tr>`;

  try {
    const search = document.getElementById('batchSearch')?.value || '';
    const universityId = document.getElementById('batchUniFilter')?.value || '';
    const courseId = document.getElementById('batchCourseFilter')?.value || '';

    let url = `/api/admin/academic-structure/batches?status=ALL`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (universityId) url += `&universityId=${encodeURIComponent(universityId)}`;
    if (courseId) url += `&courseId=${encodeURIComponent(courseId)}`;

    const data = window.CollegeOSApiClient?.request ? 
      await window.CollegeOSApiClient.request(url) : 
      await fetch(url, { credentials: 'include' }).then(r => r.json());

    const list = data.batches || [];
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="co-admin-table-empty">No batches found.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(b => `
      <tr>
        <td><strong>${escapeHtml(b.university_name)}</strong></td>
        <td>${escapeHtml(b.course_name)}</td>
        <td><strong>Batch ${escapeHtml(b.name)}</strong></td>
        <td>Session ${b.start_year}${b.end_year ? ' – ' + b.end_year : ''}</td>
        <td>${b.students_count || 0}</td>
        <td>
          <span class="co-admin-badge ${b.status === 'ACTIVE' ? 'published' : 'rejected'}" style="padding:2px 8px; border-radius:6px; font-size:0.75rem;">
            ${b.status || 'ACTIVE'}
          </span>
        </td>
        <td>
          <button class="btn secondary btn-sm" onclick="editBatch(${b.id}, ${b.university_id}, ${b.course_id}, '${escapeHtml(b.name)}', ${b.start_year}, ${b.end_year || b.start_year + 4}, '${b.status || 'ACTIVE'}')">
            <i class="fa-solid fa-pen"></i> Edit
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load batches:', err);
    tbody.innerHTML = `<tr><td colspan="7" class="co-admin-table-empty" style="color:#f87171;">Failed to load batches: ${err.message}</td></tr>`;
  }
}

async function editBatch(id, uniId, courseId, name, startYear, endYear, status) {
  document.getElementById('adminBatchId').value = id;
  document.getElementById('adminBatchName').value = name;
  document.getElementById('adminBatchStartYear').value = startYear;
  document.getElementById('adminBatchEndYear').value = endYear;
  document.getElementById('adminBatchStatus').value = status;

  await populateUniSelect('adminBatchUniSelect', uniId);
  await populateCourseSelect('adminBatchCourseSelect', uniId, courseId);

  document.getElementById('adminBatchModalTitle').textContent = 'Edit Academic Batch';
  document.getElementById('adminBatchModal').style.display = 'flex';
}

// ----------------------------------------------------
// 5. STUDENT CONTRIBUTIONS MODERATION PIPELINE
// ----------------------------------------------------
const NOTE_RESOURCE_TYPES = new Set(['class_notes', 'handwritten_notes', 'assignment', 'lab_file', 'other']);
const PAPER_RESOURCE_TYPES = new Set(['mst1_paper', 'mst2_paper', 'final_exam_paper', 'pyq']);
const contribCache = new Map();

function isNotesContribution(item) {
  return NOTE_RESOURCE_TYPES.has(String(item?.resource_type || '').toLowerCase());
}

function isPapersContribution(item) {
  return PAPER_RESOURCE_TYPES.has(String(item?.resource_type || '').toLowerCase());
}

function setupContributionLaneTabs() {
  ['contributionLaneTabsNotes', 'contributionLaneTabsPapers'].forEach((barId) => {
    const bar = document.getElementById(barId);
    if (!bar) return;

    bar.querySelectorAll('.contrib-lane-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        bar.querySelectorAll('.contrib-lane-btn').forEach((node) => node.classList.remove('active'));
        btn.classList.add('active');
        applyContributionLanePreset(btn.dataset.domain || 'notes', btn.dataset.lane || 'pending');
        filterContributions();
      });
    });
  });
}

function applyContributionLanePreset(domain, lane) {
  const status = document.getElementById(domain === 'notes' ? 'contributionStatusFilterNotes' : 'contributionStatusFilterPapers');
  const risk = document.getElementById(domain === 'notes' ? 'contributionRiskFilterNotes' : 'contributionRiskFilterPapers');
  if (!status || !risk) return;

  status.value = 'all';
  risk.value = '';

  if (['pending', 'approved', 'rejected', 'needs_correction'].includes(lane)) {
    status.value = lane;
    return;
  }

  if (lane === 'risk') {
    risk.value = 'quality';
  }
}

function textIncludes(source, needle) {
  return String(source || '').toLowerCase().includes(String(needle || '').toLowerCase());
}

function applyDomainFilters(rows, domain) {
  const subject = document.getElementById(domain === 'notes' ? 'contributionSubjectFilterNotes' : 'contributionSubjectFilterPapers')?.value?.trim() || '';
  const semester = document.getElementById(domain === 'notes' ? 'contributionSemesterFilterNotes' : 'contributionSemesterFilterPapers')?.value?.trim() || '';
  const branch = document.getElementById(domain === 'notes' ? 'contributionBranchFilterNotes' : 'contributionBranchFilterPapers')?.value?.trim() || '';
  const uploader = document.getElementById(domain === 'notes' ? 'contributionUploaderFilterNotes' : 'contributionUploaderFilterPapers')?.value?.trim() || '';
  const risk = document.getElementById(domain === 'notes' ? 'contributionRiskFilterNotes' : 'contributionRiskFilterPapers')?.value || '';
  const status = document.getElementById(domain === 'notes' ? 'contributionStatusFilterNotes' : 'contributionStatusFilterPapers')?.value || 'all';

  return rows.filter((item) => {
    if (status && status !== 'all' && String(item.status || '') !== status) return false;
    if (subject && !textIncludes(item.subject_name, subject) && !textIncludes(item.title, subject)) return false;
    if (semester && !textIncludes(item.semester_label, semester)) return false;
    if (branch && !textIncludes(item.branch_name, branch)) return false;
    if (uploader && !textIncludes(item.uploader_name, uploader) && !textIncludes(item.uploader_email, uploader)) return false;
    if (risk === 'duplicate' && Number(item.duplicate_score || 0) < 60) return false;
    if (risk === 'quality' && Number(item.quality_score || 100) > 45) return false;
    return true;
  });
}

async function filterContributions() {
  try {
    const notesLane = document.querySelector('#contributionLaneTabsNotes .contrib-lane-btn.active')?.dataset?.lane || 'pending';
    const papersLane = document.querySelector('#contributionLaneTabsPapers .contrib-lane-btn.active')?.dataset?.lane || 'pending';

    const notesParams = {
      status: document.getElementById('contributionStatusFilterNotes')?.value || 'pending'
    };
    const papersParams = {
      status: document.getElementById('contributionStatusFilterPapers')?.value || 'pending'
    };

    if (notesLane === 'risk') notesParams.queueType = 'low_quality';
    if (papersLane === 'risk') papersParams.queueType = 'low_quality';

    const [notesQueueRes, papersQueueRes, analyticsRes] = await Promise.all([
      window.CollegeOSApi.adminGetContributionModerationQueue(notesParams),
      window.CollegeOSApi.adminGetContributionModerationQueue(papersParams),
      window.CollegeOSApi.adminContributionAnalyticsOverview()
    ]);

    let notesRows = (notesQueueRes.queue || []).filter(isNotesContribution);
    let papersRows = (papersQueueRes.queue || []).filter(isPapersContribution);

    notesRows = applyDomainFilters(notesRows, 'notes');
    papersRows = applyDomainFilters(papersRows, 'papers');

    renderContributionsTable('contributionsNotesTableBody', notesRows, 'notes');
    renderContributionsTable('contributionsPapersTableBody', papersRows, 'papers');
  } catch (error) {
    const notesNode = document.getElementById('contributionsNotesTableBody');
    const papersNode = document.getElementById('contributionsPapersTableBody');
    if (notesNode) notesNode.innerHTML = `<tr><td colspan="9" class="co-admin-table-empty">Failed to load student notes pipeline: ${escapeHtml(error.message)}</td></tr>`;
    if (papersNode) papersNode.innerHTML = `<tr><td colspan="9" class="co-admin-table-empty">Failed to load student papers pipeline: ${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderContributionsTable(targetBodyId, items, domain) {
  const node = document.getElementById(targetBodyId);
  if (!node) return;

  if (!items.length) {
    const emptyText = domain === 'papers'
      ? 'No question paper contributions found for this pipeline state.'
      : 'No student notes contributions found for this pipeline state.';
    node.innerHTML = `<tr><td colspan="9" class="co-admin-table-empty">${emptyText}</td></tr>`;
    return;
  }

  node.innerHTML = items.map(item => {
    contribCache.set(Number(item.id), item);
    return `
    <tr>
      <td><input class="contrib-select" type="checkbox" value="${item.id}" /></td>
      <td>
        <strong>${escapeHtml(item.title)}</strong>
        <div style="font-size:0.75rem; color:#94a3b8;">${escapeHtml(item.subject_name || '-')}</div>
      </td>
      <td>
        <strong>${escapeHtml(item.uploader_name || 'Student')}</strong>
        <div style="font-size:0.75rem; color:#94a3b8;">${escapeHtml(item.uploader_email || '')}</div>
      </td>
      <td>${escapeHtml(item.college_name || '-')}</td>
      <td>${escapeHtml(item.branch_name || '-')}</td>
      <td><span class="co-admin-badge ${item.status === 'approved' ? 'published' : 'draft'}">${item.status}</span></td>
      <td>Q:${item.quality_score || 0}</td>
      <td>${item.points_awarded || 0}</td>
      <td>
        <button class="btn secondary btn-sm" onclick="openContribDrawer(${item.id})">
          <i class="fa-solid fa-eye"></i> Detail
        </button>
      </td>
    </tr>`;
  }).join('');
}

// ----------------------------------------------------
// HELPER DROPDOWN POPULATORS
// ----------------------------------------------------
async function populateAdminFilterDropdowns() {
  try {
    const data = window.CollegeOSApiClient?.request ? 
      await window.CollegeOSApiClient.request('/api/student/academic-options/universities') : 
      await fetch('/api/student/academic-options/universities').then(r => r.json());

    const list = data.universities || [];
    const optionsHtml = '<option value="">All Universities / Colleges</option>' + 
      list.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');

    const uniFilters = ['enrolmentUniFilter', 'courseUniFilter', 'batchUniFilter'];
    uniFilters.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = optionsHtml;
    });
  } catch (err) {
    console.error(err);
  }
}

async function populateUniSelect(elementId, selectedId = null) {
  const select = document.getElementById(elementId);
  if (!select) return;
  try {
    const data = window.CollegeOSApiClient?.request ? 
      await window.CollegeOSApiClient.request('/api/student/academic-options/universities') : 
      await fetch('/api/student/academic-options/universities').then(r => r.json());

    const list = data.universities || [];
    select.innerHTML = '<option value="">-- Select University --</option>' + 
      list.map(u => `<option value="${u.id}" ${u.id === selectedId ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('');
  } catch (err) {
    console.error(err);
  }
}

async function populateCourseSelect(elementId, universityId, selectedId = null) {
  const select = document.getElementById(elementId);
  if (!select || !universityId) return;
  try {
    const data = window.CollegeOSApiClient?.request ? 
      await window.CollegeOSApiClient.request(`/api/student/academic-options/courses?universityId=${universityId}`) : 
      await fetch(`/api/student/academic-options/courses?universityId=${universityId}`).then(r => r.json());

    const list = data.courses || [];
    select.innerHTML = '<option value="">-- Select Course --</option>' + 
      list.map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  } catch (err) {
    console.error(err);
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
