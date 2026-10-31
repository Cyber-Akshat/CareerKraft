const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');

const timestamp = 1793361600123;
const originalCv = 'Education\nResearch project: investigated network traffic.';
const currentCv = { sections: [{ name: 'Projects', bullets: ['Investigated network traffic.'] }] };

function seed(db) {
  db.exec(`INSERT INTO users(id,email,name,created_at) VALUES
    (1,'build-one@example.test','One',1),(2,'build-two@example.test','Two',1)`);
  const scan = db.prepare(`INSERT INTO cv_scans
    (id,user_id,extracted_text,analysis_json,created_at) VALUES (?,?,?,'{}',?)`);
  scan.run(10, 1, originalCv, timestamp);
  scan.run(20, 2, 'Another student CV.', timestamp);
}

function database(t) {
  const { db } = createApp({ database: ':memory:' });
  t.after(() => db.close());
  seed(db);
  return db;
}

function insert(db, table, values) {
  const columns = Object.keys(values);
  return db.prepare(`INSERT INTO ${table} (${columns.join(',')})
    VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(values));
}

function build(db, changes = {}) {
  return insert(db, 'cv_builds', {
    user_id: 1, cv_scan_id: 10, original_cv_text: originalCv,
    current_cv_json: JSON.stringify(currentCv), created_at: timestamp, updated_at: timestamp,
    ...changes
  });
}

function suggestion(db, buildId, changes = {}) {
  return insert(db, 'cv_build_suggestions', {
    cv_build_id: buildId, section_name: 'Projects', suggestion_type: 'rewrite',
    suggested_text: 'Investigated network traffic.', reason: 'Use direct wording.',
    created_at: timestamp, updated_at: timestamp, ...changes
  });
}

test('CV builds generate IDs, preserve source and JSON, and default to reviewing with zero counters', t => {
  const db = database(t);
  const first = build(db);
  const second = build(db);
  assert.ok(first.lastInsertRowid > 0);
  assert.ok(second.lastInsertRowid > first.lastInsertRowid);
  const row = db.prepare('SELECT * FROM cv_builds WHERE id=?').get(first.lastInsertRowid);
  assert.equal(row.user_id, 1);
  assert.equal(row.cv_scan_id, 10);
  assert.equal(row.target_career, null);
  assert.equal(row.original_cv_text, originalCv);
  assert.deepEqual(JSON.parse(row.current_cv_json), currentCv);
  assert.equal(row.status, 'reviewing');
  for (const name of ['total_suggestions', 'accepted_count', 'rejected_count', 'edited_count']) {
    assert.equal(row[name], 0, name);
  }
  assert.equal(row.created_at, timestamp);
  assert.equal(row.updated_at, timestamp);
});

test('CV build suggestions default to pending, allow optional text and evidence, and retain their ordering', t => {
  const db = database(t);
  const buildId = build(db).lastInsertRowid;
  const first = suggestion(db, buildId);
  const evidence = { source: 'uploaded_cv', quote: 'investigated network traffic' };
  const second = suggestion(db, buildId, {
    original_text: 'Research project: investigated network traffic.', evidence_json: JSON.stringify(evidence), sort_order: 2
  });
  assert.ok(first.lastInsertRowid > 0);
  assert.ok(second.lastInsertRowid > first.lastInsertRowid);
  const row = db.prepare('SELECT * FROM cv_build_suggestions WHERE id=?').get(first.lastInsertRowid);
  assert.equal(row.cv_build_id, buildId);
  assert.equal(row.status, 'pending');
  assert.equal(row.sort_order, 0);
  for (const field of ['original_text', 'evidence_json', 'final_text']) assert.equal(row[field], null, field);
  const withEvidence = db.prepare('SELECT * FROM cv_build_suggestions WHERE id=?').get(second.lastInsertRowid);
  assert.deepEqual(JSON.parse(withEvidence.evidence_json), evidence);
  assert.equal(withEvidence.original_text, 'Research project: investigated network traffic.');
  assert.deepEqual(db.prepare('SELECT id FROM cv_build_suggestions ORDER BY sort_order,id').all().map(item => item.id),
    [first.lastInsertRowid, second.lastInsertRowid]);
  assert.throws(() => suggestion(db, buildId, { evidence_json: '{invalid JSON}' }), /CHECK constraint failed/);
});

test('CV builds and suggestions reject missing required values, invalid JSON and unknown references', t => {
  const db = database(t);
  for (const field of ['user_id', 'cv_scan_id', 'original_cv_text', 'current_cv_json', 'status',
    'total_suggestions', 'accepted_count', 'rejected_count', 'edited_count', 'created_at', 'updated_at']) {
    assert.throws(() => build(db, { [field]: null }), /NOT NULL constraint failed/, field);
  }
  assert.throws(() => build(db, { current_cv_json: '{invalid JSON}' }), /CHECK constraint failed/);
  assert.throws(() => build(db, { user_id: 999 }), /FOREIGN KEY constraint failed/);
  assert.throws(() => build(db, { cv_scan_id: 999 }), /FOREIGN KEY constraint failed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cv_builds').get().count, 0);
  const buildId = build(db).lastInsertRowid;
  for (const field of ['cv_build_id', 'section_name', 'suggestion_type', 'suggested_text', 'reason',
    'status', 'sort_order', 'created_at', 'updated_at']) {
    assert.throws(() => suggestion(db, buildId, { [field]: null }), /NOT NULL constraint failed/, field);
  }
  assert.throws(() => suggestion(db, 999), /FOREIGN KEY constraint failed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cv_build_suggestions').get().count, 0);
});

test('review decisions preserve original CV text while updating current content, counters and final suggestion text', t => {
  const db = database(t);
  const buildId = build(db, { target_career: 'Cyber Security Analyst' }).lastInsertRowid;
  const suggestionId = suggestion(db, buildId).lastInsertRowid;
  const revisedCv = { sections: [{ name: 'Projects', bullets: ['Investigated network traffic.'] }], reviewed: true };
  db.prepare(`UPDATE cv_builds SET current_cv_json=?,status=?,total_suggestions=?,
    accepted_count=?,rejected_count=?,edited_count=?,updated_at=? WHERE id=?`)
    .run(JSON.stringify(revisedCv), 'completed', 3, 1, 1, 1, timestamp + 1000, buildId);
  db.prepare('UPDATE cv_build_suggestions SET status=?,final_text=?,updated_at=? WHERE id=?')
    .run('edited', 'Investigated network traffic.', timestamp + 1000, suggestionId);
  const row = db.prepare('SELECT * FROM cv_builds WHERE id=?').get(buildId);
  assert.equal(row.original_cv_text, originalCv);
  assert.deepEqual(JSON.parse(row.current_cv_json), revisedCv);
  assert.equal(row.target_career, 'Cyber Security Analyst');
  assert.equal(row.status, 'completed');
  assert.deepEqual([row.total_suggestions, row.accepted_count, row.rejected_count, row.edited_count], [3, 1, 1, 1]);
  assert.equal(row.created_at, timestamp);
  assert.equal(row.updated_at, timestamp + 1000);
  const decision = db.prepare('SELECT status,final_text,created_at,updated_at FROM cv_build_suggestions WHERE id=?').get(suggestionId);
  assert.equal(decision.status, 'edited');
  assert.equal(decision.final_text, 'Investigated network traffic.');
  assert.equal(decision.created_at, timestamp);
  assert.equal(decision.updated_at, timestamp + 1000);
});

test('deleting a build, its source scan or its user cascades suggestions while preserving another account', t => {
  for (const [table, id] of [['cv_builds', null], ['cv_scans', 10], ['users', 1]]) {
    const db = database(t);
    const firstBuild = build(db).lastInsertRowid;
    const otherBuild = build(db, { user_id: 2, cv_scan_id: 20 }).lastInsertRowid;
    suggestion(db, firstBuild);
    suggestion(db, firstBuild, { sort_order: 1 });
    const otherSuggestion = suggestion(db, otherBuild).lastInsertRowid;
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id ?? firstBuild);
    assert.equal(db.prepare('SELECT * FROM cv_builds WHERE id=?').get(firstBuild), undefined, table);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cv_build_suggestions WHERE cv_build_id=?')
      .get(firstBuild).count, 0, table);
    assert.equal(db.prepare('SELECT id FROM users WHERE id=2').get().id, 2, table);
    assert.equal(db.prepare('SELECT id FROM cv_scans WHERE id=20').get().id, 20, table);
    assert.equal(db.prepare('SELECT user_id FROM cv_builds WHERE id=?').get(otherBuild).user_id, 2, table);
    assert.equal(db.prepare('SELECT cv_build_id FROM cv_build_suggestions WHERE id=?').get(otherSuggestion).cv_build_id,
      otherBuild, table);
    if (table === 'cv_builds') assert.equal(db.prepare('SELECT id FROM cv_scans WHERE id=10').get().id, 10);
    if (table === 'cv_scans') assert.equal(db.prepare('SELECT id FROM users WHERE id=1').get().id, 1);
    if (table === 'users') assert.equal(db.prepare('SELECT * FROM cv_scans WHERE id=10').get(), undefined);
  }
});

test('restarting the application keeps existing builds and suggestions without recreating or resetting them', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'careerkraft-cv-build-schema-'));
  const filename = path.join(directory, 'accounts.sqlite');
  let db;
  t.after(() => {
    db?.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('careerkraft-cv-build-schema-'));
    rmSync(directory, { recursive: true, force: true });
  });
  db = createApp({ database: filename }).db;
  seed(db);
  const buildId = build(db, { target_career: 'Cyber Security Analyst', accepted_count: 1 }).lastInsertRowid;
  const suggestionId = suggestion(db, buildId, {
    status: 'accepted', final_text: 'Investigated network traffic.', evidence_json: JSON.stringify({ source: 'uploaded_cv' })
  }).lastInsertRowid;
  const originalBuild = db.prepare('SELECT * FROM cv_builds WHERE id=?').get(buildId);
  const originalSuggestion = db.prepare('SELECT * FROM cv_build_suggestions WHERE id=?').get(suggestionId);
  db.close();
  db = null;
  db = createApp({ database: filename }).db;
  assert.deepEqual(db.prepare('SELECT * FROM cv_builds WHERE id=?').get(buildId), originalBuild);
  assert.deepEqual(db.prepare('SELECT * FROM cv_build_suggestions WHERE id=?').get(suggestionId), originalSuggestion);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cv_builds').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cv_build_suggestions').get().count, 1);
});
