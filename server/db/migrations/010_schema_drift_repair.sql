-- Migration 010: Additive Schema Drift Repair for ai_tools_catalog and career_roadmaps
-- Fixes PostgreSQL error 42703 (undefined column drift across ai_tools_catalog and career_roadmaps)

-- 1. Ensure ai_tools_catalog additive columns
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS tool_key VARCHAR(120);
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS title VARCHAR(180);
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS tagline TEXT;
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS icon_name VARCHAR(80) DEFAULT 'fa-wand-magic-sparkles';
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS accent_color VARCHAR(20) DEFAULT '#2563eb';
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS access_type VARCHAR(20) DEFAULT 'free';
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published';
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT TRUE;
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES academic_categories(id);
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES academic_branches(id);
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES academic_semesters(id);
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS college_id INTEGER REFERENCES universities(id);
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES academic_categories(id);
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS year_id INTEGER REFERENCES academic_semesters(id);
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS is_common BOOLEAN DEFAULT TRUE;
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS college_name VARCHAR(255);
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS benefits JSONB DEFAULT '[]'::jsonb;
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS prompt_template TEXT;
ALTER TABLE ai_tools_catalog ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- 2. Synchronize alias values for existing rows
UPDATE ai_tools_catalog SET tool_key = COALESCE(tool_key, 'tool-' || id) WHERE tool_key IS NULL;
UPDATE ai_tools_catalog SET title = COALESCE(title, 'AI Tool') WHERE title IS NULL;
UPDATE ai_tools_catalog SET access_type = COALESCE(access_type, 'free') WHERE access_type IS NULL;

-- 3. Ensure career_roadmaps additive columns
ALTER TABLE career_roadmaps ADD COLUMN IF NOT EXISTS college_id INTEGER REFERENCES universities(id);
ALTER TABLE career_roadmaps ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES academic_categories(id);
ALTER TABLE career_roadmaps ADD COLUMN IF NOT EXISTS year_id INTEGER REFERENCES academic_semesters(id);
ALTER TABLE career_roadmaps ADD COLUMN IF NOT EXISTS is_common BOOLEAN DEFAULT TRUE;
ALTER TABLE career_roadmaps ADD COLUMN IF NOT EXISTS college_name VARCHAR(255);
