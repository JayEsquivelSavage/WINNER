// Preload the REAL generated bindings with the same tsx loader as npm start,
// then replace only the connection builder so the REAL entrypoint executes
// without accessing a network or a credential file. A throw or import failure
// makes this regression test fail before any live bot could be launched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DbConnection } from '../src/module_bindings/index.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wordgoat-startup-'));
process.chdir(dir);
for(const key of ['BOT_TOKEN','BOT_NONCE','TOURNAMENT_ID','WORDGOAT_STRATEGY','WORDGOAT_PROFILE','WORDGOAT_DATA_DIR','BOT_ID','WORDGOAT_REPORT_DIR'])delete process.env[key];
process.env.BOT_NAME='winner';
process.env.STDB_HOST='https://startup-test.invalid';
let builds=0;
const builder={
 withUri(){return this;},withDatabaseName(){return this;},
 withAutomaticReconnect(){return this;},onAutomaticReconnect(){return this;},
 withToken(token:unknown){assert.equal(token,undefined);return this;},
 onConnect(){return this;},onConnectError(){return this;},onDisconnect(){return this;},
 build(){builds++;console.log('STARTUP TEST: module loading and challenger initialization passed; live connection disabled');return {disconnect(){}};},
};
Object.defineProperty(DbConnection,'builder',{value:()=>builder,configurable:true});
process.once('beforeExit',()=>{assert.equal(builds,1,'Actual entrypoint must reach the connection builder exactly once');});
// The entrypoint registers its own lock cleanup after this preloader. Remove
// only this test's temporary directory after it has finished exiting.
process.once('exit',()=>{fs.rmSync(dir,{recursive:true,force:true});});
