import {VALUES,type Rack} from './rules.js';
import type {WordEngine} from './word-engine.js';
export interface EndgameResult {score:number;first:number;complete:boolean;}
/** Exact maximum reward over disjoint legal words in a small current rack.
 * Search has no beliefs about future tiles. Incomplete results are unusable:
 * callers fall back to their ordinary legal policy, never partial valuations. */
export function solveEndgame(engine:WordEngine,rack:Rack,deadline:number):EndgameResult {
 const incomplete:EndgameResult={score:0,first:-1,complete:false};
 if(rack.reduce((sum,n)=>sum+n,0)>12||performance.now()>=deadline)return incomplete;
 const memo=new Map<string,{score:number;first:number}>(),timeout=Symbol('timeout');
 const solve=(available:Rack):{score:number;first:number}=>{
  if(performance.now()>=deadline)throw timeout;
  const key=String.fromCharCode(...available),cached=memo.get(key);if(cached)return cached;
  let score=0,first=-1;
  const words=engine.allPlayable(available).sort((a,b)=>engine.scores[b]-engine.scores[a]);
  if(performance.now()>=deadline)throw timeout;
  const leaves=new Set<string>();
  for(const id of words){
   if(performance.now()>=deadline)throw timeout;
   const leave=engine.subtract(available,id),leaveKey=String.fromCharCode(...leave);
   if(leaves.has(leaveKey))continue;leaves.add(leaveKey);
   // No word's multiplier exceeds three; this is an admissible upper bound.
   const upper=engine.scores[id]+leave.reduce((sum,n,c)=>sum+n*VALUES[c]*3,0);
   if(upper<=score)continue;
   const value=engine.scores[id]+solve(leave).score;
   if(value>score){score=value;first=id;}
  }
  const result={score,first};memo.set(key,result);return result;
 };
 try{return {...solve(rack),complete:true};}catch(error){if(error===timeout)return incomplete;throw error;}
}
