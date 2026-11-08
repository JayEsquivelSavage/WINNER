import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DbConnection} from '../src/module_bindings/index.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wordgoat-reconnect-'));
process.chdir(dir);
for(const key of ['BOT_TOKEN','BOT_NONCE','TOURNAMENT_ID','WORDGOAT_STRATEGY','WORDGOAT_PROFILE','WORDGOAT_DATA_DIR','BOT_ID','WORDGOAT_REPORT_DIR'])delete process.env[key];
process.env.WORDGOAT_DATA_DIR='telemetry';
process.env.BOT_NAME='winner';process.env.STDB_HOST='https://reconnect-test.invalid';
let firstConnect:any,reconnect:any,disconnect:any,automatic=false,builds=0;
const subscriptions:{applied:()=>void;active:boolean}[]=[];
const table=(rows:any[]=[])=>({iter:()=>rows,count:()=>BigInt(rows.length),onInsert(){},onUpdate(){},onDelete(){},id:{find:(id:bigint)=>rows.find(r=>r.id===id)}});
const state:any={id:1n,status:{tag:'Running'},currentRound:1,bagTotal:68,auctionType:{tag:'Vickrey'},createdAt:{toDate:()=>new Date()},currentAuctionId:undefined};
const db:any={
 matchState:table([state]),matchParticipant:table([{matchId:1n,botId:307n,balance:100n,score:0n}]),
 myRack:table([{matchId:1n,letter:'Q',count:1}]),auction:table(),auctionResult:table(),wordPlay:table(),openLobbies:table(),openLobbyMembers:table(),
 botCredential:{identity:{find:()=>({botId:307n})}},bot:table([{id:307n,name:'winner'}])
};
const client:any={db,reducers:{joinLobby:async()=>{assert.equal(state.status.tag,'Ended','must not join a lobby during a running match');}},disconnect(){},subscriptionBuilder(){
 let applied=()=>{};
 return {onApplied(fn:()=>void){applied=fn;return this;},onError(){return this;},subscribe(){
  const sub={applied,active:true};subscriptions.push(sub);queueMicrotask(applied);
  return {unsubscribe(){assert.equal(sub.active,true,'subscription retired twice');sub.active=false;}};
 }};
}};
const builder:any={withUri(){return this;},withDatabaseName(){return this;},withToken(){return this;},
 withAutomaticReconnect(){automatic=true;return this;},
 onConnect(fn:any){firstConnect=fn;return this;},onAutomaticReconnect(fn:any){reconnect=fn;return this;},
 onConnectError(){return this;},onDisconnect(fn:any){disconnect=fn;return this;},
 build(){builds++;setImmediate(runFixture);return client;}};
Object.defineProperty(DbConnection,'builder',{value:()=>builder,configurable:true});
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function runFixture(){
 assert.equal(automatic,true,'actual entrypoint must enable established-connection recovery');
 assert.equal(typeof reconnect,'function');
 firstConnect(client,{toHexString:()=> '0'.repeat(64)},'fixture-token');
 // Lose the socket before the queued credential/name checks have applied.
 disconnect(client,new Error('fixture pre-auth drop'),1,1000);
 reconnect(client,{toHexString:()=> '0'.repeat(64)},'refreshed-fixture-token');
 assert.equal(fs.existsSync(path.join(dir,'.token-winner')),false,'unverified reconnect must not persist a credential');
 for(let i=0;i<8;i++)await turn();
 assert.equal(fs.readFileSync(path.join(dir,'.token-winner'),'utf8'),'refreshed-fixture-token');
 const active=subscriptions.filter(s=>s.active).length;
 assert.equal(active,4,'credential, lobby, discovery and current-match subscriptions');
 for(let cycle=0;cycle<2;cycle++){
  disconnect(client,new Error('fixture transient drop'),1,1000);
  reconnect(client,{toHexString:()=> '0'.repeat(64)},'fixture-token');
  for(const sub of subscriptions.filter(s=>s.active))sub.applied();
  for(let i=0;i<8;i++)await turn();
  assert.equal(subscriptions.filter(s=>s.active).length,active,'replay must not register duplicate subscriptions');
 }
 state.status={tag:'Ended'};state.endedAt={toDate:()=>new Date()};
 for(const sub of subscriptions.filter(s=>s.active))sub.applied();
 for(let i=0;i<8;i++)await turn();
 const records=fs.readdirSync(path.join(dir,'telemetry/matches')).filter(f=>f.endsWith('.json'));
 assert.equal(records.length,1);
 const record=JSON.parse(fs.readFileSync(path.join(dir,'telemetry/matches',records[0]),'utf8'));
 assert.equal(record.coverage,'partial-session','a disconnect in round one must remain partial after replay');
 assert.equal(builds,1,'native reconnect retains the same connection');
 console.log('RECONNECT TEST: two loss/replay cycles passed without duplicate subscriptions or sockets');
}
process.once('beforeExit',()=>assert.equal(builds,1));
process.once('exit',()=>fs.rmSync(dir,{recursive:true,force:true}));
