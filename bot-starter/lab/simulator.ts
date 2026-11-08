import {CycleStrategy} from '../src/cycle-strategy.js';
import { GoalStrategy } from '../src/goal-strategy.js';
import { WordEngine } from '../src/word-engine.js';
import { Challenger,type Position,type FinishingPolicy } from '../src/challenger.js';
import { BAG, VALUES, type Rack, type AuctionKind } from '../src/rules.js';
import { DeployedChallenger,DEPLOYED_DEFAULTS } from '../src/deployed.js';
import { applyPrior,type PricePrior } from '../src/learning.js';
import { DEFAULTS,type Parameters } from '../src/config.js';
export type BotKind='challenger'|'champion'|'starter'|'random'|'greedy'|'fixed'|'economy'|'aggressive'|'rival';
export function rng(seed:number):()=>number {let x=seed>>>0;return ()=> {x=(Math.imul(x,1664525)+1013904223)>>>0;return x/4294967296;};}
export interface Player {
  kind:BotKind;id:bigint;rack:Rack;balance:number;score:number;halfScore:number;spent:number;wins:number;bids:number;
  words:number;lettersPlayed:number;invalid:number;missed:number;deadlines:number;
  agent:Challenger|DeployedChallenger;lastPlayKey:string;latencyBid:number[];latencyWord:number[];
}
export interface MatchResult {seed:number;kind:AuctionKind;players:Player[];rounds:number;}
// Cache exact official longest selection separately; bounded across simulations.
const longestCache=new Map<string,number>();
function longest(engine:WordEngine,rack:Rack):number {
 const key=String.fromCharCode(...rack);const cached=longestCache.get(key);if(cached!==undefined)return cached;
 let id=-1;for(const w of engine.allPlayable(rack)) if(id<0||engine.lengths[w]>engine.lengths[id]||
   (engine.lengths[w]===engine.lengths[id]&&engine.words[w]<engine.words[id]))id=w;
 if(longestCache.size>=2048)longestCache.delete(longestCache.keys().next().value!);longestCache.set(key,id);return id;
}
function remove(p:Player,engine:WordEngine,id:number) {
 if(!engine.valid(id,p.rack)) {p.invalid++;return;}
 for(let c=0;c<26;c++) p.rack[c]-=engine.signatures[id*26+c];
 const points=engine.scores[id];p.score+=points;p.balance+=points;p.words++;p.lettersPlayed+=engine.lengths[id];
}
function position(p:Player,remaining:number,kind:AuctionKind,seen:Uint8Array,players:Player[]):Position {
 return {rack:p.rack,balance:p.balance,remaining,auctionType:kind,remainingCounts:seen,score:p.score,leaderScore:Math.max(...players.map(q=>q.score))};
}
export function simulate(engine:WordEngine,seed:number,roster:BotKind[],kind:AuctionKind='Vickrey',params:Partial<Parameters>={},
 options:{startingRack?:number;deadlineMs?:number;learn?:boolean;algorithm?:'deployed'|'challenger'|'goal'|'cycle';prior?:PricePrior;cutoff?:string;finishing?:FinishingPolicy}={}):MatchResult {
 const random=rng(seed),ties=rng(seed^0x938f21),behaviour=rng(seed^0x1b3a55);
 const bag:number[]=[];for(let c=0;c<26;c++)for(let j=0;j<BAG[c];j++)bag.push(c);
 for(let i=bag.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}
 const players:Player[]=roster.map((k,i)=>({kind:k,id:BigInt(i+1),rack:new Uint8Array(26),balance:100,score:0,halfScore:0,spent:0,wins:0,bids:0,
  words:0,lettersPlayed:0,invalid:0,missed:0,deadlines:0,agent:k==='challenger'&&options.algorithm==='cycle'?new CycleStrategy(engine,params):k==='challenger'&&options.algorithm==='goal'?new GoalStrategy(engine,params):k==='rival'?new DeployedChallenger(engine,DEPLOYED_DEFAULTS):k==='challenger'&&options.algorithm==='deployed'?new DeployedChallenger(engine,params):new Challenger(engine,params,k==='challenger'?options.finishing:undefined),lastPlayKey:'',latencyBid:[],latencyWord:[]}));
 if(options.prior)for(const p of players)if(p.kind==='challenger')applyPrior(p.agent.model.hist,options.prior,options.prior.venue,kind,options.cutoff??options.prior.cutoff);
 let offset=0;
 for(const p of players)for(let i=0;i<(options.startingRack??5);i++)p.rack[bag[offset++]]++;
 // This is a belief, not the simulator's actual hidden bag. Subtract only
 // own initial tiles and public auction draws. Never pass opponents' racks.
 const beliefs=players.map(p=>{const b=BAG.slice();for(let c=0;c<26;c++)b[c]-=p.rack[c];return b;});
 const play=(p:Player,remaining:number)=>{
  for(let action=0;action<49;action++) {
   const key=String.fromCharCode(...p.rack)+':'+remaining+':'+Math.floor(p.balance/10);
   if(key===p.lastPlayKey)break;p.lastPlayKey=key;
   let id=-1,wait=false;const started=performance.now();
   if(p.kind==='challenger'||p.kind==='rival'){const d=p.agent.play(position(p,remaining,kind,beliefs[Number(p.id)-1],players));id=d.id;wait=d.wait;}
   else if(p.kind==='starter') id=longest(engine,p.rack);
   else if(p.kind==='economy'&&remaining>8&&p.balance>=20) {id=engine.best(p.rack);wait=id>=0&&engine.lengths[id]<5;}
   else if(p.kind==='random') {const all=engine.allPlayable(p.rack);id=all.length?all[Math.floor(behaviour()*all.length)]:-1;}
   else id=engine.best(p.rack);
   const elapsed=performance.now()-started;p.latencyWord.push(elapsed);
   if(elapsed>(options.deadlineMs??1000))p.deadlines++;
   if(id<0||wait)break;remove(p,engine,id);
   for(const q of players)if(q!==p){
    if(q.kind==='challenger'&&options.finishing?.inferDeals&&q.agent instanceof Challenger){
     const rival=q.agent.model.get(p.id),before=rival.initialRevealed.slice();
     q.agent.model.word(p.id,engine.words[id]);
     for(let c=0;c<26;c++)beliefs[Number(q.id)-1][c]=Math.max(0,beliefs[Number(q.id)-1][c]-(rival.initialRevealed[c]-before[c]));
    }else q.agent.model.word(p.id,engine.words[id]);
   }
  }
 };
 const auctionCount=bag.length-offset;let checkpoint=false;
 let rounds=0;
 while(offset<bag.length) {
  const letter=bag[offset++],remaining=bag.length-offset;rounds++;
  if(!checkpoint&&remaining<auctionCount/2){for(const p of players)p.halfScore=p.score;checkpoint=true;}
  for(let i=0;i<players.length;i++)beliefs[i][letter]=Math.max(0,beliefs[i][letter]-1);
  // Real bots may play initial racks and between auctions, before final close.
  for(const p of players)if(!(p.kind==='challenger'&&options.algorithm==='goal'))play(p,remaining);
  const bids=players.map(p=>{
   const started=performance.now();let b=0;
   if(p.kind==='challenger'||p.kind==='rival'){b=p.agent.bid(letter,position(p,remaining,kind,beliefs[Number(p.id)-1],players)).amount;
    if(p.kind==='challenger'&&options.algorithm==='goal'){const old=p.balance;play(p,remaining);if(p.balance!==old)b=p.agent.bid(letter,position(p,remaining,kind,beliefs[Number(p.id)-1],players)).amount;}
   }
   else if(p.kind==='champion'||p.kind==='starter') b=p.rack[letter]===0?VALUES[letter]+2:Math.max(1,VALUES[letter]);
   else if(p.kind==='fixed') b=6;
   else if(p.kind==='greedy') {const before=engine.best(p.rack);p.rack[letter]++;const after=engine.best(p.rack);p.rack[letter]--;b=Math.max(VALUES[letter]+2,(after<0?0:engine.scores[after])-(before<0?0:engine.scores[before]));}
   else if(p.kind==='aggressive')b=VALUES[letter]+('AEIOU'.includes(String.fromCharCode(65+letter))?12:8);
   else if(p.kind==='economy')b=Math.min(Math.max(1,VALUES[letter]),Math.floor(p.balance/8));
   else b=1+Math.floor(behaviour()*12);
   b=Math.min(p.balance,Math.max(0,Math.floor(b)));
   const elapsed=performance.now()-started;p.latencyBid.push(elapsed);if(elapsed>(options.deadlineMs??1000))p.deadlines++;
   if(b>0)p.bids++;if(b<0||b>p.balance||!Number.isInteger(b))p.invalid++;return b;
  });
  const order=players.map((_,i)=>i);for(let i=order.length-1;i>0;i--){const j=Math.floor(ties()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
  order.sort((a,b)=>bids[b]-bids[a]);
  const wi=order[0],winner=bids[wi]>0?players[wi]:undefined;
  const paid=winner?(kind==='FirstPrice'?bids[wi]:Math.max(1,bids[order[1]]??0)):0;
  if(winner){winner.rack[letter]++;winner.balance-=paid;winner.spent+=paid;winner.wins++;}
  for(let i=0;i<players.length;i++) {
   const p=players[i];if(options.learn!==false||p.kind!=='challenger')p.agent.model.observe(letter,kind,winner?.id,paid,p.id,bids[i]);
   for(const q of players)if(q!==p)p.agent.model.participant(q.id,q.balance,q.score);
  }
  // Critical: real bots receive no opportunity to submit after the last close.
  if(!remaining)break;
 }
 for(const p of players) {if(engine.best(p.rack)>=0)p.missed++;}
 return {seed,kind,players,rounds};
}
export function percentile(values:number[]) {const a=values.slice().sort((a,b)=>a-b);return {p50:a[Math.floor(a.length*.5)]??0,p95:a[Math.floor(a.length*.95)]??0,p99:a[Math.floor(a.length*.99)]??0,max:a.at(-1)??0};}
export function wilson(wins:number,n:number) {
 const z=1.96,p=wins/n,den=1+z*z/n,mid=(p+z*z/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;
 return [Math.max(0,mid-half),Math.min(1,mid+half)];
}
