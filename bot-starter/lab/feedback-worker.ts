import fs from 'node:fs';
import { loadDictionary } from '../src/dictionary.js';
import { WordEngine } from '../src/word-engine.js';
import { validateProfile } from '../src/profiles.js';
import { simulate,rng,percentile,type BotKind } from './simulator.js';
import type { ArmMetrics } from '../src/promotion.js';
const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),profile=validateProfile(request.profile);
interface Sample {seed:number;score:number;halfScore:number;win:number;placement:number;spent:number;balance:number;wins:number;bids:number;invalid:number;missed:number;bid:number[];word:number[];}
const engine=new WordEngine(loadDictionary().words),results:Sample[]=[];
for(const seed of request.seeds as number[]){
 const pool:BotKind[]=request.field==='strong'?['rival','rival','rival','rival','rival','greedy']:['starter','greedy','fixed','economy','aggressive','random'];
 const random=rng(seed^12345);for(let i=pool.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
 const roster=pool.slice(0,5);roster.splice(seed%6,0,'challenger');
 const match=simulate(engine,seed,roster,seed%2?'FirstPrice':'Vickrey',profile.parameters,
   {algorithm:profile.algorithm,finishing:profile.finishing,prior:profile.crossMatchLearning?request.prior:undefined,cutoff:request.cutoff,deadlineMs:250});
 const p=match.players.find(p=>p.kind==='challenger')!,top=Math.max(...match.players.map(p=>p.score));
 results.push({seed,score:p.score,halfScore:p.halfScore,win:Number(p.score===top),placement:1+match.players.filter(q=>q.score>p.score).length,
  spent:p.spent,balance:p.balance,wins:p.wins,bids:p.bids,invalid:p.invalid,missed:p.deadlines,bid:p.latencyBid,word:p.latencyWord});
}
const total=(key:'score'|'halfScore'|'win'|'placement'|'spent'|'balance'|'wins'|'bids'|'invalid'|'missed')=>results.reduce((s,r)=>s+r[key],0);
const metrics:ArmMetrics={score:total('score')/results.length,winRate:total('win')/results.length,placement:total('placement')/results.length,
 currencyEfficiency:total('score')/Math.max(1,total('spent')),auctionWinRate:total('wins')/Math.max(1,total('bids')),balance:total('balance')/results.length,
 invalid:total('invalid'),missedCpuDeadlines:total('missed'),bidP99:percentile(results.flatMap(r=>r.bid)).p99,wordP99:percentile(results.flatMap(r=>r.word)).p99,
 firstHalfScore:total('halfScore')/results.length,secondHalfGain:(total('score')-total('halfScore'))/results.length,
 peakRssMiB:process.resourceUsage().maxRSS/1024};
fs.writeFileSync(process.argv[3],JSON.stringify({profile,metrics,results:results.map(({bid,word,...r})=>r),cache:engine.cache.size}));
