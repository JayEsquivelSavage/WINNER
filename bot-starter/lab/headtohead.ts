import fs from 'node:fs';
import { WordEngine } from '../src/word-engine.js';
import { loadDictionary } from '../src/dictionary.js';
import { simulate,wilson } from './simulator.js';
const engine=new WordEngine(loadDictionary().words),n=100;
const total={challenger:{wins:0,score:0,auctions:0,balance:0},champion:{wins:0,score:0,auctions:0,balance:0}};
for(let i=0;i<n;i++){
 const result=simulate(engine,90000+i,['challenger','champion','rival','rival','rival','rival'],i%2?'FirstPrice':'Vickrey');
 const highest=Math.max(...result.players.map(p=>p.score));
 for(const key of ['challenger','champion'] as const){const p=result.players.find(p=>p.kind===key)!;total[key].wins+=Number(p.score===highest);total[key].score+=p.score;total[key].auctions+=p.wins;total[key].balance+=p.balance;}
}
const report=Object.fromEntries(Object.entries(total).map(([k,v])=>[k,{matches:n,winRate:v.wins/n,winCI95:wilson(v.wins,n),averageScore:v.score/n,averageWonAuctions:v.auctions/n,averageUnusedCurrency:v.balance/n}]));
fs.writeFileSync('reports/headtohead.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
