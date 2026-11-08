import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireInstance } from './instance.js';
import { loadDictionary } from './dictionary.js';
import { WordEngine,RackState } from './word-engine.js';
import { Challenger } from './challenger.js';
import { chooseWord as previous } from './champion.js';
import { counts,rackMap,BAG } from './rules.js';
import { OpponentModel } from './opponents.js';
import { MatchSession } from './session.js';
const dictionary=loadDictionary();const engine=new WordEngine(dictionary.words,64);
let seed=419;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
test('indexed search agrees with exhaustive official-dictionary search including duplicates',()=>{
 for(let t=0;t<300;t++) {
  const r=new Uint8Array(26),bag=BAG.slice();let left=98;
  for(let j=0;j<2+t%19;j++){let draw=Math.floor(random()*left);for(let c=0;c<26;c++){draw-=bag[c];if(draw<0){bag[c]--;r[c]++;left--;break;}}}
  const expected=previous({myRack:rackMap(r),dictionary:dictionary.words});
  const a=engine.search(r,'trie')[0]??-1,b=engine.search(r,'bitset')[0]??-1;
  const score=(id:number)=>id<0?0:engine.scores[id];
  const expectedScore=expected?engine.scores[dictionary.words.indexOf(expected)]:0;
  assert.equal(score(a),expectedScore);assert.equal(score(b),expectedScore);
  for(const id of engine.top(r))assert.ok(engine.valid(id,r));
 }
});
test('all playable spellings and repeated letters exactly match exhaustive filtering',()=>{
 for(const letters of ['TACT','TINGE','AAAEEI','QUIZCATS','RETAINS','MISSISSIPPI']) {
  const r=counts(letters),all=engine.allPlayable(r).sort((a,b)=>a-b);
  const expected=dictionary.words.flatMap((_,id)=>engine.valid(id,r)?[id]:[]);
  assert.deepEqual(all,expected);
 }
});
test('cache is bounded and incremental rack updates invalidate counts',()=>{
 for(let i=0;i<500;i++){const r=new Uint8Array(26);r[i%26]=1;r[(i>>3)%26]=2;r[(i>>5)%26]=3;engine.best(r);}
 assert.ok(engine.cache.size<=64);
 const state=new RackState();assert.ok(state.update(rackMap(counts('TACT'))));assert.equal(state.counts[19],2);
 assert.equal(state.update(rackMap(counts('TACT'))),false);
 state.update(rackMap(counts('AT')));assert.equal(state.counts[19],1);assert.equal(state.counts[2],0);
});
test('last tile is rejected, last usable completion can use remaining budget, and bids are legal',()=>{
 const agent=new Challenger(engine);
 const pos={rack:counts('QI'),balance:93,remaining:0,auctionType:'Vickrey' as const};
 assert.equal(agent.bid(0,pos).amount,0);
 const completion={...pos,rack:counts('QUI'),remaining:1};
 assert.equal(agent.bid(25,completion).amount,93);
 for(let i=0;i<100;i++) {
  const p={...pos,rack:counts('AEIRST'),remaining:i%68,balance:i};const d=agent.bid(i%26,p);
  assert.ok(Number.isInteger(d.amount)&&d.amount>=0&&d.amount<=p.balance);
 }
});
test('isolated Q is discounted and a Q completion earns substantially higher valuation',()=>{
 const agent=new Challenger(engine),p={rack:counts(''),balance:100,remaining:40,auctionType:'Vickrey' as const};
 const isolated=agent.bid(16,p),usable=agent.bid(16,{...p,rack:counts('UIZ')});
 assert.ok(usable.value>isolated.value*3,JSON.stringify({isolated,usable}));
 assert.ok(usable.amount>isolated.amount);
});
test('budget exhaustion falls back to a legal word, and endgame never waits on a playable rack',()=>{
 const agent=new Challenger(engine,{budgetMs:0});
 for(const letters of ['TINGE','RETAINS','CAT','AX']) {
  const p={rack:counts(letters),balance:100,remaining:30,auctionType:'Vickrey' as const};
  const d=agent.play(p);assert.equal(d.wait,false);assert.ok(engine.valid(d.id,p.rack));
  const end=agent.play({...p,remaining:0});assert.equal(end.wait,false);assert.ok(engine.valid(end.id,p.rack));
 }
});
test('second-price opponent wins are treated as censored bounds, not exact bids',()=>{
 const m=new OpponentModel();for(let i=0;i<20;i++)m.observe(0,'Vickrey',2n,12,1n,4);
 const h=m.distribution(0);assert.ok(h.slice(13).some(x=>x>0));assert.ok(m.winProbability(0,20)>m.winProbability(0,6));
 m.observe(0,'Vickrey',1n,1,1n,30);assert.ok(m.distribution(0)[0]>0&&m.distribution(0)[1]>0);
});
test('session de-duplicates public events and reports actual confirmed rewards',()=>{
 const s=new MatchSession(1n,175n,engine,'challenger');s.rack.update(rackMap(counts('QH')));
 s.auction(1n,'Q');s.auction(1n,'Q');s.result(1n,'Q',175n,12,'Vickrey');s.result(1n,'Q',175n,12,'Vickrey');
 s.word(1n,175n,'TINGE',12);s.word(1n,175n,'TINGE',12);
 const summary=s.summary(12,99);assert.equal(summary.spent,12);assert.equal(summary.lettersWon,1);assert.equal(summary.words,1);assert.equal(summary.unusedRack,'HQ');
});

test('instance guard rejects duplicates without stopping the existing process',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wordgoat-test-')),file=path.join(dir,'lock');
 const release=acquireInstance(file);assert.throws(()=>acquireInstance(file),/already running/);
 release();const releaseAgain=acquireInstance(file);releaseAgain();fs.rmdirSync(dir);
});
