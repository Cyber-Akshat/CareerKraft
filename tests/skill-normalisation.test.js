const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {createApp}=require('../server');
test('skill aliases deduplicate approval sources without inflating verification counts',t=>{
 const {db}=createApp({database:':memory:'});t.after(()=>db.close());
 db.exec("INSERT INTO users(id,email,name,created_at) VALUES(1,'aliases@example.com','Student',1);INSERT INTO roadmaps(id,user_id,career_id,career_title,status,created_at) VALUES(1,1,'teacher','Teacher','active',1);INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title) VALUES(1,1,1,'Basics',1,'Activity'),(2,1,1,'Basics',2,'Activity two');INSERT INTO evidence_submissions(id,user_id,roadmap_step_id,submitted_at) VALUES(1,1,1,1),(2,1,2,2)");
 const source=fs.readFileSync(require.resolve('../server'),'utf8');const start=source.indexOf('  const SKILL_ALIASES =');const end=source.indexOf('  const requireUser',start);const context=vm.createContext({db});vm.runInContext(source.slice(start,end),context);
 const skills=['Prioritization','prioritisation','Prioritisation Skills','Problem-solving','Problem Solving','Problem solving skills','UX research','user-research','analytical skills','team work','time-management',null,''];
 const saved=context.saveVerifiedSkills({userId:1,evidenceSubmissionId:1,roadmapStepId:1,skills});assert.equal(saved.length,6);assert.equal(saved[0].name,'Prioritisation');assert.equal(saved[0].verifiedCount,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM skill_verifications').get().n,6);
 assert.equal(context.saveVerifiedSkills({userId:1,evidenceSubmissionId:1,roadmapStepId:1,skills:['task prioritization']})[0].verifiedCount,1);
 assert.equal(context.saveVerifiedSkills({userId:1,evidenceSubmissionId:2,roadmapStepId:2,skills:['Task Prioritisation Skills']})[0].verifiedCount,2);
 assert.equal(context.canonicalizeSkillName('  portfolio   DEVELOPMENT  '),'Portfolio Development');assert.equal(context.canonicalizeSkillName({}),null);assert.equal(context.canonicalizeSkillName('constructor'),'Constructor');
});

