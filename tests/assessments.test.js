const {test}=require('node:test');const assert=require('node:assert/strict');const {createHash}=require('node:crypto');const {createApp}=require('../server');
test('assessments save Lumia results or three fallback matches and validate inputs',async t=>{
 let fail=false,calls=0;
 const {app,db}=createApp({database:':memory:',analyseCareerQuizWithLumia:async answers=>{calls++;assert.deepEqual(answers.workStyle,['team']);if(fail)throw Error('Offline');return {summary:'Analysis',recommendations:['teacher','data-analyst','software-developer'].map((id,i)=>({id,title:id,category:'Career',matchScore:95-i,roadmapSupported:true,reason:'Matched answers',strengths:['Research','Planning']}))};}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.close();db.close();});
 db.exec("INSERT INTO users(id,email,name,verified,created_at) VALUES(1,'assess@example.com','Student',1,1)");db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('assessment-test').digest('hex'),1,Date.now()+60000);
 const body={interests:['data'],subjects:['maths'],strengths:['analysis'],work_style:['team'],matches:Array.from({length:4},(_,i)=>({id:'fallback-'+i,title:'Fallback '+i,category:'Career',score:80-i,reasons:['Reason']}))};
 const post=async(payload=body,auth=true)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/assessments`,{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json',...(auth?{Cookie:'ck_session=assessment-test'}:{})},body:JSON.stringify(payload)});return {status:r.status,data:await r.json()};};
 assert.equal((await post(body,false)).status,401);assert.equal((await post({})).status,400);assert.equal(calls,0);
 const ai=await post();assert.equal(ai.data.source,'lumia');assert.equal(ai.data.summary,'Analysis');assert.equal(ai.data.matches[0].id,'teacher');assert.equal(JSON.parse(db.prepare('SELECT matches FROM career_assessments').get().matches)[0].id,'teacher');
 fail=true;const fallback=await post();assert.equal(fallback.data.source,'fallback');assert.equal(fallback.data.matches.length,3);assert.equal(db.prepare('SELECT career_id FROM career_matches WHERE rank=1').get().career_id,'fallback-0');
});
