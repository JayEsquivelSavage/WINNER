/** Deduce only the MINIMUM initial counts forced by public acquisitions and
 * consumed words. When those counts exhaust the entire starting deal, the
 * initial and final racks are uniquely determined. Otherwise retain unknowns. */
export function reconstructRack(starting:number,events:{time:number;letter?:string;word?:string}[]):{initial:string|null;final:string|null;unused:number|null} {
 const sorted=events.slice().sort((a,b)=>a.time-b.time),net=new Int16Array(26),need=new Int16Array(26);
 const awardTimes=new Set(sorted.filter(e=>e.letter).map(e=>e.time));
 if(sorted.some(e=>e.word&&awardTimes.has(e.time)))return {initial:null,final:null,unused:null};
 for(const e of sorted){if(e.letter)net[e.letter.charCodeAt(0)-65]++;
  if(e.word)for(const l of e.word){const c=l.charCodeAt(0)-65;net[c]--;need[c]=Math.max(need[c],-net[c]);}}
 const minimum=need.reduce((a,b)=>a+b,0),unused=starting+net.reduce((a,b)=>a+b,0);
 if(minimum>starting||unused<0)return {initial:null,final:null,unused:null};
 if(minimum!==starting)return {initial:null,final:null,unused};
 const text=(a:Int16Array)=>[...a].flatMap((n,c)=>Array(Math.max(0,n)).fill(String.fromCharCode(65+c))).join('');
 return {initial:text(need),final:text(Int16Array.from(net,(n,c)=>n+need[c])),unused};
}
