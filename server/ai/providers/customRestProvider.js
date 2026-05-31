async function runCustomRest({ provider, prompt, toolConfig, context }) {
  const endpoint = String(provider.endpoint_url || '').trim();
  const apiKey = provider.api_key || '';
  if (!endpoint) throw new Error('CUSTOM_ENDPOINT_MISSING');

  const headers = {
    'Content-Type': 'application/json',
    ...(provider.headers_json && typeof provider.headers_json === 'object' ? provider.headers_json : {})
  };

  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const payload = {
    toolKey: context.toolKey,
    model: provider.model_name || null,
    temperature: Number(toolConfig.temperature || provider.temperature || 0.3),
    maxTokens: Number(toolConfig.max_tokens || provider.max_tokens || 900),
    prompt
  };

  if (provider.request_template) {
    try {
      const parsed = JSON.parse(String(provider.request_template));
      if (parsed && typeof parsed === 'object') {
        Object.assign(payload, parsed, { prompt, toolKey: context.toolKey });
      }
    } catch (_error) {
      // Ignore malformed admin template and use safe defaults.
    }
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json?.error || `Custom AI endpoint failed (${response.status})`);
    error.code = json?.code || `CUSTOM_HTTP_${response.status}`;
    throw error;
  }

  return {
    text: String(json?.text || json?.output || '').trim(),
    tokens: Number(json?.tokens || 0)
  };
}

module.exports = { runCustomRest };
