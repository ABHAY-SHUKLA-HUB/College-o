document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('iconSettingsForm');
  if (!form || !window.CollegeOSApi) return;

  const size = document.getElementById('iconSize');
  const style = document.getElementById('iconStyle');
  const darkSwitch = document.getElementById('iconDarkSwitch');
  const fontSize = document.getElementById('fontSize');
  const themeMode = document.getElementById('themeMode');

  const settingsName = document.getElementById('settingsName');
  const settingsEmail = document.getElementById('settingsEmail');
  const settingsCollege = document.getElementById('settingsCollege');
  const settingsCategory = document.getElementById('settingsCategory');
  const settingsBranch = document.getElementById('settingsBranch');
  const settingsSemester = document.getElementById('settingsSemester');
  const settingsTargetExam = document.getElementById('settingsTargetExam');
  const settingsCareerInterest = document.getElementById('settingsCareerInterest');
  const settingsStudyMode = document.getElementById('settingsStudyMode');

  const notifyEmail = document.getElementById('notifyEmail');
  const notifyMock = document.getElementById('notifyMock');
  const notifyCert = document.getElementById('notifyCert');
  const notifyRoadmap = document.getElementById('notifyRoadmap');

  const privacyProfile = document.getElementById('privacyProfile');
  const privacyLeaderboard = document.getElementById('privacyLeaderboard');
  const privacyDataSharing = document.getElementById('privacyDataSharing');

  const security2FA = document.getElementById('security2FA');
  const currentPassword = document.getElementById('currentPassword');
  const newPassword = document.getElementById('newPassword');

  const iconScaling = document.getElementById('iconScaling');
  const textSize = document.getElementById('textSize');
  const highContrast = document.getElementById('highContrast');

  const sessionsList = document.getElementById('activeSessionsList');
  const refreshSessionsBtn = document.getElementById('refreshSessionsBtn');
  const logoutAllDevicesBtn = document.getElementById('logoutAllDevicesBtn');
  const resetSettingsBtn = document.getElementById('resetSettingsBtn');
  const feedback = document.getElementById('settingsFeedback');

  function setFeedback(text) {
    if (feedback) feedback.textContent = text;
  }

  const academicState = {
    categories: [],
    semesters: [],
    profile: null,
    initialCategoryId: null
  };

  function normalizeList(payload, key) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload)) return payload;
    return [];
  }

  function fillSelect(selectNode, options, placeholder, selectedValue = '') {
    if (!selectNode) return;
    const selected = selectedValue ? String(selectedValue) : '';
    const html = [`<option value="">${placeholder}</option>`]
      .concat(
        options.map((item) => {
          const id = String(item.id);
          const text = String(item.label || item.name || item.code || id);
          const chosen = id === selected ? ' selected' : '';
          return `<option value="${id}"${chosen}>${text}</option>`;
        })
      );
    selectNode.innerHTML = html.join('');
  }

  async function loadBranchesForCategory(categoryId, selectedBranchId = '') {
    if (!settingsBranch) return;
    settingsBranch.disabled = !categoryId;

    if (!categoryId) {
      fillSelect(settingsBranch, [], 'Select Branch');
      return;
    }

    try {
      const payload = await window.CollegeOSApi.getAcademicBranches(categoryId);
      const branches = normalizeList(payload, 'branches');
      fillSelect(settingsBranch, branches, 'Select Branch', selectedBranchId);
    } catch {
      fillSelect(settingsBranch, [], 'Select Branch');
      setFeedback('Unable to load branches right now. Please try again.');
    }
  }

  async function loadAcademicSettings() {
    if (!settingsCategory || !settingsBranch || !settingsSemester) return;

    try {
      const [categoriesPayload, semestersPayload, profilePayload] = await Promise.all([
        window.CollegeOSApi.getAcademicCategories(),
        window.CollegeOSApi.getAcademicSemesters(),
        window.CollegeOSApi.getStudentAcademicProfile()
      ]);

      academicState.categories = normalizeList(categoriesPayload, 'categories');
      academicState.semesters = normalizeList(semestersPayload, 'semesters');
      academicState.profile = profilePayload?.profile || null;
      academicState.initialCategoryId = academicState.profile?.categoryId ? String(academicState.profile.categoryId) : null;

      fillSelect(settingsCategory, academicState.categories, 'Select Category', academicState.profile?.categoryId || '');
      fillSelect(settingsSemester, academicState.semesters, 'Select Semester', academicState.profile?.semesterId || '');

      await loadBranchesForCategory(
        settingsCategory.value,
        academicState.profile?.branchId || ''
      );

      if (settingsTargetExam) settingsTargetExam.value = academicState.profile?.targetExam || '';
      if (settingsCareerInterest) settingsCareerInterest.value = academicState.profile?.careerInterest || '';
      if (settingsStudyMode) settingsStudyMode.value = academicState.profile?.preferredStudyMode || '';
    } catch {
      fillSelect(settingsCategory, [], 'Select Category');
      fillSelect(settingsBranch, [], 'Select Branch');
      fillSelect(settingsSemester, [], 'Select Semester');
      setFeedback('Could not load academic options.');
    }
  }

  function getPreferencesPayload() {
    return {
      darkCompatible: Boolean(darkSwitch?.checked),
      appearance: {
        fontSize: fontSize?.value || 'medium',
        theme: themeMode?.value || 'system'
      },
      notifications: {
        emailAlerts: Boolean(notifyEmail?.checked),
        mockReminders: Boolean(notifyMock?.checked),
        certificateAlerts: Boolean(notifyCert?.checked),
        roadmapUpdates: Boolean(notifyRoadmap?.checked)
      },
      privacy: {
        profileVisibility: Boolean(privacyProfile?.checked),
        leaderboardVisibility: Boolean(privacyLeaderboard?.checked),
        dataSharing: Boolean(privacyDataSharing?.checked)
      },
      security: {
        twoFactorEnabled: Boolean(security2FA?.checked)
      },
      accessibility: {
        iconScaling: Number(iconScaling?.value || 1),
        textScale: Number(textSize?.value || 1),
        highContrast: Boolean(highContrast?.checked)
      }
    };
  }

  function applyLocalAccessibility() {
    const prefs = getPreferencesPayload();
    document.documentElement.style.setProperty('--settings-icon-scale', String(prefs.accessibility.iconScaling || 1));
    document.documentElement.style.setProperty('--settings-text-scale', String(prefs.accessibility.textScale || 1));
    document.body.style.fontSize = `${(prefs.accessibility.textScale || 1) * 16}px`;

    if (prefs.accessibility.highContrast) {
      document.body.style.filter = 'contrast(1.08) saturate(1.04)';
    } else {
      document.body.style.filter = '';
    }
  }

  function applyTheme(theme) {
    const safeTheme = ['light', 'dark', 'system'].includes(theme) ? theme : 'system';
    const resolved = window.CollegeOSTheme?.resolveThemeMode
      ? window.CollegeOSTheme.resolveThemeMode(safeTheme)
      : (safeTheme === 'system' ? ((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light') : safeTheme);

    if (window.CollegeOSTheme?.applyThemePreference) {
      window.CollegeOSTheme.applyThemePreference(safeTheme);
    } else {
      document.documentElement.dataset.themeMode = resolved;
      document.documentElement.style.colorScheme = resolved;
    }

    window.localStorage.setItem('collegeos_theme', safeTheme);
    // Keep the dark mode toggle switch in sync with the resolved value
    if (darkSwitch) darkSwitch.checked = resolved === 'dark';
  }

  function hydrateSwitches(preferences = {}) {
    const appearance = preferences.appearance || {};
    const notifications = preferences.notifications || {};
    const privacy = preferences.privacy || {};
    const security = preferences.security || {};
    const accessibility = preferences.accessibility || {};

    // Restore theme from localStorage first (most reliable source), fall back to DB preference
    const storedTheme = window.CollegeOSTheme?.getStoredThemePreference
      ? window.CollegeOSTheme.getStoredThemePreference()
      : (window.localStorage.getItem('collegeos_theme') || 'system');
    const effectiveTheme = storedTheme || appearance.theme || 'system';
    if (themeMode) themeMode.value = effectiveTheme;
    const resolvedDark = effectiveTheme === 'dark' || (effectiveTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (darkSwitch) darkSwitch.checked = resolvedDark;
    if (fontSize && appearance.fontSize) fontSize.value = appearance.fontSize;

    if (notifyEmail) notifyEmail.checked = notifications.emailAlerts !== false;
    if (notifyMock) notifyMock.checked = notifications.mockReminders !== false;
    if (notifyCert) notifyCert.checked = notifications.certificateAlerts !== false;
    if (notifyRoadmap) notifyRoadmap.checked = notifications.roadmapUpdates !== false;

    if (privacyProfile) privacyProfile.checked = privacy.profileVisibility !== false;
    if (privacyLeaderboard) privacyLeaderboard.checked = privacy.leaderboardVisibility !== false;
    if (privacyDataSharing) privacyDataSharing.checked = Boolean(privacy.dataSharing);

    if (security2FA) security2FA.checked = Boolean(security.twoFactorEnabled);

    if (iconScaling && accessibility.iconScaling) iconScaling.value = String(accessibility.iconScaling);
    if (textSize && accessibility.textScale) textSize.value = String(accessibility.textScale);
    if (highContrast) highContrast.checked = Boolean(accessibility.highContrast);
  }

  async function loadSessions() {
    if (!sessionsList) return;
    sessionsList.innerHTML = '<li>Loading active sessions...</li>';
    try {
      const { sessions } = await window.CollegeOSApi.getActiveSessions();
      if (!sessions || !sessions.length) {
        sessionsList.innerHTML = '<li>No active sessions found.</li>';
        return;
      }

      sessionsList.innerHTML = sessions
        .map((s) => {
          const expires = s.expiresAt ? new Date(s.expiresAt).toLocaleString() : 'Unknown';
          return `<li>${s.isCurrent ? '<strong>Current Session</strong>' : 'Session'} | Expires: ${expires}</li>`;
        })
        .join('');
    } catch (error) {
      sessionsList.innerHTML = `<li>${error.message}</li>`;
    }
  }

  try {
    const me = await window.CollegeOSApi.getMe();
    if (settingsName) settingsName.value = me?.user?.full_name || '';
    if (settingsEmail) settingsEmail.value = me?.user?.email || '';
    if (settingsCollege) settingsCollege.value = me?.user?.college_name || '';

    await loadAcademicSettings();

    const { settings } = await window.CollegeOSApi.getSettingsIcons();
    if (settings?.icon_size) size.value = settings.icon_size;
    if (settings?.icon_style) style.value = settings.icon_style;
    hydrateSwitches(settings?.preferences || {});

    applyTheme(themeMode?.value || 'system');
    applyLocalAccessibility();
  } catch {
    // Keep default values.
  }

  settingsCategory?.addEventListener('change', async () => {
    await loadBranchesForCategory(settingsCategory.value, '');
  });

  await loadSessions();

  // Theme dropdown drives everything; dark toggle switch also drives theme
  themeMode?.addEventListener('change', () => {
    applyTheme(themeMode.value);
    applyLocalAccessibility();
  });

  darkSwitch?.addEventListener('change', () => {
    const newTheme = darkSwitch.checked ? 'dark' : 'light';
    if (themeMode) themeMode.value = newTheme;
    applyTheme(newTheme);
    applyLocalAccessibility();
  });

  [iconScaling, textSize, highContrast].forEach((node) => {
    node?.addEventListener('change', () => {
      applyLocalAccessibility();
    });
  });

  refreshSessionsBtn?.addEventListener('click', () => {
    loadSessions();
  });

  logoutAllDevicesBtn?.addEventListener('click', async () => {
    try {
      const result = await window.CollegeOSApi.logoutAllDevices();
      setFeedback(result.message || 'Logged out from all other devices.');
      await loadSessions();
    } catch (error) {
      setFeedback(error.message);
    }
  });

  resetSettingsBtn?.addEventListener('click', () => {
    size.value = 'medium';
    style.value = 'fontawesome';
    if (darkSwitch) darkSwitch.checked = false;
    if (fontSize) fontSize.value = 'medium';
    if (themeMode) themeMode.value = 'light';

    if (notifyEmail) notifyEmail.checked = true;
    if (notifyMock) notifyMock.checked = true;
    if (notifyCert) notifyCert.checked = true;
    if (notifyRoadmap) notifyRoadmap.checked = true;

    if (privacyProfile) privacyProfile.checked = true;
    if (privacyLeaderboard) privacyLeaderboard.checked = true;
    if (privacyDataSharing) privacyDataSharing.checked = false;

    if (security2FA) security2FA.checked = false;
    if (iconScaling) iconScaling.value = '1';
    if (textSize) textSize.value = '1';
    if (highContrast) highContrast.checked = false;

    applyTheme('light');
    applyLocalAccessibility();
    setFeedback('Settings reset to defaults. Click Save Settings to persist.');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await window.CollegeOSApi.updateProfile({
        fullName: settingsName?.value?.trim(),
        collegeName: settingsCollege?.value?.trim()
      });

      const categoryId = Number(settingsCategory?.value || 0) || null;
      const branchId = Number(settingsBranch?.value || 0) || null;
      const semesterId = Number(settingsSemester?.value || 0) || null;
      const targetExam = settingsTargetExam?.value?.trim() || null;
      const careerInterest = settingsCareerInterest?.value?.trim() || null;
      const preferredStudyMode = settingsStudyMode?.value || null;

      const hasAnyAcademicSelection = Boolean(categoryId || branchId || semesterId);
      const hasFullAcademicSelection = Boolean(categoryId && branchId && semesterId);

      if (hasAnyAcademicSelection && !hasFullAcademicSelection) {
        throw new Error('Please select Category, Branch, and Semester to save academic settings.');
      }

      if (hasFullAcademicSelection) {
        const categoryChanged =
          academicState.initialCategoryId && academicState.initialCategoryId !== String(categoryId);

        if (!academicState.profile || categoryChanged) {
          await window.CollegeOSApi.completeAcademicOnboarding({
            categoryId,
            branchId,
            semesterId,
            targetExam,
            careerInterest,
            preferredStudyMode,
            weakSubjects: []
          });
        } else {
          await window.CollegeOSApi.updateAcademicProfile({
            branchId,
            semesterId,
            targetExam,
            careerInterest,
            preferredStudyMode
          });
        }
      }

      if (currentPassword?.value && newPassword?.value) {
        await window.CollegeOSApi.changePassword({
          currentPassword: currentPassword.value,
          newPassword: newPassword.value
        });
      }

      await window.CollegeOSApi.updateSettingsIcons({
        iconSize: size.value,
        iconStyle: style.value,
        preferences: getPreferencesPayload()
      });

      applyTheme(themeMode?.value || 'system');
      applyLocalAccessibility();
      setFeedback('Settings saved successfully.');
      await loadAcademicSettings();
      if (currentPassword) currentPassword.value = '';
      if (newPassword) newPassword.value = '';
    } catch (error) {
      setFeedback(error.message);
    }
  });
});
