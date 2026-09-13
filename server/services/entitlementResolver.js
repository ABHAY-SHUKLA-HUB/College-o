const { pool } = require('../db/pool');
const logger = require('./logger');
const { readFeatureMatrix, resolveEffectiveFeatureState } = require('../middleware/featureToggle');

let membershipSchemaEnsured = false;

/**
 * Ensure membership system database tables exist and are seeded.
 */
async function ensureMembershipSchema() {
  if (membershipSchemaEnsured) return;

  try {
    // 1. Membership Plans Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS membership_plans (
        id SERIAL PRIMARY KEY,
        code VARCHAR(80) UNIQUE NOT NULL,
        name VARCHAR(150) NOT NULL,
        description TEXT,
        price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        currency VARCHAR(10) NOT NULL DEFAULT 'INR',
        duration_value INT NOT NULL DEFAULT 30,
        duration_unit VARCHAR(20) NOT NULL DEFAULT 'DAYS',
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        is_purchasable BOOLEAN NOT NULL DEFAULT TRUE,
        display_order INT NOT NULL DEFAULT 0,
        display_benefits JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by INT REFERENCES users(id) ON DELETE SET NULL,
        updated_by INT REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // 2. Membership Plan Entitlements Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS membership_plan_entitlements (
        id SERIAL PRIMARY KEY,
        plan_id INT NOT NULL REFERENCES membership_plans(id) ON DELETE CASCADE,
        feature_key VARCHAR(100) NOT NULL,
        access_level VARCHAR(50) NOT NULL DEFAULT 'enabled',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(plan_id, feature_key)
      )
    `);

    // 3. User Active & Historical Memberships Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS memberships (
        id SERIAL PRIMARY KEY,
        student_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_id INT REFERENCES membership_plans(id) ON DELETE SET NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        source VARCHAR(50) NOT NULL DEFAULT 'PAYMENT',
        plan_name_at_activation VARCHAR(150),
        price_at_activation NUMERIC(10, 2),
        currency_at_activation VARCHAR(10) DEFAULT 'INR',
        duration_at_activation VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add indexes for high-performance resolution
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_memberships_student_status ON memberships(student_id, status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_membership_plans_code_status ON membership_plans(code, status)`);

    // 4. Part 7 Payment Request Schema Extensions
    await pool.query(`
      ALTER TABLE membership_payment_requests ADD COLUMN IF NOT EXISTS plan_id INT REFERENCES membership_plans(id) ON DELETE SET NULL;
      ALTER TABLE membership_payment_requests ADD COLUMN IF NOT EXISTS plan_name_snapshot VARCHAR(150);
      ALTER TABLE membership_payment_requests ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'INR';
      ALTER TABLE membership_payment_requests ADD COLUMN IF NOT EXISTS duration_snapshot VARCHAR(50);
      ALTER TABLE membership_payment_requests ADD COLUMN IF NOT EXISTS membership_id INT REFERENCES memberships(id) ON DELETE SET NULL;
      ALTER TABLE membership_payment_requests ADD COLUMN IF NOT EXISTS approved_by INT REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE membership_payment_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
      ALTER TABLE membership_payment_requests ADD COLUMN IF NOT EXISTS note TEXT;
      ALTER TABLE membership_payment_requests ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE membership_payment_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);

    // 5. Part 8 Academic Content Schema Extensions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        subject VARCHAR(180) NOT NULL,
        chapter VARCHAR(180) NOT NULL,
        content TEXT NOT NULL,
        user_notes TEXT,
        bookmarks JSONB DEFAULT '[]'::jsonb,
        difficulty VARCHAR(40) DEFAULT 'medium',
        format_type VARCHAR(40) DEFAULT 'pdf',
        created_by INT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        college_name VARCHAR(180),
        pdf_url TEXT,
        college_id INT REFERENCES academic_colleges(id) ON DELETE SET NULL,
        course_id INT REFERENCES academic_courses(id) ON DELETE SET NULL,
        year_id INT REFERENCES academic_years(id) ON DELETE SET NULL,
        source_type VARCHAR(40) DEFAULT 'admin_upload',
        approval_status VARCHAR(30) DEFAULT 'published',
        contributor_notes TEXT,
        category_id INT REFERENCES academic_categories(id) ON DELETE SET NULL,
        branch_id INT REFERENCES academic_branches(id) ON DELETE SET NULL,
        semester_id INT REFERENCES academic_semesters(id) ON DELETE SET NULL,
        subject_id INT REFERENCES academic_subjects(id) ON DELETE SET NULL,
        academic_subject VARCHAR(180),
        access_type VARCHAR(40) DEFAULT 'free',
        status VARCHAR(30) DEFAULT 'published',
        is_common BOOLEAN DEFAULT FALSE,
        deleted_at TIMESTAMP,
        is_premium BOOLEAN DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS materials (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        category VARCHAR(100) DEFAULT 'General',
        subject VARCHAR(180) NOT NULL,
        description TEXT,
        file_url TEXT,
        uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        college_id INT REFERENCES academic_colleges(id) ON DELETE SET NULL,
        course_id INT REFERENCES academic_courses(id) ON DELETE SET NULL,
        year_id INT REFERENCES academic_years(id) ON DELETE SET NULL,
        category_id INT REFERENCES academic_categories(id) ON DELETE SET NULL,
        branch_id INT REFERENCES academic_branches(id) ON DELETE SET NULL,
        semester_id INT REFERENCES academic_semesters(id) ON DELETE SET NULL,
        subject_id INT REFERENCES academic_subjects(id) ON DELETE SET NULL,
        access_type VARCHAR(40) DEFAULT 'free',
        status VARCHAR(30) DEFAULT 'published',
        is_common BOOLEAN DEFAULT FALSE,
        deleted_at TIMESTAMP,
        source_type VARCHAR(40) DEFAULT 'admin_upload',
        approval_status VARCHAR(30) DEFAULT 'published',
        contributor_id INT REFERENCES users(id) ON DELETE SET NULL,
        quality_score INT DEFAULT 5
      );

      CREATE TABLE IF NOT EXISTS previous_papers (
        id SERIAL PRIMARY KEY,
        subject VARCHAR(180) NOT NULL,
        exam_name VARCHAR(180) NOT NULL,
        year INT NOT NULL DEFAULT 2026,
        paper_url TEXT,
        summary_note_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        college_name VARCHAR(180),
        uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
        college_id INT REFERENCES academic_colleges(id) ON DELETE SET NULL,
        course_id INT REFERENCES academic_courses(id) ON DELETE SET NULL,
        year_id INT REFERENCES academic_years(id) ON DELETE SET NULL,
        category_id INT REFERENCES academic_categories(id) ON DELETE SET NULL,
        branch_id INT REFERENCES academic_branches(id) ON DELETE SET NULL,
        semester_id INT REFERENCES academic_semesters(id) ON DELETE SET NULL,
        subject_id INT REFERENCES academic_subjects(id) ON DELETE SET NULL,
        access_type VARCHAR(40) DEFAULT 'free',
        status VARCHAR(30) DEFAULT 'published',
        is_common BOOLEAN DEFAULT FALSE,
        deleted_at TIMESTAMP,
        source_type VARCHAR(40) DEFAULT 'admin_upload',
        approval_status VARCHAR(30) DEFAULT 'published',
        contributor_id INT REFERENCES users(id) ON DELETE SET NULL,
        moderation_notes TEXT
      );

      ALTER TABLE notes ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published';
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS access_type VARCHAR(40) DEFAULT 'free';
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS subject_id INT REFERENCES academic_subjects(id) ON DELETE SET NULL;

      ALTER TABLE materials ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published';
      ALTER TABLE materials ADD COLUMN IF NOT EXISTS access_type VARCHAR(40) DEFAULT 'free';
      ALTER TABLE materials ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
      ALTER TABLE materials ADD COLUMN IF NOT EXISTS subject_id INT REFERENCES academic_subjects(id) ON DELETE SET NULL;

      ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published';
      ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS access_type VARCHAR(40) DEFAULT 'free';
      ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
      ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS subject_id INT REFERENCES academic_subjects(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_notes_status_branch ON notes(status, branch_id, semester_id);
      CREATE INDEX IF NOT EXISTS idx_materials_status_branch ON materials(status, branch_id, semester_id);
      CREATE INDEX IF NOT EXISTS idx_previous_papers_status_branch ON previous_papers(status, branch_id, semester_id);

      // 6. Part 9 Assessment & Roadmap Schema Extensions
      ALTER TABLE mock_test_attempts ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'SUBMITTED';
      ALTER TABLE mock_test_attempts ADD COLUMN IF NOT EXISTS started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE mock_test_attempts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
      ALTER TABLE mock_test_attempts ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP;
      ALTER TABLE mock_test_attempts ADD COLUMN IF NOT EXISTS question_order_json JSONB;
      ALTER TABLE mock_test_attempts ADD COLUMN IF NOT EXISTS score NUMERIC(8,2);
      ALTER TABLE mock_test_attempts ADD COLUMN IF NOT EXISTS max_score NUMERIC(8,2);
      ALTER TABLE mock_test_attempts ADD COLUMN IF NOT EXISTS percentage NUMERIC(5,2);
      ALTER TABLE mock_test_attempts ADD COLUMN IF NOT EXISTS passed BOOLEAN DEFAULT FALSE;

      CREATE TABLE IF NOT EXISTS quiz_questions (
        id SERIAL PRIMARY KEY,
        quiz_id INT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        question_text TEXT NOT NULL,
        question_type VARCHAR(30) NOT NULL DEFAULT 'single_mcq',
        difficulty VARCHAR(20) DEFAULT 'medium',
        marks NUMERIC(6,2) DEFAULT 1,
        negative_marks NUMERIC(6,2) DEFAULT 0,
        explanation TEXT,
        options_json JSONB DEFAULT '[]'::jsonb,
        correct_answer_json JSONB NOT NULL,
        order_no INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'SUBMITTED';
      ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
      ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP;
      ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS answers_json JSONB;
      ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS question_order_json JSONB;
      ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS score NUMERIC(8,2);
      ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS max_score NUMERIC(8,2);
      ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS percentage NUMERIC(5,2);
      ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS passed BOOLEAN DEFAULT FALSE;

      ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS title VARCHAR(200);
      ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS category_id INT REFERENCES academic_categories(id) ON DELETE SET NULL;
      ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS branch_id INT REFERENCES academic_branches(id) ON DELETE SET NULL;
      ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS semester_id INT REFERENCES academic_semesters(id) ON DELETE SET NULL;
      ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS subject_id INT REFERENCES academic_subjects(id) ON DELETE SET NULL;
      ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published';
      ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS access_type VARCHAR(40) DEFAULT 'free';
      ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

      CREATE TABLE IF NOT EXISTS roadmap_steps (
        id SERIAL PRIMARY KEY,
        roadmap_id INT NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        step_order INT NOT NULL DEFAULT 0,
        resource_type VARCHAR(50) NOT NULL DEFAULT 'route',
        resource_id INT,
        route VARCHAR(255),
        is_required BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS student_roadmap_progress (
        id SERIAL PRIMARY KEY,
        student_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        roadmap_id INT NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
        step_id INT NOT NULL REFERENCES roadmap_steps(id) ON DELETE CASCADE,
        status VARCHAR(30) NOT NULL DEFAULT 'COMPLETED',
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, step_id)
      );
    `);

    // Seed default FREE plan if missing
    const freeRes = await pool.query("SELECT id FROM membership_plans WHERE code = 'free' LIMIT 1");
    let freePlanId;
    if (freeRes.rows.length === 0) {
      const insertedFree = await pool.query(`
        INSERT INTO membership_plans (code, name, description, price, currency, duration_value, duration_unit, status, is_purchasable, display_order, display_benefits)
        VALUES (
          'free', 
          'Free Plan', 
          'Start learning with core campus resources and basic access.', 
          0.00, 
          'INR', 
          365, 
          'DAYS', 
          'ACTIVE', 
          TRUE, 
          0, 
          '["Limited notes access", "Basic diagnostic quizzes", "2 mock test attempts"]'::jsonb
        )
        RETURNING id
      `);
      freePlanId = insertedFree.rows[0].id;
    } else {
      freePlanId = freeRes.rows[0].id;
    }

    // Seed default PREMIUM plan if missing
    const premiumRes = await pool.query("SELECT id FROM membership_plans WHERE code = 'premium' LIMIT 1");
    let premiumPlanId;
    if (premiumRes.rows.length === 0) {
      const insertedPremium = await pool.query(`
        INSERT INTO membership_plans (code, name, description, price, currency, duration_value, duration_unit, status, is_purchasable, display_order, display_benefits)
        VALUES (
          'premium', 
          'Premium Membership', 
          'Full platform access with unlimited tests, AI study tools, and certificates.', 
          49.00, 
          'INR', 
          30, 
          'DAYS', 
          'ACTIVE', 
          TRUE, 
          1, 
          '["Unlimited notes & downloads", "All AI study tools enabled", "Unlimited mock tests", "Certificates & advanced roadmaps"]'::jsonb
        )
        RETURNING id
      `);
      premiumPlanId = insertedPremium.rows[0].id;

      // Seed default entitlements for Premium plan
      const defaultEntitlements = [
        'study_materials', 'notes_library', 'previous_papers', 'quizzes',
        'mock_tests', 'study_roadmaps', 'academic_structure', 'career_guidance',
        'ai_study_assistant', 'certificates', 'company_support', 'campus_feed'
      ];

      for (const featKey of defaultEntitlements) {
        await pool.query(`
          INSERT INTO membership_plan_entitlements (plan_id, feature_key, access_level)
          VALUES ($1, $2, 'enabled')
          ON CONFLICT (plan_id, feature_key) DO NOTHING
        `, [premiumPlanId, featKey]);
      }
    }

    membershipSchemaEnsured = true;
  } catch (err) {
    logger.error('[EntitlementResolver] Failed to ensure membership schema', { error: err.message });
  }
}

/**
 * Get active student membership record.
 * Handles auto-expiry evaluation server-side.
 */
async function getStudentActiveMembership(studentId) {
  await ensureMembershipSchema();

  // 1. Query memberships table for ACTIVE subscription
  const { rows } = await pool.query(`
    SELECT 
      m.id,
      m.student_id,
      m.plan_id,
      m.status,
      m.started_at,
      m.expires_at,
      m.source,
      m.plan_name_at_activation,
      m.price_at_activation,
      m.currency_at_activation,
      m.duration_at_activation,
      p.code AS plan_code,
      p.name AS plan_name
    FROM memberships m
    LEFT JOIN membership_plans p ON p.id = m.plan_id
    WHERE m.student_id = $1 AND m.status = 'ACTIVE'
    ORDER BY m.started_at DESC
    LIMIT 1
  `, [studentId]);

  if (rows.length > 0) {
    const mem = rows[0];
    // Evaluate expiry server-side
    if (mem.expires_at && new Date(mem.expires_at).getTime() < Date.now()) {
      // Auto-expire
      await pool.query("UPDATE memberships SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [mem.id]);
      return {
        hasActiveMembership: false,
        status: 'EXPIRED',
        planCode: 'free',
        planName: 'Free Plan',
        startedAt: mem.started_at,
        expiresAt: mem.expires_at,
        source: mem.source
      };
    }

    return {
      id: mem.id,
      hasActiveMembership: true,
      status: 'ACTIVE',
      planId: mem.plan_id,
      planCode: mem.plan_code || 'premium',
      planName: mem.plan_name || mem.plan_name_at_activation || 'Premium Plan',
      startedAt: mem.started_at,
      expiresAt: mem.expires_at,
      source: mem.source
    };
  }

  // 2. Fallback check on users table legacy subscription_tier / subscription_expiry
  const userRes = await pool.query(`
    SELECT subscription_tier, subscription_expiry, created_at 
    FROM users 
    WHERE id = $1
  `, [studentId]);

  if (userRes.rows.length > 0) {
    const user = userRes.rows[0];
    const isTierActive = (user.subscription_tier === 'premium' || user.subscription_tier === 'active');
    const notExpired = !user.subscription_expiry || new Date(user.subscription_expiry).getTime() > Date.now();

    if (isTierActive && notExpired) {
      return {
        hasActiveMembership: true,
        status: 'ACTIVE',
        planCode: 'premium',
        planName: 'Premium Plan',
        startedAt: user.created_at,
        expiresAt: user.subscription_expiry,
        source: 'LEGACY'
      };
    }
  }

  return {
    hasActiveMembership: false,
    status: 'FREE',
    planCode: 'free',
    planName: 'Free Plan',
    startedAt: null,
    expiresAt: null,
    source: null
  };
}

/**
 * Fetch feature entitlements enabled for a given plan ID.
 */
async function getPlanEntitlements(planId) {
  await ensureMembershipSchema();
  const { rows } = await pool.query(`
    SELECT feature_key, access_level 
    FROM membership_plan_entitlements 
    WHERE plan_id = $1
  `, [planId]);
  
  const entitlementSet = new Set(rows.map(r => r.feature_key));
  return entitlementSet;
}

/**
 * CENTRAL ENTITLEMENT RESOLVER
 * Returns student's effective access across all 17 capabilities by checking:
 * 1. Account Status (Is suspended? -> Blocked)
 * 2. Part 4 Global Feature Controls (Is hidden/disabled/maintenance? -> Takes priority over membership)
 * 3. Active Membership & Plan Entitlements (Does student have entitlement or admin role?)
 */
async function getStudentEntitlements(studentId) {
  await ensureMembershipSchema();

  // 1. Fetch Student Identity & Account Status
  const userRes = await pool.query(`
    SELECT id, email, role, is_suspended, is_blocked 
    FROM users 
    WHERE id = $1
  `, [studentId]);

  if (userRes.rows.length === 0) {
    throw new Error(`Student not found: ID ${studentId}`);
  }

  const user = userRes.rows[0];
  const isSuspended = Boolean(user.is_suspended || user.is_blocked);
  const isAdmin = (user.role === 'admin' || user.role === 'super_admin');

  // 2. Fetch Active Membership & Entitlement Set
  const activeMembership = await getStudentActiveMembership(studentId);
  let grantedEntitlements = new Set();

  if (activeMembership.hasActiveMembership && activeMembership.planId) {
    grantedEntitlements = await getPlanEntitlements(activeMembership.planId);
  } else if (activeMembership.hasActiveMembership) {
    // Legacy fallback: grant standard entitlements
    grantedEntitlements = new Set([
      'study_materials', 'notes_library', 'previous_papers', 'quizzes',
      'mock_tests', 'study_roadmaps', 'academic_structure', 'career_guidance',
      'ai_study_assistant', 'certificates', 'company_support', 'campus_feed'
    ]);
  }

  // 3. Fetch Part 4 Global Feature Matrix
  const globalMatrix = await readFeatureMatrix();

  // 4. Resolve Effective Access per Feature
  const effectiveAccess = {};

  Object.keys(globalMatrix).forEach((featKey) => {
    const featConfig = globalMatrix[featKey];

    if (isSuspended) {
      effectiveAccess[featKey] = {
        ...featConfig,
        accessible: false,
        unavailableReason: 'ACCOUNT_SUSPENDED',
        maintenanceMessage: 'Your account is suspended. Protected actions are restricted.'
      };
      return;
    }

    // Evaluate Global Feature State first (Part 4)
    const isVisible = featConfig.is_visible !== false;
    const isEnabled = featConfig.is_enabled !== false;
    const isMaintenance = Boolean(featConfig.maintenance_mode);
    const accessMode = featConfig.access_mode || 'EVERYONE';

    if (!isVisible) {
      effectiveAccess[featKey] = {
        ...featConfig,
        accessible: false,
        unavailableReason: 'FEATURE_HIDDEN'
      };
      return;
    }

    if (isMaintenance) {
      effectiveAccess[featKey] = {
        ...featConfig,
        accessible: false,
        unavailableReason: 'FEATURE_MAINTENANCE',
        maintenanceMessage: featConfig.maintenance_message || 'This feature is under maintenance.'
      };
      return;
    }

    if (!isEnabled) {
      effectiveAccess[featKey] = {
        ...featConfig,
        accessible: false,
        unavailableReason: 'FEATURE_DISABLED'
      };
      return;
    }

    // Access Mode Evaluation
    let accessible = true;
    let reason = null;

    if (accessMode === 'AUTHENTICATED' && !studentId) {
      accessible = false;
      reason = 'UNAUTHENTICATED';
    } else if (accessMode === 'MEMBERSHIP_REQUIRED' || accessMode === 'SPECIFIC_ENTITLEMENT') {
      const isMemberOrEntitled = isAdmin || (activeMembership.hasActiveMembership && (grantedEntitlements.has(featKey) || grantedEntitlements.size === 0));
      if (!isMemberOrEntitled) {
        accessible = false;
        reason = 'MEMBERSHIP_REQUIRED';
      }
    }

    effectiveAccess[featKey] = {
      ...featConfig,
      accessible,
      unavailableReason: reason
    };
  });

  return {
    studentId: user.id,
    accountStatus: isSuspended ? 'SUSPENDED' : 'ACTIVE',
    membership: activeMembership,
    entitlements: Array.from(grantedEntitlements),
    effectiveAccess
  };
}

module.exports = {
  ensureMembershipSchema,
  getStudentActiveMembership,
  getPlanEntitlements,
  getStudentEntitlements
};
