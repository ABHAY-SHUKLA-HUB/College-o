document.addEventListener('DOMContentLoaded', () => {
  if (!window.CollegeOSApi) return;

  const byId = (id) => document.getElementById(id);

  const status = byId('profileActionStatus');
  const avatarNode = byId('profileAvatar');
  const fullNameNode = byId('profileFullName');
  const emailNode = byId('profileEmail');
  const collegeNode = byId('profileCollege');
  const branchNode = byId('profileBranch');
  const semesterNode = byId('profileSemester');
  const joinDateNode = byId('profileJoinDate');
  const achievementsGrid = byId('achievementsGrid');

  const activityNotes = byId('activityNotes');
  const activityMocks = byId('activityMocks');
  const activityCertificates = byId('activityCertificates');
  const activityRoadmap = byId('activityRoadmap');

  let profileCache = null;
  let academicProfileCache = null;

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'U';
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  }

  function setStat(key, value) {
    document.querySelectorAll(`[data-stat="${key}"]`).forEach((node) => {
      node.textContent = String(value ?? 0);
    });
  }

  function setProgress(fillId, valueId, value) {
    const pct = Math.max(0, Math.min(100, Number(value || 0)));
    const fill = byId(fillId);
    const label = byId(valueId);
    if (fill) fill.style.width = `${pct}%`;
    if (label) label.textContent = `${pct}%`;
  }

  function renderList(node, items, formatter, emptyText) {
    if (!node) return;
    if (!items || !items.length) {
      node.innerHTML = `<li>${emptyText}</li>`;
      return;
    }

    node.innerHTML = items.map((item) => `<li>${formatter(item)}</li>`).join('');
  }

  function updateEmptyMessages(totals) {
    const certText = byId('certificatesEmptyText');
    const roadmapText = byId('roadmapsEmptyText');
    const notesText = byId('notesEmptyText');

    if (certText && Number(totals.certificates || 0) > 0) {
      certText.textContent = 'Great progress. Keep earning and showcasing your certificates.';
    }
    if (roadmapText && Number(totals.myRoadmaps || 0) > 0) {
      roadmapText.textContent = 'You are actively building your career roadmap path.';
    }
    if (notesText && Number(totals.savedNotes || 0) > 0) {
      notesText.textContent = 'Your saved notes are helping your revision flow.';
    }
  }

  function renderAchievements(achievements) {
    if (!achievementsGrid) return;
    if (!achievements || !achievements.length) {
      achievementsGrid.innerHTML = '<p class="muted">No badges unlocked yet. Start learning to unlock rewards.</p>';
      return;
    }

    achievementsGrid.innerHTML = achievements
      .map((item) => {
        const stateClass = item.unlocked ? '' : 'locked';
        const marker = item.unlocked ? 'Unlocked' : 'Locked';
        return `
          <article class="badge-card ${stateClass}">
            <strong><i class="fa-solid ${item.icon || 'fa-star'}"></i>${item.title}</strong>
            <p class="muted" style="margin:0.45rem 0 0.2rem;">${item.description || ''}</p>
            <span class="badge">${marker}</span>
          </article>
        `;
      })
      .join('');
  }

  function renderProfile(profile, academicData) {
    profileCache = profile;
    academicProfileCache = academicData?.profile || null;
    const user = profile.user || {};
    const totals = profile.totals || {};
    const progress = profile.learningProgress || {};
    const recent = profile.recentActivity || {};

    if (fullNameNode) fullNameNode.textContent = user.full_name || 'Student';
    if (emailNode) emailNode.textContent = user.email || '-';
    if (collegeNode) collegeNode.textContent = user.college_name || 'Not set';
    if (branchNode) {
      branchNode.textContent =
        academicProfileCache?.branch?.name ||
        user.course_branch ||
        user.target_exam ||
        'Not set';
    }
    if (semesterNode) {
      semesterNode.textContent =
        academicProfileCache?.semester?.label ||
        user.semester ||
        'Not set';
    }
    if (joinDateNode) {
      joinDateNode.textContent = user.created_at ? new Date(user.created_at).toLocaleDateString() : '-';
    }

    if (avatarNode) {
      if (user.avatar_url) {
        avatarNode.innerHTML = `<img src="${user.avatar_url}" alt="Profile avatar" />`;
      } else {
        avatarNode.textContent = initials(user.full_name || user.email);
      }
    }

    setStat('certificates', totals.certificates);
    setStat('myRoadmaps', totals.myRoadmaps);
    setStat('savedNotes', totals.savedNotes);
    setStat('totalXp', totals.totalXp);
    setStat('currentStreak', totals.currentStreak);
    setStat('mockTestsAttempted', totals.mockTestsAttempted);
    setStat('certificatesEarned', totals.certificatesEarned);
    setStat('completedRoadmaps', totals.completedRoadmaps);

    setProgress('progressRoadmapFill', 'progressRoadmapValue', progress.roadmapCompletion);
    setProgress('progressMockFill', 'progressMockValue', progress.mockPerformance);
    setProgress('progressCertFill', 'progressCertValue', progress.certificationProgress);

    renderAchievements(profile.achievements || []);

    renderList(
      activityNotes,
      recent.recentNotes,
      (n) => `${n.subject || 'Note'} - ${n.chapter || 'General'}`,
      'No saved notes yet'
    );
    renderList(
      activityMocks,
      recent.recentMocks,
      (m) => `${m.title || 'Mock Test'} (${m.marks_obtained ?? 0} marks)`,
      'No mock tests attempted yet'
    );
    renderList(
      activityCertificates,
      recent.recentCertificates,
      (c) => `${c.type || 'Certificate'} (${c.issued_date ? new Date(c.issued_date).toLocaleDateString() : 'Date N/A'})`,
      'No certificates yet'
    );
    renderList(
      activityRoadmap,
      recent.lastRoadmap ? [recent.lastRoadmap] : [],
      (r) => `Last opened roadmap with ${Number(r.progress || 0)}% progress`,
      'Start your roadmap journey'
    );

    updateEmptyMessages(totals);
  }

  async function loadProfile() {
    try {
      const [profile, academicData] = await Promise.all([
        window.CollegeOSApi.getProfile(),
        window.CollegeOSApi.getStudentAcademicProfile().catch(() => ({ profile: null, onboarding_completed: false }))
      ]);
      renderProfile(profile, academicData);
    } catch (error) {
      setStatus(error.message || 'Failed to load profile data.');
    }
  }

  byId('editProfileBtn')?.addEventListener('click', async () => {
    const onboardingDone = Boolean(academicProfileCache);
    window.location.href = onboardingDone ? 'settings.html' : 'academic-onboarding.html';
  });

  byId('changePasswordBtn')?.addEventListener('click', async () => {
    const currentPassword = prompt('Enter current password');
    if (!currentPassword) return;
    const newPassword = prompt('Enter new password (min 6 chars)');
    if (!newPassword) return;

    try {
      await window.CollegeOSApi.changePassword({ currentPassword, newPassword });
      setStatus('Password changed successfully.');
    } catch (error) {
      setStatus(error.message || 'Password change failed.');
    }
  });

  byId('uploadPhotoBtn')?.addEventListener('click', () => {
    byId('uploadPhotoInput')?.click();
  });

  byId('uploadPhotoInput')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const avatarUrl = String(reader.result || '');
      try {
        await window.CollegeOSApi.updateProfile({ avatarUrl });
        setStatus('Profile photo updated.');
        await loadProfile();
      } catch (error) {
        setStatus(error.message || 'Could not update profile photo.');
      }
    };
    reader.readAsDataURL(file);
  });

  loadProfile();
});
