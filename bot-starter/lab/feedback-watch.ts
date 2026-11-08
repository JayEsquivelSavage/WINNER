import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {atomicJson} from '../src/match-store.js';
import {botContext,readBotRecords,resolveBotId} from '../src/bot-context.js';
const context=botContext(),root=context.dataDir,botId=resolveBotId(context);
let known=new Set(readBotRecords(context).map(r=>r.matchId)),newMatches=0;
async function poll(){
 try{
  console.log(new Date().toISOString(),`Reading ${context.name} (bot ${botId}) public completed matches; no bot connection or restart`);
  execFileSync('python3',['lab/collect-live.py'],{stdio:'inherit'});
  execFileSync(process.execPath,['--import','tsx','lab/live-report.ts','--import','--write-report'],{stdio:'inherit',env:{...process.env,WORDGOAT_DATA_DIR:root}});
  execFileSync(process.execPath,['--import','tsx','lab/live-performance.ts'],{stdio:'inherit',env:{...process.env,WORDGOAT_DATA_DIR:root}});
  const rows=readBotRecords(context),added=rows.filter(r=>!known.has(r.matchId));newMatches+=added.length;known=new Set(rows.map(r=>r.matchId));
  if(process.env.WORDGOAT_AUTOLAB==='1'&&newMatches>=10){newMatches=0;execFileSync(process.execPath,['--max-old-space-size=256','--import','tsx','lab/improve.ts'],{stdio:'inherit'});}
  atomicJson(path.join(root,'watch-status.json'),{botId,botName:context.name,lastPoll:new Date().toISOString(),matches:rows.length,newMatches,autoExperiments:process.env.WORDGOAT_AUTOLAB==='1',deployment:'never automatic'});
 }catch{console.error('Feedback poll failed; prior records retained; no live action taken');}
 setTimeout(poll,Math.max(15000,Number(process.env.WORDGOAT_POLL_MS??60000)));
}
void poll();
