import {test} from 'node:test';
import assert from 'node:assert/strict';
import {solveEndgame} from './endgame.js';
import {Challenger} from './challenger.js';
import {WordEngine} from './word-engine.js';
import {counts} from './rules.js';

test('endgame chooses two compatible words over the highest single reward',()=>{
 const engine=new WordEngine(['ABCDEFG','ABCDJ','EFGHI']);
 const rack=counts('ABCDEFGHIJ'),before=rack.slice();
 const result=solveEndgame(engine,rack,performance.now()+1000);
 assert.equal(result.complete,true);assert.equal(result.score,58);
 assert.ok(['ABCDJ','EFGHI'].includes(engine.words[result.first]));
 assert.deepEqual(rack,before);
});
test('endgame counts repeated letters once per consumption and permits unplayable leftovers',()=>{
 const engine=new WordEngine(['AA','AB','BA']);
 const result=solveEndgame(engine,counts('AAABZ'),performance.now()+1000);
 assert.equal(result.complete,true);assert.equal(result.score,6);
});
test('expired or oversized searches decline without mutating the rack',()=>{
 const engine=new WordEngine(['AA']),rack=counts('AAAAAAAAAAAAA'),before=rack.slice();
 assert.equal(solveEndgame(engine,rack,performance.now()+1000).complete,false);
 assert.equal(solveEndgame(engine,counts('AA'),0).complete,false);
 assert.deepEqual(rack,before);
});
test('last usable auction rejects a tile that cannot increase convertible score',()=>{
 const engine=new WordEngine(['QI','AT']);
 const agent=new Challenger(engine,{}, {exactEndgame:true});
 const p={rack:counts(''),balance:8,remaining:1,score:59,auctionType:'Vickrey' as const};
 assert.equal(agent.bid(0,p).amount,0);
 assert.equal(agent.bid(8,{...p,rack:counts('Q')}).amount,8);
 assert.equal(agent.bid(8,{...p,rack:counts('Q'),remaining:0}).amount,0);
 // Acquiring a high face-value tile is also useless when it only replaces
 // an equally valuable existing liquidation.
 assert.equal(agent.bid(16,{...p,rack:counts('QI')}).amount,0);
});
test('candidate preserves opening decisions and realizes the best final partition',()=>{
 const engine=new WordEngine(['ABCDEFG','ABCDJ','EFGHI','QI','AT']);
 const base=new Challenger(engine),candidate=new Challenger(engine,{}, {exactEndgame:true});
 const p={rack:counts('ABCDEFGHIJ'),balance:40,remaining:30,score:20,auctionType:'FirstPrice' as const};
 assert.equal(candidate.bid(16,p).amount,base.bid(16,p).amount);
 assert.equal(candidate.play(p).wait,base.play(p).wait);
 const end=candidate.play({...p,remaining:2});
 assert.equal(end.wait,false);assert.ok(['ABCDJ','EFGHI'].includes(engine.words[end.id]));
});
