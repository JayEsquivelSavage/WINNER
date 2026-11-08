import { DEFAULTS, type Parameters } from './config.js';
import { BAG, VALUES, type Rack, type AuctionKind } from './rules.js';
import { WordEngine } from './word-engine.js';
import { completionPotential } from './completion-potential.js';
import { OpponentModel } from './opponents.js';
import { solveEndgame } from './endgame.js';
export interface Position {
  rack:Rack; balance:number; remaining:number; auctionType:AuctionKind;
  // Estimate from public draws; hidden starting opponent tiles stay uncertain.
  remainingCounts?:Readonly<Uint8Array>; score?:number; leaderScore?:number;
}
export interface BidDecision { amount:number; value:number; utility:number; elapsedMs:number; fallback:boolean; }
export interface PlayDecision { id:number; wait:boolean; elapsedMs:number; fallback:boolean; reason?:string; }
export interface FinishingPolicy {maxHoldAuctions:number;cyclePremium:number;affordableHorizon:boolean;liquidationWindow:number;planningWeight?:number;cashOutAtSeven?:boolean;scoringWindow?:number;marketBudget?:number;letterMarkets?:boolean;inferDeals?:boolean;scoreAware?:number;integerReserve?:boolean;exactEndgame?:boolean;}
export const NO_FINISHING:Readonly<FinishingPolicy>={maxHoldAuctions:0,cyclePremium:0,affordableHorizon:false,liquidationWindow:3};
export class Challenger {
  readonly model:OpponentModel;
  readonly params:Parameters;
  fallbacks=0;
  readonly finishing:FinishingPolicy;
  private heldRack='';private heldSince=0;
  private scoringSince:number|null=null;private scoringScore=0;private scoringRack=new Uint8Array(26);
  constructor(readonly engine:WordEngine,params:Partial<Parameters>={},finishing:Partial<FinishingPolicy>={}) {this.finishing={...NO_FINISHING,...finishing};this.params={...DEFAULTS,...params};this.model=new OpponentModel(this.params.marketPrior,this.finishing.letterMarkets??false);}
  private futureWeight(p:Position):number {
    // Preserve the opening. When trailing late, a routine small payout may
    // improve points without improving the chance to win; give completion
    // opportunities more weight, while still liquidating at the deadline.
    const risk=this.finishing.scoreAware??0;
    const deficit=Math.max(0,(p.leaderScore??0)-(p.score??0));
    const chase=(p.score??0)>0&&p.remaining<=24?Math.min(1,deficit/Math.max(20,p.remaining*2)):0;
    return this.params.futureWeight*(1+risk*chase);
  }
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
  private marketPrice():number {
    // Approximate clearing-price median from normal public-result learning.
    // Never use hidden live top bids. Keep the estimate bounded and nonzero.
    let sum=0;
    for(const letter of [0,19,16]) {
      const h=this.model.distribution(letter),total=h.reduce((a,b)=>a+b,0);let mass=0,median=0;
      for(let i=0;i<h.length;i++){mass+=h[i];if(mass>=total*.5){median=i;break;}}
      sum+=Math.max(2,Math.min(40,median));
    }
    return sum/3;
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
    const price=this.finishing.affordableHorizon?this.marketPrice():0;
    const cashLimited=this.finishing.affordableHorizon&&(p.score??0)>=20&&base>=16&&p.balance<price*1.25;
    const horizon=Math.min(2.5,(p.remaining-1)*this.params.captureRate,
      cashLimited?Math.max(0,p.balance/price):Infinity);
    return total?gain/total*horizon:0;
  }
  bid(letter:number,p:Position):BidDecision {
    const start=performance.now(),deadline=start+this.params.budgetMs;
    if(p.remaining<=0||p.balance<1) return {amount:0,value:0,utility:0,elapsedMs:performance.now()-start,fallback:false};
    if(this.finishing.exactEndgame&&p.remaining===1){
      const before=solveEndgame(this.engine,p.rack,deadline);
      const acquired=p.rack.slice();acquired[letter]++;
      const after=solveEndgame(this.engine,acquired,deadline);
      if(before.complete&&after.complete){
        const gain=Math.max(0,after.score-before.score);
        // No later acquisition can score. Cash has no remaining strategic
        // use, but an unconvertible tile never merits a positive bid.
        return {amount:gain>0?p.balance:0,value:gain,utility:gain,elapsedMs:performance.now()-start,fallback:false};
      }
    }
    const before=this.liquidate(p.rack,deadline);
    const oldPotential=this.future(p.rack,p,this.score(this.engine.best(p.rack)),deadline);
    const afterRack=p.rack.slice();afterRack[letter]++;
    const after=this.liquidate(afterRack,deadline);
    const newPotential=this.future(afterRack,p,this.score(this.engine.best(afterRack)),deadline);
    const baseExhausted=performance.now()>deadline;
    let plan=0;
    if((this.finishing.planningWeight??0)>0&&(p.score??0)>=20&&p.remaining>3&&performance.now()<deadline){
      const draws=Math.min(6,(p.remaining-1)*this.params.captureRate,p.balance/this.marketPrice());
      const future=completionPotential(this.engine,p.rack,letter,p.remainingCounts??BAG,draws,Math.max(before.value,after.value),deadline);
      if(future.complete)plan=future.value*(this.finishing.planningWeight??0);
    }
    const exhausted=performance.now()>deadline;
    // Value is points, converted to currency by a state-dependent shadow price.
    // Liquidation generates cash; a cash-starved rack gives that cash extra value.
    const liquidity=p.balance<20?this.params.liquidity*(20-p.balance)/20:0;
    const completion=Math.max(0,after.value-before.value);
    if(this.finishing.affordableHorizon&&p.remaining<=2&&completion===0)
      return {amount:0,value:0,utility:0,elapsedMs:performance.now()-start,fallback:exhausted};
    const potentialGain=baseExhausted?0:newPotential-oldPotential;
    let value=completion*(1+liquidity)+this.futureWeight(p)*potentialGain+plan;
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
    // Public match 42822 reached balance=8 after COGI, exactly equal to
    // the old fixed reserve, blocking ordinary completion bids for many turns.
    // Protect a fraction of current cash so small budgets can still invest.
    const protectedCash=Math.min(this.params.reserve*Math.min(1,rounds/12),p.balance*.25);
    // Cash is integral. Rounding spendable cash down rounds the reserve UP,
    // exceeding the quarter-cash ceiling and freezing a one-credit balance.
    const reserve=this.finishing.integerReserve?Math.floor(protectedCash):protectedCash;
    const spendable=Math.max(0,Math.floor(p.balance-reserve));
    // Public clearing prices determine how many future acquisitions our cash
    // can finance. The old fixed five-currency assumption ignored expensive
    // fields and could spend the next earning cycle's budget too early.
    const budgetWeight=this.finishing.marketBudget??0;
    const expectedPrice=budgetWeight>0?5+budgetWeight*(this.marketPrice()-5):5;
    let shadow=Math.max(p.remaining<=3?.03:.15,Math.min(2.5,(rounds*this.params.captureRate*expectedPrice)/(p.balance+15)));
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
    if(this.finishing.exactEndgame&&p.remaining<=3){
      const exact=solveEndgame(this.engine,p.rack,deadline);
      if(exact.complete)return {id:exact.first,wait:exact.first<0,elapsedMs:performance.now()-start,fallback:false,reason:'optimal current-rack endgame liquidation'};
    }
    const immediate=this.liquidate(p.rack,deadline);
    // Observe authoritative scoring/rack consumption, rather than assuming a
    // returned play was accepted. Purchases must not restart the earning clock.
    const consumed=p.rack.some((n,c)=>n<this.scoringRack[c]);
    if((p.score??0)!==this.scoringScore||consumed||immediate.first<0)this.scoringSince=null;
    this.scoringScore=p.score??0;this.scoringRack.set(p.rack);
    if(immediate.first>=0&&this.scoringSince===null)this.scoringSince=p.remaining;
    const window=this.finishing.scoringWindow??0;
    if(immediate.first>=0&&window>0&&(p.score??0)>0&&this.scoringSince!==null&&this.scoringSince-p.remaining>=window)
      return {id:immediate.first,wait:false,elapsedMs:performance.now()-start,fallback:false,reason:'scoring window reached; realize points and recycle cash'};
    if(immediate.first<0) return {id:-1,wait:true,elapsedMs:performance.now()-start,fallback:false};
    if(this.finishing.cashOutAtSeven&&this.engine.lengths[immediate.first]>=7)
      return {id:immediate.first,wait:false,elapsedMs:performance.now()-start,fallback:false,reason:'maximum length multiplier earned; recycle cash into next rack'};
    if(p.remaining<=this.finishing.liquidationWindow) return {id:immediate.first,wait:false,elapsedMs:performance.now()-start,fallback:false,reason:'endgame liquidation'};
    const rackKey=String.fromCharCode(...p.rack);
    if(rackKey!==this.heldRack){this.heldRack=rackKey;this.heldSince=p.remaining;}
    const mature=(p.score??0)>=20&&this.score(immediate.first)>=20&&this.engine.lengths[immediate.first]>=5;
    if(mature&&this.finishing.maxHoldAuctions>0&&this.heldSince-p.remaining>=this.finishing.maxHoldAuctions)
      return {id:immediate.first,wait:false,elapsedMs:performance.now()-start,fallback:false,reason:'completed rack reached maximum holding window'};
    const potential=this.future(p.rack,p,this.score(this.engine.best(p.rack)),deadline);
    const urgency=this.params.waitDiscount+Math.max(0,(12-p.remaining)/12)*.6;
    const waitValue=immediate.value*(1-urgency)+this.futureWeight(p)*potential;
    let best=-1,bestValue=-Infinity;
    for(const id of this.engine.top(p.rack).slice(0,this.params.beam)) {
      const leave=this.engine.subtract(p.rack,id);
      const rest=this.score(this.engine.best(leave));
      const future=this.future(leave,{...p,balance:p.balance+this.score(id)},rest,deadline);
      const cashPremium=p.balance<25?this.params.liquidity*(25-p.balance)/25:0;
      // Playing pays both points and currency; leaving a completed rack idle
      // delays the next earning cycle. Reward recycling only while useful
      // auctions remain, rather than mechanically raising every bid.
      const cycle=(p.score??0)>=20&&this.engine.lengths[id]>=5?this.finishing.cyclePremium*Math.min(1,Math.max(0,p.remaining-3)/15):0;
      const v=this.score(id)*(1+cashPremium+cycle)+rest+this.futureWeight(p)*future;
      if(v>bestValue) {best=id;bestValue=v;}
      if(performance.now()>deadline) break;
    }
    const fallback=performance.now()>deadline;
    if(fallback) {this.fallbacks++;return {id:immediate.first,wait:false,elapsedMs:performance.now()-start,fallback:true};}
    return {id:best,wait:bestValue<waitValue,elapsedMs:performance.now()-start,fallback:false};
  }
}
