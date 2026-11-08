import { VALUES, type AuctionKind } from './rules.js';
const BINS=129;
const group=(letter:number)=>'AEIOU'.includes(String.fromCharCode(letter+65))?0:VALUES[letter]>=5?2:1;
export interface Opponent { id:bigint; wins:number; paid:number; words:number; score:number; balance:number; acquired:Uint8Array; }
/** Posterior over highest competing bid, not the winning bot's valuation.
 * Exact, upper-censored, and lower-censored evidence have distinct updates.
 * Vickrey opponent wins reveal only a lower bound, never an exact top bid. */
export class OpponentModel {
  readonly rivals=new Map<bigint,Opponent>();
  readonly hist:Float64Array[];
  constructor(marketPrior=0) {
    // Optional weak historical prior from public *ended* match 42763. One
    // match is not representative, so live censored observations still learn
    // and a tuning ablation determines whether this prior is promoted.
    this.hist=Array.from({length:3},(_,g)=> {
      const center=marketPrior?([12.41,16.38,30.2][g]):(g===2?12:g===0?7:5);
      const h=new Float64Array(BINS);let sum=0;
      for(let i=0;i<BINS;i++){h[i]=Math.exp(-Math.abs(i-center)/(marketPrior?7:5));sum+=h[i];}
      for(let i=0;i<BINS;i++)h[i]=h[i]/sum*8;return h;
    });
  }
  observations=0;
  get(id:bigint):Opponent {
    let p=this.rivals.get(id);
    if(!p) { if(this.rivals.size>=12) this.rivals.delete(this.rivals.keys().next().value!);
      p={id,wins:0,paid:0,words:0,score:0,balance:100,acquired:new Uint8Array(26)};this.rivals.set(id,p); }
    return p;
  }
  participant(id:bigint,balance:number,score:number) {const p=this.get(id);p.balance=balance;p.score=score;}
  word(id:bigint,word:string) {const p=this.get(id);p.words++;for(const c of word) {const i=c.charCodeAt(0)-65;p.acquired[i]=Math.max(0,p.acquired[i]-1);} }
  observe(letter:number,kind:AuctionKind,winner:bigint|undefined,paid:number,self:bigint,ourBid:number) {
    if(winner!==undefined&&winner!==self) {const p=this.get(winner);p.wins++;p.paid+=paid;p.acquired[letter]++;}
    const h=this.hist[group(letter)];
    // Mild forgetting prevents old regimes from overwhelming current play.
    for(let i=0;i<BINS;i++) h[i]*=.995;
    let lo=0,hi=BINS-1;
    if(winner===undefined) hi=0;
    else if(kind==='FirstPrice'&&winner!==self) lo=hi=Math.min(128,paid);
    else if(kind==='Vickrey'&&winner===self) {if(paid<=1){lo=0;hi=1;}else lo=hi=Math.min(128,paid);}
    else if(kind==='FirstPrice') hi=Math.min(128,ourBid);
    else lo=Math.min(128,Math.max(paid,ourBid));
    let sum=0;for(let i=lo;i<=hi;i++) sum+=h[i];
    if(sum>0) for(let i=lo;i<=hi;i++) h[i]+=h[i]/sum;
    this.observations++;
  }
  distribution(letter:number):Float64Array {return this.hist[group(letter)];}
  winProbability(letter:number,bid:number):number {
    const h=this.distribution(letter);let total=0,win=0;
    for(let m=0;m<h.length;m++) {total+=h[m];if(m<bid)win+=h[m];else if(m===bid)win+=h[m]*.5;}
    return total?win/total:0;
  }
}
