import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {loadProfile,type Profile} from '../src/profiles.js';
import {pairedCI,promotionGate,type Evaluation} from '../src/promotion.js';
const dir='telemetry/experiments/reserve-'+Date.now();fs.mkdirSync(dir,{recursive:true});
const base=loadProfile('profiles/finish-strong.json');
const selected:Profile={...base,id:'sustainable-integer-v2',finishing:{maxHoldAuctions:0,cyclePremium:0,affordableHorizon:false,liquidationWindow:3,integerReserve:true}};
const seeds=Array.from({length:1000},(_,i)=>3600000+i);
const sourceHash=()=>{const h=createHash('sha256');for(const d of ['src','lab'])for(const f of fs.readdirSync(d).filter(f=>f.endsWith('.ts')).sort())h.update(fs.readFileSync(`${d}/${f}`));return h.digest('hex');};
const before=sourceHash();
function run(profile:Profile,field:string,label:string){
 const input=`${dir}/${label}-input.json`,output=`${dir}/${label}-output.json`;
 fs.writeFileSync(input,JSON.stringify({profile,seeds,field}));
 execFileSync(process.execPath,['--max-old-space-size=256','--import','tsx','lab/feedback-worker.ts',input,output]);
 return JSON.parse(fs.readFileSync(output,'utf8'));
}
const checks:Record<string,boolean>={};
for(const [key,script]of [['compile','build'],['unit','test'],['integration','test:integration'],['startup','test:startup']]){
 try{fs.writeFileSync(`${dir}/${key}.txt`,execFileSync('npm',['run',script],{encoding:'utf8',maxBuffer:4*1024*1024}));checks[key]=true;}catch{checks[key]=false;}
 console.log('Check',key,checks[key]);
}
if(Object.values(checks).some(v=>!v))throw new Error('Required checks failed');
const evaluations:Evaluation[]=[];
for(const field of ['strong','mixed']){
 const a=run(base,field,field+'-reference');console.log('Reference',field,JSON.stringify(a.metrics));
 const b=run(selected,field,field+'-candidate');
 const result:Evaluation={name:field,seeds,champion:a.metrics,challenger:b.metrics,scoreDeltaCI:pairedCI(b.results.map((r:any,i:number)=>r.score-a.results[i].score)),winDeltaCI:pairedCI(b.results.map((r:any,i:number)=>r.win-a.results[i].win))};evaluations.push(result);console.log('Evaluation',JSON.stringify(result));
}
checks.sourceStable=sourceHash()===before;
const decision=promotionGate(checks,evaluations,[]);
fs.writeFileSync('reports/reserve-confirmation.json',JSON.stringify({dir,selected,sourceHash:before,checks,decision,evaluations},null,2)+'\n');
fs.writeFileSync('profiles/optimized.json',JSON.stringify(selected,null,2)+'\n');
console.log('Decision',JSON.stringify(decision));
