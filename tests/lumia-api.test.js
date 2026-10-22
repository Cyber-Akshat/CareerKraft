const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createApp } = require('../server');

async function setup(t, options = {}) {
  const { app, db } = createApp({ database: ':memory:', ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  function addUser(email) {
    const user = db.prepare('INSERT INTO users(email,name,verified,created_at) VALUES(?,?,1,?)')
      .run(email, email.split('@')[0], Date.now());
    const id = Number(user.lastInsertRowid);
    const secret = `test-session-${id}`;
    const hash = createHash('sha256').update(secret).digest('hex');
    db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run(hash, id, Date.now() + 60000);
    return { id, cookie: `ck_session=${secret}` };
  }
  async function request(path, { method = 'GET', body, cookie } = {}) {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }),
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  }
  return { db, addUser, request };
}

test('Lumia history and new conversations are authenticated and isolated per user', async t => {
  const { db, addUser, request } = await setup(t);
  const first = addUser('first@example.test');
  const second = addUser('second@example.test');
  assert.equal((await request('/api/lumia/history')).status, 401);

  const firstHistory = await request('/api/lumia/history', { cookie: first.cookie });
  assert.equal(firstHistory.status, 200);
  assert.deepEqual(firstHistory.data.messages, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM lumia_conversations WHERE user_id=?').get(first.id).count, 1);
  const conversationId = firstHistory.data.conversation.id;
  const insertMessage = db.prepare(`INSERT INTO lumia_messages
    (conversation_id,user_id,role,content,created_at) VALUES(?,?,?,?,?)`);
  for (let index = 0; index < 35; index += 1) {
    insertMessage.run(conversationId, first.id, index % 2 ? 'assistant' : 'user', `Turn ${index}`, index);
  }
  const restoredHistory = await request('/api/lumia/history', { cookie: first.cookie });
  assert.equal(restoredHistory.data.messages.length, 30);
  assert.equal(restoredHistory.data.messages[0].content, 'Turn 5');
  assert.equal(restoredHistory.data.messages.at(-1).content, 'Turn 34');

  const created = await request('/api/lumia/new-conversation', { method: 'POST', body: {}, cookie: first.cookie });
  assert.equal(created.status, 201);
  assert.notEqual(created.data.conversation.id, conversationId);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM lumia_conversations WHERE user_id=?').get(first.id).count, 2);

  const secondHistory = await request('/api/lumia/history', { cookie: second.cookie });
  assert.notEqual(secondHistory.data.conversation.id, firstHistory.data.conversation.id);
  assert.equal(secondHistory.data.messages.length, 0);
});

test('Lumia persists turns, includes prior chat and viewed activity, and rejects cross-account conversation IDs', async t => {
  const calls = [];
  const fetchLumia = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: `Answer ${calls.length}` } }] }) };
  };
  const oldKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'test-key';
  t.after(() => {
    if (oldKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldKey;
  });
  const { db, addUser, request } = await setup(t, { fetchLumia });
  const first = addUser('first@example.test');
  const second = addUser('second@example.test');
  const third = addUser('third@example.test');
  const roadmap = db.prepare(`INSERT INTO roadmaps
    (user_id,career_id,career_title,status,current_level,created_at,updated_at)
    VALUES(?,'teacher','Teacher','active','beginner',?,?)`).run(first.id, Date.now(), Date.now());
  const step = db.prepare(`INSERT INTO roadmap_steps
    (roadmap_id,phase_number,phase_title,step_number,title,description,estimated_minutes,activity_type,evidence_required,level,level_step_number)
    VALUES(?,1,'Foundations',1,'Plan a lesson','Create a sample lesson.',20,'activity',1,'beginner',1)`)
    .run(Number(roadmap.lastInsertRowid));
  const foreignRoadmap = db.prepare(`INSERT INTO roadmaps
    (user_id,career_id,career_title,status,current_level,created_at,updated_at)
    VALUES(?,'teacher','Private Teacher Roadmap','active','beginner',?,?)`).run(third.id, Date.now(), Date.now());
  const foreignStep = db.prepare(`INSERT INTO roadmap_steps
    (roadmap_id,phase_number,phase_title,step_number,title,description,estimated_minutes,activity_type,evidence_required,level,level_step_number)
    VALUES(?,1,'Private',1,'Private activity title','Do not reveal this activity.',20,'activity',1,'beginner',1)`)
    .run(Number(foreignRoadmap.lastInsertRowid));
  const history = await request('/api/lumia/history', { cookie: first.cookie });
  const conversationId = history.data.conversation.id;

  const firstAnswer = await request('/api/lumia/chat', {
    method: 'POST', cookie: first.cookie,
    body: { message: 'What should I do?', conversationId, pageContext: { path: '/activity.html', stepId: Number(step.lastInsertRowid) } }
  });
  assert.equal(firstAnswer.status, 200);
  assert.equal(firstAnswer.data.answer, 'Answer 1');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM lumia_messages WHERE conversation_id=?').get(conversationId).count, 2);
  const firstPrompt = calls[0].messages;
  assert.match(firstPrompt.find(item => item.content?.includes('CAREERKRAFT CONTEXT')).content, /Plan a lesson/);
  assert.equal(firstPrompt.at(-1).content, 'What should I do?');

  const secondAnswer = await request('/api/lumia/chat', {
    method: 'POST', cookie: first.cookie, body: { message: 'Why?', conversationId }
  });
  assert.equal(secondAnswer.status, 200);
  const secondPrompt = calls[1].messages;
  assert.ok(secondPrompt.some(item => item.role === 'user' && item.content === 'What should I do?'));
  assert.ok(secondPrompt.some(item => item.role === 'assistant' && item.content === 'Answer 1'));
  assert.equal(db.prepare('SELECT title FROM lumia_conversations WHERE id=?').get(conversationId).title, 'What should I do?');

  const foreignAttempt = await request('/api/lumia/chat', {
    method: 'POST', cookie: second.cookie,
    body: { message: 'Private?', conversationId, pageContext: { path: '/activity.html', stepId: Number(step.lastInsertRowid) } }
  });
  assert.equal(foreignAttempt.status, 200);
  assert.notEqual(foreignAttempt.data.conversationId, conversationId);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM lumia_messages WHERE user_id=?').get(second.id).count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM lumia_messages WHERE user_id=?').get(first.id).count, 4);
  const secondContext = calls[2].messages.find(item => item.content?.includes('CAREERKRAFT CONTEXT'));
  assert.match(secondContext.content, /"viewedActivity": null/);
  assert.doesNotMatch(secondContext.content, /Plan a lesson|Private Teacher Roadmap|Private activity title/);
  assert.notEqual(Number(foreignStep.lastInsertRowid), Number(step.lastInsertRowid));
});
