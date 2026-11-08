export interface PriceEvidence { auctionId:string; letter:string; kind:'FirstPrice'|'Vickrey'; rivalMax:number|null; paid:number; winner:string|null; }
export interface MatchRecord {
 schema:1; source:'runtime'|'public-history';venue:string;matchId:string;botId:string;endedAt:string;startedAt:string;
 strategyVersion:string|null;profileId:string|null;score:number;placement:number;opponents:{id:string;score:number;balance:number}[];
 auctions:number;participated:number|null;acceptedBids:number|null;lettersWon:number;spent:number;balance:number;
 words:{word:string;score:number}[];unusedRack:string|null;unusedTiles:number|null;invalidActions:number|null;deadlineRejections:number|null;lateBidSkips:number|null;
 bidP99Ms:number|null;wordP99Ms:number|null;peakRssMiB:number|null;
 waits:number|null;coverage:'full-session'|'partial-session'|'public-only';evidence:PriceEvidence[];
 decisions?:{kind:'bid'|'word';auctionId?:string;rack:string;remaining:number;balance?:number;score?:number;leaderScore?:number;value?:number;bid?:number;best?:string|null;bestScore?:number;chosen?:string|null;reason?:string}[];
 droppedDecisions?:number;
}
export function percentileFromHistogram(hist:Uint32Array,p=.99):number|null {
 const total=hist.reduce((a,b)=>a+b,0);if(!total)return null;
 let n=0;for(let i=0;i<hist.length;i++){n+=hist[i];if(n>=total*p)return 2**i/1000;}return null;
}
export function diagnose(r:MatchRecord):{verified:string[];hypotheses:string[];unknown:string[]} {
 const verified=[`Placed ${r.placement}/${r.opponents.length+1}; scored ${r.score}; winner scored ${Math.max(r.score,...r.opponents.map(p=>p.score))}.`,
  `Won ${r.lettersWon}/${r.auctions} offered tiles; spent ${r.spent}; finished with ${r.balance} currency; played ${r.words.length} words.`];
 const hypotheses:string[]=[],unknown:string[]=[];
 if(r.unusedTiles!==null)verified.push(`Unused tiles by conservation: ${r.unusedTiles}; exact letters ${r.unusedRack??'unknown'}.`);
 if(r.lettersWon===0&&r.words.length===0)hypotheses.push('No scoring or acquisition was observed: check connection and runtime deadlines before inferring a gameplay weakness.');
 if(r.balance>=40&&r.placement>1)hypotheses.push('Underinvestment or missed acquisition opportunities may be limiting score; unused currency alone does not prove profitable offers existed.');
 if(r.spent>0&&r.score/r.spent<.45)hypotheses.push('Low realized score per currency: review purchase timing and word-length bonuses; this ratio alone does not prove overpayment.');
 if(r.unusedRack&&r.unusedRack.length>=4)hypotheses.push('Stranded rack suggests checking word timing and acquisition compatibility; last-tile awards are not playable by real bots.');
 if(r.waits&&r.waits>10)hypotheses.push('Many WAIT decisions: compare held combinations with later realized words before blaming speculation.');
 if(r.participated!==null&&r.participated>0&&r.lettersWon/r.participated<.12)hypotheses.push('Low auction conversion warrants replaying completion-aware lost bids against observed rival prices.');
 if(r.invalidActions)verified.push(`${r.invalidActions} rejected or locally invalid actions were observed.`);
 if(r.deadlineRejections||r.lateBidSkips)verified.push(`Observed ${r.deadlineRejections??0} deadline rejections and ${r.lateBidSkips??0} intentional late-send skips.`);
 if(r.unusedRack===null)unknown.push('Starting/final hidden rack cannot be reconstructed exactly from public history.');
 if(r.coverage!=='full-session')unknown.push('Complete submitted-bid counts, action errors, waits and decision latency are unavailable or cover only part of the match.');
 unknown.push('Counterfactual missed words and causal benefits of waiting require replay; final scores do not establish them.');
 return {verified,hypotheses,unknown};
}
