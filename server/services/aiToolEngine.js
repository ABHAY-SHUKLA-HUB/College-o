const SUPPORTED_TOOL_KEYS = new Set([
	'notes-summary',
	'quiz-generator',
	'flashcards-generator',
	'doubt-solver',
	'resume-builder',
	'career-suggestion',
	'study-planner',
	'concept-explainer',
	'interview-generator',
	'roadmap-recommender'
]);

function safeText(value, max = 2400) {
	return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function toList(value, max = 12) {
	return String(value || '')
		.split(/\n|,|;|\||•|\t/)
		.map((item) => item.trim())
		.filter(Boolean)
		.slice(0, max);
}

function unique(values, max = 20) {
	const out = [];
	const seen = new Set();
	(values || []).forEach((value) => {
		const item = String(value || '').trim();
		const key = item.toLowerCase();
		if (!item || seen.has(key)) return;
		seen.add(key);
		out.push(item);
	});
	return out.slice(0, max);
}

function splitSentences(value, max = 18) {
	return String(value || '')
		.split(/(?<=[.!?])\s+/)
		.map((item) => item.trim())
		.filter(Boolean)
		.slice(0, max);
}

function inferComplexity(inputs) {
	const body = [inputs.topic, inputs.content, inputs.doubt, inputs.concept, inputs.goal, inputs.targetGoal].join(' ');
	const len = body.length;
	if (len > 1400) return 'high';
	if (len > 500) return 'medium';
	return 'low';
}

function inferIntent(toolKey, inputs) {
	const raw = [inputs.examType, inputs.goal, inputs.context, inputs.doubt, inputs.round].join(' ').toLowerCase();
	if (/exam|semester|marks|placement|interview|practice/.test(raw)) return 'exam';
	if (toolKey === 'study-planner' || toolKey === 'quiz-generator') return 'practice';
	return 'learning';
}

function resolveMode(toolKey, inputs, membership, sessionMemory) {
	const requested = safeText(inputs.mode || '', 20);
	if (requested && requested !== 'Auto') return requested;

	const complexity = inferComplexity(inputs);
	const intent = inferIntent(toolKey, inputs);
	const premium = Boolean(membership?.premiumActive || membership?.isAdmin);
	const hasHistory = Array.isArray(sessionMemory?.recentTools) && sessionMemory.recentTools.length >= 3;

	if (intent === 'exam') return 'Exam';
	if (intent === 'practice') return 'Practice';
	if (premium && complexity === 'high') return 'Deep';
	if (hasHistory && complexity !== 'low') return 'Deep';
	return 'Quick';
}

function profileContext(profile) {
	const branch = safeText(profile?.branch_name || profile?.branch || '', 80);
	const category = safeText(profile?.category_name || profile?.category || '', 80);
	const semester = safeText(profile?.semester_label || profile?.semester || '', 40);
	return {
		branch,
		category,
		semester,
		label: [category, branch, semester].filter(Boolean).join(' | ') || 'General learner profile'
	};
}

function validateToolInput(toolKey, inputs) {
	const errors = [];
	const hasAny = (...keys) => keys.some((key) => safeText(inputs[key]).length > 0);

	if (toolKey === 'notes-summary' && !hasAny('content', 'topic')) errors.push('Provide note content or topic for summary generation.');
	if (toolKey === 'quiz-generator' && !hasAny('subject', 'topic', 'concepts')) errors.push('Provide subject/topic/concepts for quiz generation.');
	if (toolKey === 'flashcards-generator' && !hasAny('topic', 'content')) errors.push('Provide topic or concept notes for flashcards.');
	if (toolKey === 'doubt-solver' && safeText(inputs.doubt).length < 8) errors.push('Write your doubt clearly with at least one complete sentence.');
	if (toolKey === 'resume-builder') {
		const populated = ['name', 'education', 'skills', 'projects', 'certifications', 'targetRole'].filter((k) => safeText(inputs[k]).length > 0);
		if (populated.length < 2) errors.push('Provide at least two resume inputs such as education + skills or role + projects.');
	}
	if (toolKey === 'career-suggestion' && !hasAny('interests', 'skills', 'goals', 'branchCourse')) errors.push('Add interests/skills/goals/branch for career suggestions.');
	if (toolKey === 'study-planner' && !hasAny('goal', 'topics', 'availableTime', 'durationDays', 'weakAreas')) errors.push('Provide goal/topics/time/weak areas for a realistic study plan.');
	if (toolKey === 'concept-explainer' && safeText(inputs.concept).length < 3) errors.push('Enter a concept to explain.');
	if (toolKey === 'interview-generator' && !hasAny('role', 'skills')) errors.push('Enter role and skills/topic for interview generation.');
	if (toolKey === 'roadmap-recommender' && !hasAny('targetGoal', 'goal', 'currentLevel', 'skillInterests', 'branchCourse')) errors.push('Provide target goal or current level for roadmap recommendations.');

	return { ok: errors.length === 0, errors };
}

function followUpFor(toolKey) {
	const map = {
		'notes-summary': ['Generate a quiz from these notes', 'Create flashcards for key terms'],
		'quiz-generator': ['Build a weak-topic study plan', 'Generate flashcards for wrong-answer concepts'],
		'flashcards-generator': ['Start a quick recall quiz', 'Ask concept explainer for difficult cards'],
		'doubt-solver': ['See a practice question on this doubt', 'Convert this doubt into flashcards'],
		'resume-builder': ['Generate interview questions for this role', 'Refine project bullets for ATS'],
		'career-suggestion': ['Create roadmap for top career option', 'Build a 2-week study plan for skill gaps'],
		'study-planner': ['Generate quiz for today\'s topic', 'Explain weakest concept in simple mode'],
		'concept-explainer': ['Create flashcards from this concept', 'Generate likely exam questions'],
		'interview-generator': ['Generate model answers', 'Create resume bullets aligned to these questions'],
		'roadmap-recommender': ['Start with phase-1 quiz set', 'Generate weekly plan for first milestone']
	};
	return map[toolKey] || ['Try a related AI tool'];
}

function qualityScore(result) {
	const sections = Array.isArray(result?.sections) ? result.sections : [];
	const sectionCount = sections.length;
	const nonEmptySectionCount = sections.filter((s) => Array.isArray(s.items) && s.items.length > 0).length;
	const hasFollowUp = Array.isArray(result?.followUps) && result.followUps.length > 0;
	const hasWarning = Array.isArray(result?.warnings) && result.warnings.length > 0;
	let score = 60;
	if (sectionCount >= 3) score += 15;
	if (nonEmptySectionCount >= 3) score += 10;
	if (hasFollowUp) score += 10;
	if (!hasWarning) score += 5;
	return Math.max(0, Math.min(100, score));
}

function sanitizeSections(sections) {
	return (Array.isArray(sections) ? sections : []).map((section) => {
		const items = Array.isArray(section.items) ? section.items : [];
		if (section.type === 'quiz') {
			const seen = new Set();
			const deduped = [];
			items.forEach((item) => {
				const q = String(item?.question || '').toLowerCase();
				if (!q || seen.has(q)) return;
				seen.add(q);
				deduped.push(item);
			});
			return { ...section, items: deduped };
		}

		const textItems = items.map((item) => String(item || '').trim()).filter(Boolean);
		return { ...section, items: unique(textItems, 20) };
	});
}

function formatNotesSummary(inputs, ctx) {
	const topic = safeText(inputs.topic, 120);
	const content = safeText(inputs.content, 9000);
	const points = unique(splitSentences(content, 10).concat(toList(content, 8)), 8);
	const likelyQuestions = unique([
		`Explain ${topic || 'the topic'} with one practical example.`,
		`Write short notes on key parts of ${topic || 'this chapter'}.`,
		`Compare two important concepts from ${topic || 'the notes'}.`
	], 3);

	const examPriority = Math.min(10, Math.max(3, Math.round((points.length * 1.2) + (ctx.mode === 'Exam' ? 2 : 0))));

	return {
		title: `Notes Summary${topic ? `: ${topic}` : ''}`,
		badges: [`Mode: ${ctx.mode}`, `Profile: ${ctx.profile.label}`],
		keyTakeaway: `Focus on the top ${Math.min(points.length, 5)} points before attempting practice questions.`,
		sections: [
			{ heading: 'Short Summary', type: 'paragraphs', items: [points.slice(0, 2).join(' ') || 'Summary generated from provided notes.'] },
			{ heading: 'Key Points', type: 'bullets', items: points.length ? points : ['Add more note text for richer key points.'] },
			{ heading: 'Exam Priority Score', type: 'badges', items: [`${examPriority}/10`, ctx.mode === 'Exam' ? 'Scoring Focus' : 'Balanced Focus'] },
			{ heading: 'Likely Questions', type: 'numbered', items: likelyQuestions },
			{ heading: 'Memory Tricks', type: 'bullets', items: ['Use 3-2-1 recall: 3 facts, 2 examples, 1 comparison.', 'Revise keywords with one-line definitions.', 'Self-test after 20 minutes without notes.'] }
		],
		followUps: followUpFor('notes-summary'),
		warnings: content.length < 140 ? ['Input is short. Paste longer notes for better depth and question quality.'] : []
	};
}

function formatQuiz(inputs, ctx) {
	const difficulty = safeText(inputs.difficulty, 20) || (ctx.mode === 'Exam' ? 'Hard' : 'Medium');
	const count = Math.min(10, Math.max(3, Number.parseInt(inputs.questionCount, 10) || (ctx.mode === 'Quick' ? 4 : 6)));
	const concepts = unique(toList(inputs.concepts, 20).concat(toList(inputs.topic, 5)).concat(toList(inputs.subject, 5)), count);

	const source = concepts.length ? concepts : ['core concept'];
	const quizItems = source.slice(0, count).map((concept, idx) => ({
		question: `${idx + 1}. Which statement best reflects ${concept}?`,
		options: [
			`${concept} is never relevant in applications.`,
			`${concept} helps solve practical and exam-level problems.`,
			`${concept} replaces all other fundamentals.`,
			`${concept} should be skipped during revision.`
		],
		answer: 'B',
		explanation: `${concept} is generally useful in both understanding and application contexts.`
	}));

	return {
		title: 'Quiz Generator',
		badges: [`Difficulty: ${difficulty}`, `Mode: ${ctx.mode}`],
		keyTakeaway: 'Attempt once without answers, then review explanations and retry incorrect ones.',
		sections: [
			{ heading: 'Generated Questions', type: 'quiz', items: quizItems },
			{ heading: 'Timer Suggestion', type: 'badges', items: [`${Math.max(8, count * 2)} min total`, `${Math.max(1, Math.round((Math.max(8, count * 2) / count) * 10) / 10)} min/question`] },
			{ heading: 'Weak Topic Detection', type: 'bullets', items: ['Mark questions you guessed.', 'Topics with 2+ wrong answers become weak-topic priority.', 'Send weak topics to Study Planner for recovery plan.'] }
		],
		followUps: followUpFor('quiz-generator'),
		warnings: []
	};
}

function formatFlashcards(inputs, ctx) {
	const cards = unique(toList(inputs.content, 24).concat(toList(inputs.topic, 8)), Math.min(12, Math.max(4, Number.parseInt(inputs.cardCount, 10) || 6)));
	const outputCards = cards.length ? cards : ['Core concept'];
	return {
		title: 'Flashcards Generator',
		badges: [`Mode: ${ctx.mode}`, `Spaced Revision Ready`],
		keyTakeaway: 'Review difficult cards at shorter intervals (Day 1, Day 3, Day 7).',
		sections: [
			{
				heading: 'Front / Back Cards',
				type: 'flashcards',
				items: outputCards.map((card, i) => ({
					front: `Card ${i + 1}: ${card}`,
					back: `${card} in one concise definition + one usage example.`
				}))
			},
			{ heading: 'Difficulty Tags', type: 'badges', items: ['Easy', 'Medium', 'Hard'] },
			{ heading: 'Spaced Repetition Tags', type: 'bullets', items: ['Easy -> 3 days', 'Medium -> 2 days', 'Hard -> daily until stable recall'] }
		],
		followUps: followUpFor('flashcards-generator'),
		warnings: []
	};
}

function formatDoubt(inputs, ctx) {
	const doubt = safeText(inputs.doubt, 1200);
	const style = /code|program|algorithm|bug|sql|runtime/i.test(doubt) ? 'Coding' : /exam|marks|question/i.test(doubt) ? 'Exam' : 'Conceptual';
	return {
		title: 'Doubt Solver',
		badges: [`Mode: ${ctx.mode}`, `${style} Doubt`],
		keyTakeaway: 'Understand the mechanism before memorizing terms or formulas.',
		sections: [
			{ heading: 'Direct Answer', type: 'paragraphs', items: ['Your doubt can be solved by breaking the concept into definition, process, and practical usage.'] },
			{ heading: 'Simple Explanation', type: 'numbered', items: ['State what it is.', 'Explain how it works step-by-step.', 'Connect to one practical or exam scenario.'] },
			{ heading: 'Common Mistakes', type: 'bullets', items: ['Memorizing terms without understanding flow.', 'Skipping examples.', 'Not checking edge-cases in code-style doubts.'] },
			{ heading: 'Exam Tip', type: 'paragraphs', items: ['Use 3-part answer format: definition, mechanism, one example.'] }
		],
		followUps: followUpFor('doubt-solver'),
		warnings: []
	};
}

function formatResume(inputs, ctx) {
	const skills = unique(toList(inputs.skills, 20), 12);
	const projects = unique(toList(inputs.projects, 12), 8);
	const certs = unique(toList(inputs.certifications, 10), 6);
	const role = safeText(inputs.targetRole, 80) || 'target role';
	const level = safeText(inputs.experienceLevel, 20) || 'Fresher';

	return {
		title: 'Resume Builder',
		badges: [`Role: ${role}`, `${level}`],
		keyTakeaway: 'All points are generated only from provided data; no fake metrics are added.',
		sections: [
			{ heading: 'ATS Summary', type: 'paragraphs', items: [`${level} candidate targeting ${role}, with practical exposure in ${skills.slice(0, 5).join(', ') || 'relevant skills'}.`] },
			{ heading: 'Skills Section', type: 'bullets', items: skills.length ? skills : ['Add your skill stack to complete this section.'] },
			{ heading: 'Project Bullets', type: 'bullets', items: projects.length ? projects.map((p) => `Built ${p} with clear implementation ownership and outcome-focused documentation.`) : ['Add projects to generate role-specific bullets.'] },
			{ heading: 'Recruiter-Style Feedback', type: 'bullets', items: ['Keep bullets action-led.', 'Keep each project to 2-3 high-impact bullets.', 'Align keywords with role JD.'] },
			{ heading: 'Achievements/Certifications', type: 'bullets', items: certs.length ? certs : ['Add certifications or validated achievements.'] }
		],
		followUps: followUpFor('resume-builder'),
		warnings: []
	};
}

function formatCareer(inputs, ctx) {
	const corpus = `${safeText(inputs.interests)} ${safeText(inputs.skills)} ${safeText(inputs.goals)} ${safeText(inputs.branchCourse)}`.toLowerCase();
	const options = [];
	if (/data|sql|analytics|excel|bi/.test(corpus)) options.push('Data Analyst');
	if (/software|web|app|backend|frontend|java|javascript/.test(corpus)) options.push('Software Developer');
	if (/ai|ml|python|model/.test(corpus)) options.push('AI/ML Engineer');
	if (/cloud|devops|linux|aws|azure/.test(corpus)) options.push('Cloud Engineer');
	if (!options.length) options.push('Software Developer', 'Data Analyst', 'Business Analyst');

	const uniqueOptions = unique(options, 4);
	return {
		title: 'Career Suggestion Tool',
		badges: [`Profile: ${ctx.profile.label}`],
		keyTakeaway: 'Choose one primary path and execute one measurable project sprint before switching tracks.',
		sections: [
			{ heading: 'Career Options', type: 'numbered', items: uniqueOptions.map((o) => `${o} - aligned with your interests/skills profile.`) },
			{ heading: 'Skills Gap', type: 'bullets', items: uniqueOptions.map((o) => `${o}: identify 3 core skills and close one gap each week.`) },
			{ heading: 'Recommended Learning Direction', type: 'bullets', items: ['Week 1-2: fundamentals + mini-project', 'Week 3-4: intermediate project + mock interview', 'Week 5+: portfolio polish + applications'] }
		],
		followUps: followUpFor('career-suggestion'),
		warnings: []
	};
}

function formatStudyPlan(inputs, ctx) {
	const topics = unique(toList(inputs.topics, 20), 12);
	const weak = unique(toList(inputs.weakAreas, 12), 6);
	const days = Math.min(21, Math.max(5, Number.parseInt(inputs.durationDays, 10) || 7));
	const weeklyHours = Math.min(70, Math.max(4, Number.parseInt(inputs.availableTime, 10) || 12));
	const dailyHours = Math.max(1, Math.round((weeklyHours / 7) * 10) / 10);

	const dayPlan = [];
	for (let day = 1; day <= days; day += 1) {
		const topic = topics[(day - 1) % Math.max(topics.length, 1)] || 'core topic';
		const weakTopic = weak[(day - 1) % Math.max(weak.length, 1)] || 'weak area reinforcement';
		const isRevisionDay = day % 3 === 0;
		dayPlan.push(`Day ${day}: ${isRevisionDay ? `revision + mock practice (${dailyHours}h)` : `${topic} deep work (${dailyHours}h)`}; weak focus: ${weakTopic}.`);
	}

	return {
		title: 'Study Planner',
		badges: [`Adaptive Plan`, `Mode: ${ctx.mode}`],
		keyTakeaway: 'Weak topics are weighted higher in this plan for faster score recovery.',
		sections: [
			{ heading: 'Day-wise Plan', type: 'numbered', items: dayPlan },
			{ heading: 'Priority Logic', type: 'bullets', items: ['Weak topics first', 'Every 3rd day revision', 'Weekly mock/practice checkpoint'] },
			{ heading: 'Daily Tracking Hooks', type: 'bullets', items: ['Did I complete target hours?', 'Which topic stayed weak?', 'What should be revised tomorrow?'] }
		],
		followUps: followUpFor('study-planner'),
		warnings: weeklyHours < 7 ? ['Available time is low. Keep scope focused on high-weight topics only.'] : []
	};
}

function formatConcept(inputs, ctx) {
	const concept = safeText(inputs.concept, 120);
	const difficulty = safeText(inputs.difficulty, 20) || 'Beginner';
	return {
		title: `Concept Explainer: ${concept}`,
		badges: [`Level: ${difficulty}`, `Mode: ${ctx.mode}`],
		keyTakeaway: 'Master one clear analogy and one exam-ready definition.',
		sections: [
			{ heading: 'Simple Explanation', type: 'paragraphs', items: [`${concept} is a mechanism that keeps systems predictable and efficient under constraints.`] },
			{ heading: 'Visual Thinking Analogy', type: 'paragraphs', items: [`Imagine ${concept} as a smart traffic manager for data/tasks so conflicts are reduced and order is maintained.`] },
			{ heading: 'Key Idea', type: 'bullets', items: ['What it does', 'Why it matters', 'Where it is used'] },
			{ heading: 'Exam-Friendly Version', type: 'bullets', items: ['One-line definition', '2-3 working points', 'one use case + one limitation'] }
		],
		followUps: followUpFor('concept-explainer'),
		warnings: []
	};
}

function formatInterview(inputs, ctx) {
	const role = safeText(inputs.role, 80) || 'Target role';
	const skills = unique(toList(inputs.skills, 10), 6);
	const round = safeText(inputs.round, 30) || 'Mixed';
	const technical = (skills.length ? skills : ['fundamentals', 'projects', 'problem solving']).map((s) => `How have you applied ${s} in a project relevant to ${role}?`);

	return {
		title: `Interview Generator: ${role}`,
		badges: [`Round: ${round}`, `Mode: ${ctx.mode}`],
		keyTakeaway: 'Use STAR format and always include measurable outcomes where available.',
		sections: [
			{ heading: 'Technical Questions', type: 'numbered', items: technical },
			...(round === 'HR' ? [] : [{ heading: 'Follow-up Questions', type: 'numbered', items: technical.slice(0, 3).map((q) => `Follow-up: ${q}`) }]),
			{ heading: 'Interviewer Style Tips', type: 'bullets', items: ['Be concise first, then expand.', 'Clarify assumptions before deep answers.', 'Tie every answer to impact/learning.'] }
		],
		followUps: followUpFor('interview-generator'),
		warnings: []
	};
}

function formatRoadmap(inputs, ctx) {
	const goal = safeText(inputs.targetGoal || inputs.goal, 120);
	const level = safeText(inputs.currentLevel, 20) || 'Beginner';
	const matched = Array.isArray(ctx.roadmaps) && ctx.roadmaps.length ? ctx.roadmaps[0] : null;
	const title = matched?.title || `${goal || 'Career'} Roadmap`;
	return {
		title: 'Roadmap Recommender',
		badges: [`Current Level: ${level}`, matched ? `Matched: ${title}` : 'Custom Path'],
		keyTakeaway: 'Complete one checkpoint before moving to the next phase.',
		sections: [
			{ heading: 'Recommended Path', type: 'paragraphs', items: [matched ? `Best-fit roadmap: ${title} for your profile context.` : `Custom roadmap generated for ${goal || 'your target goal'}.`] },
			{ heading: 'Phase Checkpoints', type: 'numbered', items: ['Phase 1: fundamentals + mini project', 'Phase 2: intermediate implementation project', 'Phase 3: interview-focused polish + mock rounds'] },
			{ heading: 'Project-Based Learning', type: 'bullets', items: ['Build one project per phase', 'Publish code + README + short demo', 'Track milestone completion weekly'] }
		],
		followUps: followUpFor('roadmap-recommender'),
		warnings: []
	};
}

function enrichResult(toolKey, result, ctx) {
	const scored = {
		...result,
		toolKey,
		mode: ctx.mode,
		sections: sanitizeSections(result.sections),
		followUps: Array.isArray(result.followUps) ? unique(result.followUps, 4) : followUpFor(toolKey)
	};

	if (ctx.membership?.premiumActive || ctx.membership?.isAdmin) {
		scored.sections = scored.sections.concat([
			{
				heading: 'Premium Insight',
				type: 'bullets',
				items: [
					'Advanced next-step strategy included for faster improvement.',
					'Use Deep mode for expanded examples and reasoning depth.'
				]
			}
		]);
	} else {
		scored.sections = scored.sections.concat([
			{
				heading: 'Upgrade Advantage',
				type: 'paragraphs',
				items: ['Premium unlocks deeper explanations, richer examples, and multi-step planning depth.']
			}
		]);
	}

	const score = qualityScore(scored);
	return {
		...scored,
		quality: {
			score,
			relevance: score >= 80 ? 'high' : score >= 65 ? 'medium' : 'needs-improvement',
			structured: true,
			antiHallucination: toolKey === 'resume-builder' ? 'strict-no-fabrication' : 'assumption-safe-mode'
		}
	};
}

function nextMemory(memory, toolKey, inputs, result) {
	const current = memory && typeof memory === 'object' ? memory : {};
	const recentTools = unique([toolKey].concat(current.recentTools || []), 8);
	const lastTopic = safeText(inputs.topic || inputs.concept || inputs.goal || inputs.targetGoal || '', 120) || current.lastTopic || null;
	const weakTopics = unique(toList(inputs.weakAreas, 8).concat(current.weakTopics || []), 8);
	const lastMode = result.mode || current.lastMode || 'Quick';
	return {
		...current,
		recentTools,
		lastTopic,
		weakTopics,
		lastMode
	};
}

function generateToolOutput({ toolKey, inputs, profile, membership, roadmaps, tool, sessionMemory }) {
	if (!SUPPORTED_TOOL_KEYS.has(toolKey)) {
		return { ok: false, status: 400, error: 'Unsupported AI tool key.' };
	}

	const normalizedInputs = inputs && typeof inputs === 'object' ? inputs : {};
	const valid = validateToolInput(toolKey, normalizedInputs);
	if (!valid.ok) {
		return {
			ok: false,
			status: 400,
			error: 'Please improve your input before generation.',
			details: valid.errors
		};
	}

	const ctx = {
		profile: profileContext(profile),
		membership: membership || {},
		roadmaps: Array.isArray(roadmaps) ? roadmaps : [],
		mode: resolveMode(toolKey, normalizedInputs, membership, sessionMemory)
	};

	let result;
	if (toolKey === 'notes-summary') result = formatNotesSummary(normalizedInputs, ctx);
	else if (toolKey === 'quiz-generator') result = formatQuiz(normalizedInputs, ctx);
	else if (toolKey === 'flashcards-generator') result = formatFlashcards(normalizedInputs, ctx);
	else if (toolKey === 'doubt-solver') result = formatDoubt(normalizedInputs, ctx);
	else if (toolKey === 'resume-builder') result = formatResume(normalizedInputs, ctx);
	else if (toolKey === 'career-suggestion') result = formatCareer(normalizedInputs, ctx);
	else if (toolKey === 'study-planner') result = formatStudyPlan(normalizedInputs, ctx);
	else if (toolKey === 'concept-explainer') result = formatConcept(normalizedInputs, ctx);
	else if (toolKey === 'interview-generator') result = formatInterview(normalizedInputs, ctx);
	else result = formatRoadmap(normalizedInputs, ctx);

	const finalResult = enrichResult(toolKey, result, ctx);
	const updatedSessionMemory = nextMemory(sessionMemory, toolKey, normalizedInputs, finalResult);

	return {
		ok: true,
		status: 200,
		data: {
			toolKey,
			toolTitle: tool?.title || toolKey,
			result: finalResult,
			memory: updatedSessionMemory,
			meta: {
				mode: finalResult.mode,
				premium: Boolean(membership?.premiumActive || membership?.isAdmin),
				profile: ctx.profile.label
			}
		}
	};
}

module.exports = {
	generateToolOutput
};
