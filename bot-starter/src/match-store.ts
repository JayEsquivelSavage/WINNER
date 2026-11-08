import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { diagnose,type MatchRecord } from './match-record.js';
export const RETENTION=500;
export function atomicJson(file:string,value:unknown):void {
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const temp=`${file}.${process.pid}.tmp`;try{fs.writeFileSync(temp,JSON.stringify(value)+'\n',{mode:0o600});fs.renameSync(temp,file);}finally{fs.rmSync(temp,{force:true});}
}
export function readRecords(root:string,limit=RETENTION):MatchRecord[] {
 const dir=path.join(root,'matches');if(!fs.existsSync(dir))return [];
 const rows:MatchRecord[]=[];
 for(const file of fs.readdirSync(dir).filter(n=>n.endsWith('.json')).sort().reverse().slice(0,Math.min(RETENTION+30,limit+5))) {
  try {const r=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));if(r.schema===1&&Number.isFinite(r.score)&&/^\d+$/.test(r.matchId)&&/^\d+$/.test(r.botId)&&Number.isFinite(Date.parse(r.endedAt))&&Array.isArray(r.words)&&Array.isArray(r.opponents)&&Array.isArray(r.evidence)&&Number.isFinite(r.balance)&&Number.isFinite(r.placement))rows.push(r);}catch{/* one damaged file cannot stop the live bot */}
 }
 return rows.sort((a,b)=>a.endedAt.localeCompare(b.endedAt));
}
export function persistRecord(root:string,r:MatchRecord):void {
 if(!/^\d+$/.test(r.matchId)||!/^\d+$/.test(r.botId))throw new Error('Invalid match record key');
 const identity=createHash('sha256').update(r.venue).digest('hex').slice(0,12)+`-${r.botId}-${r.matchId}`;
 const key=String(Date.parse(r.endedAt)).padStart(13,'0')+'-'+identity;
 const file=path.join(root,'matches',key+'.json');
 let old:MatchRecord|undefined;let previous=file;
 if(!fs.existsSync(file)&&fs.existsSync(path.join(root,'matches')))previous=fs.readdirSync(path.join(root,'matches')).filter(n=>n.endsWith(identity+'.json')).map(n=>path.join(root,'matches',n))[0]??file;
 try{old=JSON.parse(fs.readFileSync(previous,'utf8'));}catch{}
 // Public imports cannot erase richer runtime evidence. Runtime may begin
 // mid-match, so preserve complete public finals while explicitly marking gaps.
 if(old?.source==='runtime'&&r.source==='public-history') {
  const exact=new Map(r.evidence.filter(e=>e.rivalMax!==null).map(e=>[e.auctionId,e.rivalMax]));
  old.evidence=old.evidence.map(e=>({...e,rivalMax:e.rivalMax??exact.get(e.auctionId)??null}));
  atomicJson(file,old);if(previous!==file){fs.rmSync(previous,{force:true});fs.rmSync(previous.replace(/\.json$/,'.md'),{force:true});}return;
 }
 atomicJson(file,r);if(previous!==file){fs.rmSync(previous,{force:true});fs.rmSync(previous.replace(/\.json$/,'.md'),{force:true});}
 const d=diagnose(r);
 fs.writeFileSync(path.join(root,'matches',key+'.md'),`# Match ${r.matchId}\n\nVerified:\n${d.verified.map(s=>'- '+s).join('\n')}\n\nHypotheses:\n${d.hypotheses.map(s=>'- '+s).join('\n')||'- None established.'}\n\nUnknown:\n${d.unknown.map(s=>'- '+s).join('\n')}\n`,{mode:0o600});
 const files=fs.readdirSync(path.join(root,'matches')).filter(n=>n.endsWith('.json'));
 if(files.length>RETENTION) {
  const sorted=files.map(name=>({name,time:/^\d{13}-/.test(name)?Number(name.slice(0,13)):0})).sort((a,b)=>b.time-a.time);
  for(const {name}of sorted.slice(RETENTION))for(const ext of ['.json','.md'])fs.rmSync(path.join(root,'matches',name.replace(/\.json$/,ext)),{force:true});
 }
}
