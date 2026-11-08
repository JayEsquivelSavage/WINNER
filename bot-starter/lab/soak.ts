import fs from 'node:fs';
import { WordEngine } from '../src/word-engine.js';
import { loadDictionary } from '../src/dictionary.js';
import { simulate,type BotKind } from './simulator.js';
const engine=new WordEngine(loadDictionary().words),samples:unknown[]=[];
const n=Number(process.env.SOAK_MATCHES??1000);let invalid=0,missed=0,maxCache=0;
for(let i=0;i<n;i++) {
 const roster:BotKind[]=i%2?['challenger','champion','starter','aggressive','greedy','fixed']:['challenger','rival','rival','rival','rival','rival'];
 const result=simulate(engine,50000+i,roster,i%4<2?'Vickrey':'FirstPrice',{}, {deadlineMs:250});
 for(const p of result.players){invalid+=p.invalid;missed+=p.deadlines;}
 maxCache=Math.max(maxCache,engine.cache.size);
 if((i+1)%100===0){global.gc?.();const m=process.memoryUsage();samples.push({matches:i+1,heapMiB:m.heapUsed/1048576,rssMiB:m.rss/1048576,arrayMiB:m.arrayBuffers/1048576,cache:engine.cache.size});console.log(JSON.stringify(samples.at(-1)));}
}
const report={matches:n,invalidActions:invalid,missedCpuDeadlines:missed,maxCache,peakRssKiB:process.resourceUsage().maxRSS,indexMiB:engine.bytes/1048576,samples};
fs.writeFileSync('reports/soak.json',JSON.stringify(report,null,2));
