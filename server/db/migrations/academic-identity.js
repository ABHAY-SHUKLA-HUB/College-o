const { pool } = require('../pool');

async function initializeAcademicIdentitySchema() {
  console.log('[Academic Identity] Initializing tables and schema...');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ensure `universities` table has status, code, display_order
    await client.query(`
      CREATE TABLE IF NOT EXISTS universities (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50),
        name VARCHAR(255) NOT NULL,
        country_code VARCHAR(10) DEFAULT 'IN',
        state VARCHAR(100),
        city VARCHAR(100),
        campus VARCHAR(100),
        is_featured BOOLEAN DEFAULT true,
        is_enabled BOOLEAN DEFAULT true,
        status VARCHAR(20) DEFAULT 'ACTIVE',
        priority_rank INTEGER DEFAULT 0,
        display_order INTEGER DEFAULT 0,
        created_by INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    await client.query(`ALTER TABLE universities ADD COLUMN IF NOT EXISTS code VARCHAR(50);`);
    await client.query(`ALTER TABLE universities ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ACTIVE';`);
    await client.query(`ALTER TABLE universities ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;`);

    // Seed initial required universities if not existing: CU UP & CU Punjab
    let cuUpCheck = await client.query(`SELECT id FROM universities WHERE code = 'CU_UP' OR name = 'Chandigarh University Uttar Pradesh' LIMIT 1`);
    let cuUpId;
    if (cuUpCheck.rows.length === 0) {
      const ins = await client.query(
        `INSERT INTO universities (code, name, country_code, state, city, campus, is_featured, is_enabled, status, priority_rank, display_order)
         VALUES ('CU_UP', 'Chandigarh University Uttar Pradesh', 'IN', 'Uttar Pradesh', 'Lucknow', 'Lucknow Campus', true, true, 'ACTIVE', 1, 1)
         ON CONFLICT (name) DO UPDATE SET code = 'CU_UP', status = 'ACTIVE'
         RETURNING id`
      );
      cuUpId = ins.rows[0].id;
    } else {
      cuUpId = cuUpCheck.rows[0].id;
      await client.query(`UPDATE universities SET name = 'Chandigarh University Uttar Pradesh', code = 'CU_UP', status = 'ACTIVE' WHERE id = $1`, [cuUpId]);
    }

    let cuPbCheck = await client.query(`SELECT id FROM universities WHERE code = 'CU_PUNJAB' OR name = 'Chandigarh University Punjab' LIMIT 1`);
    let cuPbId;
    if (cuPbCheck.rows.length === 0) {
      const ins = await client.query(
        `INSERT INTO universities (code, name, country_code, state, city, campus, is_featured, is_enabled, status, priority_rank, display_order)
         VALUES ('CU_PUNJAB', 'Chandigarh University Punjab', 'IN', 'Punjab', 'Mohali', 'Gharuan Campus', true, true, 'ACTIVE', 2, 2)
         ON CONFLICT (name) DO UPDATE SET code = 'CU_PUNJAB', status = 'ACTIVE'
         RETURNING id`
      );
      cuPbId = ins.rows[0].id;
    } else {
      cuPbId = cuPbCheck.rows[0].id;
      await client.query(`UPDATE universities SET name = 'Chandigarh University Punjab', code = 'CU_PUNJAB', status = 'ACTIVE' WHERE id = $1`, [cuPbId]);
    }

    // 2. Create `courses` table
    await client.query(`
      CREATE TABLE IF NOT EXISTS courses (
        id SERIAL PRIMARY KEY,
        university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
        code VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        department VARCHAR(150),
        degree_type VARCHAR(50) DEFAULT 'UG',
        duration_years INTEGER DEFAULT 4,
        status VARCHAR(20) DEFAULT 'ACTIVE',
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT unique_uni_course_code UNIQUE (university_id, code)
      );
    `);
    await client.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS department VARCHAR(150);`);

    // 3. Create `batches` table
    await client.query(`
      CREATE TABLE IF NOT EXISTS batches (
        id SERIAL PRIMARY KEY,
        university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
        course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        start_year INTEGER NOT NULL,
        end_year INTEGER,
        status VARCHAR(20) DEFAULT 'ACTIVE',
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT unique_course_batch_name UNIQUE (course_id, name)
      );
    `);

    // 4. Create `student_academic_profiles` table
    await client.query(`
      CREATE TABLE IF NOT EXISTS student_academic_profiles (
        id SERIAL PRIMARY KEY,
        student_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE RESTRICT,
        course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
        batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
        profile_completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Create indexes for high performance querying
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_courses_uni_status ON courses (university_id, status);
      CREATE INDEX IF NOT EXISTS idx_batches_course_status ON batches (course_id, status);
      CREATE INDEX IF NOT EXISTS idx_student_acad_prof_student ON student_academic_profiles (student_id);
    `);

    // 5. Ensure Content Tables support scope_type, university_id, course_id, batch_id
    const scopedTables = ['materials', 'notes', 'previous_papers', 'quizzes', 'mock_tests', 'roadmaps', 'coding_challenges', 'live_sessions'];
    for (const tbl of scopedTables) {
      const tblCheck = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`, [tbl]);
      if (tblCheck.rows.length > 0) {
        await client.query(`
          ALTER TABLE ${tbl}
            ADD COLUMN IF NOT EXISTS scope_type VARCHAR(20) DEFAULT 'GLOBAL',
            ADD COLUMN IF NOT EXISTS university_id INTEGER,
            ADD COLUMN IF NOT EXISTS course_id INTEGER,
            ADD COLUMN IF NOT EXISTS batch_id INTEGER;
        `);
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_${tbl}_acad_scope ON ${tbl} (scope_type, university_id, course_id, batch_id);
        `);
      }
    }

    // Seed Courses for CU UP & CU Punjab if not present
    const defaultCourses = [
      { code: 'BTECH_CSE', name: 'B.Tech Computer Science & Engineering', department: 'Department of Computer Science & Engineering', degree: 'B.Tech', duration: 4 },
      { code: 'BTECH_IT', name: 'B.Tech Information Technology', department: 'Department of Information Technology', degree: 'B.Tech', duration: 4 },
      { code: 'BTECH_ECE', name: 'B.Tech Electronics & Communication', department: 'Department of Electronics & Communication', degree: 'B.Tech', duration: 4 },
      { code: 'BCA', name: 'Bachelor of Computer Applications (BCA)', department: 'Department of Computer Applications', degree: 'BCA', duration: 3 },
      { code: 'MCA', name: 'Master of Computer Applications (MCA)', department: 'Department of Computer Applications', degree: 'MCA', duration: 2 },
      { code: 'BBA', name: 'Bachelor of Business Administration (BBA)', department: 'Department of Management & Business Studies', degree: 'BBA', duration: 3 },
      { code: 'MBA', name: 'Master of Business Administration (MBA)', department: 'Department of Management & Business Studies', degree: 'MBA', duration: 2 }
    ];

    const defaultBatches = [
      { name: '2026-2030', start_year: 2026, end_year: 2030 },
      { name: '2025-2029', start_year: 2025, end_year: 2029 },
      { name: '2024-2028', start_year: 2024, end_year: 2028 },
      { name: '2023-2027', start_year: 2023, end_year: 2027 }
    ];

    for (const uniId of [cuUpId, cuPbId]) {
      for (const [idx, c] of defaultCourses.entries()) {
        const courseIns = await client.query(
          `INSERT INTO courses (university_id, code, name, department, degree_type, duration_years, status, display_order)
           VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7)
           ON CONFLICT (university_id, code) DO UPDATE SET name = EXCLUDED.name, department = EXCLUDED.department, status = 'ACTIVE'
           RETURNING id`,
          [uniId, c.code, c.name, c.department, c.degree, c.duration, idx + 1]
        );
        const courseId = courseIns.rows[0].id;

        for (const [bIdx, b] of defaultBatches.entries()) {
          await client.query(
            `INSERT INTO batches (university_id, course_id, name, start_year, end_year, status, display_order)
             VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6)
             ON CONFLICT (course_id, name) DO UPDATE SET status = 'ACTIVE'`,
            [uniId, courseId, b.name, b.start_year, b.end_year, bIdx + 1]
          );
        }
      }
    }

    await client.query('COMMIT');
    console.log('[Academic Identity] Schema initialization and seeding complete.');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Academic Identity] Schema initialization failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { initializeAcademicIdentitySchema };
