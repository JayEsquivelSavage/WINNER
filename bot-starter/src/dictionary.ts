import fs from 'node:fs';
import { createHash } from 'node:crypto';
// Same source file embedded by the server. No extra word lists or filtering.
export function loadDictionary(): {words:string[];sha256:string} {
  const raw=fs.readFileSync(new URL('../../spacetimedb/wordlist.txt',import.meta.url),'utf8');
  const words=raw.split('\n').filter(w=>w.length>0);
  if(words.some(w=>! /^[A-Z]{2,}$/.test(w))) throw new Error('Unexpected official dictionary format');
  return {words,sha256:createHash('sha256').update(raw).digest('hex')};
}
