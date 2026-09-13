const { pool } = require('../db/pool');

const STABLE_PERMISSIONS = [
  { key: 'view_dashboard', label: 'View Admin Dashboard', module: 'dashboard', description: 'Access admin analytics and metrics dashboard' },
  { key: 'view_students', label: 'View Students', module: 'students', description: 'View student directory, profiles, and activity' },
  { key: 'manage_students', label: 'Manage Students', module: 'students', description: 'Suspend, block, edit, or delete student accounts' },
  { key: 'manage_memberships', label: 'Manage Memberships', module: 'memberships', description: 'View and manage membership plans and manual entitlements' },
  { key: 'verify_payments', label: 'Verify Payments', module: 'payments', description: 'Approve or reject student offline payment proofs' },
  { key: 'manage_payment_settings', label: 'Manage Payment Settings', module: 'payments', description: 'Configure UPI ID, QR code, and payment gateways' },
  { key: 'manage_academic_content', label: 'Manage Academic Content', module: 'academics', description: 'Upload and manage notes, materials, papers, and subjects' },
  { key: 'manage_assessments', label: 'Manage Assessments', module: 'assessments', description: 'Create and manage quizzes and mock test papers' },
  { key: 'manage_coding', label: 'Manage Coding Governance', module: 'coding', description: 'Manage coding challenges, testcases, and submissions' },
  { key: 'manage_community', label: 'Manage Community', module: 'community', description: 'Moderate campus feed, forum posts, and user contributions' },
  { key: 'manage_support', label: 'Manage Support Governance', module: 'support', description: 'Manage support tickets, assign agents, and respond to requests' },
  { key: 'manage_live_sessions', label: 'Manage Live Sessions', module: 'live_sessions', description: 'Schedule, update, and host live mentorship & lab sessions' },
  { key: 'manage_features', label: 'Manage Feature Controls', module: 'features', description: 'Toggle student feature availability and maintenance modes' },
  { key: 'manage_settings', label: 'Manage System Settings', module: 'settings', description: 'Configure global app branding and operational settings' },
  { key: 'manage_roles', label: 'Manage Roles & Security', module: 'security', description: 'Define roles, permissions, and assign admin staff' },
  { key: 'view_audit_logs', label: 'View Audit Logs', module: 'security', description: 'Inspect immutable system security and action audit logs' }
];

const DEFAULT_SYSTEM_ROLES = [
  {
    key: 'super_admin',
    label: 'Super Administrator',
    description: 'Full, unrestricted governance and administrative authority',
    is_system: true,
    permissions: ['*']
  },
  {
    key: 'admin',
    label: 'Administrator',
    description: 'Full operational administrative access across platform modules',
    is_system: true,
    permissions: STABLE_PERMISSIONS.map(p => p.key)
  },
  {
    key: 'content_manager',
    label: 'Content Manager',
    description: 'Manages academic notes, materials, assessments, coding, and live sessions',
    is_system: true,
    permissions: ['view_dashboard', 'manage_academic_content', 'manage_assessments', 'manage_coding', 'manage_live_sessions']
  },
  {
    key: 'support_agent',
    label: 'Support Agent',
    description: 'Handles student support tickets, community moderation, and student lookups',
    is_system: true,
    permissions: ['view_dashboard', 'manage_support', 'view_students', 'manage_community']
  },
  {
    key: 'moderator',
    label: 'Community Moderator',
    description: 'Moderates forum threads, campus feed posts, and student submissions',
    is_system: true,
    permissions: ['view_dashboard', 'manage_community', 'view_students']
  }
];

let rbacSchemaEnsured = false;

async function ensureRbacSchema() {
  if (rbacSchemaEnsured) return;

  // 1. Core RBAC Tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      key VARCHAR(40) PRIMARY KEY,
      label VARCHAR(100) NOT NULL,
      description TEXT,
      is_system BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS permissions (
      key VARCHAR(80) PRIMARY KEY,
      label VARCHAR(120) NOT NULL,
      module VARCHAR(60) NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_key VARCHAR(40) NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
      permission_key VARCHAR(80) NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
      PRIMARY KEY (role_key, permission_key)
    );

    CREATE TABLE IF NOT EXISTS admin_user_roles (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_key VARCHAR(40) NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
      assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, role_key)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_role VARCHAR(40),
      action VARCHAR(120) NOT NULL,
      entity_type VARCHAR(80),
      entity_id VARCHAR(80),
      old_values JSONB,
      new_values JSONB,
      metadata JSONB,
      ip_address VARCHAR(45),
      user_agent TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Indexes for performance
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
  `);

  // 2. Seed Permissions
  for (const perm of STABLE_PERMISSIONS) {
    await pool.query(
      `INSERT INTO permissions (key, label, module, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE
       SET label = EXCLUDED.label, module = EXCLUDED.module, description = EXCLUDED.description`,
      [perm.key, perm.label, perm.module, perm.description]
    );
  }

  // 3. Seed Roles & Mappings
  for (const role of DEFAULT_SYSTEM_ROLES) {
    await pool.query(
      `INSERT INTO roles (key, label, description, is_system)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE
       SET label = EXCLUDED.label, description = EXCLUDED.description, is_system = EXCLUDED.is_system`,
      [role.key, role.label, role.description, role.is_system]
    );

    // Sync role_permissions
    for (const permKey of role.permissions) {
      if (permKey === '*') {
        // Expand wildcard to all permissions
        for (const p of STABLE_PERMISSIONS) {
          await pool.query(
            `INSERT INTO role_permissions (role_key, permission_key)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [role.key, p.key]
          );
        }
      } else {
        await pool.query(
          `INSERT INTO role_permissions (role_key, permission_key)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [role.key, permKey]
        );
      }
    }

    // Sync legacy admin_permissions table
    const permsJson = JSON.stringify(role.permissions);
    await pool.query(
      `INSERT INTO admin_permissions (admin_role, permissions)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (admin_role) DO UPDATE
       SET permissions = EXCLUDED.permissions`,
      [role.key, permsJson]
    );
  }

  // 4. Backfill existing admin users into admin_user_roles & ensure admin_role column is populated
  const adminUsers = await pool.query(
    "SELECT id, role, admin_role FROM users WHERE role IN ('admin', 'super_admin')"
  );

  for (const user of adminUsers.rows) {
    let effectiveRole = user.admin_role;
    if (!effectiveRole) {
      effectiveRole = user.role === 'super_admin' ? 'super_admin' : 'admin';
      await pool.query("UPDATE users SET admin_role = $1 WHERE id = $2", [effectiveRole, user.id]);
    }
    await pool.query(
      `INSERT INTO admin_user_roles (user_id, role_key)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [user.id, effectiveRole]
    );
  }

  rbacSchemaEnsured = true;
}

module.exports = {
  ensureRbacSchema,
  STABLE_PERMISSIONS,
  DEFAULT_SYSTEM_ROLES
};
