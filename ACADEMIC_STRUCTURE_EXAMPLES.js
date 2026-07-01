/**
 * Academic Structure System - Implementation Examples
 * 
 * This file shows how to integrate the academic structure system
 * into different parts of the application
 */

// ============================================
// EXAMPLE 1: Show Onboarding Popup to New Student
// ============================================

// In signup success handler:
function handleSignupSuccess(user) {
  // Check if user has completed academic profile
  fetch('/api/academics/profile')
    .then(r => r.json())
    .then(data => {
      if (data.error || !data.profile) {
        // Show onboarding popup
        showAcademicOnboarding();
      } else {
        // Profile already set, go to dashboard
        redirectToDashboard();
      }
    });
}

function showAcademicOnboarding() {
  // Option 1: Show as modal/dialog
  const modal = document.createElement('div');
  modal.className = 'academic-onboarding-modal';
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.7); z-index: 9999;
    display: flex; align-items: center; justify-content: center;
  `;
  
  const iframe = document.createElement('iframe');
  iframe.src = '/academic-profile-setup.html';
  iframe.style.cssText = `
    width: 600px; height: 600px; max-width: 90vw; max-height: 90vh;
    border: none; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  `;
  
  modal.appendChild(iframe);
  document.body.appendChild(modal);
  
  // Listen for completion
  window.addEventListener('message', (e) => {
    if (e.data.type === 'onboarding-complete') {
      console.log('Profile saved:', e.data.profile);
      modal.remove();
      redirectToDashboard();
    } else if (e.data.type === 'onboarding-skip') {
      modal.remove();
      redirectToDashboard();
    }
  });
  
  // Close on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      modal.remove();
    }
  });
}

// ============================================
// EXAMPLE 2: Fetch and Display Student Profile
// ============================================

async function loadStudentProfile() {
  try {
    const response = await fetch('/api/academics/profile');
    const { profile } = await response.json();
    
    if (!profile) {
      console.log('User has not completed academic profile');
      return null;
    }
    
    return {
      collegeId: profile.college_id,
      collegeName: profile.college_name,
      courseName: profile.course_name,
      branchName: profile.branch_name,
      yearLabel: profile.year_label,
      semesterLabel: profile.semester_label,
      specialization: profile.specialization
    };
  } catch (error) {
    console.error('Failed to load profile:', error);
    return null;
  }
}

// Display profile on dashboard
async function displayStudentProfile() {
  const profile = await loadStudentProfile();
  
  if (!profile) {
    document.getElementById('profileSection').innerHTML = 
      '<p>Complete your academic profile</p>';
    return;
  }
  
  document.getElementById('profileSection').innerHTML = `
    <div class="student-profile">
      <h3>Your Academic Profile</h3>
      <p><strong>College:</strong> ${profile.collegeName}</p>
      <p><strong>Course:</strong> ${profile.courseName}</p>
      <p><strong>Branch:</strong> ${profile.branchName}</p>
      <p><strong>Year:</strong> ${profile.yearLabel}</p>
      <p><strong>Semester:</strong> ${profile.semesterLabel}</p>
      ${profile.specialization ? `<p><strong>Specialization:</strong> ${profile.specialization}</p>` : ''}
    </div>
  `;
}

// ============================================
// EXAMPLE 3: Filter Content Based on Profile
// ============================================

async function loadPersonalizedNotes() {
  // Get student profile
  const profileResponse = await fetch('/api/academics/profile');
  const { profile } = await profileResponse.json();
  
  if (!profile) {
    console.log('No profile set, showing all notes');
    return fetchAllNotes();
  }
  
  // Fetch notes matching student's profile
  const params = new URLSearchParams();
  params.append('collegeId', profile.college_id);
  params.append('courseId', profile.course_id);
  params.append('branchId', profile.branch_id);
  params.append('yearId', profile.year_id);
  
  const response = await fetch(`/api/notes?${params}`);
  const { notes } = await response.json();
  
  return notes;
}

async function loadPersonalizedQuizzes() {
  const profileResponse = await fetch('/api/academics/profile');
  const { profile } = await profileResponse.json();
  
  if (!profile) return fetchAllQuizzes();
  
  const params = new URLSearchParams();
  params.append('collegeId', profile.college_id);
  params.append('courseId', profile.course_id);
  params.append('semesterId', profile.semester_id);
  
  const response = await fetch(`/api/quizzes?${params}`);
  const { quizzes } = await response.json();
  
  return quizzes;
}

// ============================================
// EXAMPLE 4: Content Upload with Academic Fields
// ============================================

async function uploadNoteWithAcademicMapping() {
  const formData = new FormData();
  
  // Basic fields
  formData.append('title', document.getElementById('title').value);
  formData.append('description', document.getElementById('description').value);
  formData.append('file', document.getElementById('fileInput').files[0]);
  
  // Academic mapping fields
  formData.append('collegeId', document.getElementById('collegeSelect').value);
  formData.append('courseId', document.getElementById('courseSelect').value);
  formData.append('branchId', document.getElementById('branchSelect').value);
  formData.append('yearId', document.getElementById('yearSelect').value);
  formData.append('semesterId', document.getElementById('semesterSelect').value);
  
  try {
    const response = await fetch('/api/notes/upload', {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();
    
    if (!response.ok) throw new Error(data.error);
    
    console.log('Note uploaded successfully:', data.note);
    showSuccessToast('Note uploaded and will be visible to matching students');
  } catch (error) {
    console.error('Upload failed:', error);
    showErrorToast(error.message);
  }
}

// ============================================
// EXAMPLE 5: Admin - Manage Colleges
// ============================================

async function adminGetColleges() {
  const response = await fetch('/api/academics/admin/colleges');
  const { colleges } = await response.json();
  return colleges;
}

async function adminAddCollege(collegeData) {
  const response = await fetch('/api/academics/admin/colleges', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: collegeData.name,
      code: collegeData.code,
      label: collegeData.label,
      description: collegeData.description,
      displayOrder: collegeData.displayOrder,
      isActive: true
    })
  });
  
  if (!response.ok) throw new Error('Failed to create college');
  return response.json();
}

async function adminUpdateCollege(collegeId, updates) {
  const response = await fetch(`/api/academics/admin/colleges/${collegeId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  
  if (!response.ok) throw new Error('Failed to update college');
  return response.json();
}

async function adminDeleteCollege(collegeId) {
  const response = await fetch(`/api/academics/admin/colleges/${collegeId}`, {
    method: 'DELETE'
  });
  
  if (!response.ok) throw new Error('Failed to delete college');
  return response.json();
}

// ============================================
// EXAMPLE 6: Admin - Manage Courses with College Filtering
// ============================================

async function adminGetCourses(collegeId = null) {
  let url = '/api/academics/admin/courses';
  if (collegeId) url += `?collegeId=${collegeId}`;
  
  const response = await fetch(url);
  const { courses } = await response.json();
  return courses;
}

async function adminAddCourse(courseData) {
  const response = await fetch('/api/academics/admin/courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collegeId: courseData.collegeId,
      name: courseData.name,
      code: courseData.code,
      label: courseData.label,
      displayOrder: courseData.displayOrder
    })
  });
  
  if (!response.ok) throw new Error('Failed to create course');
  return response.json();
}

// ============================================
// EXAMPLE 7: Admin - Manage Branches with Course Filtering
// ============================================

async function adminGetBranches(courseId = null) {
  let url = '/api/academics/admin/branches';
  if (courseId) url += `?courseId=${courseId}`;
  
  const response = await fetch(url);
  const { branches } = await response.json();
  return branches;
}

async function adminAddBranch(branchData) {
  const response = await fetch('/api/academics/admin/branches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      courseId: branchData.courseId,
      name: branchData.name,
      code: branchData.code,
      displayOrder: branchData.displayOrder
    })
  });
  
  if (!response.ok) throw new Error('Failed to create branch');
  return response.json();
}

// ============================================
// EXAMPLE 8: Admin - Get Analytics
// ============================================

async function loadAcademicAnalytics() {
  const response = await fetch('/api/academics/admin/analytics');
  const data = await response.json();
  
  return {
    totalColleges: data.colleges,
    totalCourses: data.courses,
    totalBranches: data.branches,
    activeStudents: data.activeStudents,
    publishedNotes: data.notes,
    totalQuizzes: data.quizzes,
    availablePapers: data.papers
  };
}

// ============================================
// EXAMPLE 9: Error Handling
// ============================================

async function safeApiCall(url, options = {}) {
  try {
    const response = await fetch(url, options);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'API request failed');
    }
    
    return { success: true, data };
  } catch (error) {
    console.error(`API Error [${url}]:`, error.message);
    return { success: false, error: error.message };
  }
}

// Usage
async function loadCollegesWithErrorHandling() {
  const result = await safeApiCall('/api/academics/colleges');
  
  if (!result.success) {
    showErrorToast('Failed to load colleges: ' + result.error);
    return [];
  }
  
  return result.data.colleges;
}

// ============================================
// EXAMPLE 10: UI Toast Notifications
// ============================================

function showSuccessToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast toast-success';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 20px; right: 20px;
    background: #48bb78; color: white;
    padding: 16px 20px; border-radius: 8px;
    z-index: 10000; animation: slideIn 0.3s ease;
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function showErrorToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast toast-error';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 20px; right: 20px;
    background: #f56565; color: white;
    padding: 16px 20px; border-radius: 8px;
    z-index: 10000; animation: slideIn 0.3s ease;
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============================================
// EXAMPLE 11: Populate College Select (HTML Form)
// ============================================

async function populateCollegeSelect(selectElementId) {
  try {
    const response = await fetch('/api/academics/colleges');
    const { colleges } = await response.json();
    
    const select = document.getElementById(selectElementId);
    select.innerHTML = '<option value="">Select a college</option>';
    
    colleges.forEach(college => {
      const option = document.createElement('option');
      option.value = college.id;
      option.textContent = college.name;
      select.appendChild(option);
    });
    
    // Add event listener to update courses when college changes
    select.addEventListener('change', () => {
      const collegeId = select.value;
      if (collegeId) {
        populateCourseSelect('courseSelect', collegeId);
      }
    });
  } catch (error) {
    console.error('Failed to load colleges:', error);
  }
}

async function populateCourseSelect(selectElementId, collegeId) {
  try {
    const response = await fetch(`/api/academics/courses?collegeId=${collegeId}`);
    const { courses } = await response.json();
    
    const select = document.getElementById(selectElementId);
    select.innerHTML = '<option value="">Select a course</option>';
    
    courses.forEach(course => {
      const option = document.createElement('option');
      option.value = course.id;
      option.textContent = course.name;
      select.appendChild(option);
    });
    
    // Reset branch select
    document.getElementById('branchSelect').innerHTML = '<option value="">Select a branch</option>';
    
    // Add event listener for course change
    select.addEventListener('change', () => {
      const courseId = select.value;
      if (courseId) {
        populateBranchSelect('branchSelect', courseId);
      }
    });
  } catch (error) {
    console.error('Failed to load courses:', error);
  }
}

async function populateBranchSelect(selectElementId, courseId) {
  try {
    const response = await fetch(`/api/academics/branches?courseId=${courseId}`);
    const { branches } = await response.json();
    
    const select = document.getElementById(selectElementId);
    select.innerHTML = '<option value="">Select a branch</option>';
    
    branches.forEach(branch => {
      const option = document.createElement('option');
      option.value = branch.id;
      option.textContent = branch.name;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('Failed to load branches:', error);
  }
}

// ============================================
// HTML FORM EXAMPLE
// ============================================

/*
<form id="uploadForm">
  <div class="form-group">
    <label>College *</label>
    <select id="collegeSelect" required></select>
  </div>
  
  <div class="form-group">
    <label>Course *</label>
    <select id="courseSelect" required></select>
  </div>
  
  <div class="form-group">
    <label>Branch</label>
    <select id="branchSelect"></select>
  </div>
  
  <div class="form-group">
    <label>Year</label>
    <select id="yearSelect"></select>
  </div>
  
  <div class="form-group">
    <label>Semester</label>
    <select id="semesterSelect"></select>
  </div>
  
  <button type="submit">Upload</button>
</form>

<script>
  // Initialize form on load
  document.addEventListener('DOMContentLoaded', async () => {
    await populateCollegeSelect('collegeSelect');
    
    // Also populate year and semester (not dependent)
    const yearsResponse = await fetch('/api/academics/years');
    const { years } = await yearsResponse.json();
    const yearSelect = document.getElementById('yearSelect');
    years.forEach(year => {
      const option = document.createElement('option');
      option.value = year.id;
      option.textContent = year.label;
      yearSelect.appendChild(option);
    });
    
    // Same for semesters...
  });
  
  // Handle form submission
  document.getElementById('uploadForm').addEventListener('submit', uploadNoteWithAcademicMapping);
</script>
*/

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    loadStudentProfile,
    loadPersonalizedNotes,
    loadPersonalizedQuizzes,
    adminGetColleges,
    adminAddCollege,
    adminUpdateCollege,
    adminDeleteCollege,
    adminGetCourses,
    adminAddCourse,
    adminGetBranches,
    adminAddBranch,
    loadAcademicAnalytics,
    showSuccessToast,
    showErrorToast
  };
}
