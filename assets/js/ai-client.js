(function attachCollegeOsAiClient() {
  function toFriendlyError(error) {
    const code = String(error?.code || '').toUpperCase();
    if (code === 'UPGRADE_REQUIRED' || code === 'PLAN_TOOL_LOCKED') {
      return {
        code,
        title: 'Premium Feature',
        message: error.message || 'This AI feature is available on Premium plan.'
      };
    }
    if (code === 'CREDITS_EXHAUSTED') {
      return {
        code,
        title: 'AI Credits Exhausted',
        message: 'You are out of AI credits for now. Upgrade or wait for refresh.'
      };
    }
    if (code === 'DAILY_LIMIT_REACHED') {
      return {
        code,
        title: 'Daily Limit Reached',
        message: 'You reached today\'s usage limit for this tool. Try again tomorrow.'
      };
    }
    if (code === 'MONTHLY_LIMIT_REACHED') {
      return {
        code,
        title: 'Monthly Limit Reached',
        message: 'You reached this month\'s usage limit for this tool.'
      };
    }
    if (code === 'ABUSE_BLOCKED') {
      return {
        code,
        title: 'Access Temporarily Restricted',
        message: 'Your AI access is temporarily restricted for safety checks. Contact support if needed.'
      };
    }
    return {
      code: code || 'AI_REQUEST_FAILED',
      title: 'Unable To Generate Right Now',
      message: 'Please retry in a moment. Your input is still safe and not lost.'
    };
  }

  function normalizePayload(payload) {
    const aiMeta = payload?.aiMeta || {};
    return {
      ...payload,
      aiMeta: {
        provider: aiMeta.provider || 'fallback',
        fallbackActive: Boolean(aiMeta.fallbackActive),
        creditsCharged: Number(aiMeta.creditsCharged || 0),
        creditsLeft: Number(aiMeta.creditsLeft || 0),
        hiddenTokenMode: aiMeta.hiddenTokenMode !== false,
        visibleCreditsLeft: aiMeta.visibleCreditsLeft !== false,
        azureConfigured: Boolean(aiMeta.azureConfigured),
        globalAiEnabled: aiMeta.globalAiEnabled !== false
      }
    };
  }

  async function generateToolOutput(toolKey, inputs) {
    try {
      const payload = await window.CollegeOSApi.generateAiToolOutput(toolKey, inputs || {});
      return { ok: true, payload: normalizePayload(payload) };
    } catch (error) {
      return { ok: false, error: toFriendlyError(error), rawError: error };
    }
  }

  async function fetchRuntime() {
    try {
      const payload = await window.CollegeOSApi.getAiToolRuntime();
      return {
        ok: true,
        runtime: payload?.aiRuntime || null
      };
    } catch {
      return { ok: false, runtime: null };
    }
  }

  window.CollegeOSAiClient = {
    generateToolOutput,
    fetchRuntime,
    toFriendlyError
  };
})();
