import fs from 'node:fs';
import path from 'node:path';
import { persistRecord,atomicJson } from '../src/match-store.js';
import { performance } from '../src/analytics.js';
import { buildPrior } from '../src/learning.js';
import { reconstructRack } from '../src/rack-reconstruction.js';
import { diagnose,type MatchRecord } from '../src/match-record.js';
import {botContext,resolveBotId,readBotRecords,readPublicSnapshots} from '../src/bot-context.js';
const context=botContext(),root=context.dataDir,venue=context.venue,botId=resolveBotId(context),bot=Number(botId);
const option=(v:unknown):number|null=>Array.isArray(v)&&v[0]===0?Number(v[1]):null;
function importHistory() {
 const file=fs.existsSync(path.join(root,'recent-public.json'))?path.join(root,'recent-public.json'):context.name==='WORDGOAT'?'reports/recent-public-matches.json':path.join(root,'recent-public.json');
 const all=readPublicSnapshots(context,file);
 for(const s of all){const m=s.match_state[0],me=s.match_participant.find((p:any)=>p.bot_id===bot);if(!me)continue;
  const awards=s.auction_result.filter((a:any)=>option(a.winner_bot_id)===bot),words=s.word_play.filter((w:any)=>w.bot_id===bot);
  const top=new Map(s.auction_top_bid_archive.map((a:any)=>[a.auction_id,a.top_bid]));
  const kind=m.auction_type[0]===0?'FirstPrice':'Vickrey';
  const inferred=reconstructRack(m.starting_rack_size,[...awards.map((a:any)=>({time:a.closed_at[0],letter:a.letter})),...words.map((w:any)=>({time:w.played_at[0],word:w.word}))]);
  const r:MatchRecord={schema:1,source:'public-history',venue,matchId:String(m.id),botId,
   startedAt:new Date(m.created_at[0]/1000).toISOString(),endedAt:new Date(m.ended_at[1][0]/1000).toISOString(),
   strategyVersion:null,profileId:null,score:me.score,placement:1+s.match_participant.filter((p:any)=>p.score>me.score).length,
   opponents:s.match_participant.filter((p:any)=>p.bot_id!==bot).map((p:any)=>({id:String(p.bot_id),score:p.score,balance:p.balance})),
   auctions:s.auction.length,participated:null,acceptedBids:null,lettersWon:awards.length,spent:awards.reduce((n:number,a:any)=>n+a.paid,0),balance:me.balance,
   words:words.map((w:any)=>({word:w.word,score:w.total_reward})),unusedRack:inferred.final,unusedTiles:m.starting_rack_size*s.match_participant.length<98?inferred.unused:null,invalidActions:null,deadlineRejections:null,lateBidSkips:null,
   bidP99Ms:null,wordP99Ms:null,peakRssMiB:null,waits:null,coverage:'public-only',
   evidence:s.auction_result.map((a:any)=>{const winner=option(a.winner_bot_id);return {auctionId:String(a.auction_id),letter:a.letter,kind,
    winner:winner===null?null:String(winner),paid:a.paid,rivalMax:winner===null?0:winner===bot?(kind==='Vickrey'&&a.paid>1?a.paid:null):(top.get(a.auction_id) as number??(kind==='FirstPrice'?a.paid:null))};})};
  persistRecord(root,r);
 }
}
if(process.argv.includes('--import'))importHistory();
const rows=readBotRecords(context),summary=performance(rows);
console.log(JSON.stringify(summary,null,2));
atomicJson(path.join(root,'dashboard.json'),summary);
const cutoff=new Date().toISOString();atomicJson(path.join(root,'price-prior.json'),buildPrior(rows,venue,cutoff));
if(process.argv.includes('--write-report')) {
 const lines=['# Recent live match analysis','',`Public observations from ${summary.matches} matches; unrecorded client behavior stays unknown.`, '',
 `Last 10 mean score: ${summary.last10Average}; previous 10: ${summary.previous10Average}. Win rate: ${summary.winRate}; mean place: ${summary.averagePlacement}. Mean balance: ${summary.averageCurrency}.`,
 '', '| Match | Score | Place | Letters won | Spent | Cash left | Words | Winner score |','|---|---:|---:|---:|---:|---:|---:|---:|'];
 for(const r of rows.slice(-30))lines.push(`| ${r.matchId} | ${r.score} | ${r.placement} | ${r.lettersWon} | ${r.spent} | ${r.balance} | ${r.words.length} | ${Math.max(r.score,...r.opponents.map(p=>p.score))} |`);
 lines.push('','## Priorities (hypotheses ranked by frequency, not proven causal win impact)','',...summary.patterns.map(p=>`- ${p.matches} matches: ${p.problem}`),
 '', 'Recent-10 pattern counts: '+JSON.stringify(summary.recentPatterns), '', 'Public history cannot establish code version, submitted losing bids, errors, client latency, exact unused racks or missed playable words. Future runtime collection will fill these fields. Version attribution is deliberately unknown for imported results.');
 for(const r of rows.filter(r=>r.score===59)){const d=diagnose(r);lines.push('',`## 59-point match ${r.matchId}`,...d.verified.map(s=>'- '+s),...d.hypotheses.map(s=>'- Hypothesis: '+s));}
 fs.mkdirSync(context.reportDir,{recursive:true});
 fs.writeFileSync(path.join(context.reportDir,'LIVE-ANALYSIS.md'),lines.join('\n')+'\n');
}
