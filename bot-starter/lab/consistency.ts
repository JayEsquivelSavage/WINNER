import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {loadProfile,type Profile} from '../src/profiles.js';
import {pairedCI} from '../src/promotion.js';
const tuning=process.env.CONSISTENCY_TUNE==='1';
const dir='telemetry/experiments/consistency-'+Date.now();fs.mkdirSync(dir,{recursive:true});
const base=loadProfile('profiles/challenger.json');
function run(p:Profile,n:number,seed:number,field:string,label:string){
 const input=`${dir}/${label}-input.json`,output=`${dir}/${label}-output.json`;
 fs.writeFileSync(input,JSON.stringify({profile:p,seeds:Array.from({length:n},(_,i)=>seed+i),field}));
 execFileSync(process.execPath,['--max-old-space-size=256','--import','tsx','lab/feedback-worker.ts',input,output]);
 return JSON.parse(fs.readFileSync(output,'utf8'));
}
const candidates:Profile[]=tuning?[base,...[1,1.8,2.2].flatMap(bidScale=>[.4,.8].map(futureWeight=>({...base,algorithm:'cycle' as const,id:`cycle-${bidScale}-${futureWeight}`,parameters:{...base.parameters,bidScale,futureWeight}})))]:[base,...[3,6,10].map(scoringWindow=>({...base,id:`consistent-${scoringWindow}`,finishing:{maxHoldAuctions:0,cyclePremium:0,affordableHorizon:true,liquidationWindow:5,scoringWindow}}))];
const training=candidates.map((p,i)=>{const r=run(p,40,tuning?3120000:3100000,'strong','train-'+i);console.log(p.id,JSON.stringify(r.metrics));return r;});
training.sort((a,b)=>(b.metrics.winRate*100+b.metrics.score)-(a.metrics.winRate*100+a.metrics.score));
const selected=training[0].profile;
const evaluations=[];
for(const field of ['mixed','strong']){
 const a=run(loadProfile('profiles/champion.json'),200,tuning?3130000:3110000,field,field+'-baseline');
 const b=run(selected,200,tuning?3130000:3110000,field,field+'-selected');
 const result={field,baseline:a.metrics,candidate:b.metrics,scoreCI:pairedCI(b.results.map((r:any,i:number)=>r.score-a.results[i].score)),winCI:pairedCI(b.results.map((r:any,i:number)=>r.win-a.results[i].win))};evaluations.push(result);console.log(JSON.stringify(result));
}
fs.writeFileSync(tuning?'profiles/consistent-cycle.json':'profiles/consistent.json',JSON.stringify(selected,null,2)+'\n');
fs.writeFileSync(tuning?'reports/consistency-cycle-evaluation.json':'reports/consistency-evaluation.json',JSON.stringify({selected,training:training.map(r=>({profile:r.profile,metrics:r.metrics})),evaluations,dir},null,2)+'\n');
