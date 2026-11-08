// Verified against spacetimedb/src/{letters,game,index}.ts. Conformance tests
// compare these constants and the simulator with the real reducers.
export const VALUES = new Uint8Array([1,3,3,2,1,4,2,4,1,8,5,1,3,1,1,3,10,1,1,1,1,4,4,8,4,10]);
export const BAG = new Uint8Array([9,2,2,4,12,2,3,2,9,1,1,4,2,6,8,2,1,6,4,6,4,2,2,1,2,1]);
export type Rack = Uint8Array;
export type AuctionKind = 'FirstPrice' | 'Vickrey';
export function reward(base: number, length: number): number {
  return Math.floor(base * (length <= 3 ? 1 : length === 4 ? 1.5 : length === 5 ? 2 : length === 6 ? 2.5 : 3));
}
export function counts(letters: string): Rack {
  const result = new Uint8Array(26);
  for (const c of letters) { const i=c.charCodeAt(0)-65; if(i>=0&&i<26) result[i]++; }
  return result;
}
export function rackMap(rack: Rack): Map<string, number> {
  const m = new Map<string,number>();
  for (let i=0;i<26;i++) if(rack[i]) m.set(String.fromCharCode(65+i),rack[i]);
  return m;
}
