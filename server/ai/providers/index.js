const { runBedrock } = require('./bedrockProvider');
const { runOpenAI } = require('./openaiProvider');
const { runAnthropic } = require('./anthropicProvider');
const { runAzureOpenAI } = require('./azureOpenAIProvider');
const { runCustomRest } = require('./customRestProvider');

async function runProvider(provider, params) {
  const key = String(provider?.provider_key || '').trim();

  if (key === 'aws_bedrock') return runBedrock({ provider, ...params });
  if (key === 'openai') return runOpenAI({ provider, ...params });
  if (key === 'anthropic') return runAnthropic({ provider, ...params });
  if (key === 'azure_openai') return runAzureOpenAI({ provider, ...params });
  if (key === 'custom_rest') return runCustomRest({ provider, ...params });

  const error = new Error(`Unsupported provider: ${key || 'unknown'}`);
  error.code = 'PROVIDER_NOT_SUPPORTED';
  throw error;
}

module.exports = { runProvider };
