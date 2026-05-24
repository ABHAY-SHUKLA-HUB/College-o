const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

let forumSchemaEnsured = false;

async function ensureForumSchema() {
  if (forumSchemaEnsured) return;

  const hasThreads = await pool.query("SELECT to_regclass('public.forum_threads') AS tbl");
  if (!hasThreads.rows[0]?.tbl) {
    await pool.query('DROP SEQUENCE IF EXISTS forum_threads_id_seq');
    await pool.query(
      `CREATE TABLE forum_threads (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        title VARCHAR(220) NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    );
  }

  await pool.query(
    `ALTER TABLE forum_threads
      ADD COLUMN IF NOT EXISTS category VARCHAR(60) DEFAULT 'Concept Discussions',
      ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS views_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
  );

  const hasReplies = await pool.query("SELECT to_regclass('public.forum_replies') AS tbl");
  if (!hasReplies.rows[0]?.tbl) {
    await pool.query('DROP SEQUENCE IF EXISTS forum_replies_id_seq');
    await pool.query(
      `CREATE TABLE forum_replies (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        thread_id INTEGER NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_reply_id INTEGER REFERENCES forum_replies(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        is_best_answer BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    );
  }

  const hasVotes = await pool.query("SELECT to_regclass('public.forum_reply_votes') AS tbl");
  if (!hasVotes.rows[0]?.tbl) {
    await pool.query('DROP SEQUENCE IF EXISTS forum_reply_votes_id_seq');
    await pool.query(
      `CREATE TABLE forum_reply_votes (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        reply_id INTEGER NOT NULL REFERENCES forum_replies(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        vote SMALLINT NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (reply_id, user_id)
      )`
    );
  }

  forumSchemaEnsured = true;
}

function normalizeTags(rawTags) {
  if (!Array.isArray(rawTags)) return [];
  return [...new Set(rawTags.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 8))];
}

function normalizeFilter(filter) {
  const allowed = ['latest', 'trending', 'unanswered', 'myposts'];
  const cleaned = String(filter || 'latest').toLowerCase();
  return allowed.includes(cleaned) ? cleaned : 'latest';
}

async function getThreadById(id, viewerId) {
  const { rows } = await pool.query(
    `SELECT f.id,
            f.title,
            f.body,
            COALESCE(f.category, 'Concept Discussions') AS category,
            COALESCE(f.tags, '[]'::jsonb) AS tags,
            COALESCE(f.views_count, 0) AS views_count,
            f.created_at,
            f.updated_at,
            u.id AS author_id,
            u.full_name AS author,
            COUNT(r.id)::int AS replies_count,
            COALESCE(MAX(CASE WHEN r.is_best_answer THEN r.id ELSE NULL END), 0) AS best_answer_id,
            CASE WHEN u.id = $2 THEN TRUE ELSE FALSE END AS is_mine
     FROM forum_threads f
     JOIN users u ON u.id = f.user_id
     LEFT JOIN forum_replies r ON r.thread_id = f.id
     WHERE f.id = $1
     GROUP BY f.id, u.id`,
    [id, Number(viewerId || 0)]
  );
  return rows[0] || null;
}

router.get('/threads', requireAuth, async (req, res) => {
  await ensureForumSchema();

  const search = String(req.query.search || '').trim();
  const filter = normalizeFilter(req.query.filter);
  const category = String(req.query.category || '').trim();

  const values = [req.session.userId];
  const where = [];

  if (search) {
    values.push(`%${search}%`);
    where.push(`(f.title ILIKE $${values.length} OR f.body ILIKE $${values.length} OR COALESCE(f.category, '') ILIKE $${values.length})`);
  }

  if (category && category.toLowerCase() !== 'all') {
    values.push(category);
    where.push(`COALESCE(f.category, 'Concept Discussions') = $${values.length}`);
  }

  if (filter === 'myposts') {
    values.push(req.session.userId);
    where.push(`f.user_id = $${values.length}`);
  }

  if (filter === 'unanswered') {
    where.push('COALESCE(reply_count.reply_count, 0) = 0');
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderClause = filter === 'trending'
    ? "ORDER BY ((COALESCE(reply_count.reply_count, 0) * 3) + COALESCE(f.views_count, 0)) DESC, f.created_at DESC"
    : 'ORDER BY f.created_at DESC';

  const { rows } = await pool.query(
    `SELECT f.id,
            f.title,
            f.body,
            COALESCE(f.category, 'Concept Discussions') AS category,
            COALESCE(f.tags, '[]'::jsonb) AS tags,
            COALESCE(f.views_count, 0) AS views_count,
            f.created_at,
            u.id AS author_id,
            u.full_name AS author,
            COALESCE(reply_count.reply_count, 0) AS replies_count,
            CASE WHEN f.user_id = $1 THEN TRUE ELSE FALSE END AS is_mine,
            CASE WHEN EXISTS (
              SELECT 1 FROM forum_replies rr
              WHERE rr.thread_id = f.id AND rr.is_best_answer = TRUE
            ) THEN TRUE ELSE FALSE END AS has_best_answer
     FROM forum_threads f
     JOIN users u ON u.id = f.user_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS reply_count
       FROM forum_replies fr
       WHERE fr.thread_id = f.id
     ) reply_count ON TRUE
     ${whereClause}
     ${orderClause}
     LIMIT 100`,
    values
  );
  res.json({ threads: rows });
});

router.get('/threads/trending', requireAuth, async (_req, res) => {
  await ensureForumSchema();
  const { rows } = await pool.query(
    `SELECT f.id,
            f.title,
            COALESCE(f.category, 'Concept Discussions') AS category,
            COALESCE(f.views_count, 0) AS views_count,
            COALESCE(reply_count.reply_count, 0) AS replies_count,
            f.created_at
     FROM forum_threads f
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS reply_count
       FROM forum_replies fr
       WHERE fr.thread_id = f.id
     ) reply_count ON TRUE
     ORDER BY ((COALESCE(reply_count.reply_count, 0) * 3) + COALESCE(f.views_count, 0)) DESC, f.created_at DESC
     LIMIT 6`
  );
  res.json({ threads: rows });
});

router.get('/threads/:id', requireAuth, async (req, res) => {
  await ensureForumSchema();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid thread id' });

  const thread = await getThreadById(id, req.session.userId);
  if (!thread) return res.status(404).json({ error: 'Thread not found' });

  const { rows } = await pool.query(
    `SELECT r.id,
            r.thread_id,
            r.parent_reply_id,
            r.body,
            r.is_best_answer,
            r.created_at,
            u.id AS author_id,
            u.full_name AS author,
            COALESCE(v.vote_count, 0) AS upvotes,
            CASE WHEN uv.id IS NULL THEN FALSE ELSE TRUE END AS voted_by_me
     FROM forum_replies r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS vote_count
       FROM forum_reply_votes rv
       WHERE rv.reply_id = r.id AND rv.vote = 1
     ) v ON TRUE
     LEFT JOIN forum_reply_votes uv ON uv.reply_id = r.id AND uv.user_id = $2
     WHERE r.thread_id = $1
     ORDER BY r.created_at ASC`,
    [id, req.session.userId]
  );

  res.json({ thread, replies: rows });
});

router.post('/threads/:id/view', requireAuth, async (req, res) => {
  await ensureForumSchema();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid thread id' });

  const { rows } = await pool.query(
    `UPDATE forum_threads
     SET views_count = COALESCE(views_count, 0) + 1,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, views_count`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Thread not found' });

  res.json({ thread: rows[0] });
});

router.post('/threads', requireAuth, async (req, res) => {
  await ensureForumSchema();
  const { title, body, category, tags } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body required' });

  const safeTags = normalizeTags(tags);
  const { rows } = await pool.query(
    `INSERT INTO forum_threads (user_id, title, body, category, tags, views_count, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 0, NOW())
     RETURNING id, title, body, category, tags, created_at`,
    [req.session.userId, title, body, category || 'Concept Discussions', JSON.stringify(safeTags)]
  );
  res.status(201).json({ thread: rows[0] });
});

router.post('/threads/:id/replies', requireAuth, async (req, res) => {
  await ensureForumSchema();
  const id = Number(req.params.id);
  const { body, parentReplyId } = req.body;
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid thread id' });
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'Reply body required' });

  if (parentReplyId) {
    const parent = await pool.query(
      'SELECT id FROM forum_replies WHERE id = $1 AND thread_id = $2',
      [Number(parentReplyId), id]
    );
    if (parent.rowCount === 0) return res.status(400).json({ error: 'Invalid parent reply' });
  }

  const { rows } = await pool.query(
    `INSERT INTO forum_replies (thread_id, user_id, parent_reply_id, body, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING id, thread_id, parent_reply_id, body, is_best_answer, created_at`,
    [id, req.session.userId, parentReplyId ? Number(parentReplyId) : null, String(body).trim()]
  );

  await pool.query('UPDATE forum_threads SET updated_at = NOW() WHERE id = $1', [id]);
  res.status(201).json({ reply: rows[0] });
});

router.post('/replies/:id/upvote', requireAuth, async (req, res) => {
  await ensureForumSchema();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid reply id' });

  const existing = await pool.query(
    'SELECT id FROM forum_reply_votes WHERE reply_id = $1 AND user_id = $2',
    [id, req.session.userId]
  );

  if (existing.rowCount > 0) {
    await pool.query('DELETE FROM forum_reply_votes WHERE id = $1', [existing.rows[0].id]);
  } else {
    await pool.query(
      'INSERT INTO forum_reply_votes (reply_id, user_id, vote) VALUES ($1, $2, 1) ON CONFLICT (reply_id, user_id) DO NOTHING',
      [id, req.session.userId]
    );
  }

  const counts = await pool.query(
    'SELECT COUNT(*)::int AS upvotes FROM forum_reply_votes WHERE reply_id = $1 AND vote = 1',
    [id]
  );
  res.json({ replyId: id, upvotes: counts.rows[0].upvotes, votedByMe: existing.rowCount === 0 });
});

router.post('/threads/:threadId/best-answer/:replyId', requireAuth, async (req, res) => {
  await ensureForumSchema();
  const threadId = Number(req.params.threadId);
  const replyId = Number(req.params.replyId);
  if (!Number.isInteger(threadId) || !Number.isInteger(replyId)) {
    return res.status(400).json({ error: 'Invalid thread/reply id' });
  }

  const thread = await pool.query('SELECT id, user_id FROM forum_threads WHERE id = $1', [threadId]);
  if (!thread.rows[0]) return res.status(404).json({ error: 'Thread not found' });
  if (thread.rows[0].user_id !== req.session.userId) {
    return res.status(403).json({ error: 'Only thread owner can mark best answer' });
  }

  const reply = await pool.query('SELECT id FROM forum_replies WHERE id = $1 AND thread_id = $2', [replyId, threadId]);
  if (!reply.rows[0]) return res.status(404).json({ error: 'Reply not found for this thread' });

  await pool.query('UPDATE forum_replies SET is_best_answer = FALSE WHERE thread_id = $1', [threadId]);
  await pool.query('UPDATE forum_replies SET is_best_answer = TRUE WHERE id = $1', [replyId]);

  res.json({ message: 'Best answer updated successfully', threadId, replyId });
});

module.exports = router;
module.exports.ensureForumSchema = ensureForumSchema;
