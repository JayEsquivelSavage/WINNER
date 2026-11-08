import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BidSubmission} from './bid-submission.js';

test('a spent completion can lower or cancel its open auction bid',async()=>{
 const sent:number[]=[];
 const bids=new BidSubmission(async(_id,amount)=>{sent.push(amount);});
 await bids.submit(1n,20);await bids.submit(1n,4);await bids.submit(1n,0);
 assert.deepEqual(sent,[20,4,0]);
 await bids.submit(1n,0);await bids.submit(2n,0);
 assert.deepEqual(sent,[20,4,0]);
});
test('bid replacements serialize so the newest value remains on the server',async()=>{
 const sent:number[]=[];let release!:()=>void;
 const bids=new BidSubmission(async(_id,amount)=>{
  sent.push(amount);if(amount===20)await new Promise<void>(resolve=>{release=resolve;});
 });
 const first=bids.submit(1n,20),duplicate=bids.submit(1n,20),cancel=bids.submit(1n,0);
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(sent,[20]);
 release();await Promise.all([first,duplicate,cancel]);assert.deepEqual(sent,[20,0]);
});
test('a rejected bid is retried and does not block a later replacement',async()=>{
 let attempts=0;const sent:number[]=[];
 const bids=new BidSubmission(async(_id,amount)=>{sent.push(amount);if(++attempts===1)throw new Error('rejected');});
 await assert.rejects(bids.submit(1n,10),/rejected/);
 await bids.submit(1n,10);await bids.submit(1n,0);
 assert.deepEqual(sent,[10,10,0]);
});

import {MatchSession} from './session.js';
import {WordEngine} from './word-engine.js';
test('retries count an auction once and rejected pending cancellation cannot falsify observed price bounds',()=>{
 const session=new MatchSession(1n,1n,new WordEngine(['QI']),'challenger');
 session.bidStarted(1n,20);session.bidSettled(1n);
 session.bidStarted(1n,20);session.bidSettled(1n,20);
 assert.equal(session.bids,1);assert.equal(session.ourBids.get(1n),20);
 session.bidStarted(1n,0);
 const before=session.agent.model.distribution(0).slice();
 session.result(1n,'A',1n,20,'FirstPrice');session.bidSettled(1n);
 const after=session.agent.model.distribution(0);
 // The observed paid=20 pins a rival upper bound of 20 even if the
 // cancellation acknowledgement/rejection has not yet arrived.
 assert.ok(after[10]>before[10]*.995);
 assert.equal(session.ourBids.has(1n),false);
});
test('pending Vickrey withdrawal never treats the previous high bid as a rival lower bound',()=>{
 const session=new MatchSession(1n,1n,new WordEngine(['QI']),'challenger');
 session.bidStarted(1n,20);session.bidSettled(1n,20);session.bidStarted(1n,0);
 const before=session.agent.model.distribution(0).slice();
 session.result(1n,'A',2n,4,'Vickrey');session.bidSettled(1n,0);
 assert.ok(session.agent.model.distribution(0)[10]>before[10]*.995);
 assert.equal(session.ourBids.has(1n),false);
});

test('recovery resubmits zero when the old socket may have accepted a different bid',async()=>{
 const sent:number[]=[];const bids=new BidSubmission(async(_id,amount)=>{sent.push(amount);});
 await bids.submit(1n,20);bids.reset(1n);await bids.submit(1n,0);assert.deepEqual(sent,[20,0]);
});
test('recovery drops queued decisions from the lost socket generation',async()=>{
 const sent:number[]=[];let release!:()=>void;
 const bids=new BidSubmission(async(_id,amount)=>{sent.push(amount);if(amount===20)await new Promise<void>(r=>{release=r;});});
 const first=bids.submit(1n,20),stale=bids.submit(1n,30);
 await new Promise(r=>setImmediate(r));bids.reset(1n);release();await Promise.all([first,stale]);
 await bids.submit(1n,0);assert.deepEqual(sent,[20,0]);
});
