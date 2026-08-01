const express = require('express');
const { pool } = require('../db/pool');
const { ensureUniversityCatalogSchema } = require('../utils/universities');

const router = express.Router();

const COLLEGE_CACHE_TTL_MS = 5 * 60 * 1000;
const UNIVERSITY_CACHE_TTL_MS = 60 * 1000;
const collegesCache = { payload: null, loadedAt: 0 };
const universitiesCache = new Map();

function setPublicCacheHeaders(res, maxAgeSeconds = 300) {
  res.setHeader('Cache-Control', `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${Math.max(maxAgeSeconds * 3, 60)}`);
}

function getCachedRows(cache, ttlMs) {
  if (!cache.payload || Date.now() - cache.loadedAt >= ttlMs) return null;
  return cache.payload;
}

function setCachedRows(cache, rows) {
  cache.payload = rows;
  cache.loadedAt = Date.now();
}

function getUniversityCacheKey(query, limit) {
  return `${String(query || '').trim().toLowerCase()}|${Number(limit || 0)}`;
}

function invalidateUniversityCatalogCache() {
  universitiesCache.clear();
}

router.get('/colleges', async (_req, res) => {
  setPublicCacheHeaders(res, 300);
  const cached = getCachedRows(collegesCache, COLLEGE_CACHE_TTL_MS);
  if (cached) {
    return res.json({ colleges: cached });
  }

  const { rows } = await pool.query('SELECT id, name, city, state FROM colleges ORDER BY name');
  setCachedRows(collegesCache, rows);
  return res.json({ colleges: rows });
});

router.get('/universities', async (req, res) => {
  await ensureUniversityCatalogSchema(pool);

  const query = String(req.query.q || '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit || 30), 5), 100);
  const cacheKey = getUniversityCacheKey(query, limit);
  const cached = universitiesCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < UNIVERSITY_CACHE_TTL_MS) {
    setPublicCacheHeaders(res, 60);
    return res.json({ universities: cached.rows, query });
  }

  const params = [];
  let where = 'WHERE is_enabled = TRUE';
  if (query) {
    params.push(`%${query}%`);
    where += ` AND (name ILIKE $${params.length} OR COALESCE(campus, '') ILIKE $${params.length})`;
  }
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT id, name, country_code, state, city, campus, is_featured, is_enabled, priority_rank
     FROM universities
     ${where}
     ORDER BY is_featured DESC, priority_rank ASC, name ASC
     LIMIT $${params.length}`,
    params
  );

  universitiesCache.set(cacheKey, { rows, loadedAt: Date.now() });
  setPublicCacheHeaders(res, 60);
  return res.json({ universities: rows, query });
});

module.exports = router;
module.exports.invalidateUniversityCatalogCache = invalidateUniversityCatalogCache;
