/** Fixed candidate, disjoint fresh seeds, sequential isolated workers. Never
 * modifies the live/default profile or opens a bot connection. */
import fs from 'node:fs';
import path from 'node:path';
import {randomInt,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {loadProfile,type Profile} from '../src/profiles.js';
import {pairedCI,promotionGate,type Evaluation,type ArmMetrics} from '../src/promotion.js';
interface Sample {seed:number;score:number;halfScore:number;win:number;balance:number;}
interface Result {profile:Profile;metrics:ArmMetrics;results:Sample[];}
const root='telemetry/experiments/endgame-'+Date.now();fs.mkdirSync(root,{recursive:true,mode:0o700});
const baseline=loadProfile('profiles/optimized.json');
const candidate:Profile={...baseline,id:'exact-endgame-v1',finishing:{...baseline.finishing!,exactEndgame:true}};
const seedBase=randomInt(10_000_000,1_000_000_000),trainingSeeds=Array.from({length:80},(_,i)=>seedBase+i),evaluationSeeds=Array.from({length:1000},(_,i)=>seedBase+10000+i);
fs.writeFileSync(`${root}/manifest.json`,JSON.stringify({baseline,candidate,trainingSeeds,evaluationSeeds},null,2));
const digest=()=>{
 const hash=createHash('sha256');
 function add(dir:string){for(const name of fs.readdirSync(dir).sort()){
  const file=path.join(dir,name);if(fs.statSync(file).isDirectory())add(file);
  else if(file.endsWith('.ts'))hash.update(file).update(fs.readFileSync(file));
 }}
 add('src');add('lab');hash.update(fs.readFileSync('profiles/optimized.json'));return hash.digest('hex');
};
const before=digest();
function run(profile:Profile,seeds:number[],field:string,label:string):Result{
 const input=`${root}/${label}-input.json`,output=`${root}/${label}-output.json`;
 fs.writeFileSync(input,JSON.stringify({profile,seeds,field}));
 execFileSync(process.execPath,['--max-old-space-size=256','--import','tsx','lab/feedback-worker.ts',input,output],{stdio:['ignore','ignore','pipe']});
 const result:Result=JSON.parse(fs.readFileSync(output,'utf8'));
 console.log(JSON.stringify({phase:label,metrics:result.metrics}));return result;
}
const training=[];
for(const field of ['strong','mixed']){
 const a=run(baseline,trainingSeeds,field,`train-${field}-reference`),b=run(candidate,trainingSeeds,field,`train-${field}-candidate`);
 training.push({field,reference:a.metrics,candidate:b.metrics});
}
fs.writeFileSync(`${root}/training.json`,JSON.stringify(training,null,2));
const checks:Record<string,boolean>={};
for(const [key,script]of [['compile','build'],['unit','test'],['integration','test:integration'],['startup','test:startup']]){
 try{fs.writeFileSync(`${root}/${key}.txt`,execFileSync('npm',['run',script],{encoding:'utf8',maxBuffer:4*1024*1024}));checks[key]=true;}
 catch(error){checks[key]=false;throw new Error(`Required ${key} check failed`,{cause:error});}
 console.log(JSON.stringify({check:key,passed:true}));
}
const evaluations:Evaluation[]=[],paymentBreakdown=[];
for(const field of ['strong','mixed']){
 const a=run(baseline,evaluationSeeds,field,`${field}-reference`),b=run(candidate,evaluationSeeds,field,`${field}-candidate`);
 const evaluation:Evaluation={name:field,seeds:evaluationSeeds,champion:a.metrics,challenger:b.metrics,
  scoreDeltaCI:pairedCI(b.results.map((r,i)=>r.score-a.results[i].score)),winDeltaCI:pairedCI(b.results.map((r,i)=>r.win-a.results[i].win))};
 evaluations.push(evaluation);
 for(const parity of [0,1]){
  const aa=a.results.filter(r=>r.seed%2===parity),bb=b.results.filter(r=>r.seed%2===parity),mean=(rs:Sample[],key:'score'|'win')=>rs.reduce((sum,r)=>sum+r[key],0)/rs.length;
  paymentBreakdown.push({field,payment:parity?'FirstPrice':'Vickrey',games:aa.length,referenceScore:mean(aa,'score'),candidateScore:mean(bb,'score'),referenceWin:mean(aa,'win'),candidateWin:mean(bb,'win'),scoreDeltaCI:pairedCI(bb.map((r,i)=>r.score-aa[i].score)),winDeltaCI:pairedCI(bb.map((r,i)=>r.win-aa[i].win))});
 }
 console.log(JSON.stringify({field,scoreDeltaCI:evaluation.scoreDeltaCI,winDeltaCI:evaluation.winDeltaCI}));
}
checks.sourceStable=digest()===before;
const decision=promotionGate(checks,evaluations,trainingSeeds);
const report={root,sourceHash:before,baseline,candidate,trainingSeeds,evaluationSeeds,training,checks,evaluations,paymentBreakdown,decision,
 limitations:['Simulator does not model the runtime bid-replacement fix; no win gain is attributed to it.','Opponents are synthetic and network timing is not simulated.','Timed search fallbacks can vary with CPU contention.','No default profile or live process was changed.']};
fs.writeFileSync('reports/endgame-evaluation.json',JSON.stringify(report,null,2)+'\n');
fs.writeFileSync('profiles/endgame-candidate.json',JSON.stringify(candidate,null,2)+'\n');
console.log(JSON.stringify({report:'reports/endgame-evaluation.json',decision,root}));
