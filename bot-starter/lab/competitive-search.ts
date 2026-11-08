import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {loadProfile,type Profile} from '../src/profiles.js';
import {pairedCI} from '../src/promotion.js';
const dir='telemetry/experiments/competitive-'+Date.now();fs.mkdirSync(dir,{recursive:true});
const base=loadProfile('profiles/finish-strong.json');
const train=Array.from({length:60},(_,i)=>3200000+i),heldout=Array.from({length:300},(_,i)=>3210000+i);
function run(profile:Profile,seeds:number[],field:string,label:string){
 const input=`${dir}/${label}-input.json`,output=`${dir}/${label}-output.json`;
 fs.writeFileSync(input,JSON.stringify({profile,seeds,field}));
 execFileSync(process.execPath,['--max-old-space-size=256','--import','tsx','lab/feedback-worker.ts',input,output]);
 return JSON.parse(fs.readFileSync(output,'utf8'));
}
const variants:Profile[]=[base];
for(const waitDiscount of [.02,.15,.3])for(const captureRate of [.12,.3])variants.push({...base,id:`tempo-${waitDiscount}-${captureRate}`,parameters:{...base.parameters,waitDiscount,captureRate}});
for(const bidScale of [1,1.8])for(const futureWeight of [.3,1.3])variants.push({...base,id:`value-${bidScale}-${futureWeight}`,parameters:{...base.parameters,bidScale,futureWeight}});
for(const liquidity of [0,1])variants.push({...base,id:`liquidity-${liquidity}`,parameters:{...base.parameters,liquidity}});
for(const bidScale of [1,1.8])variants.push({...base,algorithm:'goal',id:`goal-${bidScale}`,parameters:{...base.parameters,bidScale}});
const training=variants.map((p,i)=>{const r=run(p,train,'strong','train-'+i);console.log('Training',p.id,JSON.stringify(r.metrics));return r;});
training.sort((a,b)=>(b.metrics.winRate*100+b.metrics.score)-(a.metrics.winRate*100+a.metrics.score));
fs.writeFileSync(`${dir}/training.json`,JSON.stringify(training.map(r=>({profile:r.profile,metrics:r.metrics}))));
const reference=run(base,heldout,'strong','strong-reference');
const finalists=training.filter(r=>r.profile.id!==base.id).slice(0,3).map((r,i)=>{
 const candidate=run(r.profile,heldout,'strong','strong-finalist-'+i);
 const scoreCI=pairedCI(candidate.results.map((r:any,i:number)=>r.score-reference.results[i].score));
 const winCI=pairedCI(candidate.results.map((r:any,i:number)=>r.win-reference.results[i].win));
 const result={profile:r.profile,metrics:candidate.metrics,scoreCI,winCI};console.log('Finalist',JSON.stringify(result));return result;
});
const report={reference:reference.metrics,training:training.map(r=>({profile:r.profile,metrics:r.metrics})),finalists,dir,trainingSeeds:train,evaluationSeeds:heldout};
fs.writeFileSync('reports/competitive-search.json',JSON.stringify(report,null,2)+'\n');
console.log('Report reports/competitive-search.json');
