const DEFAULT_UNIVERSITIES = [
  { name: 'Chandigarh University', isFeatured: true, priorityRank: 1 },
  { name: 'Lovely Professional University (LPU)', isFeatured: true, priorityRank: 2 },
  { name: 'Delhi University', isFeatured: true, priorityRank: 3 },
  { name: 'Banaras Hindu University (BHU)', isFeatured: true, priorityRank: 4 },
  { name: 'Jawaharlal Nehru University (JNU)', isFeatured: true, priorityRank: 5 },
  { name: 'Amity University', isFeatured: true, priorityRank: 6 },
  { name: 'Sharda University', isFeatured: true, priorityRank: 7 },
  { name: 'Galgotias University', isFeatured: true, priorityRank: 8 },
  { name: 'Noida International University', isFeatured: false, priorityRank: 9 },
  { name: 'SRM University', isFeatured: true, priorityRank: 10 },
  { name: 'VIT Vellore', isFeatured: true, priorityRank: 11 },
  { name: 'Anna University', isFeatured: true, priorityRank: 12 },
  { name: 'University of Mumbai', isFeatured: true, priorityRank: 13 },
  { name: 'Savitribai Phule Pune University', isFeatured: true, priorityRank: 14 },
  { name: 'University of Calcutta', isFeatured: true, priorityRank: 15 },
  { name: 'Jamia Millia Islamia', isFeatured: true, priorityRank: 16 },
  { name: 'Aligarh Muslim University (AMU)', isFeatured: true, priorityRank: 17 },
  { name: 'IIT Delhi', isFeatured: true, priorityRank: 18 },
  { name: 'IIT Bombay', isFeatured: true, priorityRank: 19 },
  { name: 'IIT Kanpur', isFeatured: true, priorityRank: 20 },
  { name: 'NIT Trichy', isFeatured: true, priorityRank: 21 },
  { name: 'NIT Surathkal', isFeatured: true, priorityRank: 22 },
  { name: 'KIIT University', isFeatured: false, priorityRank: 23 },
  { name: 'Christ University', isFeatured: true, priorityRank: 24 },
  { name: 'Symbiosis International University', isFeatured: true, priorityRank: 25 },
  { name: 'UPES Dehradun', isFeatured: false, priorityRank: 26 },
  { name: 'Graphic Era University', isFeatured: false, priorityRank: 27 },
  { name: 'Integral University Lucknow', isFeatured: false, priorityRank: 28 },
  { name: 'Dr. APJ Abdul Kalam Technical University (AKTU)', isFeatured: true, priorityRank: 29 },
  { name: 'Chandigarh University Unnao', isFeatured: false, priorityRank: 30 }
];

let ensured = false;

async function ensureUniversityCatalogSchema(pool) {
  if (ensured) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS universities (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      name VARCHAR(220) NOT NULL UNIQUE,
      country_code VARCHAR(12) NOT NULL DEFAULT 'IN',
      state VARCHAR(120),
      city VARCHAR(120),
      campus VARCHAR(160),
      is_featured BOOLEAN NOT NULL DEFAULT FALSE,
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      priority_rank INTEGER NOT NULL DEFAULT 999,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS universities_priority_idx ON universities(is_enabled, is_featured DESC, priority_rank ASC, name ASC)');

  for (const uni of DEFAULT_UNIVERSITIES) {
    await pool.query(
      `INSERT INTO universities (name, country_code, is_featured, is_enabled, priority_rank)
       VALUES ($1, 'IN', $2, TRUE, $3)
       ON CONFLICT (name) DO NOTHING`,
      [uni.name, Boolean(uni.isFeatured), Number(uni.priorityRank || 999)]
    );
  }

  ensured = true;
}

module.exports = {
  DEFAULT_UNIVERSITIES,
  ensureUniversityCatalogSchema
};
