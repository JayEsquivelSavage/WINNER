export interface ArmMetrics {score:number;winRate:number;placement:number;currencyEfficiency:number;auctionWinRate:number;balance:number;invalid:number;missedCpuDeadlines:number;bidP99:number;wordP99:number;peakRssMiB:number;firstHalfScore?:number;secondHalfGain?:number;}
export interface Evaluation {name:string;seeds:number[];champion:ArmMetrics;challenger:ArmMetrics;scoreDeltaCI:[number,number];winDeltaCI:[number,number];}
export function pairedCI(deltas:number[]):[number,number] {
 if(deltas.length<2)return [-Infinity,Infinity];const n=deltas.length,m=deltas.reduce((a,b)=>a+b,0)/n;
 const sd=Math.sqrt(deltas.reduce((s,d)=>s+(d-m)**2,0)/(n-1)),z=1.96;
 return [m-z*sd/Math.sqrt(n),m+z*sd/Math.sqrt(n)];
}
export function promotionGate(checks:Record<string,boolean>,fields:Evaluation[],trainingSeeds:number[],minGames=100) {
 const reasons:string[]=[];
 if(!['compile','unit','integration','startup','sourceStable'].every(k=>checks[k]===true))reasons.push('Required compilation and tests did not all pass');
 if(!['mixed','strong'].every(name=>fields.some(f=>f.name===name))||new Set(fields.map(f=>f.name)).size!==fields.length)reasons.push('Require held-out mixed and strong fields');
 const train=new Set(trainingSeeds);let meaningful=false;
 for(const e of fields){const c=e.challenger,b=e.champion;
  if(e.seeds.length<minGames||new Set(e.seeds).size!==e.seeds.length||e.seeds.some(s=>train.has(s)))reasons.push(`${e.name}: insufficient, duplicate or leaked evaluation seeds`);
  const numbers=[...Object.values(c),...Object.values(b),...e.scoreDeltaCI,...e.winDeltaCI];
  if(numbers.some(x=>!Number.isFinite(x)))reasons.push(`${e.name}: missing or invalid metrics`);
  if(c.invalid!==0||c.missedCpuDeadlines!==0)reasons.push(`${e.name}: invalid actions or CPU deadline misses`);
  if(c.bidP99>=10||c.wordP99>=20)reasons.push(`${e.name}: decision latency target failed`);
  if(c.peakRssMiB>256||c.peakRssMiB>Math.max(b.peakRssMiB*1.2,b.peakRssMiB+10))reasons.push(`${e.name}: memory regression`);
  if(c.winRate<b.winRate||c.score<b.score)reasons.push(`${e.name}: observed performance regressed`);
  if(e.scoreDeltaCI[0]>0&&e.winDeltaCI[0]>0)meaningful=true;
 }
 if(!meaningful)reasons.push('No field demonstrates positive paired 95% score AND win improvement');
 return {eligibleForApproval:reasons.length===0,reasons,liveDeployment:'requires explicit user approval',networkDeadlines:'unverified by offline tests'};
}
