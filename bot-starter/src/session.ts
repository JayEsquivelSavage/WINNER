import {CycleStrategy} from './cycle-strategy.js';
import { Challenger,type Position,type BidDecision,type FinishingPolicy,type PlayDecision } from './challenger.js';
import { chooseWord as championWord,decideBid as championBid } from './champion.js';
import { GoalStrategy } from './goal-strategy.js';
import { DeployedChallenger } from './deployed.js';
import { percentileFromHistogram,type MatchRecord,type PriceEvidence } from './match-record.js';
import { WordEngine,RackState } from './word-engine.js';
import { BAG,rackMap,type AuctionKind } from './rules.js';
import type { Parameters } from './config.js';
export type StrategyMode='champion'|'challenger';
export function rackText(rack:Uint8Array):string {let s='';for(let c=0;c<26;c++)s+=String.fromCharCode(c+65).repeat(rack[c]);return s;}
export class MatchSession {
 readonly rack=new RackState();readonly agent:Challenger|DeployedChallenger;
 readonly evidence:PriceEvidence[]=[];readonly decisions:NonNullable<MatchRecord["decisions"]>=[];
 droppedDecisions=0;invalidActions=0;deadlineRejections=0;readonly acceptedAuctions=new Set<bigint>();coverage:MatchRecord["coverage"]="partial-session";readonly remainingCounts=BAG.slice();
 readonly seenAuctions=new Set<bigint>();readonly seenResults=new Set<bigint>();readonly seenWords=new Set<bigint>();
 readonly ourBids=new Map<bigint,number>();
 readonly pendingBids=new Set<bigint>();private readonly attemptedAuctions=new Set<bigint>();
 initialRackAccounted=false;lastBidAuction:bigint|undefined;lastBidKey='';lastWordKey='';
 auctions=0;bids=0;wins=0;spent=0;words=0;points=0;lettersPlayed=0;waits=0;errors=0;lateSkips=0;
 readonly bidLatency=new Uint32Array(32);readonly wordLatency=new Uint32Array(32);
 constructor(readonly matchId:bigint,readonly botId:bigint,readonly engine:WordEngine,readonly mode:StrategyMode,params:Partial<Parameters>={},algorithm:'deployed'|'challenger'|'goal'|'cycle'='challenger',finishing:Partial<FinishingPolicy>={}) {this.agent=algorithm==='cycle'?new CycleStrategy(engine,params):algorithm==='goal'?new GoalStrategy(engine,params):algorithm==='deployed'?new DeployedChallenger(engine,params):new Challenger(engine,params,finishing);}
 auction(id:bigint,letter:string) {
  if(this.seenAuctions.has(id))return;this.seenAuctions.add(id);this.auctions++;
  const c=letter.charCodeAt(0)-65;this.remainingCounts[c]=Math.max(0,this.remainingCounts[c]-1);
 }
 result(id:bigint,letter:string,winner:bigint|undefined,paid:number,kind:AuctionKind):boolean {
  if(this.seenResults.has(id))return false;this.seenResults.add(id);
  // A result may precede a replacement's acknowledgement. First-price own
  // wins reveal our accepted bid through paid; pending Vickrey replacements
  // reveal no reliable own-bid lower bound beyond the public payment.
  const knownBid=kind==='FirstPrice'&&winner===this.botId?paid:this.pendingBids.has(id)?0:this.ourBids.get(id)??0;
  this.agent.model.observe(letter.charCodeAt(0)-65,kind,winner,paid,this.botId,knownBid);
  this.ourBids.delete(id);
  if(this.evidence.length<98)this.evidence.push({auctionId:String(id),letter,kind,winner:winner===undefined?null:String(winner),paid,
    rivalMax:winner===undefined?0:winner===this.botId?(kind==='Vickrey'&&paid>1?paid:null):kind==='FirstPrice'?paid:null});
  if(winner===this.botId){this.wins++;this.spent+=paid;}return true;
 }
 bidStarted(id:bigint,amount:number){
  this.pendingBids.add(id);
  if(amount>0&&!this.attemptedAuctions.has(id)){this.attemptedAuctions.add(id);this.bids++;}
 }
 bidSettled(id:bigint,accepted?:number){
  this.pendingBids.delete(id);
  if(accepted!==undefined){
   this.acceptedAuctions.add(id);
   if(!this.seenResults.has(id))this.ourBids.set(id,accepted);
  }
 }
 word(id:bigint,botId:bigint,word:string,points:number):boolean {
  if(this.seenWords.has(id))return false;this.seenWords.add(id);
  if(botId===this.botId){this.words++;this.points+=points;this.lettersPlayed+=word.length;}
  else if(this.agent instanceof Challenger&&this.agent.finishing.inferDeals) {
   const opponent=this.agent.model.get(botId),before=opponent.initialRevealed.slice();
   this.agent.model.word(botId,word);
   for(let c=0;c<26;c++)this.remainingCounts[c]=Math.max(0,this.remainingCounts[c]-(opponent.initialRevealed[c]-before[c]));
  }else this.agent.model.word(botId,word);return true;
 }
 position(balance:number,remaining:number,auctionType:AuctionKind,score:number,leaderScore:number):Position {
  return {rack:this.rack.counts,balance,remaining,auctionType,remainingCounts:this.remainingCounts,score,leaderScore};
 }
 bid(letter:string,p:Position):BidDecision {
  const started=performance.now();
  const d=this.mode==='challenger'?this.agent.bid(letter.charCodeAt(0)-65,p):
   {amount:championBid({letter,myBalance:p.balance,myRack:rackMap(p.rack)}),value:0,utility:0,elapsedMs:0,fallback:false};
  d.amount=Math.max(0,Math.min(Math.floor(p.balance),Math.floor(d.amount)));
  d.elapsedMs=performance.now()-started;this.decision({kind:'bid',auctionId:String(this.lastBidAuction??''),rack:rackText(p.rack),remaining:p.remaining,balance:p.balance,score:p.score,leaderScore:p.leaderScore,value:d.value,bid:d.amount});this.record(this.bidLatency,d.elapsedMs);return d;
 }
 play(p:Position):{id:number;word:string|null;best:string|null;bestScore:number;reason:string;elapsedMs:number} {
  const started=performance.now(),best=this.engine.best(p.rack);
  let id=-1,reason='no legal word';
  if(this.mode==='challenger') {
   const d:PlayDecision=this.agent.play(p);id=d.wait?-1:d.id;
   reason=d.reason??(d.wait?(d.id<0?'no legal word':'bounded future value exceeds playing now'):
    d.fallback?'budget fallback':p.remaining<=3?'endgame liquidation':'score plus leave value and liquidity');
  } else {
   const w=championWord({myRack:rackMap(p.rack),dictionary:this.engine.words as string[]});
   if(w)id=this.engine.words.indexOf(w);reason='previous WORDGOAT policy';
  }
  const elapsedMs=performance.now()-started;this.record(this.wordLatency,elapsedMs);
  if(id<0&&best>=0)this.waits++;
  this.decision({kind:'word',rack:rackText(p.rack),remaining:p.remaining,balance:p.balance,score:p.score,leaderScore:p.leaderScore,best:best<0?null:this.engine.words[best],bestScore:best<0?0:this.engine.scores[best],chosen:id<0?null:this.engine.words[id],reason});
  return {id,word:id<0?null:this.engine.words[id],best:best<0?null:this.engine.words[best],bestScore:best<0?0:this.engine.scores[best],reason,elapsedMs};
 }
 decision(d:NonNullable<MatchRecord['decisions']>[number]) {if(this.decisions.length>=256){this.decisions.shift();this.droppedDecisions++;}this.decisions.push(d);}
 actionFailure(message:string) {
  this.errors++;
  if(/expired|Auction closed|Match not running/.test(message))this.deadlineRejections++;
  if(/Not enough|dictionary|Insufficient balance|non-negative|A-Z|at least 2/.test(message))this.invalidActions++;
 }
 toRecord(meta:{venue:string;startedAt:string;endedAt:string;strategyVersion:string;profileId:string;score:number;balance:number;opponents:MatchRecord['opponents']}):MatchRecord {
  return {schema:1,source:'runtime',...meta,matchId:String(this.matchId),botId:String(this.botId),placement:1+meta.opponents.filter(p=>p.score>meta.score).length,
    auctions:this.auctions,participated:this.coverage==='full-session'?this.bids:null,acceptedBids:this.acceptedAuctions.size,
    lettersWon:this.wins,spent:this.spent,words:[],unusedRack:rackText(this.rack.counts),unusedTiles:this.rack.counts.reduce((a,b)=>a+b,0),invalidActions:this.invalidActions,deadlineRejections:this.deadlineRejections,
    lateBidSkips:this.lateSkips,bidP99Ms:percentileFromHistogram(this.bidLatency),wordP99Ms:percentileFromHistogram(this.wordLatency),
    peakRssMiB:process.resourceUsage().maxRSS/1024,waits:this.waits,coverage:this.coverage,evidence:this.evidence.slice(),decisions:this.decisions.slice(),droppedDecisions:this.droppedDecisions};
 }
 private record(hist:Uint32Array,ms:number) {const bin=Math.min(31,Math.max(0,Math.ceil(Math.log2(Math.max(.001,ms)*1000))));hist[bin]++;}
 summary(score:number,balance:number) {
  return {strategy:this.mode,score,balance,auctionsSeen:this.auctions,bidsSent:this.bids,lettersWon:this.wins,
   spent:this.spent,words:this.words,pointsRecorded:this.points,averageWordLength:this.words?this.lettersPlayed/this.words:0,
   unusedRack:rackText(this.rack.counts),playableAtEnd:this.engine.best(this.rack.counts)>=0,
   waitDecisions:this.waits,errors:this.errors,lateBidSkips:this.lateSkips,fallbacks:this.agent.fallbacks,
   bidLatencyLog2Microseconds:[...this.bidLatency],wordLatencyLog2Microseconds:[...this.wordLatency]};
 }
}
