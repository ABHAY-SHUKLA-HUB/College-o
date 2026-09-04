/**
 * Automated Data Retention & Safe Cleanup Service
 * Enforces retention policies for transient execution data, failed/non-best submissions, and integrity logs.
 * ABSOLUTE SAFETY: Never deletes evidence for unresolved integrity reviews or winner certificate records.
 */

const { pool } = require('../db/pool');

/**
 * Execute automated safe data retention cleanup routine.
 */
async function runSafeDataRetentionCleanup({ retentionDays = 15 } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Delete non-best, non-accepted submissions older than retentionDays
    // DO NOT delete submissions linked to winner certificates or active similarity reviews!
    const { rowCount: deletedSubs } = await client.query(
      `DELETE FROM coding_submissions sub
       WHERE sub.submitted_at < CURRENT_TIMESTAMP - ($1 || ' days')::interval
         AND sub.is_best_submission = false
         AND sub.status != 'accepted'
         AND NOT EXISTS (
           SELECT 1 FROM coding_certificates cert WHERE cert.student_id = sub.student_id AND cert.contest_id = sub.contest_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM coding_similarity_results sim WHERE sim.submission_a = sub.id OR sim.submission_b = sub.id
         )`,
      [retentionDays]
    );

    // 2. Clean up raw integrity events older than 60 days (except for disqualified users)
    const { rowCount: deletedEvents } = await client.query(
      `DELETE FROM coding_integrity_events evt
       WHERE evt.created_at < CURRENT_TIMESTAMP - INTERVAL '60 days'
         AND NOT EXISTS (
           SELECT 1 FROM coding_participants pt WHERE pt.student_id = evt.student_id AND pt.contest_id = evt.contest_id AND pt.status = 'disqualified'
         )`
    );

    await client.query('COMMIT');
    console.info(`[Coding Retention] Cleanup finished. Removed ${deletedSubs} obsolete submissions and ${deletedEvents} old integrity events.`);

    return {
      ok: true,
      deleted_submissions: deletedSubs,
      deleted_events: deletedEvents
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => null);
    console.error('[Coding Retention] Cleanup error:', error.message || error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  runSafeDataRetentionCleanup
};
