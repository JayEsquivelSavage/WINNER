import { expect,test } from '../../spacetimedb/node_modules/vitest/dist/index.js';
import { BAG,VALUES,reward,counts } from '../src/rules.js';
import { WordEngine } from '../src/word-engine.js';
import { loadDictionary } from '../src/dictionary.js';
import {GoalStrategy} from '../src/goal-strategy.js';
import { Challenger } from '../src/challenger.js';
import {BidSubmission} from '../src/bid-submission.js';
import { DEFAULT_BAG,letterValue,lengthMultiplier } from '../../spacetimedb/src/letters.js';
import { isValidWord } from '../../spacetimedb/src/dictionary.js';
import { joinLobby,submitBid,submitWord } from '../../spacetimedb/src/index.js';
import { newDb,teamWithBot,startMatch,VICKREY,FIRST_PRICE,currentAuction,participant,rack,setRack,call,tick,getMatch,lobbyTimeout,runToEnd } from '../../spacetimedb/src/tests/harness.js';
const engine=new WordEngine(loadDictionary().words);
class InformationChallenger extends Challenger {
 constructor(engine:WordEngine){super(engine,{}, {inferDeals:true,letterMarkets:true,integerReserve:true,exactEndgame:true});}
}
test('local rules and dictionary agree with the official server',()=>{
 for(let c=0;c<26;c++) {const char=String.fromCharCode(c+65);expect(VALUES[c]).toBe(letterValue(char));expect(BAG[c]).toBe(DEFAULT_BAG.find(([l])=>l===char)?.[1]);}
 for(let id=0;id<engine.words.length;id+=31){const w=engine.words[id];const base=[...w].reduce((s,c)=>s+letterValue(c),0);const [n,d]=lengthMultiplier(w.length);expect(engine.scores[id]).toBe(Number(BigInt(base)*n/d));expect(isValidWord(w)).toBe(true);}
});
test('real reducers accept challenger bids and repeated legal word submissions through an entire match',()=>{
 for(const Agent of [Challenger,GoalStrategy,InformationChallenger])for(const kind of [VICKREY,FIRST_PRICE]) {
  const db=newDb();const me=teamWithBot(db,'owner','WORDGOAT-test'),rival=teamWithBot(db,'other','rival-test');
  const mid=startMatch(db,kind,[me,rival]);const agent=new Agent(engine);
  let steps=0;
  while(getMatch(db,mid).status.tag==='Running'&&steps++<98) {
   const m=getMatch(db,mid),a=currentAuction(db,mid);
   for(let j=0;j<20;j++) {
    const r=new Uint8Array(26);for(const [l,n]of rack(db,mid,me))r[l.charCodeAt(0)-65]=n;
    const p=participant(db,mid,me),decision=agent.play({rack:r,balance:Number(p.balance),remaining:m.bagTotal,auctionType:kind.tag});
    if(decision.id<0||decision.wait)break;
    expect(()=>call(db,'WORDGOAT-test',tx=>submitWord(tx,{matchId:mid,word:engine.words[decision.id]}))).not.toThrow();
   }
   const r=new Uint8Array(26);for(const [l,n]of rack(db,mid,me))r[l.charCodeAt(0)-65]=n;
   const p=participant(db,mid,me),decision=agent.bid(a.letter.charCodeAt(0)-65,{rack:r,balance:Number(p.balance),remaining:m.bagTotal,auctionType:kind.tag});
   expect(decision.amount).toBeGreaterThanOrEqual(0);expect(decision.amount).toBeLessThanOrEqual(Number(p.balance));
   if(decision.amount)expect(()=>call(db,'WORDGOAT-test',tx=>submitBid(tx,{auctionId:a.id,amount:BigInt(decision.amount)}))).not.toThrow();
   tick(db,mid);
  }
  expect(getMatch(db,mid).status.tag).toBe('Ended');expect(steps).toBe(88);
 }
},30000);
test('actual final close ends before a real winner can submit the acquired word',()=>{
 const db=newDb();const me=teamWithBot(db,'owner','last-test'),rival=teamWithBot(db,'other','last-rival');
 const mid=startMatch(db,VICKREY,[me,rival]);while(getMatch(db,mid).bagTotal>0)tick(db,mid);
 setRack(db,mid,me,'QI');const a=currentAuction(db,mid);
 call(db,'last-test',tx=>submitBid(tx,{auctionId:a.id,amount:1n}));tick(db,mid);
 expect(()=>call(db,'last-test',tx=>submitWord(tx,{matchId:mid,word:'QI'}))).toThrow(/Match not running/);
});

test('serialized bid reductions and cancellation replace the bid in actual reducers',async()=>{
 for(const kind of [VICKREY,FIRST_PRICE]){
  const db=newDb(),me=teamWithBot(db,'owner','replace-me'),rival=teamWithBot(db,'other','replace-rival');
  const mid=startMatch(db,kind,[me,rival]),a=currentAuction(db,mid);
  const bids=new BidSubmission(async(id,amount)=>{call(db,'replace-me',tx=>submitBid(tx,{auctionId:id,amount:BigInt(amount)}));});
  await bids.submit(a.id,20);await bids.submit(a.id,4);await bids.submit(a.id,0);
  call(db,'replace-rival',tx=>submitBid(tx,{auctionId:a.id,amount:1n}));tick(db,mid);
  expect(participant(db,mid,me).balance).toBe(100n);
  expect(participant(db,mid,rival).balance).toBe(99n);
 }
});

test('official lobby registration, full match completion, and rejoining remain compatible',()=>{
 const db=newDb();const me=teamWithBot(db,'lobby-owner','lobby-WORDGOAT');
 call(db,'lobby-WORDGOAT',tx=>joinLobby(tx,{}));
 let lobby=[...db.db.lobby.iter()].find(l=>l.status.tag==='Open')!;
 expect([...db.db.lobbyMember.iter()].some(m=>m.botId===me&&m.lobbyId===lobby.id)).toBe(true);
 lobbyTimeout(db,lobby.id);const resolved=db.db.lobby.id.find(lobby.id)!;
 expect(resolved.resolvedMatchId).toBeDefined();runToEnd(db,resolved.resolvedMatchId!);
 call(db,'lobby-WORDGOAT',tx=>joinLobby(tx,{}));
 lobby=[...db.db.lobby.iter()].find(l=>l.status.tag==='Open')!;
 expect([...db.db.lobbyMember.iter()].some(m=>m.botId===me&&m.lobbyId===lobby.id)).toBe(true);
});
