export interface Parameters {
  bidScale:number; reserve:number; futureWeight:number; captureRate:number;
  waitDiscount:number; liquidity:number; leaveWeight:number; denial:number;
  beam:number; budgetMs:number; marketPrior:number;
}
export const DEFAULTS: Readonly<Parameters> = Object.freeze({
  bidScale:1.4,reserve:8,futureWeight:0.8,captureRate:0.22,
  waitDiscount:0.07,liquidity:0.5,leaveWeight:1,denial:0,
  beam:4,budgetMs:6,marketPrior:0,
});
export const MEMORY_BUDGET = { heapMiB:256, rackCacheEntries:2048, opponents:12, historyRounds:98 } as const;
