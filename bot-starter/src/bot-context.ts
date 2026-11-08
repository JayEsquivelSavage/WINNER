import fs from 'node:fs';
import path from 'node:path';
import {atomicJson,readRecords,RETENTION} from './match-store.js';
import type {MatchRecord} from './match-record.js';
export interface BotContext {name:string;botId?:string;dataDir:string;reportDir:string;host:string;database:string;venue:string;}
function checkedId(value:string):string{
 if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value)))throw new Error('Invalid public bot ID');
 return String(Number(value));
}
export function botContext(env:NodeJS.ProcessEnv=process.env):BotContext{
 const name=env.BOT_NAME??'winner';
 if(!name||name.length>100||/[\x00-\x1f\x7f]/.test(name))throw new Error('Invalid bot name');
 const legacy=name==='WORDGOAT',part='bot-'+encodeURIComponent(name);
 const host=(env.STDB_HOST??'https://maincloud.spacetimedb.com').replace(/\/$/,'');
 if(!['http:','https:','ws:','wss:'].includes(new URL(host).protocol))throw new Error('Invalid database host');
 const database=env.STDB_DB??'scrabblebot';
 return {name,botId:env.BOT_ID===undefined?(name==='winner'?'307':undefined):checkedId(env.BOT_ID),host,database,venue:`${host}/${database}`,
  dataDir:env.WORDGOAT_DATA_DIR??(legacy?'telemetry':path.join('telemetry','bots',part)),
  reportDir:env.WORDGOAT_REPORT_DIR??(legacy?'reports':path.join('reports','bots',part))};
}
function storedIdentity(ctx:BotContext):{botId:string}|undefined{
 const file=path.join(ctx.dataDir,'bot.json');if(!fs.existsSync(file))return undefined;
 const saved=JSON.parse(fs.readFileSync(file,'utf8'));
 if(saved.schema!==1||saved.name!==ctx.name||saved.venue!==ctx.venue||(ctx.botId!==undefined&&saved.botId!==ctx.botId))throw new Error('Stored bot identity differs; use a separate data directory');
 return {botId:checkedId(saved.botId)};
}
export function resolveBotId(ctx:BotContext):string{
 return storedIdentity(ctx)?.botId??ctx.botId??(ctx.name==='WORDGOAT'?'175':(()=>{throw new Error('Set BOT_ID or start the named bot once to record its public identity');})());
}
export function loadScopedToken(name:string,dir=process.cwd()):string|undefined{
 const own=path.join(dir,'.token-'+encodeURIComponent(name));
 const file=fs.existsSync(own)?own:name==='WORDGOAT'?path.join(dir,'.token-wordgoat'):undefined;
 try{return file?fs.readFileSync(file,'utf8').trim()||undefined:undefined;}catch{return undefined;}
}
export function assertBotIdentity(ctx:BotContext,id:string,name:string):void{
 const wanted=storedIdentity(ctx)?.botId??ctx.botId;
 if(name!==ctx.name||(wanted!==undefined&&checkedId(id)!==wanted))throw new Error('Authenticated bot identity differs from BOT_NAME/BOT_ID; refusing to play');
}
export function saveBotIdentity(ctx:BotContext,id:string):void{
 assertBotIdentity(ctx,id,ctx.name);
 atomicJson(path.join(ctx.dataDir,'bot.json'),{schema:1,name:ctx.name,botId:checkedId(id),venue:ctx.venue});
}
export function readBotRecords(ctx:BotContext,limit=RETENTION):MatchRecord[]{
 const id=resolveBotId(ctx);return readRecords(ctx.dataDir,RETENTION).filter(r=>r.botId===id&&r.venue===ctx.venue).slice(-limit);
}
/** Raw historical arrays are accepted only for the known original venue/account.
 * New-account snapshots must carry explicit provenance before any import. */
export function readPublicSnapshots(ctx:BotContext,file=path.join(ctx.dataDir,'recent-public.json')):any[]{
 if(!fs.existsSync(file))return [];
 const value=JSON.parse(fs.readFileSync(file,'utf8')),id=resolveBotId(ctx);
 if(Array.isArray(value)){
  if(ctx.name==='WORDGOAT'&&id==='175'&&ctx.venue==='https://maincloud.spacetimedb.com/scrabblebot')return value;
  throw new Error('Snapshot provenance is missing for this account');
 }
 if(value.schema!==1||value.botName!==ctx.name||value.botId!==id||value.venue!==ctx.venue||!Array.isArray(value.matches))throw new Error('Snapshot provenance differs from the selected bot or venue');
 if(value.matches.some((s:any)=>!Array.isArray(s.match_participant)||!s.match_participant.some((p:any)=>p.bot_id===Number(id))))throw new Error('Snapshot provenance contains a match for another bot');
 return value.matches;
}
