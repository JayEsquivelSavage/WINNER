import fs from 'node:fs';
/** Refuse a second upgraded instance; stale locks after a crash are recoverable.
 * Legacy versions have no lock, so deployment still requires stopping the old
 * process AFTER its match ends and AFTER the user's approval. */
export function acquireInstance(lockPath:string):()=>void {
 for(let attempt=0;attempt<2;attempt++) {
  try {
   const fd=fs.openSync(lockPath,'wx',0o600);
   try{fs.writeFileSync(fd,String(process.pid));}finally{fs.closeSync(fd);}
   return ()=>{try{if(fs.readFileSync(lockPath,'utf8')===String(process.pid))fs.unlinkSync(lockPath);}catch{ /* already released */ }};
  } catch(error) {
   if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
   const pid=Number(fs.readFileSync(lockPath,'utf8'));
   if(!Number.isInteger(pid)||pid<=0)throw new Error('Invalid instance lock; inspect it before starting');
   try {process.kill(pid,0);} catch(e) {
    if((e as NodeJS.ErrnoException).code==='ESRCH'){fs.unlinkSync(lockPath);continue;}
    throw new Error('An existing instance cannot be inspected; refusing a duplicate connection');
   }
   throw new Error(`WORDGOAT is already running (pid ${pid}); refusing a duplicate connection`);
  }
 }
 throw new Error('Could not acquire WORDGOAT instance lock');
}
