const express = require('express');
const { pool } = require('../db/pool');
const { ensureUniversityCatalogSchema } = require('../utils/universities');

const router = express.Router();

router.get('/colleges', async (_req, res) => {
  const { rows } = await pool.query('SELECT id, name, city, state FROM colleges ORDER BY name');
  res.json({ colleges: rows });
});

router.get('/universities', async (req, res) => {
  await ensureUniversityCatalogSchema(pool);

  const query = String(req.query.q || '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit || 30), 5), 100);

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

  res.json({ universities: rows, query });
});

module.exports = router;
