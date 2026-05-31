async function runOpenAI({ provider, prompt, toolConfig }) {
  const apiKey = provider.api_key || '';
  const endpoint = String(provider.endpoint_url || 'https://api.openai.com/v1/chat/completions').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY_MISSING');

  const payload = {
    model: provider.model_name || 'gpt-4o-mini',
    temperature: Number(toolConfig.temperature || provider.temperature || 0.3),
    max_tokens: Number(toolConfig.max_tokens || provider.max_tokens || 900),
    messages: [
      { role: 'system', content: prompt.systemPrompt },
      { role: 'user', content: prompt.userPrompt }
    ]
  };

  if (provider.request_template) {
    try {
      const parsed = JSON.parse(String(provider.request_template));
      if (parsed && typeof parsed === 'object') {
        Object.assign(payload, parsed, { messages: payload.messages });
      }
    } catch (_error) {
      // Ignore malformed admin template and use safe defaults.
    }
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(provider.headers_json && typeof provider.headers_json === 'object' ? provider.headers_json : {})
    },
    body: JSON.stringify(payload)
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json?.error?.message || `OpenAI request failed (${response.status})`);
    error.code = json?.error?.code || `OPENAI_HTTP_${response.status}`;
    throw error;
  }

  return {
    text: String(json?.choices?.[0]?.message?.content || '').trim(),
    tokens: Number(json?.usage?.total_tokens || 0)
  };
}

module.exports = { runOpenAI };
