const {test}=require('node:test');const assert=require('node:assert/strict');const {createHash}=require('node:crypto');const {createApp}=require('../server');
test('non-template careers generate beginner roadmaps, retry safely and preserve generated evidence requirements',async t=>{
 let fail=true,calls=0;const {app,db}=createApp({database:':memory:',generateRoadmapWithLumia:async input=>{calls++;assert.equal(input.level,'beginner');assert.equal(input.career.id,'digital-forensics-investigator');assert.deepEqual(input.assessment.interests,['investigation']);if(fail)throw Error('Unavailable');return {steps:Array.from({length:7},(_,i)=>({phase:1,phaseTitle:'Foundations',title:'Activity '+i,description:'Task',minutes:30,type:'learning',evidence:false}))};}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.close();db.close();});
 db.exec("INSERT INTO users(id,email,name,verified,created_at) VALUES(1,'roadmap@example.com','Student',1,1); INSERT INTO selected_career VALUES(1,'digital-forensics-investigator','Digital Forensics Investigator',1)");
 db.prepare('INSERT INTO career_assessments VALUES(?,?,?,?,?,?,?)').run(1,JSON.stringify(['investigation']),'[]','[]','[]','[]',1);db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('generated-test').digest('hex'),1,Date.now()+60000);
 const post=async()=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/roadmap`,{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json',Cookie:'ck_session=generated-test'},body:JSON.stringify({level:'advanced'})});return {status:r.status,data:await r.json()};};
 assert.equal((await post()).status,503);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roadmaps').get().n,0);fail=false;
 const built=await post();assert.equal(built.status,201);assert.equal(built.data.source,'lumia');assert.equal(db.prepare('SELECT current_level FROM roadmaps').get().current_level,'beginner');const steps=db.prepare('SELECT * FROM roadmap_steps ORDER BY step_number').all();assert.equal(steps.length,7);assert.deepEqual(steps.map(s=>s.level_step_number),[1,2,3,4,5,6,7]);assert.ok(steps.every(s=>s.evidence_required===0));assert.equal((await post()).data.existing,true);assert.equal(calls,2);
});


