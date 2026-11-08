import fs from 'node:fs';
import { loadDictionary } from '../src/dictionary.js';
import { WordEngine } from '../src/word-engine.js';
import { Challenger } from '../src/challenger.js';
import { counts,BAG,VALUES } from '../src/rules.js';
const history=JSON.parse(fs.readFileSync('reports/public-history.json','utf8'))[0];
const engine=new WordEngine(loadDictionary().words);
const results=history.auction_result.slice().sort((a:any,b:any)=>a.closed_at[0]-b.closed_at[0]);
const bids=new Map<number,number>(history.auction_top_bid_archive.map((a:any)=>[a.auction_id,a.top_bid]));
const runs=[];
for(const variant of ['champion','challenger']) {
 const agent=new Challenger(engine),rack=counts('TINGE'),seen=BAG.slice();for(let c=0;c<26;c++)seen[c]-=rack[c];
 let balance=100,score=0,spent=0,wins=0,words=0,letters=0,participated=0;
 for(let round=0;round<results.length;round++) {
  const row=results[round],c=row.letter.charCodeAt(0)-65,remaining=results.length-round-1;
  seen[c]=Math.max(0,seen[c]-1);
  for(let j=0;j<49;j++) {
   const decision=variant==='challenger'?agent.play({rack,balance,remaining,auctionType:'Vickrey',remainingCounts:seen}):{id:engine.best(rack),wait:false};
   if(decision.id<0||decision.wait)break;const id=decision.id;
   for(let i=0;i<26;i++)rack[i]-=engine.signatures[id*26+i];
   score+=engine.scores[id];balance+=engine.scores[id];words++;letters+=engine.lengths[id];
  }
  const originalWon=row.winner_bot_id[0]===0&&row.winner_bot_id[1]===175;
  const threshold=originalWon?row.paid:bids.get(row.auction_id)!;
  const bid=variant==='challenger'?agent.bid(c,{rack,balance,remaining,auctionType:'Vickrey',remainingCounts:seen}).amount:
    Math.min(balance,rack[c]===0?VALUES[c]+2:Math.max(1,VALUES[c]));
  if(bid>0)participated++;
  const won=bid>threshold||(bid===threshold&&originalWon);
  if(won) {rack[c]++;balance-=threshold;spent+=threshold;wins++;}
  agent.model.observe(c,'Vickrey',won?175n:BigInt(row.winner_bot_id[1]??999),won?threshold:row.paid,175n,bid);
 }
 runs.push({variant,score,balance,spent,wins,words,averageWordLength:letters/Math.max(1,words),participated,
 unused:[...rack].flatMap((n,c)=>Array(n).fill(String.fromCharCode(c+65))).join(''),
 playableAtEnd:engine.allPlayable(rack).map(id=>engine.words[id])});
}
const report={matchId:42763,real:{score:12,spent:13,wins:2,words:1,averageWordLength:5,unused:'QH',balance:99,auctions:68},runs,
 caveats:['Original bids and runtime failures are private/unavailable. 68 bid attempts are reconstructed from the saved policy, not verified submissions.',
 'TINGE consumed the five starting tiles before the first close, establishing the initial rack from public events.',
 'Historical replay freezes rival offers and uses archived post-match winning bids. Opponents would adapt in a real counterfactual match; this is a diagnostic stress test, not a win-rate estimate.',
 'Equal bids are awarded only where the original bot won. This deterministic convention reproduces its actual Q and final H wins.']};
fs.writeFileSync('reports/failure-replay.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
