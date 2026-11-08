import fs from 'node:fs';
import {createHash,randomInt} from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadProfile,validateProfile,type Profile,profileVersion } from '../src/profiles.js';
import { atomicJson } from '../src/match-store.js';
import { buildPrior } from '../src/learning.js';
import { pairedCI,promotionGate,type Evaluation } from '../src/promotion.js';
import {botContext,readBotRecords} from '../src/bot-context.js';
const context=botContext(),root=context.dataDir,venue=context.venue;
const run=path.join(root,'experiments',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(run,{recursive:true,mode:0o700});
const champion=loadProfile('profiles/optimized.json'),base=loadProfile('profiles/optimized.json');
const sourceHash=()=>{
 const h=createHash('sha256').update(profileVersion(base)).update(profileVersion(champion));
 for(const dir of ['src','lab'])for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.ts')).sort())h.update(dir+'/'+name).update(fs.readFileSync(path.join(dir,name)));
 return h.digest('hex');
};
const sourceBefore=sourceHash();
const cutoff=new Date().toISOString(),prior=buildPrior(readBotRecords(context),venue,cutoff);
const n=Number(process.env.IMPROVE_EVAL_MATCHES??200),trainN=Number(process.env.IMPROVE_TRAIN_MATCHES??30);
if(!Number.isInteger(n)||n<20||n>1000||!Number.isInteger(trainN)||trainN<10||trainN>100)throw new Error('Invalid experiment size');
const seedBase=Number(process.env.IMPROVE_SEED??randomInt(1000000,1000000000));
if(!Number.isInteger(seedBase)||seedBase<0||seedBase>2000000000)throw new Error('Invalid seed base');
const training=Array.from({length:trainN},(_,i)=>seedBase+i),evaluation=Array.from({length:n},(_,i)=>seedBase+10000+i);
const checks:Record<string,boolean>={};
// Execute tests afresh; a candidate cannot fabricate successful check flags.
for(const [key,script]of [['compile','build'],['unit','test'],['integration','test:integration'],['startup','test:startup']]){
 try{console.log(`Checking ${key}`);const out=execFileSync('npm',['run',script],{encoding:'utf8',maxBuffer:4*1024*1024});fs.writeFileSync(path.join(run,key+'.txt'),out,{mode:0o600});checks[key]=true;}
 catch(error){checks[key]=false;const out=(error as {stdout?:string|Buffer}).stdout;fs.writeFileSync(path.join(run,key+'.txt'),out??'Check failed without stdout',{mode:0o600});}
}
const variants:Profile[]=[
 {...base,id:'control'},
 {...base,id:'conservative',parameters:{...base.parameters,bidScale:1.1,reserve:12}},
 {...base,id:'aggressive',parameters:{...base.parameters,bidScale:1.9,reserve:3}},
 {...base,id:'adaptive',crossMatchLearning:true},
 {...base,id:'earlier-liquidation',parameters:{...base.parameters,waitDiscount:.16}},
 {...base,id:'preserve-completions',parameters:{...base.parameters,futureWeight:1}},
];
function evaluate(profile:Profile,seeds:number[],field:string,label:string){
 validateProfile(profile);const input=path.join(run,label+'-input.json'),output=path.join(run,label+'-output.json');
 atomicJson(input,{profile,seeds,field,prior,cutoff});
 execFileSync(process.execPath,['--max-old-space-size=256','--import','tsx','lab/feedback-worker.ts',input,output],{maxBuffer:1024*1024});
 return JSON.parse(fs.readFileSync(output,'utf8'));
}
if(!Object.values(checks).every(Boolean)){
 atomicJson(path.join(run,'decision.json'),{...promotionGate(checks,[],training),checks});console.log('Required checks failed; candidate rejected. No deployment.');process.exitCode=1;
}else{
 const trials=variants.map((profile,i)=>{console.log(`Training ${profile.id}`);return evaluate(profile,training,'strong',`train-${i}`);});
 trials.sort((a,b)=>(b.metrics.winRate*100+b.metrics.score)-(a.metrics.winRate*100+a.metrics.score));
 const selected=trials[0].profile as Profile;
 const fields:Evaluation[]=[];
 for(const field of ['mixed','strong']){
  console.log(`Held-out ${field}: current WINNER baseline vs ${selected.id}`);
  const a=evaluate(champion,evaluation,field,`${field}-champion`),b=evaluate(selected,evaluation,field,`${field}-candidate`);
  fields.push({name:field,seeds:evaluation,champion:a.metrics,challenger:b.metrics,
   scoreDeltaCI:pairedCI(b.results.map((r:any,i:number)=>r.score-a.results[i].score)),winDeltaCI:pairedCI(b.results.map((r:any,i:number)=>r.win-a.results[i].win))});
 }
 const ablations=[{...selected,id:'ablation-no-future',parameters:{...selected.parameters,futureWeight:0}},
  {...selected,id:'ablation-always-play',parameters:{...selected.parameters,waitDiscount:1}},
  {...selected,id:'ablation-no-reserve',parameters:{...selected.parameters,reserve:0}},
  {...selected,id:'ablation-no-crossmatch',crossMatchLearning:false}].map((p,i)=>evaluate(p,training,'strong',`ablation-${i}`));
 atomicJson(path.join(run,'ablations.json'),ablations.map(t=>({profile:t.profile,metrics:t.metrics})));
 checks.sourceStable=sourceHash()===sourceBefore;
 const gate=promotionGate(checks,fields,training);
 atomicJson(path.join(run,'decision.json'),{...gate,checks,sourceHash:sourceBefore,seedBase,trainingSeeds:training,fields,championVersion:profileVersion(champion),candidateVersion:profileVersion(selected),priorCutoff:cutoff});
 atomicJson(path.join(run,'training.json'),trials.map(t=>({profile:t.profile,metrics:t.metrics})));
 atomicJson(path.join(run,'proposed-profile.json'),selected);
 // A proposal only: never overwrite profiles/champion.json or a live process.
 atomicJson(path.join(root,'latest-experiment.json'),{directory:run,...gate});
 console.log(JSON.stringify({directory:run,...gate},null,2));
}
// Retain only ten complete experiment folders, independent of match retention.
const dirs=fs.readdirSync(path.join(root,'experiments')).filter(n=>/^\d{4}-/.test(n)).sort().reverse();
for(const dir of dirs.slice(10))fs.rmSync(path.join(root,'experiments',dir),{recursive:true,force:true});
