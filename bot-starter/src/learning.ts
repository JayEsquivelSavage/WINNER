import type { MatchRecord } from './match-record.js';
import { VALUES,type AuctionKind } from './rules.js';
export interface PricePrior {schema:1;venue:string;cutoff:string;matches:number;counts:Record<AuctionKind,number[][]>;}
export function buildPrior(records:MatchRecord[],venue:string,cutoff:string):PricePrior {
 const counts={FirstPrice:Array.from({length:3},()=>Array(129).fill(0) as number[]),Vickrey:Array.from({length:3},()=>Array(129).fill(0) as number[])};
 const selected=records.filter(r=>r.venue===venue&&Number.isFinite(Date.parse(cutoff))&&Date.parse(r.endedAt)<Date.parse(cutoff)&&r.evidence.length>0&&r.evidence.filter(e=>e.rivalMax!==null).length/r.evidence.length>=.8).slice(-30);
 for(const r of selected)for(const e of r.evidence)if(e.rivalMax!==null&&e.rivalMax>=0&&Number.isFinite(e.rivalMax)) {
  const c=e.letter.charCodeAt(0)-65,g='AEIOU'.includes(e.letter)?0:VALUES[c]>=5?2:1;
  counts[e.kind][g][Math.min(128,Math.floor(e.rivalMax))]++;
 }
 return {schema:1,venue,cutoff,matches:selected.length,counts};
}
export function applyPrior(hist:Float64Array[],p:PricePrior,venue:string,kind:AuctionKind,startedAt:string):boolean {
 if(!p||p.schema!==1||p.venue!==venue||!Number.isInteger(p.matches)||p.matches<10||p.matches>30||!Number.isFinite(Date.parse(p.cutoff))||!Number.isFinite(Date.parse(startedAt))||Date.parse(p.cutoff)>Date.parse(startedAt))return false;
 const groups=p.counts?.[kind];if(!groups||groups.length!==3||groups.some(h=>h.length!==129||h.some(n=>!Number.isFinite(n)||n<0||n>10000)))return false;
 // A small, bounded prior; live evidence will quickly dominate. Not a policy
 // parameter change. Applied only at match START, never during live decisions.
 let applied=false;
 for(let g=0;g<3;g++){const total=groups[g].reduce((a,b)=>a+b,0);if(total<20)continue;applied=true;for(let i=0;i<129;i++)hist[g][i]=hist[g][i]*.5+4*groups[g][i]/total;}
 return applied;
}
