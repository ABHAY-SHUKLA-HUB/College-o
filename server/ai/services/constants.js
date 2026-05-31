const TOOL_ROUTE_MAP = {
  summary: 'notes-summary',
  quiz: 'quiz-generator',
  flashcards: 'flashcards-generator',
  'doubt-solver': 'doubt-solver',
  resume: 'resume-builder',
  career: 'career-suggestion',
  planner: 'study-planner',
  explainer: 'concept-explainer',
  interview: 'interview-generator',
  roadmap: 'roadmap-recommender'
};

const TOOL_KEYS = Object.values(TOOL_ROUTE_MAP);

const DEFAULT_PROVIDER_KEYS = ['aws_bedrock', 'openai', 'anthropic', 'azure_openai', 'custom_rest'];

module.exports = {
  TOOL_ROUTE_MAP,
  TOOL_KEYS,
  DEFAULT_PROVIDER_KEYS
};
