import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {loadProfile,type Profile} from '../src/profiles.js';
import {pairedCI} from '../src/promotion.js';
const dir='telemetry/experiments/information-'+Date.now();fs.mkdirSync(dir,{recursive:true});
const base=loadProfile('profiles/finish-strong.json'),policy={maxHoldAuctions:0,cyclePremium:0,affordableHorizon:false,liquidationWindow:3};
const seeds=Array.from({length:300},(_,i)=>3400000+i);
function run(profile:Profile,field:string,label:string){
 const input=`${dir}/${label}-input.json`,output=`${dir}/${label}-output.json`;
 fs.writeFileSync(input,JSON.stringify({profile,seeds,field}));
 execFileSync(process.execPath,['--max-old-space-size=256','--import','tsx','lab/feedback-worker.ts',input,output]);
 return JSON.parse(fs.readFileSync(output,'utf8'));
}
const variants:Profile[]=[
 {...base,id:'public-supply-v1',finishing:{...policy,inferDeals:true}},
 {...base,id:'letter-market-v1',finishing:{...policy,letterMarkets:true}},
 {...base,id:'supply-market-v1',finishing:{...policy,inferDeals:true,letterMarkets:true}},
];
const evaluations=[];
for(const field of ['strong','mixed']){
 const a=run(base,field,field+'-reference');console.log('Reference',field,JSON.stringify(a.metrics));
 for(let i=0;i<variants.length;i++){
  const b=run(variants[i],field,field+'-candidate-'+i);
  const result={profile:b.profile,field,reference:a.metrics,candidate:b.metrics,scoreCI:pairedCI(b.results.map((r:any,i:number)=>r.score-a.results[i].score)),winCI:pairedCI(b.results.map((r:any,i:number)=>r.win-a.results[i].win))};evaluations.push(result);console.log('Evaluation',JSON.stringify(result));
 }
}
fs.writeFileSync('reports/information-evaluation.json',JSON.stringify({dir,evaluationSeeds:seeds,evaluations},null,2)+'\n');
for(const p of variants)fs.writeFileSync(`profiles/${p.id}.json`,JSON.stringify(p,null,2)+'\n');
