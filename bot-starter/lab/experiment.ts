import fs from 'node:fs';
import { loadDictionary } from '../src/dictionary.js';
import { WordEngine } from '../src/word-engine.js';
import { DEFAULTS,type Parameters } from '../src/config.js';
import { simulate,percentile,wilson,rng,type BotKind,type MatchResult } from './simulator.js';
const n=Number(process.env.LAB_MATCHES??100), start=Number(process.env.LAB_SEED??10000);
const engine=new WordEngine(loadDictionary().words);
const pool:BotKind[]=process.env.LAB_POOL==='strong'?['rival','rival','rival','rival','rival','greedy']:['starter','greedy','fixed','economy','aggressive','random'];
function roster(seed:number,candidate:BotKind):BotKind[] {
 const others=pool.slice();const random=rng(seed^12345);for(let i=others.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[others[i],others[j]]=[others[j],others[i]];}
 const r=others.slice(0,5);r.splice(seed%6,0,candidate);return r;
}
function sample(result:MatchResult,candidate:BotKind) {
 const p=result.players.find(p=>p.kind===candidate)!;
 const max=Math.max(...result.players.map(p=>p.score));
 return {score:p.score,win:Number(p.score===max),place:1+result.players.filter(q=>q.score>p.score).length,
 balance:p.balance,spent:p.spent,wins:p.wins,bids:p.bids,words:p.words,letters:p.lettersPlayed,unused:p.rack.reduce((a,b)=>a+b,0),
 invalid:p.invalid,missed:p.missed,deadlines:p.deadlines,bid:p.latencyBid,word:p.latencyWord,fallbacks:p.agent.fallbacks};
}
type Sample=ReturnType<typeof sample>;
function aggregate(samples:Sample[]) {
 const total=(k:Exclude<keyof Sample,'bid'|'word'>)=>samples.reduce((a,s)=>a+s[k],0);
 return {matches:samples.length,winRate:total('win')/samples.length,winCI95:wilson(total('win'),samples.length),
 averageScore:total('score')/samples.length,averagePlace:total('place')/samples.length,
 wordsPerMatch:total('words')/samples.length,pointsPerWord:total('score')/Math.max(1,total('words')),
 averageWordLength:total('letters')/Math.max(1,total('words')),currencyEfficiency:total('score')/Math.max(1,total('spent')),
 auctionWinRate:total('wins')/Math.max(1,total('bids')),averageSpent:total('spent')/samples.length,
 averageUnused:total('unused')/samples.length,averageUnusedCurrency:total('balance')/samples.length,finalPlayableRacks:total('missed'),invalidActions:total('invalid'),
 missedCpuDeadlines:total('deadlines'),fallbacks:total('fallbacks'),bidLatency:percentile(samples.flatMap(s=>s.bid)),wordLatency:percentile(samples.flatMap(s=>s.word))};
}
const mode=process.env.LAB_MODE??'evaluate';
if(mode==='tune') {
 const random=rng(271828);const configs:Partial<Parameters>[]=[{},
  {bidScale:2,futureWeight:.3,waitDiscount:.15},
  {bidScale:2.5,futureWeight:.6,waitDiscount:.2},
  {bidScale:3,futureWeight:.2,waitDiscount:.25},
  {bidScale:1.6,futureWeight:0,waitDiscount:.25},
  ...Array.from({length:7},()=>({bidScale:1+random()*3,futureWeight:random()*1.2,waitDiscount:.05+random()*.3,
    captureRate:.12+random()*.18,reserve:random()*12,liquidity:random()}))];
 const trials=[];
 for(const config of configs) {
  const samples:Sample[]=[];
  for(let i=0;i<n;i++) {const seed=start+i;samples.push(sample(simulate(engine,seed,roster(seed,'challenger'),i%2?'FirstPrice':'Vickrey',config),'challenger'));}
  const metrics=aggregate(samples);trials.push({config,metrics});console.log(JSON.stringify({config,score:metrics.averageScore,win:metrics.winRate}));
 }
 trials.sort((a,b)=> (b.metrics.winRate*100+b.metrics.averageScore)-(a.metrics.winRate*100+a.metrics.averageScore));
 fs.writeFileSync(`reports/${process.env.LAB_POOL==='strong'?'strong-':''}tuning.json`,JSON.stringify({trainingSeeds:[start,start+n-1],trials},null,2));
 fs.writeFileSync(`reports/${process.env.LAB_POOL==='strong'?'strong-':''}selected-parameters.json`,JSON.stringify({...DEFAULTS,...trials[0].config},null,2));
} else {
 const params:Parameters=fs.existsSync('reports/selected-parameters.json')?JSON.parse(fs.readFileSync('reports/selected-parameters.json','utf8')):DEFAULTS;
 const variants:Record<string,Partial<Parameters>|null>={challenger:params,champion:null};
 if(mode==='ablate') {
  Object.assign(variants,{'no-future':{...params,futureWeight:0},'no-lookahead':{...params,beam:1},
   'always-play':{...params,waitDiscount:1},'no-reserve':{...params,reserve:0},'no-liquidity':{...params,liquidity:0},
   'no-learning':{...params},'market-prior':{...params,marketPrior:1}});
 }
 const all:Record<string,Sample[]>={};
 for(const [name,config] of Object.entries(variants)) {
  const samples:Sample[]=[];
  for(let i=0;i<n;i++) {
   const seed=start+i,bot=config?'challenger':'champion';
   // no-learning is performed by the simulator's dedicated option below.
   samples.push(sample(simulate(engine,seed,roster(seed,bot),i%2?'FirstPrice':'Vickrey',config??{},
    {learn:name!=='no-learning'}),bot));
  }
  all[name]=samples;console.log(name,JSON.stringify(aggregate(samples)));
 }
 const paired=all.challenger.map((s,i)=>s.score-all.champion[i].score),mean=paired.reduce((a,b)=>a+b,0)/n;
 const sd=Math.sqrt(paired.reduce((a,d)=>a+(d-mean)**2,0)/Math.max(1,n-1));
 const report={seeds:[start,start+n-1],params,metrics:Object.fromEntries(Object.entries(all).map(([k,v])=>[k,aggregate(v)])),
 pairedScoreImprovement:{mean,ci95:[mean-1.96*sd/Math.sqrt(n),mean+1.96*sd/Math.sqrt(n)]},
 memory:{...process.memoryUsage(),peakRssKiB:process.resourceUsage().maxRSS,cacheEntries:engine.cache.size,indexBytes:engine.bytes}};
 fs.writeFileSync(`reports/${process.env.LAB_POOL==='strong'?'strong-':''}${mode}.json`,JSON.stringify(report,null,2));
}
