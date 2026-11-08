import fs from 'node:fs';
import { loadDictionary } from '../src/dictionary.js';
import { WordEngine } from '../src/word-engine.js';
import { chooseWord } from '../src/champion.js';
import { BAG,rackMap,type Rack } from '../src/rules.js';
import { Challenger } from '../src/challenger.js';
let seed=876521; const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const dictionary=loadDictionary(); const build=performance.now();
const engine=new WordEngine(dictionary.words); const buildMs=performance.now()-build;
function percentile(values:number[]) {values.sort((a,b)=>a-b);return {p50:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],p99:values[Math.floor(values.length*.99)],max:values.at(-1)};}
const racks:Rack[]=[];
for(let i=0;i<1000;i++) {
  const r=new Uint8Array(26),bag=BAG.slice();let left=98;
  const size=i%10===0?20:2+i%14;
  for(let j=0;j<size;j++) {let n=Math.floor(random()*left);for(let c=0;c<26;c++){n-=bag[c];if(n<0){bag[c]--;r[c]++;left--;break;}}}racks.push(r);
}
const results:Record<string,unknown>={dictionaryWords:dictionary.words.length,sha256:dictionary.sha256,buildMs,indexMiB:engine.bytes/1048576};
for(const mode of ['scan','trie','bitset','cached'] as const) {
  for(const r of racks.slice(0,50)) { if(mode==='scan') chooseWord({myRack:rackMap(r),dictionary:dictionary.words});else if(mode==='cached') engine.top(r); else engine.search(r,mode); }
  if(mode==='cached') for(const r of racks) engine.top(r);
  const times:number[]=[];
  for(const r of racks) {const start=performance.now();if(mode==='scan') chooseWord({myRack:rackMap(r),dictionary:dictionary.words});else if(mode==='cached')engine.top(r);else engine.search(r,mode);times.push(performance.now()-start);}
  results[mode]=percentile(times);
}
const agent=new Challenger(engine);
for(const action of ['bid','play'] as const) {
 const times:number[]=[];let fallbacks=0;
 for(let i=0;i<racks.length;i++) {
  const p={rack:racks[i],balance:20+i%150,remaining:i%68,auctionType:i%2?'Vickrey' as const:'FirstPrice' as const};
  const r=action==='bid'?agent.bid(i%26,p):agent.play(p);times.push(r.elapsedMs);fallbacks+=Number(r.fallback);
 } results[action]={...percentile(times),fallbacks};
}
global.gc?.(); results.memory={...process.memoryUsage(),maxRssKiB:process.resourceUsage().maxRSS,cacheEntries:engine.cache.size};
fs.writeFileSync('reports/benchmark.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
