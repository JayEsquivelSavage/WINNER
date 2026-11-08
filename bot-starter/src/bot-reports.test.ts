import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const loader=new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url).href;
function runReports(snapshots:unknown[],venue='https://maincloud.spacetimedb.com/scrabblebot'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'winner-report-test-')),data=path.join(dir,'data'),reports=path.join(dir,'winner-reports');
 fs.mkdirSync(data);fs.mkdirSync(path.join(dir,'reports'));fs.writeFileSync(path.join(data,'recent-public.json'),JSON.stringify({schema:1,botName:'winner',botId:'307',venue,matches:snapshots}));
 const env={...process.env,BOT_NAME:'winner',BOT_ID:'307',WORDGOAT_DATA_DIR:data,WORDGOAT_REPORT_DIR:reports,STDB_HOST:'https://maincloud.spacetimedb.com',STDB_DB:'scrabblebot'};
 // No network, credentials or running bot: both real report scripts consume
 // controlled public snapshots in a temporary working directory.
 try{
  execFileSync(process.execPath,['--import',loader,new URL('../lab/live-report.ts',import.meta.url).pathname,'--import','--write-report'],{cwd:dir,env,stdio:'pipe'});
  execFileSync(process.execPath,['--import',loader,new URL('../lab/live-performance.ts',import.meta.url).pathname],{cwd:dir,env,stdio:'pipe'});
  return {dashboard:JSON.parse(fs.readFileSync(path.join(data,'dashboard.json'),'utf8')),performance:JSON.parse(fs.readFileSync(path.join(data,'live-performance.json'),'utf8')),reportExists:fs.existsSync(path.join(reports,'LIVE-PERFORMANCE.md')),legacyReportExists:fs.existsSync(path.join(dir,'reports/LIVE-ANALYSIS.md'))};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('new bot with no matches reports unknown performance and does not write WORDGOAT reports',()=>{
 const r=runReports([]);assert.equal(r.dashboard.matches,0);assert.equal(r.dashboard.winRate,null);
 assert.equal(r.performance.latestMatchAt,null);assert.equal(r.performance.last30.averageScore,null);
 assert.equal(r.reportExists,true);assert.equal(r.legacyReportExists,false);
});
test('reports select winner even when WORDGOAT is in the same game',()=>{
 const snapshot={match_state:[{id:1,starting_rack_size:5,created_at:[0],started_at:[0,[0]],ended_at:[0,[1000000]],auction_type:[1,[]]}],
  match_participant:[{bot_id:175,score:100,balance:7},{bot_id:307,score:11,balance:111}],auction:[],auction_result:[],auction_top_bid_archive:[],
  word_play:[{bot_id:175,word:'EXAMPLE',total_reward:100,played_at:[400000]},{bot_id:307,word:'QI',total_reward:11,played_at:[500000]}]};
 const r=runReports([snapshot]);assert.equal(r.dashboard.last10Average,11);assert.equal(r.performance.last30.averageScore,11);
 assert.equal(r.performance.matches[0].words[0].word,'QI');assert.equal(r.performance.matches[0].place,2);
 assert.equal(r.reportExists,true);assert.equal(r.legacyReportExists,false);
});

test('reports reject snapshots from another venue before importing or relabeling them',()=>{
 assert.throws(()=>runReports([],'https://other.example/scrabblebot'),(error:any)=>String(error.stderr).includes('provenance'));
});
