const {test}=require('node:test');const assert=require('node:assert/strict');const {createHash}=require('node:crypto');const {createApp}=require('../server');const fixture=require('./fixtures/module');

test('cached lessons recover empty or broken resources without regenerating their content',async t=>{
 for(const original of [[],[{...fixture.resources[0],url:'https://www.youtube.com/watch?v=madeup00000',resourceType:'video'}]]) {
  let lessonCalls=0;
  const {app,db}=createApp({database:':memory:',generateModuleContent:async()=>{lessonCalls++;throw Error('Lesson must remain cached');},verifyLearningResources:async resources=>resources.filter(r=>!r.url.includes('youtube.com')),recommendLearningResourcesWithLumia:async()=>[]});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  db.exec("INSERT INTO users(id,email,name,verified,created_at) VALUES(1,'recovery@example.com','Student',1,1);INSERT INTO roadmaps(id,user_id,career_id,career_title,status,created_at) VALUES(1,1,'ux-ui-designer','UX/UI Designer','active',1);INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title,description) VALUES(1,1,1,'Foundations',1,'Understand UX and UI','Learn the difference between user experience and interface design.')");
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('recovery-test').digest('hex'),1,Date.now()+60000);
  db.prepare('INSERT INTO roadmap_step_content VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(1,fixture.introduction,JSON.stringify(fixture.learningObjectives),JSON.stringify(fixture.keyConcepts),JSON.stringify(fixture.example),JSON.stringify(fixture.task),fixture.evidence.instructions,JSON.stringify(fixture.verificationCriteria),JSON.stringify(fixture.skills),fixture.reflectionQuestion,42,JSON.stringify(original));
  try {
   const r=await fetch(`http://127.0.0.1:${server.address().port}/api/roadmap/steps/1/content`,{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json',Cookie:'ck_session=recovery-test'},body:'{}'});const result=await r.json();
   assert.equal(r.status,200);assert.equal(result.cached,true);assert.ok(result.content.resources.length>=2);assert.ok(result.content.resources.every(r=>['www.gov.uk','developer.mozilla.org','www.w3.org'].includes(new URL(r.url).hostname)));assert.equal(lessonCalls,0);
   const saved=db.prepare('SELECT * FROM roadmap_step_content').get();assert.ok(JSON.parse(saved.resources).length>=2);assert.equal(saved.generated_at,42);assert.equal(saved.introduction,fixture.introduction);assert.deepEqual(JSON.parse(saved.task_content),fixture.task);
  }finally{server.close();db.close();}
 }
});
