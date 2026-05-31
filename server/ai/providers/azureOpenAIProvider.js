async function runAzureOpenAI({ provider, prompt, toolConfig }) {
  const endpointRoot = String(provider.endpoint_url || '').trim().replace(/\/$/, '');
  const deployment = String(provider.deployment_name || provider.model_name || '').trim();
  const apiKey = provider.api_key || '';
  const apiVersion = String(provider.api_version || process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview').trim();

  if (!endpointRoot || !deployment || !apiKey) {
    throw new Error('AZURE_OPENAI_CONFIG_MISSING');
  }

  const endpoint = `${endpointRoot}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
      ...(provider.headers_json && typeof provider.headers_json === 'object' ? provider.headers_json : {})
    },
    body: JSON.stringify({
      temperature: Number(toolConfig.temperature || provider.temperature || 0.3),
      max_tokens: Number(toolConfig.max_tokens || provider.max_tokens || 900),
      messages: [
        { role: 'system', content: prompt.systemPrompt },
        { role: 'user', content: prompt.userPrompt }
      ]
    })
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json?.error?.message || `Azure OpenAI request failed (${response.status})`);
    error.code = json?.error?.code || `AZURE_HTTP_${response.status}`;
    throw error;
  }

  return {
    text: String(json?.choices?.[0]?.message?.content || '').trim(),
    tokens: Number(json?.usage?.total_tokens || 0)
  };
}

module.exports = { runAzureOpenAI };
