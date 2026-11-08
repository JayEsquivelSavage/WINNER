import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {persistRecord,readRecords} from '../src/match-store.js';
import {MatchSession} from '../src/session.js';
import {WordEngine} from '../src/word-engine.js';
import {loadDictionary} from '../src/dictionary.js';
import {rackMap,counts} from '../src/rules.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'goat-feedback-soak-')),engine=new WordEngine(loadDictionary().words);
const samples=[];let retained=0;
try{
 for(let i=0;i<600;i++){
  const s=new MatchSession(BigInt(i+1),175n,engine,'challenger',{},'deployed');s.rack.update(rackMap(counts('AT')));
  for(let j=0;j<400;j++)s.decision({kind:'word',rack:'AT',remaining:20,best:'AT',bestScore:2,chosen:null,reason:'synthetic retention stress'});
  const r=s.toRecord({venue:'synthetic-telemetry-test',startedAt:new Date(1000000*i).toISOString(),endedAt:new Date(1000000*i+500).toISOString(),strategyVersion:'test',profileId:'test',score:0,balance:100,opponents:[]});
  persistRecord(dir,r);
  if((i+1)%100===0){global.gc?.();samples.push({recordsWritten:i+1,heapMiB:process.memoryUsage().heapUsed/1048576,rssMiB:process.memoryUsage().rss/1048576,retained:readRecords(dir).length,decisionsPerRecord:s.decisions.length,dropped:s.droppedDecisions});}
 }
 retained=readRecords(dir).length;if(retained!==500)throw new Error('Retention cap failed');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
const report={kind:'synthetic telemetry retention stress, not competitive match results',recordsWritten:600,retained,peakRssMiB:process.resourceUsage().maxRSS/1024,samples};
fs.writeFileSync('reports/feedback-memory.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
