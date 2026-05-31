async function runAnthropic({ provider, prompt, toolConfig }) {
  const apiKey = provider.api_key || '';
  const endpoint = String(provider.endpoint_url || 'https://api.anthropic.com/v1/messages').trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY_MISSING');

  const payload = {
    model: provider.model_name || 'claude-3-5-sonnet-latest',
    max_tokens: Number(toolConfig.max_tokens || provider.max_tokens || 900),
    temperature: Number(toolConfig.temperature || provider.temperature || 0.3),
    system: prompt.systemPrompt,
    messages: [{ role: 'user', content: prompt.userPrompt }]
  };

  if (provider.request_template) {
    try {
      const parsed = JSON.parse(String(provider.request_template));
      if (parsed && typeof parsed === 'object') {
        Object.assign(payload, parsed, { messages: payload.messages, system: payload.system });
      }
    } catch (_error) {
      // Ignore malformed admin template and use safe defaults.
    }
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      ...(provider.headers_json && typeof provider.headers_json === 'object' ? provider.headers_json : {})
    },
    body: JSON.stringify(payload)
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json?.error?.message || `Anthropic request failed (${response.status})`);
    error.code = json?.error?.type || `ANTHROPIC_HTTP_${response.status}`;
    throw error;
  }

  const text = Array.isArray(json?.content)
    ? json.content.map((item) => item?.text || '').join('\n').trim()
    : '';

  return {
    text,
    tokens: Number(json?.usage?.input_tokens || 0) + Number(json?.usage?.output_tokens || 0)
  };
}

module.exports = { runAnthropic };
