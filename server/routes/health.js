const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

router.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.json({ ok: true, service: 'college-os-api', timestamp: new Date().toISOString() });
});

router.get('/live', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.json({ ok: true, service: 'college-os-api', live: true, timestamp: new Date().toISOString() });
});

router.get('/ready', async (_req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    await pool.query('SELECT 1');
    res.json({ ok: true, ready: true, database: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.status(503).json({ ok: false, ready: false, database: 'unavailable', error: error.message, timestamp: new Date().toISOString() });
  }
});

module.exports = router;
