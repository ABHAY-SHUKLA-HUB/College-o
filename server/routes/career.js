const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth, requireAdmin, resolveMembershipState } = require('../middleware/auth');
const { generateToolOutput } = require('../services/aiToolEngine');

const router = express.Router();

let schemaReady = false;

const DEFAULT_ROADMAPS = [
  {
    slug: 'software-developer',
    title: 'Software Developer',
    careerTrack: 'Engineering',
    tagline: 'Build strong fundamentals, ship real apps, and prepare for campus hiring.',
    description: 'A branch-friendly roadmap for students aiming for software engineering roles with strong DSA, project, and interview readiness.',
    iconName: 'fa-code',
    accentColor: '#2563eb',
    difficultyLevel: 'Beginner to Intermediate',
    estimatedDuration: '24 weeks',
    accessType: 'free',
    isFeatured: true,
    sortOrder: 10,
    skills: ['Programming fundamentals', 'Data structures', 'Algorithms', 'Git and GitHub', 'Problem solving'],
    tools: ['VS Code', 'Git', 'GitHub', 'Postman', 'Chrome DevTools'],
    projects: ['Student portal clone', 'REST API project', 'Portfolio website'],
    certifications: ['GitHub Foundations', 'Postman API Fundamentals'],
    interviewPrep: 'Focus on arrays, strings, recursion, OOP, DBMS, OS, and 2 mock interviews every week.',
    placementReadiness: 'Build one polished resume, maintain a GitHub profile, and practice coding rounds under time pressure.',
    stages: [
      {
        stageTitle: 'Core Foundations',
        stageSummary: 'Build confidence with one programming language and essential CS basics.',
        skills: ['Language syntax', 'OOP basics', 'Loops and functions'],
        tools: ['VS Code', 'Git'],
        projects: ['CLI calculator', 'Student record manager'],
        certifications: ['Programming fundamentals certificate'],
        interviewPrep: 'Explain code aloud and review beginner programming questions.',
        placementReadiness: 'Create a one-page resume draft and LinkedIn headline.'
      },
      {
        stageTitle: 'DSA and Problem Solving',
        stageSummary: 'Learn the patterns used in coding rounds and online assessments.',
        skills: ['Arrays', 'Linked lists', 'Trees', 'Sorting', 'Binary search'],
        tools: ['LeetCode', 'CodeStudio'],
        projects: ['Pattern notebook', 'DSA revision tracker'],
        certifications: ['DSA practice streak badge'],
        interviewPrep: 'Practice 5 medium questions per week with dry runs.',
        placementReadiness: 'Track solved questions by topic and confidence level.'
      },
      {
        stageTitle: 'Backend and Full-Stack Projects',
        stageSummary: 'Ship real products that prove implementation ability.',
        skills: ['REST APIs', 'Databases', 'Authentication', 'Deployment'],
        tools: ['Node.js', 'Express', 'PostgreSQL', 'Render'],
        projects: ['Task manager API', 'Campus event app'],
        certifications: ['Backend development course certificate'],
        interviewPrep: 'Prepare system design basics and project deep dives.',
        placementReadiness: 'Document architecture, tradeoffs, and impact of every project.'
      },
      {
        stageTitle: 'Placement Sprint',
        stageSummary: 'Turn your preparation into interview readiness.',
        skills: ['Resume storytelling', 'CS fundamentals revision', 'Communication'],
        tools: ['Interview tracker', 'Resume builder'],
        projects: ['Interview question journal'],
        certifications: ['Mock interview completion'],
        interviewPrep: 'Run HR, technical, and project interviews every week.',
        placementReadiness: 'Finalize resume, referrals message, and company-wise prep list.'
      }
    ]
  },
  {
    slug: 'ai-engineer',
    title: 'AI Engineer',
    careerTrack: 'AI and Machine Learning',
    tagline: 'Move from math and Python basics to ML deployment and applied AI projects.',
    description: 'A modern AI roadmap covering Python, data, ML, deep learning, LLM workflows, and deployment.',
    iconName: 'fa-brain',
    accentColor: '#7c3aed',
    difficultyLevel: 'Intermediate',
    estimatedDuration: '28 weeks',
    accessType: 'premium',
    isFeatured: true,
    sortOrder: 20,
    skills: ['Python', 'Statistics', 'Machine learning', 'Deep learning', 'Prompt engineering'],
    tools: ['Python', 'Pandas', 'scikit-learn', 'PyTorch', 'Jupyter'],
    projects: ['House price predictor', 'Resume classifier', 'AI tutor chatbot'],
    certifications: ['Google ML Crash Course', 'AWS ML Foundations'],
    interviewPrep: 'Revise regression, classification, feature engineering, evaluation metrics, neural networks, and ML tradeoffs.',
    placementReadiness: 'Keep 2 deployment-ready projects and explain model choice, limitations, and monitoring.',
    stages: [
      {
        stageTitle: 'Math and Python Base',
        stageSummary: 'Refresh Python, statistics, and linear algebra basics before model building.',
        skills: ['Python syntax', 'Probability', 'Vectors', 'Data handling'],
        tools: ['Python', 'NumPy', 'Jupyter'],
        projects: ['EDA notebook', 'Statistics cheat sheet'],
        certifications: ['Python data foundations'],
        interviewPrep: 'Practice explaining mean, variance, bias, and overfitting simply.',
        placementReadiness: 'Build a clean notebook workflow and portfolio README format.'
      },
      {
        stageTitle: 'Classical ML',
        stageSummary: 'Learn supervised and unsupervised learning with real datasets.',
        skills: ['Regression', 'Classification', 'Clustering', 'Feature engineering'],
        tools: ['Pandas', 'scikit-learn'],
        projects: ['Churn model', 'Student performance predictor'],
        certifications: ['ML beginner track'],
        interviewPrep: 'Compare algorithms and discuss feature importance and evaluation.',
        placementReadiness: 'Publish one project with metrics, visuals, and business takeaway.'
      },
      {
        stageTitle: 'Deep Learning and GenAI',
        stageSummary: 'Move to neural networks, embeddings, and practical GenAI workflows.',
        skills: ['Neural nets', 'Transformers', 'Embeddings', 'Prompt design'],
        tools: ['PyTorch', 'Hugging Face', 'Open-source models'],
        projects: ['Image classifier', 'RAG assistant'],
        certifications: ['Deep learning specialisation'],
        interviewPrep: 'Understand attention, tokenization, fine-tuning, and inference cost.',
        placementReadiness: 'Prepare one product-minded GenAI case study.'
      },
      {
        stageTitle: 'Model Deployment',
        stageSummary: 'Turn notebooks into usable products with APIs and monitoring.',
        skills: ['Serving', 'Evaluation', 'MLOps basics'],
        tools: ['FastAPI', 'Docker', 'Weights and Biases'],
        projects: ['Model API', 'AI dashboard'],
        certifications: ['MLOps foundations'],
        interviewPrep: 'Practice architecture questions for AI products.',
        placementReadiness: 'Show end-to-end ownership from dataset to deployed app.'
      }
    ]
  },
  {
    slug: 'data-analyst',
    title: 'Data Analyst',
    careerTrack: 'Data and Analytics',
    tagline: 'Learn SQL, Excel, BI tools, and storytelling for analytics and business insight roles.',
    description: 'A structured analytics roadmap for students interested in dashboards, reporting, SQL, and business problem solving.',
    iconName: 'fa-chart-simple',
    accentColor: '#0f766e',
    difficultyLevel: 'Beginner',
    estimatedDuration: '18 weeks',
    accessType: 'free',
    isFeatured: true,
    sortOrder: 30,
    skills: ['SQL', 'Excel', 'Dashboarding', 'Business communication'],
    tools: ['Excel', 'SQL', 'Power BI', 'Looker Studio'],
    projects: ['Sales dashboard', 'Cohort analysis', 'Student performance analytics'],
    certifications: ['Google Data Analytics', 'Power BI badge'],
    interviewPrep: 'Review SQL joins, aggregations, business cases, KPI selection, and dashboard critique.',
    placementReadiness: 'Maintain 3 clean dashboards and business-first project summaries.',
    stages: [
      {
        stageTitle: 'Spreadsheet and SQL Basics',
        stageSummary: 'Learn to clean, inspect, and aggregate data quickly.',
        skills: ['Excel formulas', 'Pivot tables', 'SQL select and joins'],
        tools: ['Excel', 'PostgreSQL'],
        projects: ['Attendance tracker', 'Sales cleanup workbook'],
        certifications: ['Spreadsheet analytics badge'],
        interviewPrep: 'Practice SQL query explanation with datasets.',
        placementReadiness: 'Create a KPI glossary and SQL notes sheet.'
      },
      {
        stageTitle: 'Analytics Thinking',
        stageSummary: 'Learn metrics, funnels, cohorts, and decision-oriented analysis.',
        skills: ['KPIs', 'Funnels', 'Trend analysis', 'Segmentation'],
        tools: ['SQL', 'Google Sheets'],
        projects: ['Monthly business report'],
        certifications: ['Business analytics starter'],
        interviewPrep: 'Work through product and business case questions.',
        placementReadiness: 'Build concise slides with problem, analysis, and recommendation.'
      },
      {
        stageTitle: 'Dashboards and Storytelling',
        stageSummary: 'Convert raw data into decision-ready dashboards.',
        skills: ['Visualization', 'Storytelling', 'Stakeholder communication'],
        tools: ['Power BI', 'Tableau'],
        projects: ['Executive dashboard', 'Placement trend tracker'],
        certifications: ['Power BI or Tableau certificate'],
        interviewPrep: 'Explain visualization choices and dashboard structure.',
        placementReadiness: 'Prepare one stakeholder-ready portfolio case study.'
      }
    ]
  },
  {
    slug: 'cloud-engineer',
    title: 'Cloud Engineer',
    careerTrack: 'Cloud and DevOps',
    tagline: 'Learn Linux, networking, cloud fundamentals, containers, and deployment patterns.',
    description: 'A cloud roadmap that moves from systems basics to AWS/Azure projects, CI/CD, and infrastructure thinking.',
    iconName: 'fa-cloud',
    accentColor: '#0284c7',
    difficultyLevel: 'Intermediate',
    estimatedDuration: '22 weeks',
    accessType: 'premium',
    isFeatured: false,
    sortOrder: 40,
    skills: ['Linux', 'Networking', 'Cloud services', 'Containers', 'CI/CD'],
    tools: ['Linux', 'Docker', 'AWS', 'GitHub Actions'],
    projects: ['Static site deployment', 'Containerized API', 'Cloud monitoring setup'],
    certifications: ['AWS Cloud Practitioner', 'Azure Fundamentals'],
    interviewPrep: 'Revise networking basics, IAM, compute vs storage, scaling, and deployment pipelines.',
    placementReadiness: 'Document architecture diagrams and cost/performance tradeoffs.',
    stages: [
      {
        stageTitle: 'System and Networking Basics',
        stageSummary: 'Understand how servers, ports, and deployment environments work.',
        skills: ['Linux commands', 'Processes', 'Networking basics'],
        tools: ['Linux terminal', 'Nginx'],
        projects: ['Linux cheatsheet', 'Server setup practice'],
        certifications: ['Linux beginner'],
        interviewPrep: 'Explain HTTP, DNS, ports, and reverse proxy basics.',
        placementReadiness: 'Be able to debug a basic deployment from logs.'
      },
      {
        stageTitle: 'Cloud Core Services',
        stageSummary: 'Learn compute, storage, security, and monitoring services.',
        skills: ['VMs', 'Object storage', 'IAM', 'Monitoring'],
        tools: ['AWS EC2', 'S3', 'CloudWatch'],
        projects: ['Cloud-hosted web app'],
        certifications: ['AWS Cloud Practitioner'],
        interviewPrep: 'Compare services and common use cases.',
        placementReadiness: 'Prepare one project with infra overview and cost notes.'
      },
      {
        stageTitle: 'Containers and CI/CD',
        stageSummary: 'Automate build and deploy workflows for modern teams.',
        skills: ['Docker', 'Pipelines', 'Deployment automation'],
        tools: ['Docker', 'GitHub Actions'],
        projects: ['CI/CD for Node app'],
        certifications: ['Docker foundations'],
        interviewPrep: 'Practice container vs VM and CI/CD scenario questions.',
        placementReadiness: 'Maintain one live demo with deployment pipeline screenshots.'
      }
    ]
  },
  {
    slug: 'web-developer',
    title: 'Web Developer',
    careerTrack: 'Frontend and Full Stack',
    tagline: 'Design, build, and ship modern responsive web products with production polish.',
    description: 'A practical web roadmap covering HTML/CSS/JS, component architecture, APIs, and deployment.',
    iconName: 'fa-globe',
    accentColor: '#ea580c',
    difficultyLevel: 'Beginner to Intermediate',
    estimatedDuration: '20 weeks',
    accessType: 'free',
    isFeatured: true,
    sortOrder: 50,
    skills: ['HTML/CSS', 'JavaScript', 'Responsive design', 'API integration'],
    tools: ['Figma', 'VS Code', 'Chrome DevTools', 'Netlify'],
    projects: ['Portfolio', 'Landing page', 'Dashboard app'],
    certifications: ['Frontend foundations', 'Responsive web design'],
    interviewPrep: 'Review DOM, event loop, CSS layout, accessibility, APIs, and project architecture.',
    placementReadiness: 'Show visually polished, mobile-ready projects with clean code and README docs.',
    stages: [
      {
        stageTitle: 'Frontend Basics',
        stageSummary: 'Master layout, styling, and interaction fundamentals.',
        skills: ['Semantic HTML', 'Flexbox', 'Grid', 'JS basics'],
        tools: ['VS Code', 'DevTools'],
        projects: ['Responsive landing page'],
        certifications: ['Responsive design course'],
        interviewPrep: 'Explain CSS box model, DOM selection, and responsive layout choices.',
        placementReadiness: 'Polish one strong visual project.'
      },
      {
        stageTitle: 'Interactive Interfaces',
        stageSummary: 'Build app-like experiences with state and reusable patterns.',
        skills: ['State management', 'Components', 'Async requests'],
        tools: ['Vanilla JS or React'],
        projects: ['Kanban board', 'Student dashboard'],
        certifications: ['Frontend intermediate certificate'],
        interviewPrep: 'Practice JS fundamentals and UI debugging questions.',
        placementReadiness: 'Document your component approach and architecture choices.'
      },
      {
        stageTitle: 'Full-Stack Delivery',
        stageSummary: 'Connect frontend to backend and deploy complete products.',
        skills: ['Auth', 'CRUD APIs', 'Deployment'],
        tools: ['Node.js', 'Express', 'Postgres'],
        projects: ['Full-stack internship tracker'],
        certifications: ['Full-stack project completion'],
        interviewPrep: 'Prepare end-to-end project walkthroughs.',
        placementReadiness: 'Keep one deployed app with production-style UX polish.'
      }
    ]
  },
  {
    slug: 'finance-and-commerce',
    title: 'Commerce and Finance Careers',
    careerTrack: 'Commerce and Finance',
    tagline: 'Prepare for analyst, finance, accounting, audit, and operations roles with structured progression.',
    description: 'A commerce-focused roadmap covering accounting, Excel, tax basics, finance operations, business analysis, and interview preparation.',
    iconName: 'fa-sack-dollar',
    accentColor: '#16a34a',
    difficultyLevel: 'Beginner',
    estimatedDuration: '18 weeks',
    accessType: 'free',
    isFeatured: true,
    sortOrder: 60,
    skills: ['Accounting', 'Excel', 'Business communication', 'Financial analysis'],
    tools: ['Excel', 'Tally', 'PowerPoint', 'Google Sheets'],
    projects: ['Budget tracker', 'Financial report summary', 'Tax case sheet'],
    certifications: ['NSE basics', 'Tally or Excel certification'],
    interviewPrep: 'Prepare accounting fundamentals, ratio analysis, GST basics, and scenario-based HR answers.',
    placementReadiness: 'Build a resume highlighting internships, Excel comfort, business clarity, and communication.',
    stages: [
      {
        stageTitle: 'Commerce Core Concepts',
        stageSummary: 'Strengthen accounting, business, and reporting fundamentals.',
        skills: ['Journal entries', 'Ledger', 'P&L', 'Balance sheet'],
        tools: ['Excel', 'Tally'],
        projects: ['Manual accounts workbook'],
        certifications: ['Accounting foundation'],
        interviewPrep: 'Explain core accounting terms and examples clearly.',
        placementReadiness: 'Prepare a compact business glossary and examples.'
      },
      {
        stageTitle: 'Excel and Financial Operations',
        stageSummary: 'Use spreadsheets for analysis, reporting, and operations workflows.',
        skills: ['VLOOKUP', 'Pivot tables', 'MIS reporting'],
        tools: ['Excel', 'Google Sheets'],
        projects: ['MIS dashboard', 'Expense analysis'],
        certifications: ['Advanced Excel'],
        interviewPrep: 'Practice Excel use-cases and business reporting questions.',
        placementReadiness: 'Keep one finance operations case study in your portfolio.'
      },
      {
        stageTitle: 'Career and Placement Prep',
        stageSummary: 'Move toward analyst, finance, or operations placement readiness.',
        skills: ['Business writing', 'Interview clarity', 'Presentation'],
        tools: ['PowerPoint', 'Canva'],
        projects: ['Case presentation deck'],
        certifications: ['Finance or analyst short course'],
        interviewPrep: 'Prepare commerce domain and HR answers for analyst roles.',
        placementReadiness: 'Create a role-wise preparation tracker for finance companies.'
      }
    ]
  }
];

const DEFAULT_AI_TOOLS = [
  { toolKey: 'notes-summary', title: 'AI Notes Summary', tagline: 'Turn long notes into crisp revision points.', description: 'Summarises textbook, class, or self notes into structured bullet takeaways.', iconName: 'fa-file-waveform', accentColor: '#2563eb', accessType: 'free', isFeatured: true, benefits: ['Fast revision bullets', 'Exam-focused takeaways', 'Cleaner note structure'], promptTemplate: 'Summarise this content into key points, formulas, and exam tips.' },
  { toolKey: 'quiz-generator', title: 'AI Quiz Generator', tagline: 'Create branch-aware practice quizzes in seconds.', description: 'Generates quick MCQs from topics, chapters, or pasted concepts.', iconName: 'fa-clipboard-question', accentColor: '#7c3aed', accessType: 'premium', isFeatured: true, benefits: ['Topic-based MCQs', 'Difficulty-aware prompts', 'Quick self-testing'], promptTemplate: 'Generate 5 MCQs with answers and explanations from this topic.' },
  { toolKey: 'flashcards-generator', title: 'AI Flashcards Generator', tagline: 'Build memory-friendly flashcards from any topic.', description: 'Converts concepts into compact question-answer flashcards for daily revision.', iconName: 'fa-layer-group', accentColor: '#0f766e', accessType: 'premium', isFeatured: true, benefits: ['Fast active recall', 'Topic cards', 'Revision-ready output'], promptTemplate: 'Create flashcards with front and back for the given concept.' },
  { toolKey: 'doubt-solver', title: 'AI Doubt Solver', tagline: 'Get simplified explanations for confusing topics.', description: 'Explains concepts using plain language, steps, and examples.', iconName: 'fa-circle-question', accentColor: '#ea580c', accessType: 'free', isFeatured: true, benefits: ['Simple explanations', 'Example-led answers', 'Exam angle support'], promptTemplate: 'Explain the doubt in simple terms, steps, and with one analogy.' },
  { toolKey: 'resume-builder', title: 'AI Resume Builder', tagline: 'Draft stronger student resumes for internships and placements.', description: 'Generates profile summaries, project bullets, and achievement lines.', iconName: 'fa-file-user', accentColor: '#0284c7', accessType: 'premium', isFeatured: true, benefits: ['ATS-friendly bullets', 'Role-focused summary', 'Project framing'], promptTemplate: 'Create concise resume bullets from the given skills and projects.' },
  { toolKey: 'career-suggestion', title: 'AI Career Suggestion Tool', tagline: 'Discover career paths based on strengths and interests.', description: 'Suggests suitable roles using branch, interests, and preferred work style.', iconName: 'fa-compass-drafting', accentColor: '#16a34a', accessType: 'free', isFeatured: true, benefits: ['Role match suggestions', 'Skill gap hints', 'Actionable next steps'], promptTemplate: 'Suggest 3 career paths based on branch, interests, and strengths.' },
  { toolKey: 'study-planner', title: 'AI Study Planner', tagline: 'Generate realistic weekly study plans.', description: 'Creates branch-aware study schedules with topics, practice, and revision blocks.', iconName: 'fa-calendar-check', accentColor: '#b45309', accessType: 'free', isFeatured: false, benefits: ['Time-blocked plans', 'Exam-focused schedule', 'Balanced revision'], promptTemplate: 'Create a weekly plan from available hours, goals, and weak subjects.' },
  { toolKey: 'concept-explainer', title: 'AI Concept Explainer', tagline: 'Understand tough ideas with simple analogies.', description: 'Breaks concepts down into beginner, intermediate, and interview-level explanations.', iconName: 'fa-lightbulb', accentColor: '#db2777', accessType: 'free', isFeatured: false, benefits: ['Level-based explanation', 'Analogy and example', 'Interview-ready summary'], promptTemplate: 'Explain the concept for beginner, exam revision, and interview depth.' },
  { toolKey: 'interview-generator', title: 'AI Interview Question Generator', tagline: 'Practice targeted technical and HR questions.', description: 'Generates role-specific interview questions with talking points.', iconName: 'fa-user-tie', accentColor: '#475569', accessType: 'premium', isFeatured: false, benefits: ['Role-based questions', 'HR and technical mix', 'Talking point suggestions'], promptTemplate: 'Generate interview questions and model talking points for this role.' },
  { toolKey: 'roadmap-recommender', title: 'AI Roadmap Recommender', tagline: 'Pick the next roadmap based on your profile.', description: 'Matches available career roadmaps to your branch, goals, and current stage.', iconName: 'fa-route', accentColor: '#0f7b6c', accessType: 'premium', isFeatured: false, benefits: ['Profile-aware recommendations', 'Skill gap mapping', 'Focused next steps'], promptTemplate: 'Recommend the best roadmap and explain why it fits.' }
];

async function ensureCareerSchema() {
  if (schemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS career_roadmaps (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      slug VARCHAR(120) UNIQUE NOT NULL,
      title VARCHAR(180) NOT NULL,
      career_track VARCHAR(120) NOT NULL,
      tagline TEXT,
      description TEXT,
      icon_name VARCHAR(80) DEFAULT 'fa-route',
      accent_color VARCHAR(20) DEFAULT '#2563eb',
      difficulty_level VARCHAR(80),
      estimated_duration VARCHAR(80),
      access_type VARCHAR(20) DEFAULT 'free',
      status VARCHAR(30) DEFAULT 'published',
      is_published BOOLEAN DEFAULT TRUE,
      is_featured BOOLEAN DEFAULT FALSE,
      sort_order INTEGER DEFAULT 0,
      category_id INTEGER REFERENCES academic_categories(id),
      branch_id INTEGER REFERENCES academic_branches(id),
      semester_id INTEGER REFERENCES academic_semesters(id),
      skills JSONB NOT NULL DEFAULT '[]'::jsonb,
      tools JSONB NOT NULL DEFAULT '[]'::jsonb,
      projects JSONB NOT NULL DEFAULT '[]'::jsonb,
      certifications JSONB NOT NULL DEFAULT '[]'::jsonb,
      interview_prep TEXT,
      placement_readiness TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS career_roadmap_stages (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      roadmap_id INTEGER NOT NULL REFERENCES career_roadmaps(id) ON DELETE CASCADE,
      stage_title VARCHAR(180) NOT NULL,
      stage_summary TEXT,
      skills JSONB NOT NULL DEFAULT '[]'::jsonb,
      tools JSONB NOT NULL DEFAULT '[]'::jsonb,
      projects JSONB NOT NULL DEFAULT '[]'::jsonb,
      certifications JSONB NOT NULL DEFAULT '[]'::jsonb,
      interview_prep TEXT,
      placement_readiness TEXT,
      sequence_no INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_tools_catalog (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      tool_key VARCHAR(120) UNIQUE NOT NULL,
      title VARCHAR(180) NOT NULL,
      tagline TEXT,
      description TEXT,
      icon_name VARCHAR(80) DEFAULT 'fa-wand-magic-sparkles',
      accent_color VARCHAR(20) DEFAULT '#2563eb',
      access_type VARCHAR(20) DEFAULT 'free',
      status VARCHAR(30) DEFAULT 'published',
      is_enabled BOOLEAN DEFAULT TRUE,
      is_visible BOOLEAN DEFAULT TRUE,
      is_featured BOOLEAN DEFAULT FALSE,
      sort_order INTEGER DEFAULT 0,
      category_id INTEGER REFERENCES academic_categories(id),
      branch_id INTEGER REFERENCES academic_branches(id),
      semester_id INTEGER REFERENCES academic_semesters(id),
      benefits JSONB NOT NULL DEFAULT '[]'::jsonb,
      prompt_template TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP
    )
  `);

  const roadmapCount = await pool.query('SELECT COUNT(*)::int AS count FROM career_roadmaps WHERE deleted_at IS NULL');
  if (roadmapCount.rows[0]?.count === 0) {
    for (const roadmap of DEFAULT_ROADMAPS) {
      const insert = await pool.query(
        `INSERT INTO career_roadmaps (
          slug, title, career_track, tagline, description, icon_name, accent_color,
          difficulty_level, estimated_duration, access_type, is_featured, sort_order,
          skills, tools, projects, certifications, interview_prep, placement_readiness
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12,
          $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17, $18
        ) RETURNING id`,
        [
          roadmap.slug,
          roadmap.title,
          roadmap.careerTrack,
          roadmap.tagline,
          roadmap.description,
          roadmap.iconName,
          roadmap.accentColor,
          roadmap.difficultyLevel,
          roadmap.estimatedDuration,
          roadmap.accessType,
          roadmap.isFeatured,
          roadmap.sortOrder,
          JSON.stringify(roadmap.skills || []),
          JSON.stringify(roadmap.tools || []),
          JSON.stringify(roadmap.projects || []),
          JSON.stringify(roadmap.certifications || []),
          roadmap.interviewPrep,
          roadmap.placementReadiness
        ]
      );
      const roadmapId = insert.rows[0].id;
      for (let index = 0; index < roadmap.stages.length; index += 1) {
        const stage = roadmap.stages[index];
        await pool.query(
          `INSERT INTO career_roadmap_stages (
            roadmap_id, stage_title, stage_summary, skills, tools, projects, certifications,
            interview_prep, placement_readiness, sequence_no
          ) VALUES (
            $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb,
            $8, $9, $10
          )`,
          [
            roadmapId,
            stage.stageTitle,
            stage.stageSummary,
            JSON.stringify(stage.skills || []),
            JSON.stringify(stage.tools || []),
            JSON.stringify(stage.projects || []),
            JSON.stringify(stage.certifications || []),
            stage.interviewPrep,
            stage.placementReadiness,
            index + 1
          ]
        );
      }
    }
  }

  const toolsCount = await pool.query('SELECT COUNT(*)::int AS count FROM ai_tools_catalog WHERE deleted_at IS NULL');
  if (toolsCount.rows[0]?.count === 0) {
    for (let index = 0; index < DEFAULT_AI_TOOLS.length; index += 1) {
      const tool = DEFAULT_AI_TOOLS[index];
      await pool.query(
        `INSERT INTO ai_tools_catalog (
          tool_key, title, tagline, description, icon_name, accent_color,
          access_type, is_enabled, is_visible, is_featured, sort_order,
          benefits, prompt_template
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, TRUE, TRUE, $8, $9,
          $10::jsonb, $11
        ) ON CONFLICT (tool_key) DO NOTHING`,
        [
          tool.toolKey,
          tool.title,
          tool.tagline,
          tool.description,
          tool.iconName,
          tool.accentColor,
          tool.accessType,
          tool.isFeatured,
          (index + 1) * 10,
          JSON.stringify(tool.benefits || []),
          tool.promptTemplate
        ]
      );
    }
  }

  schemaReady = true;
}

async function getUserAcademicProfile(userId) {
  const { rows } = await pool.query(
    `SELECT up.category_id, up.branch_id, up.semester_id,
            ac.name AS category_name,
            ab.name AS branch_name,
            s.label AS semester_label
     FROM user_profiles up
     LEFT JOIN academic_categories ac ON ac.id = up.category_id
     LEFT JOIN academic_branches ab ON ab.id = up.branch_id
     LEFT JOIN academic_semesters s ON s.id = up.semester_id
     WHERE up.user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}

function enrichAccess(rows, membership) {
  return rows.map((row) => ({
    ...row,
    locked: row.access_type === 'premium' && !(membership?.premiumActive || membership?.isAdmin)
  }));
}

function scoreRoadmap(row, profile) {
  let score = 0;
  if (row.is_featured) score += 8;
  if (profile?.branch_id && row.branch_id && Number(profile.branch_id) === Number(row.branch_id)) score += 12;
  if (profile?.semester_id && row.semester_id && Number(profile.semester_id) === Number(row.semester_id)) score += 8;
  if (profile?.category_id && row.category_id && Number(profile.category_id) === Number(row.category_id)) score += 6;

  const branch = String(profile?.branch_name || '').toLowerCase();
  const title = String(row.title || '').toLowerCase();
  if (branch.includes('computer') || branch.includes('cse') || branch.includes('it')) {
    if (title.includes('software') || title.includes('ai') || title.includes('web') || title.includes('cloud')) score += 5;
  }
  if (branch.includes('commerce') || branch.includes('finance') || branch.includes('account')) {
    if (title.includes('finance') || title.includes('commerce') || title.includes('analyst')) score += 7;
  }
  if (title.includes('data')) score += 2;
  return score;
}

async function loadRoadmapsForUser(userId) {
  const membership = await resolveMembershipState(userId);
  const profile = await getUserAcademicProfile(userId);
  const params = [];
  const clauses = ['r.deleted_at IS NULL', "r.status = 'published'", 'r.is_published = TRUE'];

  if (profile?.category_id) {
    params.push(profile.category_id);
    clauses.push(`(r.category_id IS NULL OR r.category_id = $${params.length})`);
  }
  if (profile?.branch_id) {
    params.push(profile.branch_id);
    clauses.push(`(r.branch_id IS NULL OR r.branch_id = $${params.length})`);
  }
  if (profile?.semester_id) {
    params.push(profile.semester_id);
    clauses.push(`(r.semester_id IS NULL OR r.semester_id = $${params.length})`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT
      r.id, r.slug, r.title, r.career_track, r.tagline, r.description, r.icon_name, r.accent_color,
      r.difficulty_level, r.estimated_duration, r.access_type, r.is_featured, r.sort_order,
      r.category_id, r.branch_id, r.semester_id,
      COALESCE(r.skills, '[]'::jsonb) AS skills,
      COALESCE(r.tools, '[]'::jsonb) AS tools,
      COALESCE(r.projects, '[]'::jsonb) AS projects,
      COALESCE(r.certifications, '[]'::jsonb) AS certifications,
      r.interview_prep, r.placement_readiness,
      COUNT(s.id)::int AS stage_count
     FROM career_roadmaps r
     LEFT JOIN career_roadmap_stages s ON s.roadmap_id = r.id
     ${where}
     GROUP BY r.id
     ORDER BY r.sort_order ASC, r.title ASC`,
    params
  );

  const ranked = enrichAccess(rows, membership)
    .map((row) => ({ ...row, recommendation_score: scoreRoadmap(row, profile) }))
    .sort((a, b) => b.recommendation_score - a.recommendation_score || a.sort_order - b.sort_order || a.title.localeCompare(b.title));

  return { membership, profile, roadmaps: ranked };
}

async function loadAiToolsForUser(userId) {
  const membership = await resolveMembershipState(userId);
  const profile = await getUserAcademicProfile(userId);
  const params = [];
  const clauses = ['deleted_at IS NULL', 'is_visible = TRUE', 'is_enabled = TRUE', "status = 'published'"];

  if (profile?.category_id) {
    params.push(profile.category_id);
    clauses.push(`(category_id IS NULL OR category_id = $${params.length})`);
  }
  if (profile?.branch_id) {
    params.push(profile.branch_id);
    clauses.push(`(branch_id IS NULL OR branch_id = $${params.length})`);
  }
  if (profile?.semester_id) {
    params.push(profile.semester_id);
    clauses.push(`(semester_id IS NULL OR semester_id = $${params.length})`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT id, tool_key, title, tagline, description, icon_name, accent_color,
            access_type, is_featured, sort_order, category_id, branch_id, semester_id,
            COALESCE(benefits, '[]'::jsonb) AS benefits, prompt_template
     FROM ai_tools_catalog
     ${where}
     ORDER BY is_featured DESC, sort_order ASC, title ASC`,
    params
  );

  return { membership, profile, tools: enrichAccess(rows, membership) };
}

router.use(async (_req, _res, next) => {
  try {
    await ensureCareerSchema();
    next();
  } catch (error) {
    next(error);
  }
});

router.get('/roadmaps', requireAuth, async (req, res) => {
  const data = await loadRoadmapsForUser(req.session.userId);
  res.json({ roadmaps: data.roadmaps, recommended: data.roadmaps.slice(0, 3), profile: data.profile, membership: data.membership });
});

router.get('/roadmaps/:id', requireAuth, async (req, res) => {
  const roadmapId = Number(req.params.id);
  const { membership, profile } = await loadRoadmapsForUser(req.session.userId);
  const { rows } = await pool.query(
    `SELECT
      r.id, r.slug, r.title, r.career_track, r.tagline, r.description, r.icon_name, r.accent_color,
      r.difficulty_level, r.estimated_duration, r.access_type, r.is_featured,
      COALESCE(r.skills, '[]'::jsonb) AS skills,
      COALESCE(r.tools, '[]'::jsonb) AS tools,
      COALESCE(r.projects, '[]'::jsonb) AS projects,
      COALESCE(r.certifications, '[]'::jsonb) AS certifications,
      r.interview_prep, r.placement_readiness,
      COALESCE(
        json_agg(
          json_build_object(
            'id', s.id,
            'stageTitle', s.stage_title,
            'stageSummary', s.stage_summary,
            'skills', COALESCE(s.skills, '[]'::jsonb),
            'tools', COALESCE(s.tools, '[]'::jsonb),
            'projects', COALESCE(s.projects, '[]'::jsonb),
            'certifications', COALESCE(s.certifications, '[]'::jsonb),
            'interviewPrep', s.interview_prep,
            'placementReadiness', s.placement_readiness,
            'sequenceNo', s.sequence_no
          ) ORDER BY s.sequence_no ASC
        ) FILTER (WHERE s.id IS NOT NULL),
        '[]'::json
      ) AS stages
     FROM career_roadmaps r
     LEFT JOIN career_roadmap_stages s ON s.roadmap_id = r.id
     WHERE r.id = $1 AND r.deleted_at IS NULL
     GROUP BY r.id`,
    [roadmapId]
  );

  const roadmap = rows[0];
  if (!roadmap) return res.status(404).json({ error: 'Career roadmap not found' });
  res.json({ roadmap: { ...roadmap, locked: roadmap.access_type === 'premium' && !(membership?.premiumActive || membership?.isAdmin) }, profile, membership });
});

router.get('/ai-tools', requireAuth, async (req, res) => {
  const data = await loadAiToolsForUser(req.session.userId);
  res.json({ tools: data.tools, featured: data.tools.filter((tool) => tool.is_featured), profile: data.profile, membership: data.membership });
});

router.post('/ai-tools/generate', requireAuth, async (req, res) => {
  const toolKey = String(req.body?.toolKey || '').trim();
  const inputs = req.body?.inputs && typeof req.body.inputs === 'object' ? req.body.inputs : {};

  if (!toolKey) {
    return res.status(400).json({
      error: 'toolKey is required',
      code: 'VALIDATION_ERROR'
    });
  }

  const userId = req.session.userId;
  const toolsPayload = await loadAiToolsForUser(userId);
  const tool = (toolsPayload.tools || []).find((item) => item.tool_key === toolKey);

  if (!tool) {
    return res.status(404).json({
      error: 'AI tool not available for your current academic scope.',
      code: 'TOOL_NOT_AVAILABLE'
    });
  }

  if (tool.locked) {
    return res.status(403).json({
      error: `${tool.title} is available on Premium membership.`,
      code: 'UPGRADE_REQUIRED'
    });
  }

  const roadmaps = toolKey === 'roadmap-recommender'
    ? (await loadRoadmapsForUser(userId)).roadmaps
    : [];

  const generated = generateToolOutput({
    toolKey,
    inputs,
    profile: toolsPayload.profile,
    membership: toolsPayload.membership,
    roadmaps,
    tool,
    sessionMemory: req.session.aiToolMemory || {}
  });

  if (!generated.ok) {
    return res.status(generated.status || 400).json({
      error: generated.error || 'Unable to generate tool output.',
      code: 'GENERATION_FAILED',
      details: generated.details || []
    });
  }

  req.session.aiToolMemory = generated.data.memory || req.session.aiToolMemory || {};

  return res.json(generated.data);
});

router.get('/admin/roadmaps', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT
      r.id, r.slug, r.title, r.career_track, r.tagline, r.description, r.icon_name, r.accent_color,
      r.difficulty_level, r.estimated_duration, r.access_type, r.status, r.is_published, r.is_featured,
      r.sort_order, r.category_id, r.branch_id, r.semester_id,
      ac.name AS category_name, ab.name AS branch_name, sem.label AS semester_label,
      COALESCE(r.skills, '[]'::jsonb) AS skills,
      COALESCE(r.tools, '[]'::jsonb) AS tools,
      COALESCE(r.projects, '[]'::jsonb) AS projects,
      COALESCE(r.certifications, '[]'::jsonb) AS certifications,
      r.interview_prep, r.placement_readiness,
      COUNT(s.id)::int AS stage_count
     FROM career_roadmaps r
     LEFT JOIN career_roadmap_stages s ON s.roadmap_id = r.id
     LEFT JOIN academic_categories ac ON ac.id = r.category_id
     LEFT JOIN academic_branches ab ON ab.id = r.branch_id
     LEFT JOIN academic_semesters sem ON sem.id = r.semester_id
     WHERE r.deleted_at IS NULL
     GROUP BY r.id, ac.name, ab.name, sem.label
     ORDER BY r.sort_order ASC, r.updated_at DESC`
  );
  res.json({ roadmaps: rows });
});

router.post('/admin/roadmaps', requireAdmin, async (req, res) => {
  const payload = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insert = await client.query(
      `INSERT INTO career_roadmaps (
        slug, title, career_track, tagline, description, icon_name, accent_color, difficulty_level,
        estimated_duration, access_type, status, is_published, is_featured, sort_order,
        category_id, branch_id, semester_id, skills, tools, projects, certifications,
        interview_prep, placement_readiness, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18::jsonb, $19::jsonb, $20::jsonb, $21::jsonb,
        $22, $23, $24
      ) RETURNING id`,
      [
        payload.slug,
        payload.title,
        payload.careerTrack,
        payload.tagline || null,
        payload.description || null,
        payload.iconName || 'fa-route',
        payload.accentColor || '#2563eb',
        payload.difficultyLevel || null,
        payload.estimatedDuration || null,
        payload.accessType || 'free',
        payload.status || 'published',
        payload.isPublished !== false,
        Boolean(payload.isFeatured),
        Number(payload.sortOrder || 0),
        payload.categoryId || null,
        payload.branchId || null,
        payload.semesterId || null,
        JSON.stringify(payload.skills || []),
        JSON.stringify(payload.tools || []),
        JSON.stringify(payload.projects || []),
        JSON.stringify(payload.certifications || []),
        payload.interviewPrep || null,
        payload.placementReadiness || null,
        req.session.userId
      ]
    );
    const roadmapId = insert.rows[0].id;
    for (let index = 0; index < (payload.stages || []).length; index += 1) {
      const stage = payload.stages[index];
      await client.query(
        `INSERT INTO career_roadmap_stages (
          roadmap_id, stage_title, stage_summary, skills, tools, projects, certifications,
          interview_prep, placement_readiness, sequence_no
        ) VALUES (
          $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb,
          $8, $9, $10
        )`,
        [
          roadmapId,
          stage.stageTitle,
          stage.stageSummary || null,
          JSON.stringify(stage.skills || []),
          JSON.stringify(stage.tools || []),
          JSON.stringify(stage.projects || []),
          JSON.stringify(stage.certifications || []),
          stage.interviewPrep || null,
          stage.placementReadiness || null,
          index + 1
        ]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ roadmap: { id: roadmapId } });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.put('/admin/roadmaps/:id', requireAdmin, async (req, res) => {
  const roadmapId = Number(req.params.id);
  const payload = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE career_roadmaps SET
        slug = $1,
        title = $2,
        career_track = $3,
        tagline = $4,
        description = $5,
        icon_name = $6,
        accent_color = $7,
        difficulty_level = $8,
        estimated_duration = $9,
        access_type = $10,
        status = $11,
        is_published = $12,
        is_featured = $13,
        sort_order = $14,
        category_id = $15,
        branch_id = $16,
        semester_id = $17,
        skills = $18::jsonb,
        tools = $19::jsonb,
        projects = $20::jsonb,
        certifications = $21::jsonb,
        interview_prep = $22,
        placement_readiness = $23,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $24 AND deleted_at IS NULL`,
      [
        payload.slug,
        payload.title,
        payload.careerTrack,
        payload.tagline || null,
        payload.description || null,
        payload.iconName || 'fa-route',
        payload.accentColor || '#2563eb',
        payload.difficultyLevel || null,
        payload.estimatedDuration || null,
        payload.accessType || 'free',
        payload.status || 'published',
        payload.isPublished !== false,
        Boolean(payload.isFeatured),
        Number(payload.sortOrder || 0),
        payload.categoryId || null,
        payload.branchId || null,
        payload.semesterId || null,
        JSON.stringify(payload.skills || []),
        JSON.stringify(payload.tools || []),
        JSON.stringify(payload.projects || []),
        JSON.stringify(payload.certifications || []),
        payload.interviewPrep || null,
        payload.placementReadiness || null,
        roadmapId
      ]
    );
    await client.query('DELETE FROM career_roadmap_stages WHERE roadmap_id = $1', [roadmapId]);
    for (let index = 0; index < (payload.stages || []).length; index += 1) {
      const stage = payload.stages[index];
      await client.query(
        `INSERT INTO career_roadmap_stages (
          roadmap_id, stage_title, stage_summary, skills, tools, projects, certifications,
          interview_prep, placement_readiness, sequence_no
        ) VALUES (
          $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb,
          $8, $9, $10
        )`,
        [
          roadmapId,
          stage.stageTitle,
          stage.stageSummary || null,
          JSON.stringify(stage.skills || []),
          JSON.stringify(stage.tools || []),
          JSON.stringify(stage.projects || []),
          JSON.stringify(stage.certifications || []),
          stage.interviewPrep || null,
          stage.placementReadiness || null,
          index + 1
        ]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.delete('/admin/roadmaps/:id', requireAdmin, async (req, res) => {
  const roadmapId = Number(req.params.id);
  await pool.query('UPDATE career_roadmaps SET deleted_at = CURRENT_TIMESTAMP, status = $1 WHERE id = $2', ['archived', roadmapId]);
  res.json({ success: true });
});

router.get('/admin/roadmaps/:id', requireAdmin, async (req, res) => {
  const roadmapId = Number(req.params.id);
  const { rows } = await pool.query(
    `SELECT
      r.*, COALESCE(
        json_agg(
          json_build_object(
            'id', s.id,
            'stageTitle', s.stage_title,
            'stageSummary', s.stage_summary,
            'skills', COALESCE(s.skills, '[]'::jsonb),
            'tools', COALESCE(s.tools, '[]'::jsonb),
            'projects', COALESCE(s.projects, '[]'::jsonb),
            'certifications', COALESCE(s.certifications, '[]'::jsonb),
            'interviewPrep', s.interview_prep,
            'placementReadiness', s.placement_readiness,
            'sequenceNo', s.sequence_no
          ) ORDER BY s.sequence_no ASC
        ) FILTER (WHERE s.id IS NOT NULL),
        '[]'::json
      ) AS stages
     FROM career_roadmaps r
     LEFT JOIN career_roadmap_stages s ON s.roadmap_id = r.id
     WHERE r.id = $1 AND r.deleted_at IS NULL
     GROUP BY r.id`,
    [roadmapId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Career roadmap not found' });
  res.json({ roadmap: rows[0] });
});

router.get('/admin/ai-tools', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT
      t.id, t.tool_key, t.title, t.tagline, t.description, t.icon_name, t.accent_color,
      t.access_type, t.status, t.is_enabled, t.is_visible, t.is_featured, t.sort_order,
      t.category_id, t.branch_id, t.semester_id,
      ac.name AS category_name, ab.name AS branch_name, sem.label AS semester_label,
      COALESCE(t.benefits, '[]'::jsonb) AS benefits, t.prompt_template
     FROM ai_tools_catalog t
     LEFT JOIN academic_categories ac ON ac.id = t.category_id
     LEFT JOIN academic_branches ab ON ab.id = t.branch_id
     LEFT JOIN academic_semesters sem ON sem.id = t.semester_id
     WHERE t.deleted_at IS NULL
     ORDER BY t.sort_order ASC, t.title ASC`
  );
  res.json({ tools: rows });
});

router.post('/admin/ai-tools', requireAdmin, async (req, res) => {
  const payload = req.body || {};
  const { rows } = await pool.query(
    `INSERT INTO ai_tools_catalog (
      tool_key, title, tagline, description, icon_name, accent_color,
      access_type, status, is_enabled, is_visible, is_featured, sort_order,
      category_id, branch_id, semester_id, benefits, prompt_template, created_by
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12,
      $13, $14, $15, $16::jsonb, $17, $18
    ) RETURNING id`,
    [
      payload.toolKey,
      payload.title,
      payload.tagline || null,
      payload.description || null,
      payload.iconName || 'fa-wand-magic-sparkles',
      payload.accentColor || '#2563eb',
      payload.accessType || 'free',
      payload.status || 'published',
      payload.isEnabled !== false,
      payload.isVisible !== false,
      Boolean(payload.isFeatured),
      Number(payload.sortOrder || 0),
      payload.categoryId || null,
      payload.branchId || null,
      payload.semesterId || null,
      JSON.stringify(payload.benefits || []),
      payload.promptTemplate || null,
      req.session.userId
    ]
  );
  res.status(201).json({ tool: rows[0] });
});

router.put('/admin/ai-tools/:id', requireAdmin, async (req, res) => {
  const toolId = Number(req.params.id);
  const payload = req.body || {};
  await pool.query(
    `UPDATE ai_tools_catalog SET
      tool_key = $1,
      title = $2,
      tagline = $3,
      description = $4,
      icon_name = $5,
      accent_color = $6,
      access_type = $7,
      status = $8,
      is_enabled = $9,
      is_visible = $10,
      is_featured = $11,
      sort_order = $12,
      category_id = $13,
      branch_id = $14,
      semester_id = $15,
      benefits = $16::jsonb,
      prompt_template = $17,
      updated_at = CURRENT_TIMESTAMP
     WHERE id = $18 AND deleted_at IS NULL`,
    [
      payload.toolKey,
      payload.title,
      payload.tagline || null,
      payload.description || null,
      payload.iconName || 'fa-wand-magic-sparkles',
      payload.accentColor || '#2563eb',
      payload.accessType || 'free',
      payload.status || 'published',
      payload.isEnabled !== false,
      payload.isVisible !== false,
      Boolean(payload.isFeatured),
      Number(payload.sortOrder || 0),
      payload.categoryId || null,
      payload.branchId || null,
      payload.semesterId || null,
      JSON.stringify(payload.benefits || []),
      payload.promptTemplate || null,
      toolId
    ]
  );
  res.json({ success: true });
});

router.delete('/admin/ai-tools/:id', requireAdmin, async (req, res) => {
  const toolId = Number(req.params.id);
  await pool.query('UPDATE ai_tools_catalog SET deleted_at = CURRENT_TIMESTAMP, status = $1 WHERE id = $2', ['archived', toolId]);
  res.json({ success: true });
});

module.exports = router;
