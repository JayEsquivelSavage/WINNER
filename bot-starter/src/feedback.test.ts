import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {persistRecord,readRecords} from './match-store.js';
import {diagnose,type MatchRecord} from './match-record.js';
import {performance} from './analytics.js';
import {buildPrior,applyPrior} from './learning.js';
import {OpponentModel} from './opponents.js';
import {promotionGate,type Evaluation} from './promotion.js';
import {loadProfile,validateProfile} from './profiles.js';
import {DeployedChallenger} from './deployed.js';
import {reconstructRack} from './rack-reconstruction.js';
import {completionPotential} from './completion-potential.js';
import {Challenger} from './challenger.js';
import {WordEngine} from './word-engine.js';
import {counts} from './rules.js';
function record(i=1):MatchRecord {return {schema:1,source:'public-history',venue:'test',matchId:String(i),botId:'175',startedAt:'2026-01-01T00:00:00Z',endedAt:new Date(Date.UTC(2026,0,1,0,i)).toISOString(),strategyVersion:null,profileId:null,score:59,placement:5,opponents:[{id:'1',score:109,balance:33}],auctions:68,participated:null,acceptedBids:null,lettersWon:12,spent:152,balance:7,words:[{word:'EXOGEN',score:35}],unusedRack:null,unusedTiles:1,invalidActions:null,deadlineRejections:null,lateBidSkips:null,bidP99Ms:null,wordP99Ms:null,peakRssMiB:null,waits:null,coverage:'public-only',evidence:[{auctionId:String(i),letter:'A',kind:'Vickrey',rivalMax:12,paid:10,winner:'1'}]};}
test('public missing fields remain unknown and reports distinguish hypothesis from fact',()=>{
 const r=record(),p=performance([r]);assert.equal(p.auctionWinRate,null);assert.equal(p.last10Average,59);assert.equal(r.invalidActions,null);
 assert.ok(diagnose(r).unknown.some(s=>s.includes('hidden rack')));assert.ok(diagnose(r).hypotheses.some(s=>s.startsWith('Low realized score')));assert.ok(!diagnose(r).verified.some(s=>s.includes('overpayment')));
});
test('persistence de-duplicates, enriches public prices, and preserves client metrics',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'goat-store-'));
 try {const r=record();persistRecord(dir,r);persistRecord(dir,r);assert.equal(readRecords(dir).length,1);
  const live={...r,source:'runtime' as const,coverage:'full-session' as const,participated:50,invalidActions:0,evidence:r.evidence.map(e=>({...e,rivalMax:null}))};
  persistRecord(dir,live);persistRecord(dir,r);const stored=readRecords(dir)[0];assert.equal(stored.participated,50);assert.equal(stored.evidence[0].rivalMax,12);assert.equal(stored.invalidActions,0);
  fs.writeFileSync(path.join(dir,'matches','broken.json'),'{');assert.equal(readRecords(dir).length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('bounded learning excludes future and other venues, requires ten past matches, and rejects malformed priors',()=>{
 const rows=Array.from({length:30},(_,i)=>{const r=record(i+1);r.evidence=Array.from({length:3},(_,j)=>({...r.evidence[0],auctionId:String(i*3+j)}));return r;});const prior=buildPrior(rows,'test','2026-01-01T00:11:00Z');
 assert.equal(prior.matches,10);const sparse=rows.map(r=>({...r,evidence:[...r.evidence,...Array.from({length:30},()=>({...r.evidence[0],rivalMax:null}))]}));assert.equal(buildPrior(sparse,'test','2026-01-01T00:11:00Z').matches,0);const model=new OpponentModel();assert.equal(applyPrior(model.hist,prior,'test','Vickrey','2026-01-01T00:12:00Z'),true);
 assert.equal(applyPrior(model.hist,prior,'other','Vickrey','2026-01-01T00:12:00Z'),false);
 assert.equal(applyPrior(model.hist,prior,'test','Vickrey','2026-01-01T00:10:00Z'),false);
 assert.equal(applyPrior(model.hist,{...prior,matches:9},'test','Vickrey','2026-01-01T00:12:00Z'),false);
 const bad=structuredClone(prior);bad.counts.Vickrey[0][0]=NaN;assert.equal(applyPrior(model.hist,bad,'test','Vickrey','2026-01-01T00:12:00Z'),false);
});
const checks={compile:true,unit:true,integration:true,startup:true,sourceStable:true};
const arm={score:80,winRate:.2,placement:3,currencyEfficiency:.5,auctionWinRate:.2,balance:10,invalid:0,missedCpuDeadlines:0,bidP99:3,wordP99:3,peakRssMiB:140};
function fields():Evaluation[]{return ['mixed','strong'].map(name=>({name,seeds:Array.from({length:100},(_,i)=>1000+i),champion:arm,challenger:{...arm,score:90,winRate:.3},scoreDeltaCI:[2,18],winDeltaCI:[.02,.18]}));}
test('promotion gate fails closed on regressions, seed leakage, missing checks, memory and invalid actions',()=>{
 assert.equal(promotionGate(checks,fields(),[1,2,3]).eligibleForApproval,true);
 assert.equal(promotionGate({...checks,startup:false},fields(),[]).eligibleForApproval,false);assert.equal(promotionGate({...checks,sourceStable:false},fields(),[]).eligibleForApproval,false);
 assert.equal(promotionGate(checks,fields(),[1000]).eligibleForApproval,false);
 const bad=fields();bad[0].challenger.peakRssMiB=280;bad[1].challenger.invalid=1;assert.equal(promotionGate(checks,bad,[]).eligibleForApproval,false);
 const tie=fields();for(const f of tie){f.scoreDeltaCI=[0,0];f.winDeltaCI=[0,0];}assert.equal(promotionGate(checks,tie,[]).eligibleForApproval,false);
 assert.equal(promotionGate(checks,[fields()[0]],[]).eligibleForApproval,false);
});
test('deployed profile is preserved and candidate changes remain explicit',()=>{
 const p=loadProfile(new URL('../profiles/champion.json',import.meta.url).pathname);
 assert.equal(p.algorithm,'deployed');assert.equal(p.crossMatchLearning,false);
 assert.throws(()=>validateProfile({...p,parameters:{...p.parameters,bidScale:999}}));
 const e=new WordEngine(['AT','CAT','TACT','QUIZ','QI','A','AX'].filter(w=>w.length>=2));
 for(const letters of ['TACT','QUI','AEIRST','CAT'])for(const remaining of [0,1,5,30]){
  const deterministic={...p.parameters,budgetMs:1000};
  const x=new DeployedChallenger(e,deterministic),y=new Challenger(e,deterministic),pos={rack:counts(letters),balance:100,remaining,auctionType:'Vickrey' as const};
  assert.equal(x.bid(25,pos).amount,y.bid(25,pos).amount);const a=x.play(pos),b=y.play(pos);assert.equal(a.id,b.id);assert.equal(a.wait,b.wait);assert.equal(a.fallback,b.fallback);
 }
});

test('public rack deductions are exact only when forced by the entire starting deal',()=>{
 assert.deepEqual(reconstructRack(5,[{time:1,letter:'A'},{time:2,word:'TATTY'},{time:3,letter:'X'},{time:4,letter:'N'},{time:5,letter:'E'},{time:6,letter:'G'},{time:7,letter:'E'},{time:8,word:'EXOGEN'},{time:9,letter:'R'}]),{initial:'OTTTY',final:'R',unused:1});
 assert.equal(reconstructRack(5,[{time:2,word:'AT'}]).final,null);
 assert.equal(reconstructRack(5,[{time:1,letter:'A'},{time:1,word:'AT'}]).final,null);
});
test('candidate cash reserve remains spendable at balance eight; deployed policy stays unchanged',()=>{
 const e=new WordEngine(['COG','COIGN','COIN','ICON','QI']);
 const pos={rack:counts('COGI'),balance:8,remaining:30,auctionType:'Vickrey' as const};
 const old=new DeployedChallenger(e),candidate=new Challenger(e);
 assert.equal(old.bid(13,pos).amount,0);assert.ok(candidate.bid(13,pos).amount>0);
});

test('finishing policy bounds idle holding of a completed word by auction count',()=>{
 const e=new WordEngine(['TEMPOS','STOMPER']);
 const a=new Challenger(e,{waitDiscount:0,liquidity:0},{maxHoldAuctions:6});
 const p={rack:counts('TEMPOS'),score:42,balance:100,remaining:40,auctionType:'Vickrey' as const};
 assert.equal(a.play(p).wait,true);
 const d=a.play({...p,remaining:34});assert.equal(d.wait,false);assert.equal(e.words[d.id],'TEMPOS');assert.match(d.reason??'',/holding window/);
});
test('future acquisitions cannot be financed with income from an unplayed word',()=>{
 const e=new WordEngine(['TEMPOS','STOMPER']);
 const a=new Challenger(e,{waitDiscount:0,liquidity:0},{affordableHorizon:true});
 const p={rack:counts('TEMPOS'),score:42,balance:0,remaining:30,auctionType:'Vickrey' as const};
 assert.equal(a.play(p).wait,false);
});
test('finishing policy rejects unusable speculative endgame tiles and liquidates earlier',()=>{
 const e=new WordEngine(['TEMPOS','STOMPER']);const a=new Challenger(e,{}, {affordableHorizon:true,liquidationWindow:6});
 const p={rack:counts('TEMPOS'),balance:100,remaining:6,auctionType:'Vickrey' as const};
 assert.equal(a.play(p).wait,false);assert.equal(a.bid(25,{...p,remaining:2}).amount,0);
});

test('multi-tile planning rewards a productive long-word bridge, respects availability, and times out safely',()=>{
 const e=new WordEngine(['RETAINS','RETAIN','RAIN']),r=counts('AEIN'),bag=new Uint8Array(26).fill(4);
 const good=completionPotential(e,r,17,bag,5,0,globalThis.performance.now()+100);
 const bad=completionPotential(e,r,25,bag,5,0,globalThis.performance.now()+100);
 assert.ok(good.value>bad.value);assert.equal(good.complete,true);
 bag[19]=0;const unavailable=completionPotential(e,r,17,bag,5,0,globalThis.performance.now()+100);assert.equal(unavailable.value,0);
 const timed=completionPotential(e,r,17,bag,5,0,0);assert.equal(timed.value,0);assert.equal(timed.complete,false);
 assert.deepEqual([...r],[...counts('AEIN')]);
});

test('maximum-multiplier words can immediately fund the next scoring cycle',()=>{
 const e=new WordEngine(['RETAINS','PAINTERS']);
 const p={rack:counts('RETAINS'),balance:80,remaining:40,auctionType:'Vickrey' as const};
 const a=new Challenger(e,{waitDiscount:0,liquidity:0},{cashOutAtSeven:true});
 const d=a.play(p);assert.equal(d.wait,false);assert.equal(e.words[d.id],'RETAINS');assert.match(d.reason??'',/maximum length multiplier/);
});
