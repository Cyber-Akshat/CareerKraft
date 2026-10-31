const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createDatabase, MYSQL_SCHEMA, MYSQL_TABLES, translateSQL } = require('../database');

function fakePool({ failSchema = false } = {}) {
  const calls = [];
  let nextConnection = 0;
  let endCount = 0;
  const pool = {
    calls,
    get endCount() { return endCount; },
    async query(sql, values) {
      calls.push({ executor: 'pool', sql, values });
      if (failSchema && sql.startsWith('CREATE TABLE')) throw new Error('Schema unavailable');
      if (sql.startsWith('SELECT')) return [[{ count: 2, timestamp: 1792929600123 }]];
      return [{ affectedRows: 1, insertId: 42 }];
    },
    async getConnection() {
      const executor = ++nextConnection;
      return {
        async query(sql, values) {
          calls.push({ executor, sql, values });
          if (sql === 'FAIL') throw new Error('Query failed');
          if (sql.startsWith('SELECT')) return [[{ executor }]];
          return [{ affectedRows: 1, insertId: 42 }];
        },
        release() { calls.push({ executor, sql: 'RELEASE' }); },
        destroy() { calls.push({ executor, sql: 'DESTROY' }); }
      };
    },
    async end() { endCount++; }
  };
  return pool;
}

function capturePoolConfig(t, environment = {}) {
  const variables = {
    DATABASE_URL: undefined, DB_HOST: 'mysql.test', DB_PORT: '3306',
    DB_NAME: 'test_database', DB_USER: 'test_user', DB_PASSWORD: 'test_password',
    DB_SSL: undefined, DB_SSL_CA: undefined, ...environment
  };
  const previous = Object.fromEntries(Object.keys(variables).map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const [key, value] of Object.entries(variables)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  let config;
  t.mock.method(require('mysql2/promise'), 'createPool', options => {
    config = options;
    return fakePool();
  });
  const db = createDatabase();
  t.after(() => db.close());
  return { db, config };
}

test('MySQL accepts inline PEM with escaped newlines and verifies the server identity', async t => {
  const certificate = '-----BEGIN CERTIFICATE-----\nTEST CERTIFICATE\n-----END CERTIFICATE-----';
  const { db, config } = capturePoolConfig(t, {
    DB_SSL: 'true', DB_SSL_CA: certificate.replace(/\n/g, '\\n')
  });
  await db.ready;
  assert.deepEqual(config.ssl, { rejectUnauthorized: true, verifyIdentity: true, ca: certificate });
});

test('MySQL still loads the CA certificate from a file path', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'careerkraft-mysql-ca-'));
  const certificatePath = path.join(directory, 'ca.pem');
  const certificate = '-----BEGIN CERTIFICATE-----\nTEST FILE CERTIFICATE\n-----END CERTIFICATE-----\n';
  writeFileSync(certificatePath, certificate);
  t.after(() => { unlinkSync(certificatePath); rmdirSync(directory); });
  const { db, config } = capturePoolConfig(t, { DB_SSL: 'true', DB_SSL_CA: certificatePath });
  await db.ready;
  assert.deepEqual(config.ssl, { rejectUnauthorized: true, verifyIdentity: true, ca: certificate });
});

test('a supplied CA enables verified MySQL TLS even when DB_SSL is false', async t => {
  const certificate = '-----BEGIN CERTIFICATE-----\nTEST CERTIFICATE\n-----END CERTIFICATE-----';
  const { db, config } = capturePoolConfig(t, { DB_SSL: 'false', DB_SSL_CA: certificate });
  await db.ready;
  assert.deepEqual(config.ssl, { rejectUnauthorized: true, verifyIdentity: true, ca: certificate });
});

test('MySQL TLS without a private CA uses certificate and identity verification', async t => {
  const { db, config } = capturePoolConfig(t, { DB_SSL: 'true' });
  await db.ready;
  assert.deepEqual(config.ssl, { rejectUnauthorized: true, verifyIdentity: true });
});

test('MySQL without TLS settings retains its existing connection options', async t => {
  const { db, config } = capturePoolConfig(t, { DB_SSL: 'false' });
  await db.ready;
  assert.equal(config.host, 'mysql.test');
  assert.equal(config.port, 3306);
  assert.equal(config.database, 'test_database');
  assert.equal(config.user, 'test_user');
  assert.equal(config.password, 'test_password');
  assert.equal(Object.hasOwn(config, 'ssl'), false);
});

test('SQLite insert translation preserves duplicate behavior and SQL literals', () => {
  assert.equal(translateSQL('INSERT OR IGNORE INTO users(email,name) VALUES (?,?);'),
    'INSERT INTO users(email,name) VALUES (?,?) ON DUPLICATE KEY UPDATE `id`=`id`');
  assert.equal(translateSQL('INSERT OR REPLACE INTO roadmap_level_notifications VALUES (?,?,?)'),
    'REPLACE INTO roadmap_level_notifications VALUES (?,?,?)');
  assert.equal(translateSQL(`INSERT INTO profiles(user_id,display_name) VALUES (?,?)
    ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name`),
    `INSERT INTO profiles(user_id,display_name) VALUES (?,?)
    ON DUPLICATE KEY UPDATE display_name=VALUES(display_name)`);
  assert.equal(translateSQL(`SELECT key,rank,'key rank excluded.key',"key",\`rank\` FROM auth_rate_limits WHERE key=?`),
    `SELECT \`key\`,\`rank\`,'key rank excluded.key',"key",\`rank\` FROM auth_rate_limits WHERE \`key\`=?`);
});

test('MySQL creates the explicit schema and preserves statement result values', async () => {
  const pool = fakePool();
  const db = createDatabase({ mysqlPool: pool });
  try {
    await db.ready;
    assert.equal(MYSQL_TABLES.length, 29);
    assert.equal(pool.calls.length, MYSQL_SCHEMA.length + 1);
    assert.match(pool.calls.at(-1).sql, /INSERT INTO auth_rate_limit_locks/);
    assert.ok(MYSQL_SCHEMA.every(sql => sql.includes('ENGINE=InnoDB') && sql.includes('utf8mb4_bin')));
    assert.deepEqual(await db.prepare('SELECT COUNT(*) AS count, ? AS timestamp').get(1792929600123),
      { count: 2, timestamp: 1792929600123 });
    assert.deepEqual(await db.prepare('INSERT INTO users(email,name) VALUES (?,?)').run('a@example.com', 'A'),
      { changes: 1, lastInsertRowid: 42 });
    assert.deepEqual(pool.calls.at(-1).values, ['a@example.com', 'A']);
  } finally { await db.close(); }
  assert.equal(pool.endCount, 1);
});

test('concurrent scopes keep transactions on independent connections', async () => {
  const pool = fakePool();
  const db = createDatabase({ mysqlPool: pool });
  await db.ready;
  pool.calls.length = 0;
  let unblock;
  const firstStarted = new Promise(resolve => { unblock = resolve; });
  let continueFirst;
  const secondStarted = new Promise(resolve => { continueFirst = resolve; });
  try {
    const [first, second] = await Promise.all([
      db.scope(async () => {
        await db.exec('BEGIN IMMEDIATE');
        assert.equal(db.isTransaction, true);
        unblock();
        await secondStarted;
        const row = await db.prepare('SELECT 1').get();
        await db.exec('COMMIT');
        assert.equal(db.isTransaction, false);
        return row.executor;
      }),
      db.scope(async () => {
        await firstStarted;
        await db.exec('BEGIN');
        const row = await db.prepare('SELECT 2').get();
        continueFirst();
        await db.exec('COMMIT');
        return row.executor;
      })
    ]);
    assert.notEqual(first, second);
    assert.equal(pool.calls.filter(call => call.sql === 'COMMIT').length, 2);
    assert.equal(pool.calls.filter(call => call.sql === 'RELEASE').length, 2);
    assert.ok(pool.calls.every(call => call.executor !== 'pool'));
    assert.equal(db.isTransaction, false);
  } finally { await db.close(); }
});

test('a separate nested background scope does not join the caller transaction', async () => {
  const pool = fakePool();
  const db = createDatabase({ mysqlPool: pool });
  await db.ready;
  try {
    await db.scope(async () => {
      await db.exec('BEGIN');
      const outer = await db.prepare('SELECT 1').get();
      await db.scope(async () => {
        assert.equal(db.isTransaction, false);
        await db.exec('BEGIN');
        const inner = await db.prepare('SELECT 2').get();
        assert.notEqual(inner.executor, outer.executor);
        await db.exec('COMMIT');
      });
      assert.equal(db.isTransaction, true);
      await db.exec('COMMIT');
    });
  } finally { await db.close(); }
});

test('failed and unfinished async scopes roll back and release their connections', async () => {
  const pool = fakePool();
  const db = createDatabase({ mysqlPool: pool });
  await db.ready;
  pool.calls.length = 0;
  try {
    await assert.rejects(db.scope(async () => {
      await db.exec('BEGIN');
      await db.prepare('FAIL').run();
    }), /Query failed/);
    assert.deepEqual(pool.calls.map(call => call.sql), ['START TRANSACTION', 'FAIL', 'ROLLBACK', 'RELEASE']);
    pool.calls.length = 0;
    assert.equal(await db.scope(async () => {
      await db.exec('BEGIN');
      return 7;
    }), 7);
    assert.deepEqual(pool.calls.map(call => call.sql), ['START TRANSACTION', 'ROLLBACK', 'RELEASE']);
    await assert.rejects(db.exec('BEGIN'), /inside db.scope/);
  } finally { await db.close(); }
});

test('failed schema initialization closes the pool exactly once', async () => {
  const pool = fakePool({ failSchema: true });
  const db = createDatabase({ mysqlPool: pool });
  await assert.rejects(db.ready, /Schema unavailable/);
  await db.close();
  assert.equal(pool.endCount, 1);
});

test('an explicit legacy SQLite database keeps the existing synchronous API', async () => {
  const db = createDatabase({ database: ':memory:' });
  try {
    await db.ready;
    assert.equal(db.dialect, 'sqlite');
    db.exec('CREATE TABLE example (id INTEGER PRIMARY KEY, value TEXT)');
    const result = db.prepare('INSERT INTO example(value) VALUES (?)').run('saved');
    assert.equal(result.changes, 1);
    assert.equal(db.scope(() => db.prepare('SELECT value FROM example').get().value), 'saved');
  } finally { db.close(); }
});

test('a real MySQL server supports app inserts, upserts, large evidence and cascading deletes',
  { skip: !process.env.MYSQL_TEST_URL }, async () => {
    const url = new URL(process.env.MYSQL_TEST_URL);
    assert.equal(url.protocol, 'mysql:');
    const mysql = require('mysql2/promise');
    const connectionOptions = {
      host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password)
    };
    const marker = `${Date.now()}-${process.pid}`;
    const databaseName = `careerkraft_adapter_${Date.now()}_${process.pid}`;
    const admin = await mysql.createConnection(connectionOptions);
    let db;
    let created = false;
    const email = `adapter-${marker}@example.com`;
    try {
      await admin.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
      created = true;
      db = createDatabase({ mysql: { ...connectionOptions, database: databaseName } });
      await db.ready;
      await db.scope(async () => {
        await db.exec('BEGIN IMMEDIATE');
        const insert = db.prepare('INSERT OR IGNORE INTO users(email,name,created_at) VALUES (?,?,?)');
        const user = await insert.run(email, 'Adapter test 😀', 1792929600123);
        assert.equal(user.changes, 1);
        assert.ok(Number.isSafeInteger(user.lastInsertRowid));
        assert.equal((await insert.run(email, 'Duplicate', 1792929600123)).changes, 0);
        const roadmap = await db.prepare(`INSERT INTO roadmaps
          (user_id,career_id,career_title,status,created_at) VALUES (?,?,?,'active',?)`)
          .run(user.lastInsertRowid, `adapter-${marker}`, 'Adapter test', 1792929600123);
        const step = await db.prepare(`INSERT INTO roadmap_steps
          (roadmap_id,phase_number,phase_title,step_number,title) VALUES (?,1,'Phase',1,'Activity')`)
          .run(roadmap.lastInsertRowid);
        const progress = db.prepare(`INSERT INTO roadmap_progress
          (user_id,roadmap_step_id,status,started_at) VALUES (?,?,'in_progress',?)
          ON CONFLICT(user_id,roadmap_step_id) DO UPDATE SET
          started_at=COALESCE(roadmap_progress.started_at,excluded.started_at)`);
        await progress.run(user.lastInsertRowid, step.lastInsertRowid, 1792929600123);
        await progress.run(user.lastInsertRowid, step.lastInsertRowid, 1792929600999);
        assert.equal((await db.prepare('SELECT started_at FROM roadmap_progress WHERE roadmap_step_id=?')
          .get(step.lastInsertRowid)).started_at, 1792929600123);
        const evidenceText = 'Evidence 😀 '.repeat(10000);
        await db.prepare(`INSERT INTO evidence_submissions
          (user_id,roadmap_step_id,text_content,submitted_at) VALUES (?,?,?,?)`)
          .run(user.lastInsertRowid, step.lastInsertRowid, evidenceText, 1792929600123);
        assert.equal((await db.prepare('SELECT text_content FROM evidence_submissions WHERE roadmap_step_id=?')
          .get(step.lastInsertRowid)).text_content, evidenceText);
        await assert.rejects(db.prepare(`INSERT OR IGNORE INTO skill_verifications
          (user_id,user_skill_id,evidence_submission_id,roadmap_step_id,created_at) VALUES (?,?,?,?,?)`)
          .run(user.lastInsertRowid, 0, 0, step.lastInsertRowid, 1792929600123),
        error => error.code === 'ER_NO_REFERENCED_ROW_2');
        await db.prepare('DELETE FROM users WHERE id=?').run(user.lastInsertRowid);
        assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM evidence_submissions WHERE roadmap_step_id=?')
          .get(step.lastInsertRowid)).count, 0);
        await db.exec('ROLLBACK');
      });
      assert.equal(await db.prepare('SELECT id FROM users WHERE email=?').get(email), undefined);
    } finally {
      if (db) await db.close();
      if (created) await admin.query(`DROP DATABASE \`${databaseName}\``);
      await admin.end();
    }
  });
