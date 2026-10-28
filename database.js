const { AsyncLocalStorage } = require('node:async_hooks');
const { readFileSync } = require('node:fs');
const { MYSQL_SCHEMA, MYSQL_TABLES, MYSQL_INTERNAL_TABLES } = require('./database-schema');

const PRIMARY_KEYS = Object.freeze({
  users: 'id', tokens: 'hash', sessions: 'hash', session_activity: 'hash', oauth_states: 'hash',
  profiles: 'user_id', career_assessments: 'user_id', early_access: 'id', career_matches: 'user_id',
  selected_career: 'user_id', roadmaps: 'id', roadmap_steps: 'id', roadmap_progress: 'id',
  lumia_conversations: 'id', lumia_messages: 'id', cv_scans: 'id', evidence_submissions: 'id', user_skills: 'id',
  skill_verifications: 'id', roadmap_step_content: 'roadmap_step_id',
  roadmap_level_notifications: 'roadmap_id', reviewers: 'user_id', account_settings: 'user_id',
  settings_email_changes: 'user_id', settings_session_verifications: 'session_hash',
  settings_oauth_states: 'hash', auth_rate_limits: 'key'
});

// Only translate the handful of SQLite insert forms used by the application.
// Quoted values and identifiers remain untouched when escaping MySQL keywords.
function translateSQL(sql) {
  let translated = sql;
  const ignore = /^\s*INSERT\s+OR\s+IGNORE\s+INTO\s+([a-z_][a-z0-9_]*)\b/i.exec(translated);
  if (ignore) {
    const primaryKey = PRIMARY_KEYS[ignore[1].toLowerCase()];
    if (!primaryKey) throw new Error('INSERT OR IGNORE requires a known application table.');
    translated = translated.replace(/\bINSERT\s+OR\s+IGNORE\b/i, 'INSERT')
      .replace(/;\s*$/, '') + ` ON DUPLICATE KEY UPDATE \`${primaryKey}\`=\`${primaryKey}\``;
  }
  translated = translated.replace(/^\s*INSERT\s+OR\s+REPLACE\b/i, 'REPLACE');
  return translated.split(/('(?:''|\\.|[^'\\])*'|"(?:""|\\.|[^"\\])*"|`(?:``|[^`])*`|--[^\r\n]*|\/\*[\s\S]*?\*\/)/g)
    .map((segment, index) => {
      if (index % 2) return segment;
      const code = segment
        .replace(/\bON\s+CONFLICT\s*\([^)]*\)\s*DO\s+UPDATE\s+SET\b/gi, 'ON DUPLICATE KEY UPDATE')
        .replace(/\bexcluded\.([a-z_][a-z0-9_]*)\b/gi, 'VALUES($1)');
      return code.replace(/\b(?:rank|key)\b/gi, (word, offset) =>
        /^key$/i.test(word) && /\b(?:DUPLICATE|PRIMARY|FOREIGN)\s*$/i.test(code.slice(0, offset))
          ? word : `\`${word}\``);
    }).join('');
}

function mysqlConfig(options) {
  const config = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || 'careerkraft',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4_bin',
    supportBigNumbers: true,
    bigNumberStrings: false,
    // A duplicate no-op insert must report changes=0, as SQLite did.
    flags: '-FOUND_ROWS',
    multipleStatements: false
  };
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    if (url.protocol !== 'mysql:') throw new Error('DATABASE_URL must use the mysql:// protocol.');
    Object.assign(config, {
      host: url.hostname, port: Number(url.port || 3306),
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1))
    });
  }
  if (process.env.DB_SSL_CA || /^(?:1|true|required)$/i.test(process.env.DB_SSL || '')) {
    config.ssl = { rejectUnauthorized: true, verifyIdentity: true };
    if (process.env.DB_SSL_CA) {
      const certificate = process.env.DB_SSL_CA.replace(/\\n/g, '\n');
      config.ssl.ca = certificate.includes('-----BEGIN CERTIFICATE-----')
        ? certificate : readFileSync(process.env.DB_SSL_CA, 'utf8');
    }
  }
  Object.assign(config, options.mysql || {});
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('DB_PORT must be a port between 1 and 65535.');
  }
  if (!config.database) throw new Error('A MySQL database name is required.');
  return config;
}

function createDatabase(options = {}) {
  // Existing tests and the import tool can explicitly open a legacy SQLite file.
  // Normal application startup always uses MySQL.
  if (typeof options.database === 'string') {
    const { DatabaseSync } = require('node:sqlite');
    const database = new DatabaseSync(options.database);
    database.dialect = 'sqlite';
    database.ready = Promise.resolve();
    database.scope = callback => callback();
    return database;
  }

  const pool = options.mysqlPool || require('mysql2/promise').createPool(mysqlConfig(options));
  const contexts = new AsyncLocalStorage();
  const activeConnections = new Set();
  let closed = false;
  let closePromise;

  async function finish(context, command) {
    const connection = context?.connection;
    if (!connection) {
      if (command === 'COMMIT') throw new Error('No MySQL transaction is active.');
      return;
    }
    context.connection = null;
    activeConnections.delete(connection);
    try {
      await connection.query(command);
    } catch (error) {
      // A failed transaction command leaves the connection state uncertain.
      connection.destroy();
      throw error;
    } finally {
      connection.release();
    }
  }

  const ready = (async () => {
    try {
      for (const statement of MYSQL_SCHEMA) await pool.query(statement);
      await pool.query('INSERT INTO auth_rate_limit_locks (id) VALUES (1) ON DUPLICATE KEY UPDATE id=id');
    } catch (error) {
      closed = true;
      try { await pool.end(); } catch {}
      throw error;
    }
  })();

  async function query(sql, values = []) {
    await ready;
    if (closed) throw new Error('The database is closed.');
    const executor = contexts.getStore()?.connection || pool;
    // query() binds values safely and supports integer LIMIT placeholders too.
    const [rows] = await executor.query(translateSQL(sql), values);
    return rows;
  }

  const database = {
    dialect: 'mysql', ready,
    get isTransaction() { return Boolean(contexts.getStore()?.connection); },
    scope(callback) {
      const context = { connection: null };
      return contexts.run(context, () => {
        const result = callback();
        if (!result || typeof result.then !== 'function') return result;
        return Promise.resolve(result).then(async value => {
          await finish(context, 'ROLLBACK');
          return value;
        }, async error => {
          try { await finish(context, 'ROLLBACK'); } catch {}
          throw error;
        });
      });
    },
    prepare(sql) {
      return {
        async all(...values) { return query(sql, values); },
        async get(...values) { return (await query(sql, values))[0]; },
        async run(...values) {
          const result = await query(sql, values);
          return { changes: result.affectedRows, lastInsertRowid: result.insertId };
        }
      };
    },
    async exec(sql) {
      const command = sql.trim().replace(/;\s*$/, '').toUpperCase();
      await ready;
      if (closed) throw new Error('The database is closed.');
      const context = contexts.getStore();
      if (command === 'BEGIN' || command === 'BEGIN IMMEDIATE' || command === 'START TRANSACTION') {
        if (!context) throw new Error('MySQL transactions must run inside db.scope().');
        if (context.connection) throw new Error('A MySQL transaction is already active in this scope.');
        const connection = await pool.getConnection();
        try {
          await connection.query('START TRANSACTION');
          context.connection = connection;
          activeConnections.add(connection);
        } catch (error) {
          connection.release();
          throw error;
        }
        return;
      }
      if (command === 'COMMIT' || command === 'ROLLBACK') return finish(context, command);
      await query(sql);
    },
    close() {
      if (!closePromise) closePromise = (async () => {
        try { await ready; } catch { return; }
        closed = true;
        for (const connection of activeConnections) {
          try { await connection.query('ROLLBACK'); } catch { connection.destroy(); }
          finally { connection.release(); }
        }
        activeConnections.clear();
        await pool.end();
      })();
      return closePromise;
    }
  };
  return database;
}

module.exports = { createDatabase, MYSQL_SCHEMA, MYSQL_TABLES, MYSQL_INTERNAL_TABLES, translateSQL };
