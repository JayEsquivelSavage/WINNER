import type {WordEngine} from './word-engine.js';
import type {Rack} from './rules.js';
/** A bounded two-missing-tile search over the existing signature trie. It
 * values the offered tile's contribution to a reachable long-word plan.
 * Poisson acquisition probabilities are approximations, not hidden-bag reads.
 * Completed words are excluded to avoid double-counting immediate rewards. */
export function completionPotential(engine:WordEngine,before:Rack,letter:number,remaining:Readonly<Uint8Array>,draws:number,base:number,deadline:number):{value:number;complete:boolean;visited:number} {
 if(draws<=0||before.reduce((a,b)=>a+b,0)+3<5)return {value:0,complete:true,visited:0};
 const total=remaining.reduce((a,b)=>a+b,0);if(!total)return {value:0,complete:true,visited:0};
 const one=new Float64Array(26),two=new Float64Array(26),three=new Float64Array(26);
 for(let c=0;c<26;c++){const lambda=draws*remaining[c]/total,p0=Math.exp(-lambda);one[c]=1-p0;two[c]=Math.max(0,1-p0*(1+lambda));three[c]=Math.max(0,1-p0*(1+lambda+lambda*lambda/2));}
 const available=before.slice();available[letter]++;
 let oldBest=0,newBest=0,visited=0,aborted=false;
 const walk=(node:number,missing:number,a:number,b:number)=>{
  if(aborted)return;
  if((visited++&127)===0&&performance.now()>deadline){aborted=true;return;}
  if(engine.upper[node]<=base)return;
  const id=engine.terminal[node];
  if(id>=0&&missing>0&&engine.lengths[id]>=5&&engine.scores[id]>base){
   const after=missing===1?one[a]:a===b?two[a]:one[a]*one[b];
   let prior=after;
   if(engine.signatures[id*26+letter]>before[letter]){
    if(missing===1)prior=letter===a?two[a]:after*one[letter];
    else if(a===b)prior=letter===a?three[a]:after*one[letter];
    else prior=letter===a?two[a]*one[b]:letter===b?one[a]*two[b]:after*one[letter];
   }
   const gain=engine.scores[id]-base;oldBest=Math.max(oldBest,gain*prior);newBest=Math.max(newBest,gain*after);
  }
  for(let child=engine.first[node];child!==-1;child=engine.next[child]){
   const c=engine.letter[child];
   if(available[c]){available[c]--;walk(child,missing,a,b);available[c]++;}
   else if(missing<2)walk(child,missing+1,missing===0?c:a,missing===1?c:b);
   if(aborted)return;
  }
 };
 walk(0,0,-1,-1);
 return {value:aborted?0:Math.max(0,newBest-oldBest),complete:!aborted,visited};
}
