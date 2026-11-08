import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {botContext,resolveBotId,loadScopedToken,assertBotIdentity,saveBotIdentity} from './bot-context.js';

test('new account uses separate data and reports while WORDGOAT retains its existing paths',()=>{
 const winner=botContext({}),old=botContext({BOT_NAME:'WORDGOAT'});
 assert.equal(winner.dataDir,path.join('telemetry','bots','bot-winner'));
 assert.equal(winner.reportDir,path.join('reports','bots','bot-winner'));
 assert.equal(resolveBotId(winner),'307');assert.equal(old.dataDir,'telemetry');assert.equal(old.reportDir,'reports');
 assert.equal(resolveBotId(old),'175');
 assert.throws(()=>botContext({BOT_NAME:'winner',BOT_ID:'307 OR 1=1'}),/bot ID/i);
 assert.ok(!botContext({BOT_NAME:'..'}).dataDir.split(path.sep).includes('..'));
});
test('winner cannot silently inherit WORDGOAT credentials',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'winner-credential-test-'));
 try{
  fs.writeFileSync(path.join(dir,'.token-wordgoat'),'legacy-fixture');
  assert.equal(loadScopedToken('winner',dir),undefined);
  assert.equal(loadScopedToken('WORDGOAT',dir),'legacy-fixture');
  fs.writeFileSync(path.join(dir,'.token-winner'),'winner-fixture');
  assert.equal(loadScopedToken('winner',dir),'winner-fixture');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('authentication requires the intended public bot identity and persists only public metadata',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'winner-identity-test-'));
 try{
  const ctx=botContext({BOT_NAME:'winner',BOT_ID:'307',WORDGOAT_DATA_DIR:dir});
  assert.throws(()=>assertBotIdentity(ctx,'175','WORDGOAT'),/identity/i);
  assert.throws(()=>assertBotIdentity(ctx,'175','winner'),/identity/i);
  assertBotIdentity(ctx,'307','winner');saveBotIdentity(ctx,'307');
  const saved=JSON.parse(fs.readFileSync(path.join(dir,'bot.json'),'utf8'));
  assert.deepEqual(saved,{schema:1,name:'winner',botId:'307',venue:'https://maincloud.spacetimedb.com/scrabblebot'});
  assert.equal(resolveBotId(botContext({BOT_NAME:'winner',WORDGOAT_DATA_DIR:dir})),'307');
  assert.throws(()=>resolveBotId(botContext({BOT_NAME:'other',WORDGOAT_DATA_DIR:dir})),/identity/i);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
