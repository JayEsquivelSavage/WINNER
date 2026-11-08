import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {loadProfile,validateProfile,type Profile} from '../src/profiles.js';
import {atomicJson} from '../src/match-store.js';
import {pairedCI,promotionGate,type Evaluation} from '../src/promotion.js';
const n=Number(process.env.FINISH_MATCHES??200),trainN=Number(process.env.FINISH_TRAIN??40),seed=Number(process.env.FINISH_SEED??2030000);
if(!Number.isInteger(n)||n<100||n>1000||!Number.isInteger(trainN)||trainN<10||trainN>100)throw new Error('Invalid sample sizes');
const dir=path.join('telemetry','experiments','finish-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(dir,{recursive:true});
const champion=loadProfile('profiles/champion.json'),base=loadProfile('profiles/challenger.json');
const hash=()=>{const h=createHash('sha256');for(const d of ['src','lab'])for(const f of fs.readdirSync(d).filter(f=>f.endsWith('.ts')).sort())h.update(fs.readFileSync(path.join(d,f)));return h.digest('hex');};
const before=hash();
const training=Array.from({length:trainN},(_,i)=>seed+i),heldout=Array.from({length:n},(_,i)=>seed+10000+i);
const checks:Record<string,boolean>={};
for(const [key,script]of [['compile','build'],['unit','test'],['integration','test:integration'],['startup','test:startup']]){
 try{console.log('Check',key);fs.writeFileSync(path.join(dir,key+'.txt'),execFileSync('npm',['run',script],{encoding:'utf8',maxBuffer:4*1024*1024}));checks[key]=true;}catch{checks[key]=false;}
}
if(Object.values(checks).some(v=>!v))throw new Error('Checks failed before strategy selection');
function run(profile:Profile,seeds:number[],field:string,label:string){
 const input=path.join(dir,label+'-input.json'),output=path.join(dir,label+'-output.json');validateProfile(profile);atomicJson(input,{profile,seeds,field});
 execFileSync(process.execPath,['--max-old-space-size=256','--import','tsx','lab/feedback-worker.ts',input,output],{maxBuffer:1024*1024});
 return JSON.parse(fs.readFileSync(output,'utf8'));
}
const variants:Profile[]=[{...base,id:'reserve-only'},
 ...[0,.25,.5,1,2].flatMap(weight=>[0,10].map(hold=>({...base,id:`cashout-plan-${weight}-hold-${hold}`,finishing:{maxHoldAuctions:hold,cyclePremium:0,affordableHorizon:false,liquidationWindow:3,planningWeight:weight,cashOutAtSeven:true}}))),
];
const trials=variants.map((p,i)=>{const r=run(p,training,'strong',`train-${i}`);console.log('Training',p.id,JSON.stringify(r.metrics));return r;});
trials.sort((a,b)=>(b.metrics.winRate*100+b.metrics.score)-(a.metrics.winRate*100+a.metrics.score));
const selected=trials[0].profile as Profile;atomicJson(path.join(dir,'training.json'),trials.map(r=>({profile:r.profile,metrics:r.metrics})));
const fields:Evaluation[]=[];
for(const field of ['mixed','strong']){
 const a=run(champion,heldout,field,`${field}-champion`),b=run(selected,heldout,field,`${field}-candidate`);
 const e:Evaluation={name:field,seeds:heldout,champion:a.metrics,challenger:b.metrics,scoreDeltaCI:pairedCI(b.results.map((r:any,i:number)=>r.score-a.results[i].score)),winDeltaCI:pairedCI(b.results.map((r:any,i:number)=>r.win-a.results[i].win))};fields.push(e);console.log('Evaluation',field,JSON.stringify(e));
}
checks.sourceStable=hash()===before;const gate=promotionGate(checks,fields,training);
const report={...gate,checks,profile:selected,sourceHash:before,trainingSeeds:training,fields,experiment:dir};
atomicJson(path.join(dir,'decision.json'),report);atomicJson('reports/finish-strong-evaluation.json',report);
atomicJson('profiles/finish-strong.json',selected);
console.log(JSON.stringify(gate));
