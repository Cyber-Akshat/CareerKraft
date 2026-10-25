// MySQL 8.0.16+ schema. Keep tables in dependency order for imports and startup.
const TABLES = [
  ['users', `
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE, name TEXT NOT NULL, password TEXT,
    verified TINYINT NOT NULL DEFAULT 0, google_sub VARCHAR(255) UNIQUE,
    created_at BIGINT NOT NULL`],
  ['tokens', `
    hash CHAR(64) NOT NULL PRIMARY KEY, user_id BIGINT UNSIGNED,
    purpose VARCHAR(32) NOT NULL, expires BIGINT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_tokens_expiry (expires)`],
  ['sessions', `
    hash CHAR(64) NOT NULL PRIMARY KEY, user_id BIGINT UNSIGNED,
    expires BIGINT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_sessions_expiry (expires)`],
  ['session_activity', `
    hash CHAR(64) NOT NULL PRIMARY KEY, created_at BIGINT NOT NULL, last_seen_at BIGINT NOT NULL,
    FOREIGN KEY (hash) REFERENCES sessions(hash) ON DELETE CASCADE`],
  ['oauth_states', `hash CHAR(64) NOT NULL PRIMARY KEY, expires BIGINT NOT NULL`],
  ['profiles', `
    user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, display_name TEXT NOT NULL DEFAULT (''),
    selected_career TEXT, onboarding_completed TINYINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`],
  ['career_assessments', `
    user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, interests LONGTEXT NOT NULL,
    subjects LONGTEXT NOT NULL, strengths LONGTEXT NOT NULL, work_style LONGTEXT NOT NULL,
    matches LONGTEXT NOT NULL, updated_at BIGINT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`],
  ['early_access', `
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE, created_at BIGINT NOT NULL`],
  ['career_matches', `
    user_id BIGINT UNSIGNED NOT NULL, \`rank\` INT NOT NULL, career_id VARCHAR(191) NOT NULL,
    title TEXT NOT NULL, category TEXT NOT NULL, score DOUBLE NOT NULL, reasons LONGTEXT NOT NULL,
    PRIMARY KEY (user_id, \`rank\`),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`],
  ['selected_career', `
    user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, career_id VARCHAR(191) NOT NULL,
    title TEXT NOT NULL, updated_at BIGINT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`],
  ['roadmaps', `
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED,
    career_id VARCHAR(191) NOT NULL, career_title TEXT NOT NULL, status VARCHAR(32) NOT NULL,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL DEFAULT 0,
    current_level VARCHAR(32) NOT NULL DEFAULT 'beginner',
    UNIQUE (user_id, career_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`],
  ['roadmap_steps', `
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, roadmap_id BIGINT UNSIGNED NOT NULL,
    phase_number INT NOT NULL, phase_title TEXT NOT NULL, step_number INT NOT NULL,
    title TEXT NOT NULL, description LONGTEXT NOT NULL DEFAULT (''), estimated_minutes INT,
    activity_type VARCHAR(64) NOT NULL DEFAULT 'learning', evidence_required TINYINT NOT NULL DEFAULT 1,
    level VARCHAR(32) NOT NULL DEFAULT 'beginner', level_step_number INT,
    UNIQUE (roadmap_id, step_number),
    FOREIGN KEY (roadmap_id) REFERENCES roadmaps(id) ON DELETE CASCADE`],
  ['roadmap_progress', `
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
    roadmap_step_id BIGINT UNSIGNED NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'not_started',
    started_at BIGINT, completed_at BIGINT, UNIQUE (user_id, roadmap_step_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (roadmap_step_id) REFERENCES roadmap_steps(id) ON DELETE CASCADE`],
  ['lumia_conversations', `
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
    title TEXT NOT NULL DEFAULT ('New conversation'), created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_lumia_conversations_user (user_id, updated_at)`],
  ['lumia_messages', `
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, conversation_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL, role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant')),
    content LONGTEXT NOT NULL, created_at BIGINT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES lumia_conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_lumia_messages_conversation (conversation_id, created_at)`],
  ['evidence_submissions', `
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
    roadmap_step_id BIGINT UNSIGNED NOT NULL, submission_type VARCHAR(32) NOT NULL DEFAULT 'text',
    text_content LONGTEXT, link_url TEXT, file_name TEXT, file_storage_key CHAR(64),
    status VARCHAR(32) NOT NULL DEFAULT 'submitted', feedback LONGTEXT,
    submitted_at BIGINT NOT NULL, reviewed_at BIGINT, file_mime_type VARCHAR(255), file_size BIGINT,
    UNIQUE (user_id, roadmap_step_id), INDEX idx_evidence_storage_key (file_storage_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (roadmap_step_id) REFERENCES roadmap_steps(id) ON DELETE CASCADE`],
  ['user_skills', `
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
    skill_name TEXT NOT NULL, normalized_name VARCHAR(255) NOT NULL, verified_count INT NOT NULL DEFAULT 1,
    first_verified_at BIGINT NOT NULL, last_verified_at BIGINT NOT NULL,
    UNIQUE (user_id, normalized_name),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`],
  ['skill_verifications', `
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
    user_skill_id BIGINT UNSIGNED NOT NULL, evidence_submission_id BIGINT UNSIGNED NOT NULL,
    roadmap_step_id BIGINT UNSIGNED NOT NULL, created_at BIGINT NOT NULL,
    UNIQUE (user_skill_id, evidence_submission_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user_skill_id) REFERENCES user_skills(id) ON DELETE CASCADE,
    FOREIGN KEY (evidence_submission_id) REFERENCES evidence_submissions(id) ON DELETE CASCADE,
    FOREIGN KEY (roadmap_step_id) REFERENCES roadmap_steps(id) ON DELETE CASCADE`],
  ['roadmap_step_content', `
    roadmap_step_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, introduction LONGTEXT NOT NULL,
    learning_objectives LONGTEXT NOT NULL, key_concepts LONGTEXT NOT NULL, example_content LONGTEXT,
    task_content LONGTEXT NOT NULL, evidence_instructions LONGTEXT, verification_criteria LONGTEXT NOT NULL,
    target_skills LONGTEXT NOT NULL, reflection_question LONGTEXT, generated_at BIGINT NOT NULL,
    resources LONGTEXT NOT NULL DEFAULT ('[]'),
    FOREIGN KEY (roadmap_step_id) REFERENCES roadmap_steps(id) ON DELETE CASCADE`],
  ['roadmap_level_notifications', `
    roadmap_id BIGINT UNSIGNED NOT NULL, level VARCHAR(32) NOT NULL, progression LONGTEXT NOT NULL,
    PRIMARY KEY (roadmap_id, level),
    FOREIGN KEY (roadmap_id) REFERENCES roadmaps(id) ON DELETE CASCADE`],
  ['reviewers', `
    user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, created_at BIGINT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`],
  ['account_settings', `
    user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, theme VARCHAR(16) CHECK (theme IN ('light','dark')),
    reduced_motion TINYINT NOT NULL DEFAULT 0, avatar_key CHAR(64), avatar_version VARCHAR(64),
    updated_at BIGINT NOT NULL, avatar_character VARCHAR(255),
    dyslexia_font TINYINT NOT NULL DEFAULT 0 CHECK (dyslexia_font IN (0,1)),
    font_size VARCHAR(16) NOT NULL DEFAULT 'default' CHECK (font_size IN ('small','default','large')),
    contrast VARCHAR(16) NOT NULL DEFAULT 'default' CHECK (contrast IN ('default','high')),
    saturation VARCHAR(16) NOT NULL DEFAULT 'default' CHECK (saturation IN ('default','low','high','grayscale')),
    cursor_size VARCHAR(16) NOT NULL DEFAULT 'default' CHECK (cursor_size IN ('small','default','large')),
    preferences_saved TINYINT NOT NULL DEFAULT 0 CHECK (preferences_saved IN (0,1)),
    dashboard_tour_seen TINYINT NOT NULL DEFAULT 0 CHECK (dashboard_tour_seen IN (0,1)),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`],
  ['settings_email_changes', `
    user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, hash CHAR(64) NOT NULL UNIQUE,
    old_email VARCHAR(254) NOT NULL, new_email VARCHAR(254) NOT NULL, expires BIGINT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`],
  ['settings_session_verifications', `
    session_hash CHAR(64) NOT NULL PRIMARY KEY, verified_at BIGINT NOT NULL,
    FOREIGN KEY (session_hash) REFERENCES sessions(hash) ON DELETE CASCADE`],
  ['settings_oauth_states', `
    hash CHAR(64) NOT NULL PRIMARY KEY, intent VARCHAR(32) NOT NULL, nonce VARCHAR(255) NOT NULL,
    user_id BIGINT UNSIGNED, session_hash CHAR(64), expires BIGINT NOT NULL, next_path TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (session_hash) REFERENCES sessions(hash) ON DELETE CASCADE`],
  ['auth_rate_limits', `
    \`key\` CHAR(64) NOT NULL PRIMARY KEY, count INT NOT NULL, reset_at BIGINT NOT NULL,
    INDEX idx_auth_rate_limits_reset (reset_at)`]
];

const MYSQL_TABLES = Object.freeze(TABLES.map(([name]) => name));
const MYSQL_INTERNAL_TABLES = Object.freeze(['auth_rate_limit_locks']);
const MYSQL_SCHEMA = Object.freeze(TABLES.map(([name, columns]) =>
  `CREATE TABLE IF NOT EXISTS \`${name}\` (${columns}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`)
  .concat('CREATE TABLE IF NOT EXISTS auth_rate_limit_locks (id TINYINT NOT NULL PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin'));

module.exports = { MYSQL_TABLES, MYSQL_INTERNAL_TABLES, MYSQL_SCHEMA };
