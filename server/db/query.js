const { pool } = require('./pool');
const logger = require('../services/logger');

const TRANSIENT_CODES = new Set(['40001', '40P01', '57P01', '57P02', '57P03']);
const PURE_SELECT_ONE = /^\s*select\s+1\s*;?\s*$/i;

function isTransientError(error) {
  if (!error) return false;
  if (TRANSIENT_CODES.has(String(error.code || ''))) return true;
  const message = String(error.message || '').toLowerCase();
  return message.includes('etimedout') || message.includes('econnreset') || message.includes('connection terminated');
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function query(text, params = [], options = {}) {
  const start = Date.now();
  const maxRetries = Math.max(0, Number(options.maxRetries ?? 1));
  const isPureSelectOne = PURE_SELECT_ONE.test(String(text || ''));
  const slowThresholdMs = Math.max(Number(options.slowThresholdMs ?? 150), isPureSelectOne ? 1000 : 0);

  let attempt = 0;
  for (;;) {
    try {
      const result = await pool.query(text, params);
      const durationMs = Date.now() - start;
      if (durationMs >= slowThresholdMs) {
        logger.warn?.({ action: 'slow_query', durationMs, text: String(text).slice(0, 240) }) || console.warn('[DB slow query]', durationMs, String(text).slice(0, 240));
      }
      return result;
    } catch (error) {
      const durationMs = Date.now() - start;
      if (attempt < maxRetries && isTransientError(error)) {
        attempt += 1;
        await sleep(50 * attempt);
        continue;
      }
      logger.error?.({ action: 'db_query_error', durationMs, code: error.code, message: error.message, text: String(text).slice(0, 240) }) || console.error('[DB query error]', error.message);
      throw error;
    }
  }
}

async function queryOne(text, params = [], options = {}) {
  const result = await query(text, params, options);
  return result.rows[0] || null;
}

async function queryMany(text, params = [], options = {}) {
  const result = await query(text, params, options);
  return result.rows;
}

module.exports = {
  query,
  queryOne,
  queryMany,
  pool
};