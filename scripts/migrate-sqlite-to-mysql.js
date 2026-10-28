const path = require('node:path');
const { statSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

// Keep the dependency order explicit. Identifiers from a source file are never
// interpolated into SQL unless they match this application-owned table list.
const TABLES = Object.freeze([
  'users', 'tokens', 'sessions', 'session_activity', 'oauth_states', 'profiles',
  'career_assessments', 'early_access', 'career_matches', 'selected_career',
  'roadmaps', 'roadmap_steps', 'roadmap_progress', 'lumia_conversations',
  'lumia_messages', 'cv_scans', 'evidence_submissions', 'user_skills', 'skill_verifications',
  'roadmap_step_content', 'roadmap_level_notifications', 'reviewers',
  'account_settings', 'settings_email_changes', 'settings_session_verifications',
  'settings_oauth_states', 'auth_rate_limits'
]);
const tableNames = new Set(TABLES);
// Schema-owned synchronization rows are initialized by the MySQL adapter.
const INTERNAL_TABLES = new Set(['auth_rate_limit_locks']);
const DEFAULT_SOURCE = path.join(__dirname, '..', 'data', 'accounts.sqlite');

class MigrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
  }
}

function identifier(value) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new MigrationError('unsupported_schema', 'The database contains an unsupported schema.');
  }
  return '`' + value + '`';
}

function portableValue(value) {
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value) : value.toString();
  }
  return value;
}

function legacyValues(table, row, sourceColumns) {
  const values = { ...row };
  if (table === 'roadmaps' && !sourceColumns.has('updated_at')) values.updated_at = row.created_at;
  if (table === 'roadmap_steps' && row.level_step_number == null) values.level_step_number = row.step_number;
  if (table === 'account_settings' && !sourceColumns.has('preferences_saved')) {
    values.preferences_saved = Number(Boolean(row.theme) || Boolean(row.reduced_motion) || Boolean(row.dyslexia_font) ||
      ['font_size', 'contrast', 'saturation', 'cursor_size'].some(column => row[column] && row[column] !== 'default'));
  }
  return values;
}

async function migrateSqliteToMysql({ sourcePath = DEFAULT_SOURCE, createTarget } = {}) {
  let source;
  let target;
  let sourceTransaction = false;
  let targetTransaction = false;
  let completed = false;
  try {
    try {
      if (!statSync(sourcePath).isFile()) throw new Error('Not a file.');
    } catch {
      throw new MigrationError('source_unavailable', 'The SQLite source file was not found or cannot be opened.');
    }
    source = new DatabaseSync(sourcePath, { readOnly: true });
    source.exec('BEGIN');
    sourceTransaction = true;
    const quickCheck = source.prepare('PRAGMA quick_check').get();
    if (!quickCheck || Object.values(quickCheck)[0] !== 'ok') {
      throw new MigrationError('source_integrity', 'The SQLite source failed its integrity check.');
    }
    if (source.prepare('PRAGMA foreign_key_check').get()) {
      throw new MigrationError('source_integrity', 'The SQLite source has invalid foreign-key references.');
    }
    const sourceTables = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'").all();
    if (sourceTables.some(({ name }) => !tableNames.has(name))) {
      throw new MigrationError('unsupported_schema', 'The SQLite source contains unsupported tables.');
    }
    const availableTables = new Set(sourceTables.map(({ name }) => name));
    if (!availableTables.has('users')) {
      throw new MigrationError('unsupported_schema', 'The SQLite source is missing the CareerKraft users table.');
    }

    target = (createTarget || require('../database').createDatabase)();
    if (target.dialect !== 'mysql') {
      throw new MigrationError('target_configuration', 'Configure a MySQL destination before migrating.');
    }
    await target.ready;
    const targetTables = await target.prepare(`SELECT TABLE_NAME AS table_name, ENGINE AS engine
      FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`).all();
    const targetTableNames = new Set(targetTables.map(row => row.table_name));
    if (TABLES.some(table => !targetTableNames.has(table)) ||
        targetTables.some(row => (!tableNames.has(row.table_name) && !INTERNAL_TABLES.has(row.table_name)) ||
          row.engine?.toLowerCase() !== 'innodb')) {
      throw new MigrationError('unsupported_schema', 'The MySQL destination must contain only CareerKraft InnoDB tables.');
    }
    const metadata = await target.prepare(`SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
      IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default, EXTRA AS extra
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, ORDINAL_POSITION`).all();
    const targetColumns = new Map(TABLES.map(table => [table, metadata.filter(row => row.table_name === table)]));
    const counts = {};

    await target.scope(async () => {
      await target.exec('BEGIN');
      targetTransaction = true;
      try {
        const mode = await target.prepare('SELECT @@SESSION.sql_mode AS sql_mode').get();
        const modes = new Set(String(mode.sql_mode || '').split(',').filter(Boolean));
        // Reject silent truncation and retain SQLite primary keys equal to zero.
        modes.add('STRICT_ALL_TABLES');
        modes.add('NO_AUTO_VALUE_ON_ZERO');
        await target.prepare('SET SESSION sql_mode = ?').run([...modes].join(','));
        for (const table of TABLES) {
          const row = await target.prepare(`SELECT COUNT(*) AS total FROM ${identifier(table)}`).get();
          if (Number(row.total) !== 0) {
            throw new MigrationError('target_not_empty', 'The MySQL destination contains data. Migration requires an empty destination.');
          }
        }
        for (const table of TABLES) {
          counts[table] = 0;
          if (!availableTables.has(table)) continue;
          const sourceColumns = new Set(source.prepare(`PRAGMA table_info(${identifier(table)})`).all().map(column => column.name));
          const columns = targetColumns.get(table);
          const acceptedColumns = new Set(columns.map(column => column.column_name));
          const rows = source.prepare(`SELECT * FROM ${identifier(table)}`);
          rows.setReadBigInts(true);
          for (const row of rows.iterate()) {
            if (Object.keys(row).some(column => !acceptedColumns.has(column) && row[column] !== null)) {
              throw new MigrationError('unsupported_schema', `The SQLite ${table} table has data in unsupported columns.`);
            }
            const values = legacyValues(table, row, sourceColumns);
            const included = columns.filter(column => Object.hasOwn(values, column.column_name));
            if (!included.length || columns.some(column => !Object.hasOwn(values, column.column_name) &&
                column.is_nullable === 'NO' && column.column_default === null && !/auto_increment|GENERATED/i.test(column.extra || ''))) {
              throw new MigrationError('unsupported_schema', `The SQLite ${table} table is missing required columns.`);
            }
            const sql = `INSERT INTO ${identifier(table)} (${included.map(column => identifier(column.column_name)).join(',')})
              VALUES (${included.map(() => '?').join(',')})`;
            await target.prepare(sql).run(...included.map(column => portableValue(values[column.column_name])));
            counts[table]++;
          }
          const sourceCount = source.prepare(`SELECT COUNT(*) AS total FROM ${identifier(table)}`).get().total;
          if (Number(sourceCount) !== counts[table]) {
            throw new MigrationError('count_mismatch', 'Source row counts changed during migration.');
          }
        }
        for (const table of TABLES) {
          const row = await target.prepare(`SELECT COUNT(*) AS total FROM ${identifier(table)}`).get();
          if (Number(row.total) !== counts[table]) {
            throw new MigrationError('count_mismatch', 'Destination row counts did not match the SQLite source.');
          }
        }
        await target.exec('COMMIT');
        targetTransaction = false;
      } catch (error) {
        if (targetTransaction) {
          await target.exec('ROLLBACK');
          targetTransaction = false;
        }
        throw error;
      }
    });
    source.exec('ROLLBACK');
    sourceTransaction = false;
    completed = true;
    return { counts, totalRows: Object.values(counts).reduce((sum, count) => sum + count, 0) };
  } finally {
    if (sourceTransaction) { try { source.exec('ROLLBACK'); } catch {} }
    if (source) source.close();
    if (target) {
      try { await target.close(); }
      catch (error) { if (!completed) throw error; }
    }
  }
}

function parseArguments(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  if (!args.length) return { sourcePath: DEFAULT_SOURCE };
  if (args.length === 2 && args[0] === '--source' && args[1] && !args[1].startsWith('-')) {
    return { sourcePath: path.resolve(args[1]) };
  }
  throw new MigrationError('arguments', 'Usage: npm run db:migrate:mysql -- [--source path/to/accounts.sqlite]');
}

async function runCli(args = process.argv.slice(2)) {
  try {
    const options = parseArguments(args);
    if (options.help) {
      console.log('Usage: npm run db:migrate:mysql -- [--source path/to/accounts.sqlite]');
      console.log('Stop CareerKraft first. The source is read-only; the MySQL destination must be empty.');
      return;
    }
    const result = await migrateSqliteToMysql(options);
    console.log(`Migration complete: ${result.totalRows} rows copied across ${TABLES.length} tables. SQLite was left unchanged.`);
  } catch (error) {
    // Driver errors can contain SQL values, account details, or credentials.
    console.error(error instanceof MigrationError ? error.message : 'Migration failed. Check MySQL connectivity, schema compatibility and database permissions. No source data was changed.');
    process.exitCode = 1;
  }
}

if (require.main === module) runCli();
module.exports = { TABLES, MigrationError, migrateSqliteToMysql, parseArguments, runCli };
