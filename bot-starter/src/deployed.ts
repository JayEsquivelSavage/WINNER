// Frozen gameplay implementation deployed after e3c84dd. Do not tune this copy.
import { type Parameters } from './config.js';
import { BAG, VALUES, type Rack, type AuctionKind } from './rules.js';
import { WordEngine } from './word-engine.js';
import { OpponentModel } from './deployed-opponents.js';
export interface Position {
  rack:Rack; balance:number; remaining:number; auctionType:AuctionKind;
  // Estimate from public draws; hidden starting opponent tiles stay uncertain.
  remainingCounts?:Readonly<Uint8Array>; score?:number; leaderScore?:number;
}
export interface BidDecision { amount:number; value:number; utility:number; elapsedMs:number; fallback:boolean; }
export interface PlayDecision { id:number; wait:boolean; elapsedMs:number; fallback:boolean; }
export const DEPLOYED_DEFAULTS:Parameters={bidScale:1.4,reserve:8,futureWeight:.8,captureRate:.22,waitDiscount:.07,liquidity:.5,leaveWeight:1,denial:0,beam:4,budgetMs:6,marketPrior:0};
export class DeployedChallenger {
  readonly model:OpponentModel;
  readonly params:Parameters;
  fallbacks=0;
  constructor(readonly engine:WordEngine,params:Partial<Parameters>={}) {this.params={...DEPLOYED_DEFAULTS,...params};this.model=new OpponentModel(this.params.marketPrior);}
  private score(id:number):number {return id<0?0:this.engine.scores[id];}
  /** Two-word liquidation is a bounded alternative to picking one large word.
   * Final liquidation is repeatedly invoked after authoritative rack changes. */
  private liquidate(rack:Rack,deadline:number):{value:number;first:number} {
    const top=this.engine.top(rack);let value=0,first=-1;
    for(let j=0;j<Math.min(this.params.beam,top.length);j++) {
      const id=top[j]; const leave=this.engine.subtract(rack,id);
      const v=this.score(id)+this.params.leaveWeight*this.score(this.engine.best(leave));
      if(v>value) {value=v;first=id;}
      if(performance.now()>deadline) break;
    }
    return {value,first};
  }
  private future(rack:Rack,p:Position,base:number,deadline:number):number {
    if(p.remaining<=1) return 0;
    const expected=p.remainingCounts??BAG;
    let total=0,gain=0;
    // Approximate next OWNED tile, not the next auctioned tile. Capture rate
    // discounts availability and is fitted only on training seeds.
    for(let c=0;c<26;c++) {
      if(!expected[c]) continue;
      rack[c]++;
      const after=this.score(this.engine.best(rack));
      rack[c]--;
      gain+=expected[c]*Math.max(0,after-base);total+=expected[c];
      if(performance.now()>deadline) break;
    }
    const horizon=Math.min(2.5,(p.remaining-1)*this.params.captureRate);
    return total?gain/total*horizon:0;
  }
  bid(letter:number,p:Position):BidDecision {
    const start=performance.now(),deadline=start+this.params.budgetMs;
    if(p.remaining<=0||p.balance<1) return {amount:0,value:0,utility:0,elapsedMs:performance.now()-start,fallback:false};
    const before=this.liquidate(p.rack,deadline);
    const oldPotential=this.future(p.rack,p,this.score(this.engine.best(p.rack)),deadline);
    const afterRack=p.rack.slice();afterRack[letter]++;
    const after=this.liquidate(afterRack,deadline);
    const newPotential=this.future(afterRack,p,this.score(this.engine.best(afterRack)),deadline);
    const exhausted=performance.now()>deadline;
    // Value is points, converted to currency by a state-dependent shadow price.
    // Liquidation generates cash; a cash-starved rack gives that cash extra value.
    const liquidity=p.balance<20?this.params.liquidity*(20-p.balance)/20:0;
    const completion=Math.max(0,after.value-before.value);
    const potentialGain=exhausted?0:newPotential-oldPotential;
    let value=completion*(1+liquidity)+this.params.futureWeight*potentialGain;
    // Small productive-tile option value supports building empty racks. It
    // shrinks with duplication and with the remaining acquisition horizon.
    const vowels=[0,4,8,14,20].reduce((n,c)=>n+p.rack[c],0);
    const tiles=p.rack.reduce((a,b)=>a+b,0);
    const balanceQuality='AEIOU'.includes(String.fromCharCode(65+letter))?Math.max(.25,1.5-vowels/Math.max(1,tiles)*2):1;
    value+=Math.min(1,p.remaining/12)*balanceQuality*(Math.min(VALUES[letter],3)+2)/(1+p.rack[letter]*1.5);
    // Rare face values do not justify buying stranded consonants. A proven
    // completion overrides this discount; prospective single-tile bridges
    // must have meaningful expected value, not just one unlikely spelling.
    if(VALUES[letter]>=8&&completion===0&&potentialGain<5) value*=.25;
    value=Math.max(0,value*this.params.bidScale);
    // Last auction cannot be converted by a real bot. remaining is bagTotal,
    // the number of FUTURE draws after the current auction letter was removed.
    const rounds=Math.max(1,p.remaining);
    const reserve=this.params.reserve*Math.min(1,rounds/12);
    const spendable=Math.max(0,Math.floor(p.balance-reserve));
    let shadow=Math.max(p.remaining<=3?.03:.15,Math.min(2.5,(rounds*this.params.captureRate*5)/(p.balance+15)));
    // On the last USABLE auction, currency has zero future value. The final
    // auction itself is already rejected above (remaining=0).
    if(p.remaining===1&&completion>0) return {amount:p.balance,value,utility:completion,elapsedMs:performance.now()-start,fallback:exhausted};
    let cap=Math.min(spendable,Math.floor(value/shadow));
    if(after.value>before.value+20) cap=Math.min(p.balance,Math.max(cap,Math.floor(value/shadow)));
    let amount=0,utility=0;
    const h=this.model.distribution(letter);let total=0;for(const x of h) total+=x;
    let mass=0,cost=0;
    for(let b=1;b<=Math.min(cap,512);b++) {
      const m=b-1;
      if(m<h.length) {mass+=h[m];cost+=h[m]*Math.max(1,m);}
      const tie=b<h.length?h[b]*.5:0;
      const win=(mass+tie)/total;
      const payment=p.auctionType==='FirstPrice'?b*win:(cost+tie*Math.max(1,b))/total;
      const u=value*win-shadow*payment;
      if(u>utility+1e-9) {utility=u;amount=b;}
    }
    if(exhausted) this.fallbacks++;
    return {amount,value,utility,elapsedMs:performance.now()-start,fallback:exhausted};
  }
  play(p:Position):PlayDecision {
    const start=performance.now(),deadline=start+this.params.budgetMs;
    const immediate=this.liquidate(p.rack,deadline);
    if(immediate.first<0) return {id:-1,wait:true,elapsedMs:performance.now()-start,fallback:false};
    if(p.remaining<=3) return {id:immediate.first,wait:false,elapsedMs:performance.now()-start,fallback:false};
    const potential=this.future(p.rack,p,this.score(this.engine.best(p.rack)),deadline);
    const urgency=this.params.waitDiscount+Math.max(0,(12-p.remaining)/12)*.6;
    const waitValue=immediate.value*(1-urgency)+this.params.futureWeight*potential;
    let best=-1,bestValue=-Infinity;
    for(const id of this.engine.top(p.rack).slice(0,this.params.beam)) {
      const leave=this.engine.subtract(p.rack,id);
      const rest=this.score(this.engine.best(leave));
      const future=this.future(leave,p,rest,deadline);
      const cashPremium=p.balance<25?this.params.liquidity*(25-p.balance)/25:0;
      const v=this.score(id)*(1+cashPremium)+rest+this.params.futureWeight*future;
      if(v>bestValue) {best=id;bestValue=v;}
      if(performance.now()>deadline) break;
    }
    const fallback=performance.now()>deadline;
    if(fallback) {this.fallbacks++;return {id:immediate.first,wait:false,elapsedMs:performance.now()-start,fallback:true};}
    return {id:best,wait:bestValue<waitValue,elapsedMs:performance.now()-start,fallback:false};
  }
}
