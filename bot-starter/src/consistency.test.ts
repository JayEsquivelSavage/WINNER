import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Challenger} from './challenger.js';
import {WordEngine} from './word-engine.js';
import {counts} from './rules.js';
const engine=new WordEngine(['AT','CAT','CATS','CATER','CATERING']);
const position=(rack:string,remaining:number,score=30)=>({rack:counts(rack),remaining,score,balance:100,auctionType:'Vickrey' as const});
test('small-word scoring window survives acquisitions and repeated callbacks',()=>{
 const a=new Challenger(engine,{waitDiscount:0,liquidity:0},{scoringWindow:3});
 a.play(position('AT',40));a.play(position('CAT',39));a.play(position('CAT',39));
 const d=a.play(position('CATS',37));assert.equal(d.wait,false);assert.match(d.reason??'',/scoring window/);assert.ok(engine.valid(d.id,counts('CATS')));
 // An unaccepted submission must not reset the clock.
 assert.match(a.play(position('CATS',36)).reason??'',/scoring window/);
});
test('authoritative score or rack consumption starts a fresh scoring window',()=>{
 const a=new Challenger(engine,{waitDiscount:0,liquidity:0},{scoringWindow:3});
 a.play(position('CAT',40));a.play(position('CATS',37));
 assert.doesNotMatch(a.play(position('AT',36,40)).reason??'',/scoring window/);
 assert.match(a.play(position('AT',33,40)).reason??'',/scoring window/);
});

import {CycleStrategy} from './cycle-strategy.js';
import {DEFAULTS} from './config.js';
test('cycle pricing preserves opening decisions and restores configured parameters',()=>{
 const p=position('CA',40,0);
 const cycle=new CycleStrategy(engine,{bidScale:1,futureWeight:.4});
 const baseline=new Challenger(engine);
 assert.equal(cycle.bid(19,p).amount,baseline.bid(19,p).amount);
 assert.equal(cycle.play(p).wait,baseline.play(p).wait);
 assert.equal(cycle.params.bidScale,1);assert.equal(cycle.params.futureWeight,.4);
 const earned=position('CA',40,30);
 const configured=new Challenger(engine,{...DEFAULTS,bidScale:1,futureWeight:.4});
 assert.equal(cycle.bid(19,earned).amount,configured.bid(19,earned).amount);
});
