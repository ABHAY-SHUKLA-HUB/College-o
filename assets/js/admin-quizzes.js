  let questionCount = 0;

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

      [document.getElementById('quizCategoryId'), document.getElementById('quizzesFilterCategoryId')].forEach((select) => {
        categories.forEach((category) => {
          const option = document.createElement('option');
          option.value = category.id;
          option.textContent = category.name;
          select.appendChild(option);
        });
      });

      [document.getElementById('quizSemesterId'), document.getElementById('quizzesFilterSemesterId')].forEach((select) => {
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

    function addQuestion() {
      questionCount++;
      const container = document.getElementById('questionsContainer');
      const questionBlock = document.createElement('div');
      questionBlock.className = 'co-admin-builder-block';
      questionBlock.innerHTML = `
        <div class="co-admin-field">
          <label>Question ${questionCount} *</label>
          <input name="questions[${questionCount}][text]" required />
        </div>
        <div class="co-admin-field" style="margin-top:12px;">
          <label>Options (select the correct answer)</label>
          <div class="co-admin-option-row">
            <input type="radio" name="questions[${questionCount}][correct]" value="A" required />
            <input name="questions[${questionCount}][optionA]" placeholder="Option A" required />
          </div>
          <div class="co-admin-option-row">
            <input type="radio" name="questions[${questionCount}][correct]" value="B" />
            <input name="questions[${questionCount}][optionB]" placeholder="Option B" required />
          </div>
          <div class="co-admin-option-row">
            <input type="radio" name="questions[${questionCount}][correct]" value="C" />
            <input name="questions[${questionCount}][optionC]" placeholder="Option C" required />
          </div>
          <div class="co-admin-option-row">
            <input type="radio" name="questions[${questionCount}][correct]" value="D" />
            <input name="questions[${questionCount}][optionD]" placeholder="Option D" required />
          </div>
        </div>
        <div class="actions" style="margin-top:12px;"><button type="button" class="btn danger sm" data-action="remove-question"><i class="fa-solid fa-trash"></i> Remove Question</button></div>
      `;
      container.appendChild(questionBlock);
    }

    document.getElementById('createQuizForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = document.getElementById('quizStatus');
      const formData = new FormData(e.target);

      const quiz = {
        subject: formData.get('subject'),
        chapter: formData.get('chapter'),
        difficulty: formData.get('difficulty'),
        categoryId: formData.get('categoryId'),
        branchId: formData.get('branchId'),
        semesterId: formData.get('semesterId'),
        accessType: formData.get('accessType'),
        status: formData.get('status'),
        isCommon: formData.get('isCommon') === 'on',
        questions: [],
        questionCount: 0
      };

      for (let i = 1; i <= questionCount; i++) {
        const text = formData.get(`questions[${i}][text]`);
        if (text) {
          quiz.questions.push({
            text,
            options: {
              A: formData.get(`questions[${i}][optionA]`),
              B: formData.get(`questions[${i}][optionB]`),
              C: formData.get(`questions[${i}][optionC]`),
              D: formData.get(`questions[${i}][optionD]`)
            },
            correct: formData.get(`questions[${i}][correct]`)
          });
        }
      }

      quiz.questionCount = quiz.questions.length;

      if (!quiz.questionCount) {
        status.textContent = 'Please add at least one question.';
        status.style.color = '#c6342d';
        return;
      }

      try {
        status.textContent = 'Creating quiz...';
        const response = await fetch('/api/admin/academics/quizzes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            subject: quiz.subject,
            chapter: quiz.chapter,
            difficulty: quiz.difficulty,
            questionCount: quiz.questionCount,
            categoryId: quiz.categoryId,
            branchId: quiz.branchId,
            semesterId: quiz.semesterId,
            accessType: quiz.accessType,
            status: quiz.status,
            isCommon: quiz.isCommon
          })
        });

        const data = await response.json();
        if (response.ok) {
          status.textContent = 'Quiz created successfully!';
          status.style.color = '#157f37';
          e.target.reset();
          document.getElementById('questionsContainer').innerHTML = '';
          questionCount = 0;
          document.getElementById('quizBranchId').innerHTML = '<option value="">Select branch or course</option>';
          document.getElementById('quizBranchId').disabled = true;
          loadQuizzes();
          addQuestion();
        } else {
          throw new Error(data.error);
        }
      } catch (error) {
        status.textContent = 'Error: ' + error.message;
        status.style.color = '#c6342d';
      }
    });

    async function loadQuizzes() {
      const tbody = document.getElementById('quizzesTableBody');
      try {
        const params = new URLSearchParams();
        const categoryId = document.getElementById('quizzesFilterCategoryId').value;
        const branchId = document.getElementById('quizzesFilterBranchId').value;
        const semesterId = document.getElementById('quizzesFilterSemesterId').value;
        const status = document.getElementById('quizzesFilterStatus').value;

        if (categoryId) params.set('categoryId', categoryId);
        if (branchId) params.set('branchId', branchId);
        if (semesterId) params.set('semesterId', semesterId);
        if (status) params.set('status', status);

        const suffix = params.toString() ? `?${params.toString()}` : '';
        const response = await fetch(`/api/admin/academics/quizzes${suffix}`, { credentials: 'include' });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load quizzes');
        }

        if (data.quizzes && data.quizzes.length > 0) {
          tbody.innerHTML = data.quizzes.map(quiz => `
            <tr>
              <td>${quiz.subject || 'N/A'}</td>
              <td>${quiz.chapter || 'N/A'}</td>
              <td>${quiz.branch_name || (quiz.is_common ? 'Common' : '-')}</td>
              <td>${quiz.semester_label || 'All'}</td>
              <td>${quiz.question_count || 0} questions</td>
              <td><span class="co-admin-badge">${quiz.status || 'published'}</span></td>
              <td><button class="btn danger sm" data-action="delete-quiz" data-quiz-id="${quiz.id}"><i class="fa-solid fa-trash"></i> Delete</button></td>
            </tr>
          `).join('');
        } else {
          tbody.innerHTML = '<tr><td colspan="7" class="co-admin-table-empty">No quizzes found.</td></tr>';
        }
      } catch (error) {
        tbody.innerHTML = `<tr><td colspan="7" class="co-admin-table-empty" style="color:#c6342d;">${error.message}</td></tr>`;
      }
    }

    async function deleteQuiz(id) {
      if (!confirm('Delete this quiz?')) return;
      try {
        await fetch(`/api/admin/academics/quizzes/${id}`, { method: 'DELETE', credentials: 'include' });
        loadQuizzes();
      } catch (error) {
        alert('Error: ' + error.message);
      }
    }

    document.getElementById('addQuestionBtn').addEventListener('click', addQuestion);

    document.getElementById('questionsContainer').addEventListener('click', (event) => {
      const button = event.target.closest('[data-action="remove-question"]');
      if (!button) return;
      const block = button.closest('.co-admin-builder-block');
      if (block) block.remove();
    });

    document.getElementById('quizzesTableBody').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action="delete-quiz"]');
      if (!button) return;
      const quizId = Number(button.dataset.quizId);
      if (!Number.isInteger(quizId) || quizId <= 0) return;
      await deleteQuiz(quizId);
    });

    document.getElementById('quizCategoryId').addEventListener('change', async () => {
      await updateBranchSelect('quizCategoryId', 'quizBranchId', 'Select branch or course');
    });

    document.getElementById('quizzesFilterCategoryId').addEventListener('change', async () => {
      await updateBranchSelect('quizzesFilterCategoryId', 'quizzesFilterBranchId', 'All branches/courses');
      await loadQuizzes();
    });

    document.getElementById('quizzesFilterBranchId').addEventListener('change', loadQuizzes);
    document.getElementById('quizzesFilterSemesterId').addEventListener('change', loadQuizzes);
    document.getElementById('quizzesFilterStatus').addEventListener('change', loadQuizzes);

    (async () => {
      await ensureAdminSession();
      await loadAcademicOptions();
      await loadQuizzes();
      addQuestion();
    })();

    window.addEventListener('collegeos:realtime', (event) => {
      if (event?.detail?.type !== 'content_changed') return;
      loadQuizzes();
    });
  
