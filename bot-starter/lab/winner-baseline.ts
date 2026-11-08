/** Synthetic baseline only: no bot socket, private reads or profile changes. */
import fs from 'node:fs';
import path from 'node:path';
import {randomInt} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {botContext} from '../src/bot-context.js';
import {loadProfile,profileVersion} from '../src/profiles.js';
const context=botContext(),profile=loadProfile('profiles/optimized.json'),version=profileVersion(profile);
const dir=path.join(context.dataDir,'experiments','baseline-'+Date.now());fs.mkdirSync(dir,{recursive:true,mode:0o700});
const seedBase=randomInt(10_000_000,1_000_000_000),seeds=Array.from({length:200},(_,i)=>seedBase+i);
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({bot:context.name,profile,version,seeds},null,2));
const fields=[];
for(const field of ['strong','mixed']){
 const input=path.join(dir,field+'-input.json'),output=path.join(dir,field+'-output.json');
 fs.writeFileSync(input,JSON.stringify({profile,seeds,field}));
 execFileSync(process.execPath,['--max-old-space-size=256','--import','tsx','lab/feedback-worker.ts',input,output],{stdio:['ignore','ignore','pipe']});
 const result=JSON.parse(fs.readFileSync(output,'utf8'));
 fields.push({field,games:seeds.length,metrics:result.metrics});console.log(JSON.stringify(fields.at(-1)));
}
const sourceStable=version===profileVersion(loadProfile('profiles/optimized.json'));
const report={bot:context.name,botId:context.botId,profile,version,seedBase,seeds,fields,sourceStable,artifacts:dir,
 limitations:['These are synthetic games, not winner live results.','No strategy comparison or superiority claim is made.','Network deadlines are not modeled.']};
fs.mkdirSync(context.reportDir,{recursive:true});fs.writeFileSync(path.join(context.reportDir,'baseline.json'),JSON.stringify(report,null,2)+'\n');
if(!sourceStable||fields.some(f=>f.metrics.invalid||f.metrics.missedCpuDeadlines))throw new Error('Baseline validation failed');
console.log('WINNER synthetic baseline saved; no live connection or profile change.');
