// ScrabbleBot bot starter.
//
// First run, with a token from the website:
//   On your team's page, click "Generate token", then run
//   `BOT_NAME=<name> BOT_TOKEN=<token> npm start`.
//
// Or with a nonce from the CLI:
//   1. `spacetime call scrabblebot mint_credential_nonce`
//      `spacetime sql 'SELECT code FROM my_nonces ORDER BY expires_at DESC'`
//   2. `BOT_NAME=<name> BOT_NONCE=<code> npm start`
//      The bot connects fresh and redeems the nonce.
//
// Either way the bot saves its token to .token-<BOT_NAME>, so later runs
// need only `BOT_NAME=<name> npm start`.
//
// Entering a tournament: `BOT_NAME=<name> TOURNAMENT_ID=<id> npm start`
// registers the bot for that tournament when it connects. Only the bot
// itself can register, so this has to come from the bot's process.
//
// Edit ./src/strategy.ts to customise how your bot bids and plays words.

import {
  DbConnection,
  type ErrorContext,
} from "./module_bindings/index.js";
import { Identity } from "spacetimedb";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadDictionary } from './dictionary.js';
import { WordEngine } from './word-engine.js';
import { MatchSession,rackText,type StrategyMode } from './session.js';
import { loadProfile,profileVersion } from './profiles.js';
import { persistRecord,atomicJson } from './match-store.js';
import { buildPrior,applyPrior,type PricePrior } from './learning.js';
import { performance as performanceReport } from './analytics.js';
import { diagnose } from './match-record.js';
import { acquireInstance } from './instance.js';
import { BidSubmission } from './bid-submission.js';
import {botContext,loadScopedToken,assertBotIdentity,saveBotIdentity,readBotRecords} from './bot-context.js';

const TARGET=botContext();
const HOST=TARGET.host;
const DB_NAME=TARGET.database;
const BOT_NAME=TARGET.name;
const BOT_TOKEN = process.env.BOT_TOKEN; // from the website, first run only
const BOT_NONCE = process.env.BOT_NONCE; // from the CLI, first run only
const TOURNAMENT_ID = process.env.TOURNAMENT_ID;
const TOKEN_PATH = path.join(process.cwd(), `.token-${encodeURIComponent(BOT_NAME)}`);

function loadToken(): string | undefined {return loadScopedToken(BOT_NAME);}
function saveToken(tok: string) {
  fs.writeFileSync(TOKEN_PATH, tok, { mode: 0o600 });
  fs.chmodSync(TOKEN_PATH, 0o600);
}

const releaseInstance=acquireInstance(path.join(process.cwd(),`.wordgoat-${encodeURIComponent(BOT_NAME)}.lock`));
process.once('exit',releaseInstance);

// One official dictionary and one compact index for the entire process.
const dictionary = loadDictionary();
const ENGINE = new WordEngine(dictionary.words);
const STRATEGY:StrategyMode = process.env.WORDGOAT_STRATEGY === 'champion' ? 'champion' : 'challenger';
const PROFILE=loadProfile(process.env.WORDGOAT_PROFILE??new URL('../profiles/optimized.json',import.meta.url).pathname);
const VERSION=(STRATEGY==='champion'?'legacy-':'')+profileVersion(PROFILE);
const DATA_DIR=path.resolve(TARGET.dataDir);
const VENUE=TARGET.venue;
import { discoveryQueries, matchQueries } from "./runtime.js";

type Handle = ReturnType<ReturnType<DbConnection["subscriptionBuilder"]>["subscribe"]>;
let connection: DbConnection;
let myBotId: bigint | null = null;
let identityVerified=false;
let latestConnectionToken:string|undefined;
let ready = false;
let discovery: Handle | undefined;
let matchSub: Handle | undefined;
let session:MatchSession|undefined;
let bidSubmission:BidSubmission|undefined;
let matchReady=false;
let activeMatch: bigint | undefined;

let wordPending = false;

let wordRetryAt = 0;
let joinRetryAt = 0;
let joinPending = false;
let reconcileQueued = false;
let discoveryFloor = 0n;
let lastLobby = "";

function log(message: string) {
  console.log(`${new Date().toISOString()} [${BOT_NAME}] ${message}`);
}
function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return [BOT_TOKEN, loadToken(), BOT_NONCE].filter((value): value is string => Boolean(value))
    .reduce((s, secret) => s.split(secret).join("[REDACTED]"), message);
}
function failure(action: string) {
  return (error: unknown) => log(`${action} failed: ${safeError(error)}`);
}
function subscribe(queries: string[], applied: () => void): Handle {
  return connection.subscriptionBuilder().onApplied(applied).onError(ctx => {
    failure("subscription")(ctx.event);
    connection.disconnect();
    process.exitCode = 1;
  }).subscribe(queries);
}
function schedule() {
  if (reconcileQueued) return;
  reconcileQueued = true;
  // Coalesce all rows in a transaction; never search on partial rack updates.
  setImmediate(() => { reconcileQueued = false; if (ready) reconcile(); });
}
function rack(): Map<string, number> {
  const result = new Map<string, number>();
  for (const h of connection.db.myRack.iter()) {
    if (h.matchId === activeMatch) result.set(h.letter, (result.get(h.letter) ?? 0) + h.count);
  }
  return result;
}
function watchDiscovery(floor: bigint) {
  let previous = discovery;
  discovery = subscribe(discoveryQueries(myBotId!, floor), () => {
    previous?.unsubscribe();previous=undefined;
    ready = true;
    log(`match discovery applied (bot ${myBotId}, minimum match ${floor})`);
    schedule();
  });
}
function watchMatch(id: bigint | undefined) {
  matchReady=false;
  matchSub?.unsubscribe(); matchSub = undefined;
  activeMatch=id;session=undefined;bidSubmission=undefined;wordPending=false;wordRetryAt=0;
  if(id===undefined)return;
  session=new MatchSession(id,myBotId!,ENGINE,STRATEGY,PROFILE.parameters,PROFILE.algorithm,PROFILE.finishing);
  const currentSession=session;
  bidSubmission=new BidSubmission(async(auctionId,amount)=>{
    if(session!==currentSession)throw new Error('Bid belongs to a previous match');
    currentSession.bidStarted(auctionId,amount);
    try {
      await connection.reducers.submitBid({auctionId,amount:BigInt(amount)});
      currentSession.bidSettled(auctionId,amount);
    }catch(error){
      currentSession.bidSettled(auctionId);
      throw error;
    }
  });
  log(`match ${id} started/resumed strategy=${STRATEGY} profile=${VERSION}`);
  matchSub=subscribe(matchQueries(id,myBotId!),()=>{
    if(activeMatch!==id)return;
    matchReady=true;
    const state=connection.db.matchState.id.find(id);
    if(!session!.initialRackAccounted)session!.coverage=state?.currentRound===1&&connection.db.auctionResult.count()===0n?'full-session':'partial-session';
    if(!session!.initialRackAccounted&&PROFILE.crossMatchLearning&&state){
      try{const prior=JSON.parse(fs.readFileSync(path.join(DATA_DIR,'price-prior.json'),'utf8')) as PricePrior;
        const accepted=applyPrior(session!.agent.model.hist,prior,VENUE,state.auctionType.tag,state.createdAt.toDate().toISOString());
        log(`match ${id} bounded historical prior ${accepted?'applied':'not eligible'}`);
      }catch{log(`match ${id} no eligible historical prior; using validated defaults`);}
    }
    session!.rack.update(rack());
    // Recover our initial deal exactly from our current rack plus public
    // consumed words minus public acquisitions. Opponent deals remain hidden.
    const initial=Int16Array.from(session!.rack.counts);
    for(const w of connection.db.wordPlay.iter())if(w.matchId===id&&w.botId===myBotId)
      for(const c of w.word)initial[c.charCodeAt(0)-65]++;
    for(const r of connection.db.auctionResult.iter())if(r.matchId===id&&r.winnerBotId===myBotId)
      initial[r.letter.charCodeAt(0)-65]--;
    if(!session!.initialRackAccounted){
      for(let c=0;c<26;c++)session!.remainingCounts[c]=Math.max(0,session!.remainingCounts[c]-Math.max(0,initial[c]));
      session!.initialRackAccounted=true;
    }
    log(`match ${id} rack, participants and public events ready`);schedule();
  });
}
function publicEvents(kind:'FirstPrice'|'Vickrey') {
  if(!session||!matchReady)return;
  for(const a of connection.db.auction.iter())if(a.matchId===activeMatch)session.auction(a.id,a.letter);
  for(const r of connection.db.auctionResult.iter())if(r.matchId===activeMatch) {
    const ourBid=session.ourBids.get(r.auctionId);
    if(session.result(r.auctionId,r.letter,r.winnerBotId,Number(r.paid),kind))
      log(`match ${activeMatch} auction ${r.auctionId}: ${r.letter} winner=${r.winnerBotId??'none'} paid=${r.paid} ourBid=${ourBid??'unobserved'} won=${r.winnerBotId===myBotId}`);
  }
  for(const w of connection.db.wordPlay.iter())if(w.matchId===activeMatch) {
    if(session.word(w.id,w.botId,w.word,Number(w.totalReward))&&w.botId===myBotId)
      log(`match ${activeMatch}: confirmed word '${w.word}' actualScore=${w.totalReward}`);
  }
  for(const p of connection.db.matchParticipant.iter())if(p.matchId===activeMatch&&p.botId!==myBotId)
    session.agent.model.participant(p.botId,Number(p.balance),Number(p.score));
}
function reconcile() {
  let running:bigint|undefined,newest=discoveryFloor;
  for(const m of connection.db.matchState.iter()) {
    if(m.id>newest)newest=m.id;
    if(m.status.tag==='Running')running=m.id;
  }
  const floor=running!==undefined&&running<newest?running:newest;
  if(floor>discoveryFloor){discoveryFloor=floor;watchDiscovery(floor);}
  if(running!==activeMatch) {
    if(activeMatch!==undefined&&session) {
      const m=connection.db.matchState.id.find(activeMatch);
      publicEvents(m?.auctionType.tag??'Vickrey');
      session.rack.update(rack());
      const p=[...connection.db.matchParticipant.iter()].find(p=>p.matchId===activeMatch&&p.botId===myBotId);
      log(`match ${activeMatch} completed ${JSON.stringify(session.summary(Number(p?.score??0),Number(p?.balance??0)))}`);
      if(m?.status.tag==='Ended'&&p&&m.endedAt) {
        try {
          const opponents=[...connection.db.matchParticipant.iter()].filter(q=>q.matchId===activeMatch&&q.botId!==myBotId).map(q=>({id:String(q.botId),score:Number(q.score),balance:Number(q.balance)}));
          const record=session.toRecord({venue:VENUE,startedAt:m.createdAt.toDate().toISOString(),endedAt:m.endedAt.toDate().toISOString(),strategyVersion:VERSION,profileId:PROFILE.id,score:Number(p.score),balance:Number(p.balance),opponents});
          record.words=[...connection.db.wordPlay.iter()].filter(w=>w.matchId===activeMatch&&w.botId===myBotId).map(w=>({word:w.word,score:Number(w.totalReward)}));
          persistRecord(DATA_DIR,record);
          const records=readBotRecords(TARGET,30);atomicJson(path.join(DATA_DIR,'dashboard.json'),performanceReport(records));
          // Checkpoint only after completion; never rewrite code or profiles.
          atomicJson(path.join(DATA_DIR,'price-prior.json'),buildPrior(records,VENUE,new Date().toISOString()));
          log(`match ${activeMatch} analysis ${JSON.stringify(diagnose(record))}`);
        } catch {log('match telemetry write failed; gameplay continues');}
      }
    }
    watchMatch(running);
  }
  if(activeMatch===undefined){void joinLobby();return;}
  if(!session||!matchReady)return;
  const match=connection.db.matchState.id.find(activeMatch);
  if(!match||match.status.tag!=='Running')return;
  publicEvents(match.auctionType.tag);
  const participant=[...connection.db.matchParticipant.iter()].find(p=>p.matchId===activeMatch&&p.botId===myBotId);
  if(!participant)return;
  session.rack.update(rack());
  let leader=0;for(const p of connection.db.matchParticipant.iter())if(p.matchId===activeMatch)leader=Math.max(leader,Number(p.score));
  const position=session.position(Number(participant.balance),match.bagTotal,match.auctionType.tag,Number(participant.score),leader);
  const auction=match.currentAuctionId===undefined?undefined:connection.db.auction.id.find(match.currentAuctionId);
  const bidKey=`${auction?.id}:${session.rack.version}:${position.balance}`;
  if(auction?.status.tag==='Open'&&session.lastBidKey!==bidKey) {
    session.lastBidKey=bidKey;
    session.lastBidAuction=auction.id;
    const remainingMs=Number(auction.closesAt.microsSinceUnixEpoch/1000n)-Date.now();
    // A guard is useful but cannot eliminate network/server-clock uncertainty.
    if(remainingMs<75) {session.lateSkips++;log(`auction ${auction.id} skipped: deadline margin ${remainingMs}ms`);}
    else {
      const d=session.bid(auction.letter,position);
      log(`match ${activeMatch} auction ${auction.id}: letter=${auction.letter} balance=${participant.balance} rack=${rackText(position.rack)} value=${d.value.toFixed(2)} bid=${d.amount} score=${participant.score} leader=${leader} futureAuctions=${match.bagTotal} cpuMs=${d.elapsedMs.toFixed(3)} fallback=${d.fallback}`);
      if(bidSubmission) {
        const currentSession=session;
        void bidSubmission.submit(auction.id,d.amount).catch(error=>{
          currentSession.actionFailure(safeError(error));
          if(session===currentSession)currentSession.lastBidKey='';
          failure(`bid ${auction.id}`)(error);
        });
      }
    }
  }
  const key=`${rackText(position.rack)}:${match.bagTotal}:${Math.floor(position.balance/10)}`;
  if(wordPending||key===session.lastWordKey||Date.now()<wordRetryAt)return;
  session.lastWordKey=key;
  const d=session.play(position);
  if(d.best)log(`match ${activeMatch} word decision: rack=${rackText(position.rack)} best=${d.best} bestScore=${d.bestScore} chosen=${d.word??'WAIT'} reason=${d.reason} futureAuctions=${match.bagTotal} cpuMs=${d.elapsedMs.toFixed(3)}`);
  if(d.id<0||!d.word)return;
  // Recheck the authoritative cache before submitting; never form a word
  // from opponent reconstructions or an optimistic local award.
  const freshRack=rack();session.rack.update(freshRack);
  if(!ENGINE.valid(d.id,session.rack.counts)) {session.errors++;session.invalidActions++;session.lastWordKey='';return;}
  wordPending=true;
  const id=activeMatch,currentSession=session,word=d.word;
  void connection.reducers.submitWord({matchId:id,word}).then(()=>log(`match ${id}: word '${word}' accepted`))
    .catch(error=>{currentSession.actionFailure(safeError(error));failure(`word '${word}'`)(error);if(activeMatch===id){currentSession.lastWordKey='';wordRetryAt=Date.now()+500;}})
    .finally(()=>{if(activeMatch===id){wordPending=false;schedule();}});
}
async function joinLobby() {
  if (joinPending || myBotId === null || Date.now() < joinRetryAt) return;
  for (const member of connection.db.openLobbyMembers.iter()) {
    if (member.botId === myBotId) {
      const lobby = connection.db.openLobbies.id.find(member.lobbyId);
      const state = `${member.lobbyId}`;
      if (lastLobby !== state) {
        lastLobby = state;
        log(`lobby ${state} membership confirmed; closes ${lobby?.closesAt.toDate().toISOString() ?? "unknown"}`);
      }
      return;
    }
  }
  joinPending = true;
  log("registering with official join_lobby reducer");
  try { await connection.reducers.joinLobby({}); log("join_lobby accepted"); }
  catch (error) { joinRetryAt = Date.now() + 10000; failure("join_lobby")(error); }
  finally { joinPending = false; }
}
function onConnect(conn: DbConnection, identity: Identity, token: string) {
  connection = conn;
  latestConnectionToken=token;
  log("connected; authenticating credential");
  // Each listener is installed once on this connection. No reconnect loop.
  for (const table of [conn.db.matchState, conn.db.matchParticipant, conn.db.myRack,
    conn.db.auction, conn.db.auctionResult, conn.db.wordPlay, conn.db.openLobbies, conn.db.openLobbyMembers]) {
    table.onInsert(schedule); table.onUpdate(schedule); table.onDelete(schedule);
  }
  subscribe([`SELECT * FROM bot_credential WHERE identity = 0x${identity.toHexString()}`], () => {
    if(myBotId!==null)return;
    void (async () => {
      let credential = conn.db.botCredential.identity.find(identity);
      if (!credential && BOT_NONCE) {
        await conn.reducers.claimCredential({ code: BOT_NONCE });
        credential = conn.db.botCredential.identity.find(identity);
      }
      if (!credential) throw new Error("No BotCredential for this token; lobby registration requires a bot credential");
      myBotId = credential.botId;
      let initialized=false;
      subscribe([`SELECT * FROM bot WHERE id = ${myBotId}`, "SELECT * FROM open_lobbies", "SELECT * FROM open_lobby_members"], () => {
        if(initialized)return;initialized=true;
        const bot = conn.db.bot.id.find(myBotId!);
        try{
          if(!bot)throw new Error('Authenticated bot record unavailable');
          assertBotIdentity(TARGET,String(myBotId),bot.name);
          saveBotIdentity(TARGET,String(myBotId));
          saveToken(latestConnectionToken??token);
          identityVerified=true;
        }catch(error){failure('authentication identity')(error);conn.disconnect();process.exitCode=1;return;}
        log(`authenticated bot '${bot?.name ?? "unknown"}' (id ${myBotId})`);
        watchDiscovery(0n);
        if (TOURNAMENT_ID) {
          void conn.reducers.registerForTournament({ tournamentId: BigInt(TOURNAMENT_ID) })
            .then(() => log(`registered for tournament ${TOURNAMENT_ID}`)).catch(failure("tournament registration"));
        }
      });
    })().catch(error => { failure("authentication")(error); conn.disconnect(); process.exitCode = 1; });
  });
}
function memory() {
  const m = process.memoryUsage();
  log(`memory rss=${(m.rss/1048576).toFixed(1)}MiB heap=${(m.heapUsed/1048576).toFixed(1)}MiB external=${(m.external/1048576).toFixed(1)}MiB dictionary=${dictionary.words.length} indexMiB=${(ENGINE.bytes/1048576).toFixed(1)} cache=${ENGINE.cache.size} rows: matches=${connection?.db.matchState.count() ?? 0} participants=${connection?.db.matchParticipant.count() ?? 0} auctions=${connection?.db.auction.count() ?? 0} racks=${connection?.db.myRack.count() ?? 0}`);
}
memory();
setInterval(memory, 10000).unref();
setInterval(schedule, 1000).unref();
log(`connecting to ${DB_NAME} at ${HOST}; strategy=${STRATEGY} profile=${VERSION} dictionarySha256=${dictionary.sha256}`);
connection = DbConnection.builder().withUri(HOST).withDatabaseName(DB_NAME)
  .withToken(BOT_TOKEN ?? loadToken()).withAutomaticReconnect().onConnect(onConnect)
  .onAutomaticReconnect((_conn,_identity,token)=>{
    latestConnectionToken=token;
    if(identityVerified)saveToken(token);
    log("reconnected; awaiting refreshed subscriptions");
  })
  .onConnectError((_ctx: ErrorContext, err: Error,nextAttempt?:number) => { failure("connection")(err); if(nextAttempt===undefined)process.exitCode = 1; })
  .onDisconnect((_ctx,_error,nextAttempt,delayMs) => {
    ready=false;matchReady=false;wordPending=false;joinPending=false;
    if(session){
      session.coverage="partial-session";session.lastBidKey="";session.lastWordKey="";
      session.ourBids.clear();
      bidSubmission?.reset(session.lastBidAuction);
    }
    log(nextAttempt===undefined?"disconnected":"disconnected; automatic retry "+nextAttempt+" in "+delayMs+"ms");
  }).build();
process.once("SIGTERM", () => { log("controlled shutdown"); connection.disconnect(); });
process.once("SIGINT", () => { log("shutdown"); connection.disconnect(); });
