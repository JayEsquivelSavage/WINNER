import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OpponentModel} from './opponents.js';
import {Challenger} from './challenger.js';
import {WordEngine} from './word-engine.js';
import {counts} from './rules.js';
test('letter market evidence reprices the observed letter with partial pooling',()=>{
 const model=new OpponentModel(0,true);
 for(let i=0;i<12;i++)model.observe(2,'FirstPrice',2n,30,1n,5);
 assert.ok(model.winProbability(2,15)<model.winProbability(19,15));
 assert.equal(model.observations,12);
 for(let c=0;c<26;c++){
  assert.ok(model.winProbability(c,0)>=0);assert.ok(model.winProbability(c,128)<=1);
  assert.ok(model.winProbability(c,30)>=model.winProbability(c,15));
 }
});
test('market budget moderates spending in expensive fields and preserves last usable completion',()=>{
 const engine=new WordEngine(['QUIZ','QI','AT','CAT']);
 const old=new Challenger(engine),adaptive=new Challenger(engine,{}, {marketBudget:1});
 for(const a of [old,adaptive])for(let i=0;i<20;i++)for(const letter of [0,19,16])a.model.observe(letter,'FirstPrice',2n,25,1n,5);
 const p={rack:counts('QUI'),balance:100,remaining:40,auctionType:'Vickrey' as const};
 const baseline=old.bid(25,p),changed=adaptive.bid(25,p);
 assert.ok(changed.amount<baseline.amount,`${changed.amount} should be below ${baseline.amount}`);
 assert.equal(adaptive.bid(25,{...p,remaining:1}).amount,100);
 assert.equal(adaptive.bid(25,{...p,remaining:0}).amount,0);
 assert.deepEqual(p.rack,counts('QUI'));
});

import {MatchSession} from './session.js';
import {BAG} from './rules.js';
test('public opponent words reveal initial tiles without double counting auction awards or duplicate events',()=>{
 const engine=new WordEngine(['QI','AT']);
 const session=new MatchSession(1n,1n,engine,'challenger',{},'challenger',{inferDeals:true});
 session.auction(1n,'I');session.result(1n,'I',2n,5,'Vickrey');
 assert.equal(session.word(1n,2n,'QI',11),true);
 assert.equal(session.remainingCounts[16],BAG[16]-1);
 assert.equal(session.remainingCounts[8],BAG[8]-1);
 assert.equal(session.word(1n,2n,'QI',11),false);
 assert.equal(session.remainingCounts[16],BAG[16]-1);
 const before=session.remainingCounts.slice();session.word(2n,1n,'AT',2);
 assert.deepEqual(session.remainingCounts,before);
});
test('unrevealed opponent starting tiles remain uncertain and default policy is unchanged',()=>{
 const engine=new WordEngine(['QI']);
 const session=new MatchSession(1n,1n,engine,'challenger');session.word(1n,2n,'QI',11);
 assert.deepEqual(session.remainingCounts,BAG);
 const active=new MatchSession(1n,1n,engine,'challenger',{},'challenger',{inferDeals:true});
 assert.deepEqual(active.remainingCounts,BAG);
});

test('scoreboard adjustment preserves the opening and cashes out before final close',()=>{
 const engine=new WordEngine(['TEMPOS','STOMPER','QI']);
 const baseline=new Challenger(engine),chasing=new Challenger(engine,{}, {scoreAware:2});
 const early={rack:counts('TEMPOS'),balance:100,remaining:40,score:30,leaderScore:100,auctionType:'FirstPrice' as const};
 assert.equal(chasing.play(early).wait,baseline.play(early).wait);
 assert.equal(chasing.bid(17,early).amount,baseline.bid(17,early).amount);
 const late={...early,remaining:1};assert.equal(chasing.play(late).wait,false);
 const before=late.rack.slice(),bid=chasing.bid(17,late);
 assert.ok(bid.amount>=0&&bid.amount<=late.balance);assert.deepEqual(late.rack,before);
 assert.equal(chasing.params.futureWeight,.8);
});

test('integer reserve leaves one-credit completion bids spendable',()=>{
 const engine=new WordEngine(['QI']),old=new Challenger(engine),fixed=new Challenger(engine,{}, {integerReserve:true});
 const p={rack:counts('Q'),balance:1,remaining:30,score:40,auctionType:'Vickrey' as const};
 assert.equal(old.bid(8,p).amount,0);assert.equal(fixed.bid(8,p).amount,1);
 for(let balance=1;balance<=8;balance++){
  const d=fixed.bid(8,{...p,balance});assert.ok(Number.isInteger(d.amount));assert.ok(d.amount>=0&&d.amount<=balance);
 }
 assert.equal(fixed.bid(8,{...p,remaining:0}).amount,0);
});
