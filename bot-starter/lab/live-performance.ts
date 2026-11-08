import fs from 'node:fs';
import path from 'node:path';
import {atomicJson} from '../src/match-store.js';
import {botContext,resolveBotId,readBotRecords,readPublicSnapshots} from '../src/bot-context.js';
const context=botContext(),root=context.dataDir,bot=Number(resolveBotId(context));
const snapshots=readPublicSnapshots(context);
const runtime=new Map(readBotRecords(context).map(r=>[r.matchId,r]));
const mean=(a:number[])=>a.length?a.reduce((s,n)=>s+n,0)/a.length:null;
const matches=snapshots.filter((s:any)=>s.match_participant.some((p:any)=>p.bot_id===bot)).map((s:any)=>{
 const m=s.match_state[0],me=s.match_participant.find((p:any)=>p.bot_id===bot);
 const start=m.started_at[0]===0?m.started_at[1][0]:m.created_at[0],end=m.ended_at[1][0],mid=(start+end)/2;
 const words=s.word_play.filter((w:any)=>w.bot_id===bot),awards=s.auction_result.filter((a:any)=>a.winner_bot_id[0]===0&&a.winner_bot_id[1]===bot);
 const first=words.filter((w:any)=>w.played_at[0]<mid).reduce((n:number,w:any)=>n+w.total_reward,0);
 const second=words.filter((w:any)=>w.played_at[0]>=mid).reduce((n:number,w:any)=>n+w.total_reward,0);
 if(first+second!==me.score)throw new Error(`Word history does not reconcile with final score for ${m.id}`);
 const r=runtime.get(String(m.id));
 return {id:String(m.id),endedAt:new Date(end/1000).toISOString(),score:me.score,place:1+s.match_participant.filter((p:any)=>p.score>me.score).length,
 firstHalf:first,secondHalf:second,firstHalfTiles:awards.filter((a:any)=>a.closed_at[0]<mid).length,secondHalfTiles:awards.filter((a:any)=>a.closed_at[0]>=mid).length,
 words:words.map((w:any)=>({word:w.word,score:w.total_reward})),cash:me.balance,spent:awards.reduce((n:number,a:any)=>n+a.paid,0),
 winnerScore:Math.max(...s.match_participant.map((p:any)=>p.score)),profile:r?.profileId??null,version:r?.strategyVersion??null,
 runtimeCoverage:r?.source==='runtime'?r.coverage:null,errors:r?.invalidActions??null,deadlineRejections:r?.deadlineRejections??null};
}).sort((a:any,b:any)=>a.endedAt.localeCompare(b.endedAt));
function summarize(rows:any[]){return {matches:rows.length,wins:rows.filter(r=>r.place===1).length,winRate:mean(rows.map(r=>Number(r.place===1))),
 averageScore:mean(rows.map(r=>r.score)),averagePlace:mean(rows.map(r=>r.place)),firstHalf:mean(rows.map(r=>r.firstHalf)),secondHalf:mean(rows.map(r=>r.secondHalf)),
 firstHalfTiles:mean(rows.map(r=>r.firstHalfTiles)),secondHalfTiles:mean(rows.map(r=>r.secondHalfTiles)),averageCash:mean(rows.map(r=>r.cash)),zeroScores:rows.filter(r=>r.score===0).length};}
const profiles=[...new Set(matches.map((r:any)=>r.profile??'unknown'))].map(profile=>({profile,...summarize(matches.filter((r:any)=>(r.profile??'unknown')===profile))}));
const report={collectedAt:new Date().toISOString(),latestMatchAt:matches.at(-1)?.endedAt??null,halfDefinition:'elapsed match time midpoint',last30:summarize(matches),last10:summarize(matches.slice(-10)),previous10:summarize(matches.slice(-20,-10)),profiles,matches};
atomicJson(path.join(root,'live-performance.json'),report);
const fmt=(n:number|null)=>n===null?'unknown':n.toFixed(1);
const lines=[`# ${context.name} live performance`,'',`Collected: ${report.collectedAt}. Latest completed match: ${report.latestMatchAt}.`,'',
 'Halves use the elapsed match-time midpoint. Scores reconcile with public word rewards. Profile attribution comes from saved runtime records; public history alone cannot identify the code.','',
 '| Window | Wins | Average score | Average place | First-half points | Second-half points | First-half tiles won | Second-half tiles won |',
 '|---|---:|---:|---:|---:|---:|---:|---:|'];
for(const [label,row] of [['Last 30',report.last30],['Last 10',report.last10],['Previous 10',report.previous10]] as const)lines.push(`| ${label} | ${row.wins}/${row.matches} | ${fmt(row.averageScore)} | ${fmt(row.averagePlace)} | ${fmt(row.firstHalf)} | ${fmt(row.secondHalf)} | ${fmt(row.firstHalfTiles)} | ${fmt(row.secondHalfTiles)} |`);
lines.push('','## Latest matches','','| Match | Score | Place | First half | Second half | Cash left | Profile |','|---|---:|---:|---:|---:|---:|---|');
for(const r of matches.slice(-10))lines.push(`| ${r.id} | ${r.score} | ${r.place} | ${r.firstHalf} | ${r.secondHalf} | ${r.cash} | ${r.profile??'unknown'} |`);
lines.push('','## Profile samples','','Small observational samples are not controlled strategy comparisons.','');
for(const p of profiles)lines.push(`- ${p.profile}: ${p.matches} matches, ${p.wins} wins, average ${fmt(p.averageScore)} points; first/second half ${fmt(p.firstHalf)}/${fmt(p.secondHalf)}.`);
fs.mkdirSync(context.reportDir,{recursive:true});
fs.writeFileSync(path.join(context.reportDir,'LIVE-PERFORMANCE.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({...report,matches:undefined},null,2));
