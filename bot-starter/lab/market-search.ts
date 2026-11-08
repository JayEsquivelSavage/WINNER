import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {loadProfile,type Profile} from '../src/profiles.js';
import {pairedCI} from '../src/promotion.js';
const dir='telemetry/experiments/market-'+Date.now();fs.mkdirSync(dir,{recursive:true});
const base=loadProfile('profiles/finish-strong.json');
const policy={maxHoldAuctions:0,cyclePremium:0,affordableHorizon:false,liquidationWindow:3};
const train=Array.from({length:40},(_,i)=>3300000+i),heldout=Array.from({length:300},(_,i)=>3310000+i);
function run(profile:Profile,seeds:number[],field:string,label:string){
 const input=`${dir}/${label}-input.json`,output=`${dir}/${label}-output.json`;
 fs.writeFileSync(input,JSON.stringify({profile,seeds,field}));
 execFileSync(process.execPath,['--max-old-space-size=256','--import','tsx','lab/feedback-worker.ts',input,output]);
 return JSON.parse(fs.readFileSync(output,'utf8'));
}
const variants:Profile[]=[base];
for(const marketBudget of [0,.5,1])for(const letterMarkets of [false,true]){
 if(marketBudget===0&&!letterMarkets)continue;
 variants.push({...base,id:`market-${marketBudget}-${letterMarkets}`,finishing:{...policy,marketBudget,letterMarkets}});
}
for(const beam of [8,12])variants.push({...base,id:`beam-${beam}`,parameters:{...base.parameters,beam}});
for(const marketPrior of [.5,1])variants.push({...base,id:`prior-${marketPrior}`,parameters:{...base.parameters,marketPrior},finishing:{...policy,letterMarkets:true,marketBudget:.5}});
const trials=variants.map((p,i)=>{const r=run(p,train,'strong','train-'+i);console.log('Training',p.id,JSON.stringify(r.metrics));return r;});
trials.sort((a,b)=>(b.metrics.winRate*200+b.metrics.score)-(a.metrics.winRate*200+a.metrics.score));
fs.writeFileSync(`${dir}/training.json`,JSON.stringify(trials.map(r=>({profile:r.profile,metrics:r.metrics}))));
const finalists=trials.filter(r=>r.profile.id!==base.id).slice(0,2),evaluations=[];
for(const field of ['strong','mixed']){
 const a=run(base,heldout,field,field+'-reference');
 for(let i=0;i<finalists.length;i++){
  const b=run(finalists[i].profile,heldout,field,field+'-finalist-'+i);
  const result={profile:b.profile,field,reference:a.metrics,candidate:b.metrics,scoreCI:pairedCI(b.results.map((r:any,i:number)=>r.score-a.results[i].score)),winCI:pairedCI(b.results.map((r:any,i:number)=>r.win-a.results[i].win))};evaluations.push(result);console.log('Evaluation',JSON.stringify(result));
 }
}
fs.writeFileSync('reports/market-evaluation.json',JSON.stringify({dir,training:trials.map(r=>({profile:r.profile,metrics:r.metrics})),evaluations,trainingSeeds:train,evaluationSeeds:heldout},null,2)+'\n');
for(let i=0;i<finalists.length;i++)fs.writeFileSync(`profiles/market-finalist-${i}.json`,JSON.stringify(finalists[i].profile,null,2)+'\n');
