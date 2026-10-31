const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { TABLES, migrateSqliteToMysql, parseArguments } = require('../scripts/migrate-sqlite-to-mysql');

function sqliteFixture(t, amend) {
  const directory = mkdtempSync(path.join(tmpdir(), 'careerkraft-mysql-migration-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  });
  const filename = path.join(directory, 'accounts.sqlite');
  const db = new DatabaseSync(filename);
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT NOT NULL,password TEXT,created_at INTEGER NOT NULL);
    INSERT INTO users VALUES(0,'zero@example.test',NULL,100);
    INSERT INTO users VALUES(7,'student@example.test','stored-password-hash',9007199254740993);
    CREATE TABLE roadmaps(id INTEGER PRIMARY KEY,user_id INTEGER,career_id TEXT,career_title TEXT,status TEXT,created_at INTEGER);
    INSERT INTO roadmaps VALUES(4,7,'teacher','Teacher','active',123);
    CREATE TABLE account_settings(user_id INTEGER PRIMARY KEY,theme TEXT,reduced_motion INTEGER,updated_at INTEGER);
    INSERT INTO account_settings VALUES(7,'dark',0,555);
  `);
  try { if (amend) amend(db); }
  finally { db.close(); }
  return filename;
}

function mysqlDestination({ nonempty = false, mismatch = false, requiredColumn = false } = {}) {
  const rows = Object.fromEntries(TABLES.map(table => [table, []]));
  rows.auth_rate_limit_locks = [{ id: 1 }];
  if (nonempty) rows.users.push({ id: 99 });
  const metadata = {
    users: ['id', 'email', 'password', 'created_at'],
    roadmaps: ['id', 'user_id', 'career_id', 'career_title', 'status', 'created_at', 'updated_at'],
    cv_scans: ['id', 'user_id', 'file_name', 'extracted_text', 'overall_score', 'structure_score',
      'clarity_score', 'evidence_score', 'relevance_score', 'analysis_json', 'created_at'],
    cv_builds: ['id', 'user_id', 'cv_scan_id', 'target_career', 'original_cv_text', 'current_cv_json',
      'status', 'total_suggestions', 'accepted_count', 'rejected_count', 'edited_count', 'created_at', 'updated_at'],
    cv_build_suggestions: ['id', 'cv_build_id', 'section_name', 'suggestion_type', 'original_text',
      'suggested_text', 'reason', 'evidence_json', 'status', 'final_text', 'sort_order', 'created_at', 'updated_at'],
    account_settings: ['user_id', 'theme', 'reduced_motion', 'updated_at', 'preferences_saved']
  };
  let snapshot;
  const target = {
    dialect: 'mysql', ready: Promise.resolve(), rows, rolledBack: false, closed: false,
    scope: async callback => callback(),
    async close() { this.closed = true; },
    async exec(sql) {
      if (sql === 'BEGIN') snapshot = structuredClone(rows);
      if (sql === 'ROLLBACK') {
        this.rolledBack = true;
        for (const table of Object.keys(rows)) rows[table] = snapshot[table];
      }
    },
    prepare(sql) {
      return {
        async all() {
          if (sql.includes('information_schema.TABLES')) {
            return Object.keys(rows).map(table_name => ({ table_name, engine: 'InnoDB' }));
          }
          if (sql.includes('information_schema.COLUMNS')) {
            const columns = Object.entries(metadata).flatMap(([table_name, names]) => names.map(column_name => ({
              table_name, column_name, is_nullable: 'YES', column_default: null, extra: ''
            })));
            if (requiredColumn) columns.push({ table_name: 'users', column_name: 'required', is_nullable: 'NO', column_default: null, extra: '' });
            return columns;
          }
          throw new Error('Unexpected metadata query.');
        },
        async get() {
          if (sql === 'SELECT @@SESSION.sql_mode AS sql_mode') return { sql_mode: 'NO_ENGINE_SUBSTITUTION' };
          const table = sql.match(/FROM `([^`]+)`/)[1];
          return { total: rows[table].length + (mismatch && table === 'users' && rows.users.length ? 1 : 0) };
        },
        async run(...values) {
          if (sql === 'SET SESSION sql_mode = ?') { target.sqlMode = values[0]; return; }
          const table = sql.match(/INSERT INTO `([^`]+)`/)[1];
          const columns = [...sql.matchAll(/`([^`]+)`/g)].slice(1).map(match => match[1]);
          rows[table].push(Object.fromEntries(columns.map((name, index) => [name, values[index]])));
        }
      };
    }
  };
  return target;
}

test('migration preserves SQLite values and IDs, fills legacy columns and retains the internal MySQL lock', async t => {
  const sourcePath = sqliteFixture(t, db => db.exec('ALTER TABLE users ADD COLUMN retired_column TEXT'));
  const before = readFileSync(sourcePath);
  const target = mysqlDestination();
  const result = await migrateSqliteToMysql({ sourcePath, createTarget: () => target });
  assert.equal(result.totalRows, 4);
  assert.deepEqual(target.rows.users, [
    { id: 0, email: 'zero@example.test', password: null, created_at: 100 },
    { id: 7, email: 'student@example.test', password: 'stored-password-hash', created_at: '9007199254740993' }
  ]);
  assert.equal(target.rows.roadmaps[0].updated_at, 123);
  assert.equal(target.rows.account_settings[0].preferences_saved, 1);
  assert.equal(result.counts.tokens, 0);
  assert.deepEqual(target.rows.auth_rate_limit_locks, [{ id: 1 }]);
  assert.match(target.sqlMode, /STRICT_ALL_TABLES/);
  assert.match(target.sqlMode, /NO_AUTO_VALUE_ON_ZERO/);
  assert.ok(target.closed);
  assert.equal(target.rolledBack, false);
  assert.deepEqual(readFileSync(sourcePath), before);
});

test('migration refuses an occupied destination without replacing existing records', async t => {
  const target = mysqlDestination({ nonempty: true });
  await assert.rejects(migrateSqliteToMysql({ sourcePath: sqliteFixture(t), createTarget: () => target }), { code: 'target_not_empty' });
  assert.ok(target.rolledBack);
  assert.deepEqual(target.rows.users, [{ id: 99 }]);
  assert.ok(target.closed);
});

test('migration preserves CV scan IDs, scores, extracted text and analysis JSON', async t => {
  const analysis = JSON.stringify({ strengths: ['Clear education section'], rewrittenBullets: [] });
  const sourcePath = sqliteFixture(t, db => {
    db.exec(`CREATE TABLE cv_scans (
      id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), file_name TEXT,
      extracted_text TEXT, overall_score INTEGER, structure_score INTEGER, clarity_score INTEGER,
      evidence_score INTEGER, relevance_score INTEGER, analysis_json TEXT, created_at INTEGER
    )`);
    db.prepare('INSERT INTO cv_scans VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(12, 7, null, 'Education\nComputer Science', 78, 85, 80, 65, 82, analysis, 1792929600123);
  });
  const before = readFileSync(sourcePath);
  const target = mysqlDestination();
  const result = await migrateSqliteToMysql({ sourcePath, createTarget: () => target });
  assert.equal(result.counts.cv_scans, 1);
  assert.deepEqual(target.rows.cv_scans, [{
    id: 12, user_id: 7, file_name: null, extracted_text: 'Education\nComputer Science',
    overall_score: 78, structure_score: 85, clarity_score: 80, evidence_score: 65,
    relevance_score: 82, analysis_json: analysis, created_at: 1792929600123
  }]);
  assert.deepEqual(readFileSync(sourcePath), before);
});

test('migration preserves CV builds and their linked suggestions without changing the source', async t => {
  const original = 'Built a Flask bot detector website.';
  const currentCv = JSON.stringify({ sections: [{ name: 'Projects', text: original }] });
  const evidence = JSON.stringify({ skills: ['Flask'], source: 'CV' });
  const sourcePath = sqliteFixture(t, db => {
    db.exec(`
      CREATE TABLE cv_scans (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id),
        extracted_text TEXT, analysis_json TEXT, created_at INTEGER);
      CREATE TABLE cv_builds (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id),
        cv_scan_id INTEGER REFERENCES cv_scans(id), target_career TEXT, original_cv_text TEXT,
        current_cv_json TEXT, status TEXT, total_suggestions INTEGER, accepted_count INTEGER,
        rejected_count INTEGER, edited_count INTEGER, created_at INTEGER, updated_at INTEGER);
      CREATE TABLE cv_build_suggestions (id INTEGER PRIMARY KEY, cv_build_id INTEGER REFERENCES cv_builds(id),
        section_name TEXT, suggestion_type TEXT, original_text TEXT, suggested_text TEXT, reason TEXT,
        evidence_json TEXT, status TEXT, final_text TEXT, sort_order INTEGER, created_at INTEGER, updated_at INTEGER);
    `);
    db.prepare('INSERT INTO cv_scans VALUES (?,?,?,?,?)').run(12, 7, original, '{}', 1792929600123);
    db.prepare('INSERT INTO cv_builds VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(17, 7, 12, 'Cyber Security Analyst', original, currentCv, 'reviewing', 1, 0, 0, 0, 1792929600123, 1792929600456);
    db.prepare('INSERT INTO cv_build_suggestions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(23, 17, 'Projects', 'clarify_project_description', original, original,
        'Keep the project description factual.', evidence, 'pending', null, 0, 1792929600123, 1792929600456);
  });
  const before = readFileSync(sourcePath);
  const target = mysqlDestination();
  const result = await migrateSqliteToMysql({ sourcePath, createTarget: () => target });
  assert.equal(result.counts.cv_builds, 1);
  assert.equal(result.counts.cv_build_suggestions, 1);
  assert.deepEqual(target.rows.cv_builds, [{
    id: 17, user_id: 7, cv_scan_id: 12, target_career: 'Cyber Security Analyst',
    original_cv_text: original, current_cv_json: currentCv, status: 'reviewing',
    total_suggestions: 1, accepted_count: 0, rejected_count: 0, edited_count: 0,
    created_at: 1792929600123, updated_at: 1792929600456
  }]);
  assert.deepEqual(target.rows.cv_build_suggestions, [{
    id: 23, cv_build_id: 17, section_name: 'Projects', suggestion_type: 'clarify_project_description',
    original_text: original, suggested_text: original, reason: 'Keep the project description factual.',
    evidence_json: evidence, status: 'pending', final_text: null, sort_order: 0,
    created_at: 1792929600123, updated_at: 1792929600456
  }]);
  assert.deepEqual(readFileSync(sourcePath), before);
});

test('migration rolls back all copied records for unsupported populated source columns', async t => {
  const sourcePath = sqliteFixture(t, db => db.exec("ALTER TABLE roadmaps ADD COLUMN retired_column TEXT; UPDATE roadmaps SET retired_column='keep this data'"));
  const target = mysqlDestination();
  await assert.rejects(migrateSqliteToMysql({ sourcePath, createTarget: () => target }), { code: 'unsupported_schema' });
  assert.ok(target.rolledBack);
  assert.deepEqual(target.rows.users, []);
  assert.deepEqual(target.rows.auth_rate_limit_locks, [{ id: 1 }]);
});

test('migration rejects missing required columns and mismatched destination counts', async t => {
  const sourcePath = sqliteFixture(t);
  for (const options of [{ requiredColumn: true }, { mismatch: true }]) {
    const target = mysqlDestination(options);
    await assert.rejects(migrateSqliteToMysql({ sourcePath, createTarget: () => target }), {
      code: options.requiredColumn ? 'unsupported_schema' : 'count_mismatch'
    });
    assert.ok(target.rolledBack);
    assert.deepEqual(target.rows.users, []);
  }
});

test('migration rejects unsupported source tables and invalid references before opening MySQL', async t => {
  const sourceFiles = [
    sqliteFixture(t, db => db.exec('CREATE TABLE custom_records(value TEXT)')),
    sqliteFixture(t, db => db.exec("PRAGMA foreign_keys=OFF; CREATE TABLE tokens(hash TEXT,user_id INTEGER REFERENCES users(id)); INSERT INTO tokens VALUES('orphan',999)"))
  ];
  for (const sourcePath of sourceFiles) {
    await assert.rejects(migrateSqliteToMysql({ sourcePath, createTarget() { assert.fail('MySQL must stay unopened.'); } }), {
      code: sourcePath === sourceFiles[0] ? 'unsupported_schema' : 'source_integrity'
    });
  }
});

test('migration CLI supports explicit source files and rejects ambiguous arguments', () => {
  assert.equal(parseArguments(['--help']).help, true);
  assert.equal(parseArguments(['--source', 'legacy.sqlite']).sourcePath, path.resolve('legacy.sqlite'));
  assert.throws(() => parseArguments(['--source']), { code: 'arguments' });
  assert.throws(() => parseArguments(['--clear']), { code: 'arguments' });
});
