import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GoalStrategy} from './goal-strategy.js';
import {WordEngine} from './word-engine.js';
import {counts,BAG} from './rules.js';
const engine=new WordEngine(['AT','CAT','CATS','QUIZ','RETAINS','RETAIN','RAIN','STAIN','TRAIN','TEA','EAT','TACT','TACTS']);
const pos=(rack:string,balance=100,remaining=40)=>({rack:counts(rack),balance,remaining,remainingCounts:BAG,auctionType:'Vickrey' as const});
test('goal bidding values an actual premium completion and rejects an isolated Q',()=>{
 const a=new GoalStrategy(engine);assert.equal(a.bid(16,pos('CAT')).amount,0);
 assert.ok(a.bid(25,pos('QUI')).amount>20);
 assert.equal(a.bid(25,pos('QUI',100,0)).amount,0);
 assert.equal(a.bid(25,pos('QUI',37,1)).amount,37);
});
test('a paid-for target preserves required letters until the completion auction resolves',()=>{
 const a=new GoalStrategy(engine),p=pos('RETAIN');
 const d=a.bid(18,p);assert.ok(d.amount>0);
 assert.equal(a.play(p).wait,true);
 const complete=pos('RETAINS',p.balance-d.amount,39);a.bid(4,complete);
 const play=a.play(complete);assert.equal(play.wait,false);assert.ok(engine.valid(play.id,complete.rack));
});
test('goal strategy liquidates every legal small word in the final usable window',()=>{
 for(const kind of ['Vickrey','FirstPrice'] as const)for(const letters of ['AT','TACT','QUIZ','CATS']){
  const a=new GoalStrategy(engine);const p={...pos(letters,10,0),auctionType:kind};
  a.bid(0,p);const d=a.play(p);assert.equal(d.wait,false);assert.ok(engine.valid(d.id,p.rack));
 }
});
test('goal decisions preserve duplicate counts and always respect available cash',()=>{
 for(let n=0;n<60;n++){
  const a=new GoalStrategy(engine),p={...pos(n%2?'TAC':'TACT',n,n%17),auctionType:n%2?'FirstPrice' as const:'Vickrey' as const};
  const before=p.rack.slice();const b=a.bid(n%26,p);assert.ok(Number.isInteger(b.amount)&&b.amount>=0&&b.amount<=p.balance);
  const play=a.play(p);if(!play.wait)assert.ok(engine.valid(play.id,p.rack));assert.deepEqual(p.rack,before);
 }
});
test('exhausted planning budget still realizes a legal ready word',()=>{
 const a=new GoalStrategy(engine,{budgetMs:0}),p=pos('AT');const d=a.play(p);
 assert.equal(d.wait,false);assert.ok(engine.valid(d.id,p.rack));assert.equal(d.fallback,true);
});
