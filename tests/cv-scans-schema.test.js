const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');

function database(t) {
  const { db } = createApp({ database: ':memory:' });
  t.after(() => db.close());
  db.prepare(`INSERT INTO users(id,email,name,created_at) VALUES
    (1,'cv-one@example.test','One',1),(2,'cv-two@example.test','Two',1)`).run();
  return db;
}

const insertScan = db => db.prepare(`INSERT INTO cv_scans
  (user_id,extracted_text,analysis_json,created_at) VALUES (?,?,?,?)`);

test('CV scans generate IDs, allow multiple scans and default optional fields', t => {
  const db = database(t);
  const insert = insertScan(db);
  const first = insert.run(1, 'A project from my CV.', '{}', 1792929600123);
  const second = insert.run(1, 'An updated CV.', '{}', 1792929600456);
  assert.ok(first.lastInsertRowid > 0);
  assert.ok(second.lastInsertRowid > first.lastInsertRowid);
  const row = db.prepare('SELECT * FROM cv_scans WHERE id=?').get(first.lastInsertRowid);
  assert.equal(row.user_id, 1);
  assert.equal(row.file_name, null);
  for (const field of ['overall_score', 'structure_score', 'clarity_score', 'evidence_score', 'relevance_score']) {
    assert.equal(row[field], 0, field);
  }
  assert.equal(row.created_at, 1792929600123);
});

test('CV scans preserve filenames, long extracted text, scores and structured analysis', t => {
  const db = database(t);
  const extractedText = 'Research project: analysed network traffic. \u{1f4c4}\n'.repeat(2500);
  const analysis = {
    strengths: ['Clear education', 'Relevant project', 'Specific responsibilities'],
    improvements: ['Clarify the project goal', 'Explain the approach', 'Link verified evidence'],
    missingVerifiedSkills: ['Research', 'Network Analysis'],
    rewrittenBullets: ['Analysed network traffic as part of a research project.']
  };
  const result = db.prepare(`INSERT INTO cv_scans
    (user_id,file_name,extracted_text,overall_score,structure_score,clarity_score,evidence_score,
      relevance_score,analysis_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(1, 'Research CV.pdf', extractedText, 78, 85, 80, 65, 82, JSON.stringify(analysis), 1792929600123);
  const row = db.prepare('SELECT * FROM cv_scans WHERE id=?').get(result.lastInsertRowid);
  assert.equal(row.file_name, 'Research CV.pdf');
  assert.equal(row.extracted_text, extractedText);
  assert.deepEqual(JSON.parse(row.analysis_json), analysis);
  assert.deepEqual([row.overall_score, row.structure_score, row.clarity_score, row.evidence_score,
    row.relevance_score], [78, 85, 80, 65, 82]);
});

test('CV scans reject missing required values, invalid JSON and unknown users', t => {
  const db = database(t);
  const insert = insertScan(db);
  for (const values of [
    [null, 'CV text', '{}', 1], [1, null, '{}', 1], [1, 'CV text', null, 1],
    [1, 'CV text', '{}', null]
  ]) {
    assert.throws(() => insert.run(...values), /NOT NULL constraint failed/);
  }
  assert.throws(() => insert.run(1, 'CV text', '{invalid JSON}', 1), /CHECK constraint failed/);
  assert.throws(() => insert.run(999, 'CV text', '{}', 1), /FOREIGN KEY constraint failed/);
  for (const score of ['overall_score', 'structure_score', 'clarity_score', 'evidence_score', 'relevance_score']) {
    assert.throws(() => db.prepare(`INSERT INTO cv_scans
      (user_id,extracted_text,analysis_json,created_at,${score}) VALUES (1,'CV text','{}',1,NULL)`)
      .run(), /NOT NULL constraint failed/);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cv_scans').get().count, 0);
});

test('deleting an account removes its CV scans and preserves scans from other accounts', t => {
  const db = database(t);
  const insert = insertScan(db);
  insert.run(1, 'First scan', '{}', 1);
  insert.run(1, 'Second scan', '{}', 2);
  const other = insert.run(2, 'Another account CV', '{}', 3);
  db.prepare('DELETE FROM users WHERE id=?').run(1);
  const rows = db.prepare('SELECT id,user_id,extracted_text FROM cv_scans').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, other.lastInsertRowid);
  assert.equal(rows[0].user_id, 2);
  assert.equal(rows[0].extracted_text, 'Another account CV');
});
