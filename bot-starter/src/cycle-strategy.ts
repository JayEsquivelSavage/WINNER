import {Challenger,type Position,type BidDecision,type PlayDecision} from './challenger.js';
import {DEFAULTS} from './config.js';
/** Keep the established opening; evaluate a separate policy for subsequent
 * earning cycles. Parameters are fixed at startup and never trained live. */
export class CycleStrategy extends Challenger {
 private opening<T>(p:Position,decide:()=>T):T {
  if((p.score??0)>0)return decide();
  const saved={...this.params};Object.assign(this.params,DEFAULTS);
  try{return decide();}finally{Object.assign(this.params,saved);}
 }
 override bid(c:number,p:Position):BidDecision{return this.opening(p,()=>super.bid(c,p));}
 override play(p:Position):PlayDecision{return this.opening(p,()=>super.play(p));}
}
