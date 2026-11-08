import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {loadProfile,type Profile} from '../src/profiles.js';
import {pairedCI} from '../src/promotion.js';
const dir='telemetry/experiments/win-'+Date.now();fs.mkdirSync(dir,{recursive:true});
const base=loadProfile('profiles/finish-strong.json'),policy={maxHoldAuctions:0,cyclePremium:0,affordableHorizon:false,liquidationWindow:3};
const train=Array.from({length:60},(_,i)=>3500000+i),heldout=Array.from({length:500},(_,i)=>3510000+i);
function run(profile:Profile,seeds:number[],field:string,label:string){
 const input=`${dir}/${label}-input.json`,output=`${dir}/${label}-output.json`;
 fs.writeFileSync(input,JSON.stringify({profile,seeds,field}));
 execFileSync(process.execPath,['--max-old-space-size=256','--import','tsx','lab/feedback-worker.ts',input,output]);
 return JSON.parse(fs.readFileSync(output,'utf8'));
}
const variants:Profile[]=[base,loadProfile('profiles/letter-market-v1.json'),...[.5,1,2].map(scoreAware=>({...base,id:`score-aware-${scoreAware}`,finishing:{...policy,scoreAware,letterMarkets:true}}))];
const trials=variants.map((p,i)=>{const r=run(p,train,'strong','train-'+i);console.log('Training',p.id,JSON.stringify(r.metrics));return r;});
trials.sort((a,b)=>(b.metrics.winRate*200+b.metrics.score)-(a.metrics.winRate*200+a.metrics.score));
const selected=trials.filter(r=>r.profile.id!==base.id)[0].profile;
fs.writeFileSync(`${dir}/training.json`,JSON.stringify(trials.map(r=>({profile:r.profile,metrics:r.metrics}))));
const evaluations=[];
for(const field of ['strong','mixed']){
 const a=run(base,heldout,field,field+'-reference'),b=run(selected,heldout,field,field+'-candidate');
 const result={profile:selected,field,reference:a.metrics,candidate:b.metrics,scoreCI:pairedCI(b.results.map((r:any,i:number)=>r.score-a.results[i].score)),winCI:pairedCI(b.results.map((r:any,i:number)=>r.win-a.results[i].win))};evaluations.push(result);console.log('Evaluation',JSON.stringify(result));
}
fs.writeFileSync('reports/win-evaluation.json',JSON.stringify({dir,selected,training:trials.map(r=>({profile:r.profile,metrics:r.metrics})),evaluations,trainingSeeds:train,evaluationSeeds:heldout},null,2)+'\n');
fs.writeFileSync('profiles/win-candidate.json',JSON.stringify(selected,null,2)+'\n');
