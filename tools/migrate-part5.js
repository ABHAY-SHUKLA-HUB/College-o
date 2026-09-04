require('dotenv').config();
const { pool } = require('../server/db/pool');

async function runPart5Migration() {
  const client = await pool.connect();
  try {
    console.log('Running Part 5 Certificate Migration...');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS coding_certificate_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS coding_certificate_template_versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        template_id UUID REFERENCES coding_certificate_templates(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_active BOOLEAN DEFAULT true,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_template_version UNIQUE (template_id, version_number)
      );
    `);

    await client.query(`
      ALTER TABLE coding_certificates DROP CONSTRAINT IF EXISTS coding_certificates_status_check;
      ALTER TABLE coding_certificates ADD CONSTRAINT coding_certificates_status_check CHECK (status IN ('pending', 'pending_review', 'pending_approval', 'approved', 'revoked'));
      ALTER TABLE coding_contests DROP CONSTRAINT IF EXISTS coding_contests_status_check;
      ALTER TABLE coding_contests ADD CONSTRAINT coding_contests_status_check CHECK (status IN ('draft', 'scheduled', 'live', 'completed', 'pending_review', 'finalized', 'cancelled'));
      ALTER TABLE coding_certificates ADD COLUMN IF NOT EXISTS position_text VARCHAR(100);
      ALTER TABLE coding_certificates ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES coding_certificate_templates(id) ON DELETE SET NULL;
      ALTER TABLE coding_certificates ADD COLUMN IF NOT EXISTS template_version_id UUID REFERENCES coding_certificate_template_versions(id) ON DELETE SET NULL;
      ALTER TABLE coding_certificates ADD COLUMN IF NOT EXISTS configuration_snapshot JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE coding_certificates ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;
      ALTER TABLE coding_certificates ADD COLUMN IF NOT EXISTS revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE coding_certificates ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
      ALTER TABLE coding_certificates ADD COLUMN IF NOT EXISTS revoke_reason TEXT;
    `);

    await client.query(`
      ALTER TABLE coding_contests ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;
      ALTER TABLE coding_contests ADD COLUMN IF NOT EXISTS finalized_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE coding_contests ADD COLUMN IF NOT EXISTS certificate_template_id UUID REFERENCES coding_certificate_templates(id) ON DELETE SET NULL;
    `);

    await client.query('COMMIT');
    console.log('✅ Part 5 Migration completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => null);
    console.error('❌ Part 5 Migration failed:', err);
  } finally {
    client.release();
    process.exit(0);
  }
}

runPart5Migration();
