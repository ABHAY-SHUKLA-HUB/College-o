/**
 * College OS — Academic Onboarding Controller
 * Handles interactive dynamic selection: University -> Course -> Batch & Semester -> Confirm
 */
(() => {
  let currentStep = 1;
  const state = {
    university: null, // { id, name, code }
    course: null,     // { id, name, code, department }
    batch: null,      // { id, name }
    semester: 1       // number (1-8)
  };

  let rawUniversities = [];
  let rawCourses = [];
  let rawBatches = [];

  const steps = [1, 2, 3, 4];

  // Helper API caller
  async function apiRequest(endpoint, options = {}) {
    if (window.CollegeOSApiClient && typeof window.CollegeOSApiClient.request === 'function') {
      return window.CollegeOSApiClient.request(endpoint, options);
    }
    const res = await fetch(endpoint, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.message || `Request failed with status ${res.status}`);
    }
    return res.json();
  }

  // DOM Elements
  const errorAlert = document.getElementById('errorAlert');
  const errorMessage = document.getElementById('errorMessage');

  const btnNext1 = document.getElementById('btnNext1');
  const btnNext2 = document.getElementById('btnNext2');
  const btnNext3 = document.getElementById('btnNext3');
  const btnBack2 = document.getElementById('btnBack2');
  const btnBack3 = document.getElementById('btnBack3');
  const btnBack4 = document.getElementById('btnBack4');
  const btnSubmitProfile = document.getElementById('btnSubmitProfile');

  const uniSearchInput = document.getElementById('uniSearchInput');
  const courseSearchInput = document.getElementById('courseSearchInput');

  const universityGrid = document.getElementById('universityGrid');
  const courseGrid = document.getElementById('courseGrid');
  const batchGrid = document.getElementById('batchGrid');
  const semesterGrid = document.getElementById('semesterGrid');

  const bannerUniSelected = document.getElementById('bannerUniSelected');
  const bannerCourseSelected = document.getElementById('bannerCourseSelected');

  const reviewUni = document.getElementById('reviewUni');
  const reviewCourse = document.getElementById('reviewCourse');
  const reviewBatch = document.getElementById('reviewBatch');
  const reviewSemester = document.getElementById('reviewSemester');

  function showError(msg) {
    if (errorAlert && errorMessage) {
      errorMessage.textContent = msg || 'An error occurred. Please try again.';
      errorAlert.classList.remove('hidden');
    }
  }

  function hideError() {
    if (errorAlert) {
      errorAlert.classList.add('hidden');
    }
  }

  function updateStepperUI() {
    steps.forEach(stepNum => {
      const indicator = document.getElementById(`stepIndicator${stepNum}`);
      const panel = document.getElementById(`stepPanel${stepNum}`);

      if (indicator) {
        indicator.classList.toggle('active', stepNum === currentStep);
        indicator.classList.toggle('completed', stepNum < currentStep);
      }

      if (panel) {
        panel.classList.toggle('hidden', stepNum !== currentStep);
      }
    });

    const progressWidth = ((currentStep - 1) / (steps.length - 1)) * 80;
    const stepperProgress = document.getElementById('stepperProgress');
    if (stepperProgress) {
      stepperProgress.style.width = `${progressWidth}%`;
    }
  }

  // --- Step 1: Universities ---
  async function loadUniversities() {
    hideError();
    universityGrid.innerHTML = `
      <div class="loading-state">
        <i class="fa-solid fa-spinner fa-spin"></i>
        <p>Loading available universities...</p>
      </div>`;
    btnNext1.disabled = !state.university;

    try {
      const data = await apiRequest('/api/student/academic-options/universities');
      rawUniversities = data.universities || [];

      if (rawUniversities.length === 0) {
        universityGrid.innerHTML = `
          <div class="loading-state">
            <p>No active universities found. Please contact support.</p>
          </div>`;
        return;
      }

      renderUniversities(rawUniversities);
    } catch (err) {
      console.error(err);
      universityGrid.innerHTML = `
        <div class="loading-state">
          <p style="color: #fca5a5;">Failed to load universities. <button type="button" id="retryUnis" style="color:#818cf8; background:none; border:none; cursor:pointer; text-decoration:underline;">Retry</button></p>
        </div>`;
      document.getElementById('retryUnis')?.addEventListener('click', loadUniversities);
    }
  }

  function renderUniversities(list) {
    universityGrid.innerHTML = '';
    const query = (uniSearchInput?.value || '').trim().toLowerCase();
    const filtered = query
      ? list.filter(u => (u.name && u.name.toLowerCase().includes(query)) || (u.code && u.code.toLowerCase().includes(query)) || (u.city && u.city.toLowerCase().includes(query)))
      : list;

    if (filtered.length === 0) {
      universityGrid.innerHTML = `
        <div class="loading-state">
          <p>No universities matching "${escapeHtml(query)}"</p>
        </div>`;
      return;
    }

    filtered.forEach(uni => {
      const isCu = (uni.code && uni.code.includes('CU')) || uni.name.includes('Chandigarh') || (uni.code && uni.code.includes('AKTU'));
      const card = document.createElement('div');
      card.className = `option-card ${state.university?.id === uni.id ? 'selected' : ''}`;
      if (isCu) {
        card.style.borderLeft = '3px solid #6366f1';
      }
      
      card.innerHTML = `
        <div class="option-info">
          <div style="display:flex; align-items:center; gap:8px;">
            <h3>${escapeHtml(uni.name)}</h3>
            ${isCu ? `<span style="background:linear-gradient(135deg, #6366f1, #4f46e5); color:#fff; font-size:0.7rem; font-weight:700; padding:2px 8px; border-radius:12px;"><i class="fa-solid fa-award"></i> Featured</span>` : ''}
          </div>
          <p><i class="fa-solid fa-location-dot" style="color:#6366f1; margin-right:4px;"></i> ${uni.city ? escapeHtml(uni.city) + ', ' : ''}${uni.state ? escapeHtml(uni.state) : 'India'} ${uni.campus ? ' (' + escapeHtml(uni.campus) + ')' : ''}</p>
        </div>
        <div class="radio-check"></div>`;

      card.addEventListener('click', () => {
        document.querySelectorAll('#universityGrid .option-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        state.university = { id: uni.id, name: uni.name, code: uni.code };
        btnNext1.disabled = false;

        // Reset downstream selections
        state.course = null;
        state.batch = null;
        btnNext2.disabled = true;
        btnNext3.disabled = true;
      });

      universityGrid.appendChild(card);
    });
  }

  // --- Step 2: Courses ---
  async function loadCourses() {
    if (!state.university) return;
    hideError();
    bannerUniSelected.innerHTML = `Selected University: <strong>${escapeHtml(state.university.name)}</strong>`;
    
    courseGrid.innerHTML = `
      <div class="loading-state">
        <i class="fa-solid fa-spinner fa-spin"></i>
        <p>Loading available courses for ${escapeHtml(state.university.name)}...</p>
      </div>`;
    btnNext2.disabled = !state.course;

    try {
      const data = await apiRequest(`/api/student/academic-options/courses?universityId=${state.university.id}`);
      rawCourses = data.courses || [];

      if (rawCourses.length === 0) {
        courseGrid.innerHTML = `
          <div class="loading-state">
            <p>No courses currently available for this university. Please contact support.</p>
          </div>`;
        return;
      }

      renderCourses(rawCourses);
    } catch (err) {
      console.error(err);
      courseGrid.innerHTML = `
        <div class="loading-state">
          <p style="color: #fca5a5;">Failed to load courses. <button type="button" id="retryCourses" style="color:#818cf8; background:none; border:none; cursor:pointer; text-decoration:underline;">Retry</button></p>
        </div>`;
      document.getElementById('retryCourses')?.addEventListener('click', loadCourses);
    }
  }

  function renderCourses(list) {
    courseGrid.innerHTML = '';
    const query = (courseSearchInput?.value || '').trim().toLowerCase();
    const filtered = query
      ? list.filter(c => (c.name && c.name.toLowerCase().includes(query)) || (c.code && c.code.toLowerCase().includes(query)) || (c.degree_type && c.degree_type.toLowerCase().includes(query)))
      : list;

    if (filtered.length === 0) {
      courseGrid.innerHTML = `
        <div class="loading-state">
          <p>No courses matching "${escapeHtml(query)}"</p>
        </div>`;
      return;
    }

    filtered.forEach(c => {
      const card = document.createElement('div');
      card.className = `option-card ${state.course?.id === c.id ? 'selected' : ''}`;
      card.innerHTML = `
        <div class="option-info">
          <div style="display:flex; align-items:center; gap:8px;">
            <h3>${escapeHtml(c.name)}</h3>
            <span style="background:rgba(99, 102, 241, 0.2); color:#c7d2fe; font-size:0.75rem; font-weight:600; padding:2px 8px; border-radius:6px;">${escapeHtml(c.degree_type || 'UG')}</span>
          </div>
          <p><i class="fa-regular fa-clock" style="margin-right:4px;"></i> ${c.duration_years ? c.duration_years + ' Years Program' : 'Full-time'}${c.code ? ' • Code: ' + escapeHtml(c.code) : ''}</p>
        </div>
        <div class="radio-check"></div>`;

      card.addEventListener('click', () => {
        document.querySelectorAll('#courseGrid .option-card').forEach(cardEl => cardEl.classList.remove('selected'));
        card.classList.add('selected');
        state.course = { id: c.id, name: c.name, code: c.code, department: c.department };
        btnNext2.disabled = false;

        // Reset batch
        state.batch = null;
        btnNext3.disabled = true;
      });

      courseGrid.appendChild(card);
    });
  }

  // --- Step 3: Batches & Semesters ---
  async function loadBatches() {
    if (!state.university || !state.course) return;
    hideError();
    bannerCourseSelected.innerHTML = `Selected: <strong>${escapeHtml(state.university.name)}</strong> → <strong>${escapeHtml(state.course.name)}</strong>`;
    
    batchGrid.innerHTML = `
      <div class="loading-state">
        <i class="fa-solid fa-spinner fa-spin"></i>
        <p>Loading academic batches...</p>
      </div>`;
    btnNext3.disabled = !state.batch;

    try {
      const data = await apiRequest(`/api/student/academic-options/batches?universityId=${state.university.id}&courseId=${state.course.id}`);
      rawBatches = data.batches || [];

      if (rawBatches.length === 0) {
        batchGrid.innerHTML = `
          <div class="loading-state">
            <p>No batches available for this course. Please contact support.</p>
          </div>`;
        return;
      }

      batchGrid.innerHTML = '';
      rawBatches.forEach(b => {
        const card = document.createElement('div');
        card.className = `option-card ${state.batch?.id === b.id ? 'selected' : ''}`;
        card.innerHTML = `
          <div class="option-info">
            <h3>Batch ${escapeHtml(b.name)}</h3>
            <p><i class="fa-regular fa-calendar-check" style="color:#6366f1; margin-right:4px;"></i> Academic Session ${b.start_year}${b.end_year ? ' – ' + b.end_year : ''}</p>
          </div>
          <div class="radio-check"></div>`;

        card.addEventListener('click', () => {
          document.querySelectorAll('#batchGrid .option-card').forEach(cardEl => cardEl.classList.remove('selected'));
          card.classList.add('selected');
          state.batch = { id: b.id, name: b.name };
          btnNext3.disabled = false;
        });

        batchGrid.appendChild(card);
      });
    } catch (err) {
      console.error(err);
      batchGrid.innerHTML = `
        <div class="loading-state">
          <p style="color: #fca5a5;">Failed to load batches. <button type="button" id="retryBatches" style="color:#818cf8; background:none; border:none; cursor:pointer; text-decoration:underline;">Retry</button></p>
        </div>`;
      document.getElementById('retryBatches')?.addEventListener('click', loadBatches);
    }
  }

  // --- Step 4: Populate Review ---
  function populateReview() {
    reviewUni.textContent = state.university?.name || '-';
    reviewCourse.textContent = state.course?.department ? `${state.course.name} (${state.course.department})` : (state.course?.name || '-');
    reviewBatch.textContent = state.batch?.name ? `Batch ${state.batch.name}` : '-';
    reviewSemester.textContent = `Semester ${state.semester}`;
  }

  // --- Search inputs ---
  uniSearchInput?.addEventListener('input', () => {
    renderUniversities(rawUniversities);
  });

  courseSearchInput?.addEventListener('input', () => {
    renderCourses(rawCourses);
  });

  // Semester pill clicks
  semesterGrid?.addEventListener('click', (e) => {
    const pill = e.target.closest('.sem-pill');
    if (!pill) return;
    document.querySelectorAll('.sem-pill').forEach(p => p.classList.remove('selected'));
    pill.classList.add('selected');
    state.semester = parseInt(pill.dataset.sem, 10) || 1;
  });

  // --- Navigation Buttons ---
  btnNext1?.addEventListener('click', () => {
    if (!state.university) return;
    currentStep = 2;
    updateStepperUI();
    loadCourses();
  });

  btnNext2?.addEventListener('click', () => {
    if (!state.course) return;
    currentStep = 3;
    updateStepperUI();
    loadBatches();
  });

  btnNext3?.addEventListener('click', () => {
    if (!state.batch) return;
    currentStep = 4;
    updateStepperUI();
    populateReview();
  });

  btnBack2?.addEventListener('click', () => {
    currentStep = 1;
    updateStepperUI();
  });

  btnBack3?.addEventListener('click', () => {
    currentStep = 2;
    updateStepperUI();
  });

  btnBack4?.addEventListener('click', () => {
    currentStep = 3;
    updateStepperUI();
  });

  // --- Final Submit Profile Handler ---
  btnSubmitProfile?.addEventListener('click', async () => {
    if (!state.university || !state.course || !state.batch) {
      showError('Please complete all selection steps before confirming.');
      return;
    }

    hideError();
    btnSubmitProfile.disabled = true;
    btnSubmitProfile.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving Academic Profile...`;

    try {
      const data = await apiRequest('/api/student/academic-profile', {
        method: 'POST',
        body: JSON.stringify({
          universityId: state.university.id,
          courseId: state.course.id,
          batchId: state.batch.id,
          semester: state.semester
        })
      });

      btnSubmitProfile.innerHTML = `<i class="fa-solid fa-circle-check"></i> Profile Completed! Loading Dashboard...`;
      
      setTimeout(() => {
        window.location.href = data.redirectUrl || '/dashboard';
      }, 500);
    } catch (err) {
      console.error(err);
      showError(err.message || 'Failed to save academic profile. Please try again.');
      btnSubmitProfile.disabled = false;
      btnSubmitProfile.innerHTML = `<i class="fa-solid fa-check"></i> Complete Profile &amp; Go to Dashboard →`;
    }
  });

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Initial Load
  document.addEventListener('DOMContentLoaded', () => {
    updateStepperUI();
    loadUniversities();
  });
})();
