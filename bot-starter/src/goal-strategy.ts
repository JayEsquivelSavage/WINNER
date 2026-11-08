import {Challenger,type Position,type BidDecision,type PlayDecision} from './challenger.js';
import {BAG,VALUES} from './rules.js';
interface Plan {id:number;missing:number;utility:number;needs:Uint8Array;complete:boolean;}
/** Whole-word procurement: reserve cash for the OTHER missing letters in a
 * reachable word, rather than repeatedly purchasing unrelated marginal tiles.
 * Target probabilities use only our rack, public draws and censored prices. */
export class GoalStrategy extends Challenger {
 private target=-1;private cachedKey='';private cachedPlan:Plan|null=null;
 private bidKey='';private pendingPlan:Plan|null=null;
 private prices=new Float64Array(26);private cdf:Float64Array[]=[];private observed=-1;
 private market(){
  if(this.observed===this.model.observations&&this.cdf.length)return;
  const groups=new Map<Float64Array,{cdf:Float64Array;price:number}>();
  for(let c=0;c<26;c++){
   const h=this.model.distribution(c);let group=groups.get(h);
   if(!group){const cdf=new Float64Array(129),total=h.reduce((a,b)=>a+b,0);let mass=0,price=0;
    for(let i=0;i<129;i++){cdf[i]=(mass+h[i]*.5)/total;mass+=h[i];if(!price&&mass>=total*.6)price=Math.max(1,i);}
    group={cdf,price};groups.set(h,group);
   }
   this.prices[c]=group.price;this.cdf[c]=group.cdf;
  }
  this.observed=this.model.observations;
 }
 private win(c:number,bid:number){return bid>128?1:this.cdf[c][Math.max(0,Math.min(128,Math.floor(bid)))];}
 private key(p:Position){return String.fromCharCode(...p.rack)+`:${p.balance}:${p.remaining}:${this.model.observations}`;}
 private select(p:Position,offered=-1):Plan{
  const key=this.key(p)+':'+offered+':'+this.target;if(this.cachedKey===key&&this.cachedPlan)return this.cachedPlan;
  this.market();const deadline=performance.now()+this.params.budgetMs;
  const rack=p.rack,available=rack.slice(),expected=Uint8Array.from(p.remainingCounts??BAG);
  if(offered>=0)expected[offered]++;
  const total=expected.reduce((a,b)=>a+b,0);
  if(this.target>=0){
   const needs=new Uint8Array(26);let missing=0,cost=0,probability=1;
   for(let c=0;c<26;c++){
    needs[c]=Math.max(0,this.engine.signatures[this.target*26+c]-rack[c]);missing+=needs[c];cost+=needs[c]*this.prices[c];
    if(needs[c]){
     const opportunities=p.remaining*expected[c]/Math.max(1,total);
     let mass=1,term=1;for(let k=1;k<needs[c];k++){term*=opportunities/k;mass+=term;}
     probability*=1-Math.exp(-opportunities)*mass;
    }
   }
   if(missing===0)return {id:this.target,missing:0,utility:this.engine.scores[this.target],needs,complete:true};
   if(missing<=p.remaining&&cost<=p.balance&&probability>=.12)
    return {id:this.target,missing,utility:this.engine.scores[this.target]*probability,needs,complete:true};
   this.target=-1;
  }
  const need=new Uint8Array(26),found=this.engine.best(rack);
  const ready=found>=0&&(this.engine.lengths[found]>=5||this.engine.scores[found]>=21||p.balance<12||p.remaining<=8)?found:-1;
  let best:Plan={id:ready,missing:0,utility:ready<0?0:this.engine.scores[ready],needs:new Uint8Array(26),complete:true};
  const targetScore=p.remaining>16&&p.balance>=35?21:p.remaining>6?12:0;
  const maxMissing=Math.min(3,Math.max(1,this.params.beam-1),p.remaining);
  let visited=0,aborted=false;
  const shadow=Math.max(.05,Math.min(.6,p.remaining*this.params.captureRate*8/(p.balance+25)*.25));
  const assess=(id:number,missing:number)=>{
   if(this.engine.scores[id]<targetScore&&missing>0)return;
   if(missing===0){if(this.engine.lengths[id]<5&&this.engine.scores[id]<21&&p.balance>=12&&p.remaining>8)return;if(this.engine.scores[id]>best.utility)best={id,missing:0,utility:this.engine.scores[id],needs:new Uint8Array(26),complete:true};return;}
   let cost=0,prob=1;
   const willingness=Math.min(p.balance,Math.max(1,this.engine.scores[id]*this.params.bidScale/missing));
   for(let c=0;c<26;c++)if(need[c]){
    if(!expected[c])return;
    const price=Math.min(this.prices[c],p.balance/missing);cost+=price*need[c];
    const probability=this.win(c,willingness);
    const offers=(p.remaining-(offered>=0?1:0))*(expected[c]-(offered===c?1:0))/Math.max(1,total-(offered>=0?1:0));
    const lambda=Math.max(0,offers)*probability;
    const tail=(n:number)=>{if(n<=0)return 1;let cumulative=1,term=1;for(let k=1;k<n;k++){term*=lambda/k;cumulative+=term;}return Math.max(0,1-Math.exp(-lambda)*cumulative);};
    prob*=offered===c?probability*tail(need[c]-1)+(1-probability)*tail(need[c]):tail(need[c]);
   }
   if(cost>p.balance||missing>=p.remaining+1)return;
   const utility=this.engine.scores[id]*Math.pow(prob,this.params.futureWeight)/(1+this.params.waitDiscount*missing)-shadow*cost;
   if(utility>best.utility)best={id,missing,utility,needs:need.slice(),complete:true};
  };
  const walk=(node:number,missing:number)=>{
   if(aborted)return;
   if((visited++&127)===0&&performance.now()>deadline){aborted=true;return;}
   if(this.engine.upper[node]<=best.utility)return;
   const id=this.engine.terminal[node];if(id>=0)assess(id,missing);
   for(let child=this.engine.first[node];child!==-1;child=this.engine.next[child]){
    const c=this.engine.letter[child];
    if(available[c]){available[c]--;walk(child,missing);available[c]++;}
    else if(missing<maxMissing){need[c]++;walk(child,missing+1);need[c]--;}
    if(aborted)return;
   }
  };
  walk(0,0);
  if(aborted){this.fallbacks++;best.complete=false;}
  if(best.id>=0&&best.missing>0)this.target=best.id;
  this.cachedKey=key;this.cachedPlan=best;return best;
 }
 override bid(letter:number,p:Position):BidDecision{
  const start=performance.now();this.bidKey=this.key(p);this.pendingPlan=null;
  if(p.remaining<=0||p.balance<1)return {amount:0,value:0,utility:0,elapsedMs:performance.now()-start,fallback:false};
  const plan=this.select(p,letter);let willing=0;
  // Submit a ready word first; the runtime reevaluates the bid after the
  // authoritative cash/rack update, using only actually available currency.
  if(plan.id>=0&&plan.missing===0)return {amount:0,value:0,utility:0,elapsedMs:performance.now()-start,fallback:!plan.complete};
  if(plan.id>=0&&plan.needs[letter]){
   let otherCost=0;for(let c=0;c<26;c++)otherCost+=Math.max(0,plan.needs[c]-(c===letter?1:0))*this.prices[c];
   const budget=Math.max(0,Math.floor(p.balance-otherCost));
   willing=Math.min(budget,this.engine.scores[plan.id]*this.params.bidScale/Math.max(1,plan.missing));
   if(p.remaining===1&&plan.missing===1)willing=p.balance;
   else if(plan.missing===1)willing=Math.min(p.balance,this.engine.scores[plan.id]*this.params.bidScale);
   this.pendingPlan=plan;
  }else if(plan.id>=0&&plan.missing>0){
   willing=0;
  }else{
   const vowels=[0,4,8,14,20].reduce((n,c)=>n+p.rack[c],0),tiles=p.rack.reduce((a,b)=>a+b,0);
   const vowel='AEIOU'.includes(String.fromCharCode(65+letter));
   const quality=vowel?(vowels===0?12:Math.max(2,7-vowels*2)):2;
   const foundation=(3*VALUES[letter]+quality)/(1+p.rack[letter]*1.6);
   const budget=p.balance/Math.max(2,7-tiles)*1.2;
   willing=Math.min(budget,foundation*this.params.bidScale);
   if('QJZ'.includes(String.fromCharCode(65+letter))){const after=p.rack.slice();after[letter]++;if(!this.engine.top(after).some(id=>this.engine.signatures[id*26+letter]>p.rack[letter]))willing=0;}
   if(p.remaining<=6)willing=0;
  }
  let amount=Math.max(0,Math.min(Math.floor(p.balance),Math.floor(willing)));
  if(p.auctionType==='FirstPrice'){
   let best=0,utility=0;
   for(let b=1;b<=amount;b++){const u=this.win(letter,b)*(willing-b);if(u>utility){best=b;utility=u;}}
   amount=best;
  }
  if(amount===0)this.pendingPlan=null;
  return {amount,value:willing,utility:plan.utility,elapsedMs:performance.now()-start,fallback:!plan.complete};
 }
 override play(p:Position):PlayDecision{
  const start=performance.now();
  const committed=this.bidKey===this.key(p)?this.pendingPlan:null;
  if(committed&&committed.missing>0)return {id:-1,wait:true,elapsedMs:performance.now()-start,fallback:!committed.complete,reason:`await committed ${this.engine.words[committed.id]} completion auction`};
  if(p.remaining<=2){const id=this.engine.best(p.rack);return {id,wait:id<0,elapsedMs:performance.now()-start,fallback:false,reason:'convert remaining rack before final close'};}
  const plan=this.select(p);
  if(!plan.complete&&plan.id<0){const id=this.engine.best(p.rack);if(id>=0)return {id,wait:false,elapsedMs:performance.now()-start,fallback:true,reason:'bounded search fallback: realize legal word'};}
  if(plan.id>=0&&plan.missing===0&&this.engine.valid(plan.id,p.rack))return {id:plan.id,wait:false,elapsedMs:performance.now()-start,fallback:!plan.complete,reason:'realize selected word and finance next target'};
  return {id:-1,wait:true,elapsedMs:performance.now()-start,fallback:!plan.complete,reason:plan.id<0?'build a productive foundation':`pursue ${this.engine.words[plan.id]} (${plan.missing} missing tiles)`};
 }
}
