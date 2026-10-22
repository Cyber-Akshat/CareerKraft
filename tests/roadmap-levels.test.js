const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createApp } = require('../server');

test('progression checks ownership and completion, builds context, avoids duplicates and finishes Advanced', async t => {
  const { db } = createApp({ database: ':memory:' });
  t.after(() => db.close());
  db.exec("INSERT INTO users(id,email,name,created_at) VALUES(1,'levels@example.com','Student',1),(2,'other@example.com','Other',1); INSERT INTO roadmaps(id,user_id,career_id,career_title,status,created_at) VALUES(1,1,'teacher','Teacher','active',1)");
  const insert = db.prepare("INSERT INTO roadmap_steps(roadmap_id,phase_number,phase_title,step_number,title,level,level_step_number) VALUES(1,1,'Basics',?,'Learn teaching','beginner',?)");
  for (let i=1;i<=7;i++) insert.run(i,i);
  db.exec("INSERT INTO roadmap_progress(user_id,roadmap_step_id,status) SELECT 1,id,'completed' FROM roadmap_steps WHERE id<7; INSERT INTO user_skills(user_id,skill_name,normalized_name,first_verified_at,last_verified_at) VALUES(1,'Planning','planning',1,1); INSERT INTO evidence_submissions(user_id,roadmap_step_id,text_content,feedback,submitted_at,reviewed_at) VALUES(1,1,'Work','Strong explanation',1,2)");
  let calls = 0, fail = false;
  const context = vm.createContext({ db, careerCatalog: require('../career-catalog'), options: { generateRoadmapWithLumia: async input => {
    calls++;
    assert.equal(input.previousJourney.verifiedSkills[0].name,'Planning');
    assert.equal(input.previousJourney.feedbackHighlights[0],'Strong explanation');
    if(fail) throw Error('Provider failure');
    return {overview:'Next level',steps:Array.from({length:7},(_,i)=>({phase:1,phaseTitle:'Practice',title:`${input.level} ${i}`,description:'Task',minutes:30,type:'challenge',evidence:true,levelStepNumber:i+1}))};
  } } });
  const source=fs.readFileSync(require.resolve('../server'),'utf8');
  const start=source.indexOf('  function getNextRoadmapLevel(');
  const end=source.indexOf('  function saveVerifiedSkills(',start);
  vm.runInContext(source.slice(start,end),context);
  const advance=userId=>context.advanceRoadmapLevelIfReady({userId,roadmapId:1});
  assert.equal((await advance(2)).advanced,false);
  const incomplete=await advance(1);assert.equal(incomplete.progress.completed,6);assert.equal(calls,0);
  db.exec("INSERT INTO roadmap_progress(user_id,roadmap_step_id,status) VALUES(1,7,'completed')");
  const results=await Promise.all([advance(1),advance(1)]);assert.ok(results.every(r=>r.level==='intermediate'));assert.equal(calls,1);
  const intermediate=db.prepare("SELECT * FROM roadmap_steps WHERE level='intermediate' ORDER BY step_number").all();assert.deepEqual(intermediate.map(s=>s.step_number),[8,9,10,11,12,13,14]);assert.deepEqual(intermediate.map(s=>s.level_step_number),[1,2,3,4,5,6,7]);
  assert.equal((await advance(1)).advanced,false);assert.equal(calls,1);
  db.exec("INSERT INTO roadmap_progress(user_id,roadmap_step_id,status) SELECT 1,id,'completed' FROM roadmap_steps WHERE level='intermediate'");
  fail=true;await assert.rejects(()=>advance(1),/Provider failure/);assert.equal(db.prepare('SELECT current_level FROM roadmaps').get().current_level,'intermediate');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roadmap_steps').get().n,14);
  fail=false;assert.equal((await advance(1)).level,'advanced');
  db.exec("INSERT INTO roadmap_progress(user_id,roadmap_step_id,status) SELECT 1,id,'completed' FROM roadmap_steps WHERE level='advanced'");
  assert.equal((await advance(1)).pathwayCompleted,true);assert.equal(db.prepare('SELECT status FROM roadmaps').get().status,'completed');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roadmap_steps').get().n,21);
});
