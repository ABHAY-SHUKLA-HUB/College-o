document.addEventListener('DOMContentLoaded', () => {
  const editor = document.getElementById('personalNotesEditor');
  const saveBtn = document.getElementById('savePersonalNotesBtn');
  const aiBtn = document.getElementById('aiSummarizeBtn');
  const search = document.getElementById('noteSearch');
  const formatFilter = document.getElementById('noteFormatFilter');
  const categoryFilter = document.getElementById('noteCategoryFilter');
  const branchFilter = document.getElementById('noteBranchFilter');
  const semesterFilter = document.getElementById('noteSemesterFilter');
  const collegeFilter = document.getElementById('noteCollegeFilter');
  const refreshBtn = document.getElementById('refreshNotesBtn');
  const notesFeed = document.getElementById('notesFeed');
  const notesStatus = document.getElementById('notesStatus');
  const aiSourceInput = document.getElementById('aiSourceInput');
  const aiSourceFile = document.getElementById('aiSourceFile');
  const aiToolsNav = document.getElementById('aiToolsNav');
  const aiSummaryResult = document.getElementById('aiSummaryResult');
  const aiQuizResult = document.getElementById('aiQuizResult');
  const aiFlashcardsResult = document.getElementById('aiFlashcardsResult');
  const aiExplainResult = document.getElementById('aiExplainResult');
  const aiDoubtResult = document.getElementById('aiDoubtResult');
  const aiSimplifyResult = document.getElementById('aiSimplifyResult');
  let quill = null;
  let hasPremiumAccess = true;

  if (editor && window.Quill) {
    quill = new Quill('#personalNotesEditor', {
      theme: 'snow',
      modules: {
        toolbar: [['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], ['link']]
      }
    });
  }

  function setStatus(text) {
    if (notesStatus) notesStatus.textContent = text;
  }

  async function emitNotesEvent(eventType, eventPayload = {}) {
    if (!window.CollegeOSApi?.trackLearnerEvent) return;
    try {
      await window.CollegeOSApi.trackLearnerEvent({
        eventType,
        source: 'notes',
        eventPayload
      });
    } catch {
      // Never interrupt note workflows if telemetry is unavailable.
    }
  }

  function parseSentences(input) {
    return String(input || '')
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function words(input) {
    return String(input || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3);
  }

  function pickKeyConcepts(input, limit = 6) {
    const stop = new Set(['this', 'that', 'with', 'from', 'have', 'will', 'your', 'into', 'about', 'there', 'their', 'when', 'which', 'what', 'where', 'were', 'been', 'then', 'than', 'they', 'them', 'also', 'such', 'should', 'could', 'would', 'because', 'while', 'through']);
    const freq = new Map();
    words(input).forEach((token) => {
      if (stop.has(token)) return;
      freq.set(token, (freq.get(token) || 0) + 1);
    });
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([term]) => term);
  }

  function getAiSourceText() {
    const source = aiSourceInput?.value?.trim() || document.getElementById('chapterInput')?.value?.trim() || '';
    return source;
  }

  function ensureSource() {
    const source = getAiSourceText();
    if (!source) {
      alert('Please paste notes or upload a text file first.');
      return null;
    }
    return source;
  }

  function renderAiSummary(source) {
    const sentences = parseSentences(source);
    const shortSummary = sentences.slice(0, 2).join(' ') || 'Insufficient text to summarize.';
    const bulletSummary = sentences.slice(0, 5).map((line) => `- ${line}`).join('\n');
    const concepts = pickKeyConcepts(source).map((c) => `- ${c}`).join('\n');

    if (aiSummaryResult) {
      aiSummaryResult.textContent = [
        'Short Summary:',
        shortSummary,
        '',
        'Bullet Point Summary:',
        bulletSummary || '- Not enough content.',
        '',
        'Key Concepts:',
        concepts || '- No key concepts detected.'
      ].join('\n');
    }
  }

  function renderQuiz(source) {
    if (!aiQuizResult) return;
    const concepts = pickKeyConcepts(source, 4);
    const sentences = parseSentences(source);
    if (!sentences.length) {
      aiQuizResult.innerHTML = '<div class="empty-state">Add more detailed notes to generate quiz questions.</div>';
      return;
    }

    const items = concepts.length ? concepts : ['concept', 'definition', 'application', 'revision'];
    aiQuizResult.innerHTML = items
      .map((topic, index) => {
        const context = sentences[index % sentences.length].slice(0, 90);
        return `
          <article class="quiz-item">
            <strong>Q${index + 1}. Which statement best explains "${topic}" in this chapter?</strong>
            <div class="opts">A) ${context}...<br>B) It is unrelated to this subject.<br>C) It only applies to practical labs.<br>D) It cannot be described from these notes.</div>
            <div class="muted" style="margin-top:0.45rem;">Suggested Answer: A</div>
          </article>
        `;
      })
      .join('');
  }

  function renderFlashcards(source) {
    if (!aiFlashcardsResult) return;
    const concepts = pickKeyConcepts(source, 8);
    const sentences = parseSentences(source);
    if (!concepts.length) {
      aiFlashcardsResult.innerHTML = '<div class="empty-state">No flashcards generated. Add richer topic content.</div>';
      return;
    }

    aiFlashcardsResult.innerHTML = concepts
      .map((concept, idx) => {
        const base = sentences[idx % sentences.length] || 'Refer to your notes for details.';
        return `
          <article class="flashcard">
            <h4>Front: ${concept}</h4>
            <div>Back: ${base}</div>
          </article>
        `;
      })
      .join('');
  }

  function explainConcept(topic, source) {
    const sentence = parseSentences(source).find((s) => s.toLowerCase().includes(topic.toLowerCase()));
    const explanation = sentence
      ? `${topic} can be understood as: ${sentence}`
      : `${topic} is an important topic. In simple terms, break it into definition, working process, and one real-world example for quick understanding.`;
    if (aiExplainResult) aiExplainResult.textContent = explanation;
  }

  function solveDoubt(question, source) {
    const concepts = pickKeyConcepts(source, 5);
    const hint = concepts.length ? `Relevant concepts from your notes: ${concepts.join(', ')}.` : 'Add more details in source notes for a sharper answer.';
    const answer = `Question: ${question}\n\nAnswer: Focus on the core idea, then map it to a worked example from your chapter. ${hint}`;
    if (aiDoubtResult) aiDoubtResult.textContent = answer;
  }

  function simplifyNotes(source) {
    const simplified = parseSentences(source)
      .slice(0, 6)
      .map((s) => s.replace(/\b(utilize|implement|facilitate|architecture|methodology|optimize|sophisticated)\b/gi, (word) => {
        const map = {
          utilize: 'use',
          implement: 'apply',
          facilitate: 'help',
          architecture: 'design',
          methodology: 'method',
          optimize: 'improve',
          sophisticated: 'advanced'
        };
        return map[word.toLowerCase()] || word;
      }))
      .map((s, i) => `${i + 1}. ${s}`)
      .join('\n');
    if (aiSimplifyResult) aiSimplifyResult.textContent = simplified || 'Add longer notes to simplify.';
  }

  if (aiToolsNav) {
    const buttons = aiToolsNav.querySelectorAll('[data-ai-tool]');
    const panels = document.querySelectorAll('[data-ai-panel]');
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const tool = button.dataset.aiTool;
        buttons.forEach((b) => b.classList.remove('active'));
        button.classList.add('active');
        panels.forEach((panel) => {
          panel.classList.toggle('active', panel.dataset.aiPanel === tool);
        });
      });
    });
  }

  aiSourceFile?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (aiSourceInput) aiSourceInput.value = text;
      setStatus(`Loaded source text from ${file.name}`);
    } catch {
      setStatus('Failed to read file. Please upload a plain text file.');
    }
  });

  document.getElementById('generateAiSummaryBtn')?.addEventListener('click', () => {
    const source = ensureSource();
    if (!source) return;
    renderAiSummary(source);
  });

  document.getElementById('generateAiQuizBtn')?.addEventListener('click', () => {
    const source = ensureSource();
    if (!source) return;
    renderQuiz(source);
  });

  document.getElementById('generateFlashcardsBtn')?.addEventListener('click', () => {
    const source = ensureSource();
    if (!source) return;
    renderFlashcards(source);
  });

  document.getElementById('explainConceptBtn')?.addEventListener('click', () => {
    const source = ensureSource();
    if (!source) return;
    const topic = document.getElementById('aiExplainTopicInput')?.value?.trim();
    if (!topic) {
      alert('Please enter a topic to explain.');
      return;
    }
    explainConcept(topic, source);
  });

  document.getElementById('askAiBtn')?.addEventListener('click', () => {
    const source = ensureSource();
    if (!source) return;
    const question = document.getElementById('aiDoubtInput')?.value?.trim();
    if (!question) {
      alert('Please enter your question.');
      return;
    }
    solveDoubt(question, source);
  });

  document.getElementById('simplifyNotesBtn')?.addEventListener('click', () => {
    const source = ensureSource();
    if (!source) return;
    simplifyNotes(source);
  });

  function renderNotes(notes) {
    if (!notesFeed) return;
    if (!notes.length) {
      notesFeed.innerHTML = '<div class="empty-state">No notes found for selected filters.</div>';
      return;
    }

    notesFeed.innerHTML = notes
      .map((n) => {
        const level = (n.difficulty || 'medium').toLowerCase();
        const format = n.format_type || 'general';
        const pdfAction = n.pdf_url
          ? `<a class="btn secondary" href="${n.pdf_url}" target="_blank" rel="noopener" data-note-pdf-id="${n.id}" data-note-subject="${(n.subject || '').replace(/"/g, '&quot;')}">Open PDF</a>`
          : '<span class="pill">Text Note</span>';

        return `
          <article class="resource-card notes-card ${level}">
            <h3>${n.subject} - ${n.chapter}</h3>
            <div class="resource-meta">
              <span class="pill">${n.college_name || 'All Colleges'}</span>
              <span class="pill">${format}</span>
              <span class="pill">${level}</span>
            </div>
            <p class="muted">${(n.content || '').slice(0, 170)}${(n.content || '').length > 170 ? '...' : ''}</p>
            <div class="actions">
              ${pdfAction}
              <button class="btn primary" data-note-id="${n.id}">Bookmark</button>
            </div>
          </article>
        `;
      })
      .join('');

    notesFeed.querySelectorAll('[data-note-id]').forEach((button) => {
      button.addEventListener('click', () => {
        setStatus(`Bookmarked note #${button.dataset.noteId}`);
        emitNotesEvent('note_bookmarked', {
          noteId: Number(button.dataset.noteId) || null
        });
      });
    });

    notesFeed.querySelectorAll('[data-note-pdf-id]').forEach((link) => {
      link.addEventListener('click', () => {
        emitNotesEvent('note_pdf_opened', {
          noteId: Number(link.dataset.notePdfId) || null,
          subject: link.dataset.noteSubject || null
        });
      });
    });
  }

  async function loadAcademicFilters() {
    if (!branchFilter || !categoryFilter || !semesterFilter) return;
    try {
      const [categoriesPayload, semestersPayload, profilePayload] = await Promise.all([
        window.CollegeOSApi.getAcademicCategories(),
        window.CollegeOSApi.getAcademicSemesters(),
        window.CollegeOSApi.getStudentAcademicProfile().catch(() => ({ profile: null }))
      ]);

      const categories = categoriesPayload?.categories || [];
      const semesters = semestersPayload?.semesters || [];
      const profile = profilePayload?.profile;

      const catHtml = ['<option value="">All Categories</option>'].concat(
        categories.map((c) => {
          const selected = profile?.categoryId === c.id ? ' selected' : '';
          return `<option value="${c.id}"${selected}>${c.name}</option>`;
        })
      );
      categoryFilter.innerHTML = catHtml.join('');

      const semHtml = ['<option value="">All Semesters</option>'].concat(
        semesters.map((s) => {
          const selected = profile?.semesterId === s.id ? ' selected' : '';
          return `<option value="${s.id}"${selected}>${s.label}</option>`;
        })
      );
      semesterFilter.innerHTML = semHtml.join('');

      if (profile?.categoryId) {
        await loadBranchesForNotes(profile.categoryId, profile?.branchId || '');
      }
    } catch {
      // Keep defaults.
    }
  }

  async function loadBranchesForNotes(categoryId, selectedBranchId = '') {
    if (!branchFilter) return;
    branchFilter.disabled = !categoryId;
    if (!categoryId) {
      branchFilter.innerHTML = '<option value="">All Branches</option>';
      return;
    }
    try {
      const payload = await window.CollegeOSApi.getAcademicBranches(categoryId);
      const branches = payload?.branches || [];
      const html = ['<option value="">All Branches</option>'].concat(
        branches.map((b) => {
          const sel = String(selectedBranchId) === String(b.id) ? ' selected' : '';
          return `<option value="${b.id}"${sel}>${b.name}</option>`;
        })
      );
      branchFilter.innerHTML = html.join('');
    } catch {
      branchFilter.innerHTML = '<option value="">All Branches</option>';
    }
  }

  categoryFilter?.addEventListener('change', async () => {
    await loadBranchesForNotes(categoryFilter.value, '');
    loadNotesFeed();
  });

  branchFilter?.addEventListener('change', () => loadNotesFeed());
  semesterFilter?.addEventListener('change', () => loadNotesFeed());

  async function loadColleges() {
    if (!collegeFilter || !window.CollegeOSApi) return;
    try {
      const { user } = await window.CollegeOSApi.getMe();
      const { colleges } = await window.CollegeOSApi.getColleges();
      const options = ['<option value="">All Colleges</option>']
        .concat(colleges.map((c) => `<option value="${c.name}">${c.name}</option>`))
        .join('');
      collegeFilter.innerHTML = options;
      if (user?.college_name) collegeFilter.value = user.college_name;
    } catch {
      // Keep default option.
    }
  }

  async function loadNotesFeed() {
    if (!window.CollegeOSApi) return;
    const query = {
      search: search?.value?.trim() || '',
      format: formatFilter?.value || '',
      college: collegeFilter?.value || '',
      branchId: branchFilter?.value || '',
      semesterId: semesterFilter?.value || ''
    };

    try {
      const queryString = Object.entries(query)
        .filter(([, value]) => value)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');

      const response = await fetch(`/api/notes${queryString ? `?${queryString}` : ''}`, { credentials: 'include' });
      const data = await response.json();

      if (!response.ok) {
        if (data.code === 'UPGRADE_REQUIRED') {
          hasPremiumAccess = false;
          notesFeed.innerHTML = '<div class="empty-state"><h3>Premium Required</h3><p>Notes are locked for Free plan.</p><a class="btn warn" href="pricing.html">Upgrade to Premium (Rs.49/month)</a></div>';
          setStatus(data.error || 'Premium required');
          return;
        }
        throw new Error(data.error || 'Failed to load notes');
      }

      hasPremiumAccess = true;
      renderNotes(data.notes || []);
      setStatus(`Loaded ${data.notes?.length || 0} notes`);
      emitNotesEvent('notes_feed_loaded', {
        resultCount: data.notes?.length || 0,
        search: query.search || null,
        format: query.format || null,
        college: query.college || null,
        branchId: query.branchId || null,
        semesterId: query.semesterId || null
      });
    } catch (error) {
      notesFeed.innerHTML = `<div class="empty-state">${error.message}</div>`;
    }
  }

  saveBtn?.addEventListener('click', async () => {
    if (!hasPremiumAccess) {
      alert('Upgrade to Premium (Rs.49/month) to access notes.');
      window.location.href = 'pricing.html';
      return;
    }

    const value = quill ? quill.root.innerHTML : editor?.value || '';
    try {
      await window.CollegeOSApi.createNote({
        subject: 'Personal',
        chapter: 'My Notes',
        content: value,
        userNotes: value,
        bookmarks: ['important'],
        difficulty: 'medium',
        formatType: 'personal'
      });
      alert('Personal notes saved to your account.');
      await loadNotesFeed();
    } catch (error) {
      alert(error.message);
    }
  });

  aiBtn?.addEventListener('click', () => {
    const source = document.getElementById('chapterInput')?.value || '';
    const summary = source
      .split('.')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 4)
      .map((x, i) => `${i + 1}. ${x}`)
      .join('\n');
    document.getElementById('aiSummaryOutput').textContent = summary || 'Paste chapter text first to generate a summary.';

    if (source && aiSourceInput && !aiSourceInput.value.trim()) {
      aiSourceInput.value = source;
    }
  });

  document.getElementById('downloadNotesBtn')?.addEventListener('click', () => {
    window.print();
  });

  const triggerRefresh = () => loadNotesFeed();
  search?.addEventListener('input', triggerRefresh);
  formatFilter?.addEventListener('change', triggerRefresh);
  collegeFilter?.addEventListener('change', triggerRefresh);
  refreshBtn?.addEventListener('click', triggerRefresh);

  async function loadMyLatestNote() {
    if (!window.CollegeOSApi) return;
    try {
      const { notes } = await window.CollegeOSApi.getMyNotes();
      const latest = notes?.[0];
      if (!latest) return;
      if (quill) {
        quill.root.innerHTML = latest.user_notes || latest.content || '';
      } else if (editor) {
        editor.value = latest.user_notes || latest.content || '';
      }
      emitNotesEvent('personal_note_loaded', {
        noteId: latest.id || null,
        hasContent: Boolean(latest.user_notes || latest.content)
      });
    } catch {
      // Keep editor usable even when API call fails.
    }
  }

  loadColleges().finally(() => {
    loadAcademicFilters().finally(() => {
      loadNotesFeed();
    });
    loadMyLatestNote();
  });

  window.addEventListener('collegeos:realtime', (event) => {
    if (event?.detail?.type !== 'content_changed') return;
    loadAcademicFilters().finally(() => {
      loadNotesFeed();
    });
  });
});
