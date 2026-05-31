const { pool } = require('../../db/pool');
const { ensureAiGatewaySchema } = require('../services/configRepository');

function toInt(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : fallback;
}

async function getAiGatewayAnalytics(days = 30) {
  await ensureAiGatewaySchema();
  const safeDays = Math.max(1, Math.min(180, Number(days) || 30));
  const intervalExpr = `${safeDays} days`;

  const [totals, byTool, byProvider, trend, cost] = await Promise.all([
    pool.query(
      `SELECT
        COUNT(*)::int AS requests,
        COUNT(*) FILTER (WHERE success = TRUE)::int AS success_count,
        COUNT(*) FILTER (WHERE success = FALSE)::int AS failure_count,
        COALESCE(AVG(latency_ms), 0)::numeric(10,2) AS avg_latency_ms,
        COALESCE(SUM(total_tokens), 0)::int AS total_tokens
       FROM ai_usage_logs
       WHERE created_at >= CURRENT_TIMESTAMP - ($1::text)::interval`,
      [intervalExpr]
    ),
    pool.query(
      `SELECT tool_key, COUNT(*)::int AS uses, COALESCE(SUM(total_tokens), 0)::int AS tokens
       FROM ai_usage_logs
       WHERE created_at >= CURRENT_TIMESTAMP - ($1::text)::interval
       GROUP BY tool_key
       ORDER BY uses DESC`,
      [intervalExpr]
    ),
    pool.query(
      `SELECT provider_key, COUNT(*)::int AS uses,
              COUNT(*) FILTER (WHERE success = FALSE)::int AS failures,
              COALESCE(AVG(latency_ms), 0)::numeric(10,2) AS avg_latency_ms
       FROM ai_usage_logs
       WHERE created_at >= CURRENT_TIMESTAMP - ($1::text)::interval
       GROUP BY provider_key
       ORDER BY uses DESC`,
      [intervalExpr]
    ),
    pool.query(
      `SELECT DATE(created_at) AS day,
              COUNT(*)::int AS requests,
              COALESCE(SUM(total_tokens), 0)::int AS tokens
       FROM ai_usage_logs
       WHERE created_at >= CURRENT_TIMESTAMP - ($1::text)::interval
       GROUP BY DATE(created_at)
       ORDER BY day ASC`,
      [intervalExpr]
    ),
    pool.query(
      `SELECT tool_key, provider_key,
              COALESCE(SUM(cost_usd), 0)::numeric(12,6) AS cost_usd,
              COALESCE(SUM(tokens), 0)::int AS tokens
       FROM ai_cost_tracking
       WHERE day_bucket >= CURRENT_DATE - ($1::text)::interval
       GROUP BY tool_key, provider_key
       ORDER BY cost_usd DESC`,
      [intervalExpr]
    )
  ]);

  return {
    generatedAt: new Date().toISOString(),
    days: safeDays,
    totals: {
      requests: toInt(totals.rows[0]?.requests, 0),
      successCount: toInt(totals.rows[0]?.success_count, 0),
      failureCount: toInt(totals.rows[0]?.failure_count, 0),
      avgLatencyMs: Number(totals.rows[0]?.avg_latency_ms || 0),
      totalTokens: toInt(totals.rows[0]?.total_tokens, 0)
    },
    byTool: byTool.rows,
    byProvider: byProvider.rows,
    trend: trend.rows,
    costBreakdown: cost.rows
  };
}

module.exports = {
  getAiGatewayAnalytics
};
