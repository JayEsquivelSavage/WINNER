import { diagnose,type MatchRecord } from './match-record.js';
const mean=(a:number[])=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
export function performance(records:MatchRecord[]) {
 const last=records.slice(-30),recent=last.slice(-10),previous=last.slice(-20,-10);
 const knownBid=last.filter(r=>r.participated!==null&&r.coverage==='full-session');
 const versions=new Map<string,MatchRecord[]>();for(const r of last){const v=r.strategyVersion??'unknown-public-history';const rows=versions.get(v)??[];rows.push(r);versions.set(v,rows);}
 const ranked=[...versions].map(([version,rows])=>({version,n:rows.length,averageScore:mean(rows.map(r=>r.score)),winRate:mean(rows.map(r=>Number(r.placement===1)))})).sort((a,b)=>(b.winRate??0)-(a.winRate??0)||(b.averageScore??0)-(a.averageScore??0));
 const scored=last.flatMap(r=>diagnose(r).hypotheses),patterns=[...new Set(scored)].map(problem=>({problem,matches:scored.filter(p=>p===problem).length})).sort((a,b)=>b.matches-a.matches);
 const den=knownBid.reduce((s,r)=>s+r.participated!,0);
 return {matches:last.length,last10Average:mean(recent.map(r=>r.score)),previous10Average:mean(previous.map(r=>r.score)),winRate:mean(last.map(r=>Number(r.placement===1))),
 averagePlacement:mean(last.map(r=>r.placement)),auctionWinRate:den?knownBid.reduce((s,r)=>s+r.lettersWon,0)/den:null,
 offeredTileWinRate:last.length?last.reduce((s,r)=>s+r.lettersWon,0)/last.reduce((s,r)=>s+r.auctions,0):null,
 averageCurrency:mean(last.map(r=>r.balance)),averageWords:mean(last.map(r=>r.words.length)),bestObservedVersion:ranked[0]??null,
 patterns,recentPatterns:[...new Set(recent.flatMap(r=>diagnose(r).hypotheses))].map(problem=>({problem,matches:recent.filter(r=>diagnose(r).hypotheses.includes(problem)).length})).sort((a,b)=>b.matches-a.matches),versions:ranked,recent:recent.map(r=>({id:r.matchId,score:r.score,place:r.placement,balance:r.balance,version:r.strategyVersion??'unknown'}))};
}
