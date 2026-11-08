interface BidState {accepted:number;requested:number;pending:Promise<void>;}
/** The reducer replaces bids and accepts zero. Serialize each auction's
 * requests so a slower old completion bid cannot overwrite its withdrawal.
 * One instance belongs to one match (at most 98 auction entries). */
export class BidSubmission {
 private readonly states=new Map<bigint,BidState>();
 private generation=0;
 reset(uncertainAuction?:bigint){
  this.generation++;this.states.clear();
  if(uncertainAuction!==undefined)this.states.set(uncertainAuction,{accepted:-1,requested:-1,pending:Promise.resolve()});
 }
 constructor(private readonly send:(id:bigint,amount:number)=>Promise<void>){}
 submit(id:bigint,amount:number):Promise<void>{
  if(!Number.isSafeInteger(amount)||amount<0)return Promise.reject(new Error('Invalid bid amount'));
  let state=this.states.get(id);
  if(!state){state={accepted:0,requested:0,pending:Promise.resolve()};this.states.set(id,state);}
  if(state.requested===amount)return state.pending;
  state.requested=amount;
  const s=state,generation=this.generation;
  const pending=s.pending.catch(()=>{}).then(async()=>{
   if(generation!==this.generation)return;
   if(s.accepted!==amount){await this.send(id,amount);s.accepted=amount;}
  });
  s.pending=pending;
  // Failed identical decisions must be retryable. A queued newer decision
  // owns requested, so an older failure must not reset it.
  void pending.catch(()=>{if(s.pending===pending)s.requested=s.accepted;});
  return pending;
 }
}
