let BedrockRuntimeClient;
let InvokeModelCommand;

function ensureBedrockSdk() {
  if (BedrockRuntimeClient && InvokeModelCommand) return;
  try {
    ({ BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime'));
  } catch (_error) {
    const sdkError = new Error('AWS_BEDROCK_SDK_NOT_INSTALLED');
    sdkError.code = 'AWS_BEDROCK_SDK_NOT_INSTALLED';
    throw sdkError;
  }
}

function parseBedrockResponse(model, parsed) {
  if (String(model).startsWith('amazon.titan')) {
    return String(parsed?.results?.[0]?.outputText || '').trim();
  }
  if (Array.isArray(parsed?.content)) {
    return String(parsed.content[0]?.text || '').trim();
  }
  if (typeof parsed?.outputText === 'string') return parsed.outputText.trim();
  return '';
}

function buildBedrockBody(model, prompt, toolConfig, provider) {
  const maxTokens = Number(toolConfig.max_tokens || provider.max_tokens || 900);
  const temperature = Number(toolConfig.temperature || provider.temperature || 0.3);

  if (String(model).startsWith('amazon.titan')) {
    return {
      inputText: `${prompt.systemPrompt}\n\n${prompt.userPrompt}`,
      textGenerationConfig: {
        temperature,
        maxTokenCount: maxTokens
      }
    };
  }

  return {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    temperature,
    system: prompt.systemPrompt,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: prompt.userPrompt }]
      }
    ]
  };
}

async function runBedrock({ provider, prompt, toolConfig }) {
  ensureBedrockSdk();

  const modelId = String(provider.model_name || 'anthropic.claude-3-haiku-20240307-v1:0').trim();
  const region = String(provider.region || process.env.AWS_REGION || 'us-east-1').trim();

  const accessKeyId = String(provider.access_key || process.env.AWS_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(provider.secret_key || process.env.AWS_SECRET_ACCESS_KEY || '').trim();
  const sessionToken = String(provider.session_token || process.env.AWS_SESSION_TOKEN || '').trim();

  const clientConfig = {
    region,
    ...(provider.endpoint_url ? { endpoint: provider.endpoint_url } : {})
  };
  if (accessKeyId && secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {})
    };
  }

  const client = new BedrockRuntimeClient(clientConfig);
  const body = buildBedrockBody(modelId, prompt, toolConfig, provider);

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body)
  });

  const response = await client.send(command);
  const text = new TextDecoder().decode(response.body);
  const parsed = JSON.parse(text || '{}');

  return {
    text: parseBedrockResponse(modelId, parsed),
    tokens: 0
  };
}

module.exports = { runBedrock };
