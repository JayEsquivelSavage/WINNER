// Edit this file to implement your bidding and word-forming strategy.

// Standard Scrabble letter values — useful for valuation.
export const LETTER_VALUE: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

export interface BidContext {
  letter: string;        // Letter being auctioned, e.g. "Q"
  myBalance: number;     // Current balance
  myRack: Map<string, number>; // Letters you currently own, letter -> count
}

/**
 * Decide how much to bid for `letter`. Return 0 to skip.
 * Default: bid the letter's face value plus a small premium if you don't have one yet.
 */
export function decideBid(ctx: BidContext): number {
  const value = LETTER_VALUE[ctx.letter] ?? 1;
  const have = ctx.myRack.get(ctx.letter) ?? 0;
  // Pay slightly above face value for letters you don't have yet.
  const want = have === 0 ? value + 2 : Math.max(1, value);
  return Math.min(want, Math.max(0, ctx.myBalance));
}

export interface WordContext {
  myRack: Map<string, number>;
  dictionary: string[]; // Sorted uppercase list, shared at startup
}

/** Exact maximum immediate server reward, with length as the tie breaker.
 * One pair of fixed buffers per search; no objects per dictionary candidate,
 * factorial rack permutations, tries, or retained rack-result caches.
 */
export function wordReward(word: string): number {
  let base = 0;
  for (let i = 0; i < word.length; i++) base += LETTER_VALUE[word[i]] ?? 0;
  const n = word.length;
  return Math.floor(base * (n <= 3 ? 1 : n === 4 ? 1.5 : n === 5 ? 2 : n === 6 ? 2.5 : 3));
}
export function chooseWord(ctx: WordContext): string | null {
  const available = new Uint16Array(26);
  const used = new Uint16Array(26);
  let tiles = 0;
  for (const [letter, count] of ctx.myRack) {
    const i = letter.charCodeAt(0) - 65;
    if (i >= 0 && i < 26) { available[i] = count; tiles += count; }
  }
  let best: string | null = null;
  let reward = -1;
  for (const word of ctx.dictionary) {
    if (word.length > tiles) continue;
    used.fill(0);
    let spellable = true;
    for (let j = 0; j < word.length; j++) {
      const i = word.charCodeAt(j) - 65;
      if (i < 0 || i >= 26 || ++used[i] > available[i]) { spellable = false; break; }
    }
    if (!spellable) continue;
    const score = wordReward(word);
    if (score > reward || (score === reward && word.length > (best?.length ?? 0))) {
      best = word; reward = score;
    }
  }
  return best;
}
