import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { FinishingPolicy } from './challenger.js';
import { type Parameters } from './config.js';
export interface Profile {schema:1;id:string;algorithm:'deployed'|'challenger'|'goal'|'cycle';parameters:Parameters;crossMatchLearning:boolean;finishing?:FinishingPolicy;}
export function validateProfile(input:unknown):Profile {
 const p=input as Profile;if(p?.schema!==1||!['deployed','challenger','goal','cycle'].includes(p.algorithm)||!/^[-a-zA-Z0-9_.]{1,80}$/.test(p.id))throw new Error('Invalid strategy profile');
 const bounds:Record<keyof Parameters,[number,number]>={bidScale:[.2,4],reserve:[0,30],futureWeight:[0,2],captureRate:[.01,.5],waitDiscount:[0,1],liquidity:[0,2],leaveWeight:[0,2],denial:[0,0],beam:[1,12],budgetMs:[.1,8],marketPrior:[0,1]};
 for(const [key,[lo,hi]]of Object.entries(bounds)){const v=p.parameters?.[key as keyof Parameters];if(!Number.isFinite(v)||v<lo||v>hi)throw new Error(`Invalid profile parameter ${key}`);}
 if(!Number.isInteger(p.parameters.beam)||typeof p.crossMatchLearning!=='boolean')throw new Error('Invalid profile types');
 if(p.finishing){const f=p.finishing;
  if(!Number.isInteger(f.maxHoldAuctions)||f.maxHoldAuctions<0||f.maxHoldAuctions>20||!Number.isFinite(f.cyclePremium)||f.cyclePremium<0||f.cyclePremium>.5||typeof f.affordableHorizon!=='boolean'||!Number.isInteger(f.liquidationWindow)||f.liquidationWindow<3||f.liquidationWindow>12)throw new Error('Invalid finishing policy');
  if(f.planningWeight!==undefined&&(!Number.isFinite(f.planningWeight)||f.planningWeight<0||f.planningWeight>3))throw new Error('Invalid planning weight');
  if(f.marketBudget!==undefined&&(!Number.isFinite(f.marketBudget)||f.marketBudget<0||f.marketBudget>1))throw new Error('Invalid market budget');
  if(f.integerReserve!==undefined&&typeof f.integerReserve!=='boolean')throw new Error('Invalid integer reserve flag');
  if(f.exactEndgame!==undefined&&typeof f.exactEndgame!=='boolean')throw new Error('Invalid exact endgame flag');
  if(f.scoreAware!==undefined&&(!Number.isFinite(f.scoreAware)||f.scoreAware<0||f.scoreAware>2))throw new Error('Invalid scoreboard weight');
  if(f.inferDeals!==undefined&&typeof f.inferDeals!=='boolean')throw new Error('Invalid inferred deal flag');
  if(f.letterMarkets!==undefined&&typeof f.letterMarkets!=='boolean')throw new Error('Invalid letter market flag');
  if(f.scoringWindow!==undefined&&(!Number.isInteger(f.scoringWindow)||f.scoringWindow<0||f.scoringWindow>20))throw new Error('Invalid scoring window');
  if(f.cashOutAtSeven!==undefined&&typeof f.cashOutAtSeven!=='boolean')throw new Error('Invalid cash-out flag');
  if(p.algorithm!=='challenger')throw new Error('Finishing policy requires challenger algorithm');
 }
 return structuredClone(p);
}
export function loadProfile(file:string):Profile{return validateProfile(JSON.parse(fs.readFileSync(file,'utf8')));}
export function profileVersion(p:Profile):string {
 const hash=createHash('sha256').update(JSON.stringify(p));
 for(const name of [p.algorithm==='deployed'?'deployed':'challenger',p.algorithm==='deployed'?'deployed-opponents':'opponents','config','word-engine','rules','session','index','bid-submission','bot-context','learning','profiles',...(p.algorithm==='challenger'?['completion-potential','endgame']:[]),...(p.algorithm==='cycle'?['cycle-strategy','completion-potential','endgame']:[]),...(p.algorithm==='goal'?['goal-strategy','completion-potential','endgame']:[])]) {
  const ts=new URL(`./${name}.ts`,import.meta.url),js=new URL(`./${name}.js`,import.meta.url);
  hash.update(fs.readFileSync(fs.existsSync(ts)?ts:js));
 }
 return p.id+'-'+hash.digest('hex').slice(0,12);
}
