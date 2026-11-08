import { VALUES, reward, type Rack } from './rules.js';
export interface WordResult { id: number; word: string; score: number; length: number }
export type IndexMode = 'trie' | 'bitset';
/** Anagram-signature trie: only nondecreasing letter sequences, never rack
 * permutations. All anagrams share an exact frequency signature and score.
 * Fixed-width arrays replace JS trie objects. Full signatures remain available
 * for validation, subtraction, and a separately benchmarked bitset index. */
export class WordEngine {
  readonly words: readonly string[];
  readonly signatures: Uint8Array;
  readonly scores: Uint16Array;
  readonly anagramNext:Int32Array;
  readonly masks: Uint32Array;
  readonly lengths: Uint8Array;
  readonly first: Int32Array;
  readonly next: Int32Array;
  readonly letter: Uint8Array;
  readonly terminal: Int32Array;
  readonly upper: Uint16Array;
  readonly postings: Uint32Array;
  readonly bitWords: number;
  readonly cache = new Map<string, readonly number[]>();
  readonly cacheLimit: number;
  cacheHits=0; queries=0; visited=0;
  readonly maxResults=12;
  constructor(dictionary: readonly string[], cacheLimit=2048) {
    this.words=dictionary;
    this.cacheLimit=cacheLimit;
    const n=dictionary.length;
    this.signatures=new Uint8Array(n*26); this.scores=new Uint16Array(n);this.anagramNext=new Int32Array(n).fill(-1);
    this.masks=new Uint32Array(n); this.lengths=new Uint8Array(n);
    this.bitWords=Math.ceil(n/32); this.postings=new Uint32Array(26*this.bitWords);
    const first=[-1], next=[-1], letter=[0], terminal=[-1], upper=[0];
    for(let id=0;id<n;id++) {
      const word=dictionary[id];
      if(!/^[A-Z]{2,}$/.test(word)) throw new Error('Dictionary must contain uppercase words of length >=2');
      let base=0, mask=0;
      for(let j=0;j<word.length;j++) { const c=word.charCodeAt(j)-65; this.signatures[id*26+c]++; base+=VALUES[c]; mask|=1<<c; }
      this.scores[id]=reward(base,word.length); this.masks[id]=mask; this.lengths[id]=word.length;
      for(let c=0;c<26;c++) if(mask&(1<<c)) this.postings[c*this.bitWords+(id>>>5)]|=1<<(id&31);
      let node=0; upper[0]=Math.max(upper[0],this.scores[id]);
      for(let c=0;c<26;c++) for(let k=0;k<this.signatures[id*26+c];k++) {
        let child=first[node];
        while(child!==-1&&letter[child]!==c) child=next[child];
        if(child===-1) { child=first.length; first.push(-1);next.push(first[node]);letter.push(c);terminal.push(-1);upper.push(0);first[node]=child; }
        node=child; upper[node]=Math.max(upper[node],this.scores[id]);
      }
      if(terminal[node]===-1) terminal[node]=id;
      else {this.anagramNext[id]=this.anagramNext[terminal[node]];this.anagramNext[terminal[node]]=id;}
    }
    this.first=Int32Array.from(first);this.next=Int32Array.from(next);this.letter=Uint8Array.from(letter);
    this.terminal=Int32Array.from(terminal);this.upper=Uint16Array.from(upper);
  }
  get bytes(): number {
    return this.anagramNext.byteLength+this.signatures.byteLength+this.scores.byteLength+this.masks.byteLength+this.lengths.byteLength+
      this.first.byteLength+this.next.byteLength+this.letter.byteLength+this.terminal.byteLength+this.upper.byteLength+this.postings.byteLength;
  }
  valid(id: number,rack: Rack): boolean {
    if(id<0||id>=this.words.length) return false;
    for(let c=0;c<26;c++) if(this.signatures[id*26+c]>rack[c]) return false;
    return true;
  }
  subtract(rack: Rack,id: number): Rack {
    if(!this.valid(id,rack)) throw new Error('Cannot subtract unspellable word');
    const leave=rack.slice();for(let c=0;c<26;c++) leave[c]-=this.signatures[id*26+c];return leave;
  }
  result(id: number): WordResult | null { return id<0 ? null : {id,word:this.words[id],score:this.scores[id],length:this.lengths[id]}; }
  top(rack: Rack): readonly number[] {
    this.queries++;
    const key=String.fromCharCode(...rack);
    const hit=this.cache.get(key); if(hit) { this.cacheHits++;return hit; }
    const found=this.search(rack,'trie');
    if(this.cache.size>=this.cacheLimit) this.cache.delete(this.cache.keys().next().value!);
    if(this.cacheLimit>0) this.cache.set(key,found);
    return found;
  }
  best(rack: Rack): number { return this.top(rack)[0] ?? -1; }
  /** Uncached alternatives used in differential correctness and benchmarks. */
  search(rack: Rack,mode: IndexMode): number[] {
    const best: number[]=[];
    const insert=(id:number) => {
      if(id<0) return;
      // Collapse anagrams in both indexes; their scores and leave are identical.
      const score=this.scores[id];
      let at=0;while(at<best.length&&(this.scores[best[at]]>score||
        (this.scores[best[at]]===score&&this.words[best[at]]<this.words[id]))) at++;
      if(at>=this.maxResults) return;
      if(mode==='bitset') for(const b of best) if(this.sameSignature(id,b)) return;
      best.splice(at,0,id);if(best.length>this.maxResults) best.pop();
    };
    let nodes=0;
    if(mode==='trie') {
      const available=rack.slice();
      const walk=(node:number) => {
        nodes++;
        if(best.length===this.maxResults&&this.upper[node]<this.scores[best[best.length-1]]) return;
        insert(this.terminal[node]);
        for(let child=this.first[node];child!==-1;child=this.next[child]) {
          const c=this.letter[child];if(!available[c]) continue;
          available[c]--;walk(child);available[c]++;
        }
      };
      walk(0);
    } else {
      let missing=0,total=0; for(let c=0;c<26;c++) {if(!rack[c]) missing|=1<<c;total+=rack[c];}
      const absent:number[]=[];for(let c=0;c<26;c++) if(missing&(1<<c)) absent.push(c*this.bitWords);
      for(let block=0;block<this.bitWords;block++) {
        let forbidden=0;for(const offset of absent) forbidden|=this.postings[offset+block];
        let possible=~forbidden;
        while(possible) {
          const bit=31-Math.clz32(possible&-possible);possible&=possible-1;
          const id=block*32+bit;if(id>=this.words.length||this.lengths[id]>total) continue;
          nodes++;if(this.valid(id,rack)) insert(id);
        }
      }
    }
    this.visited=nodes;return best;
  }
  /** All accepted spellings, including every anagram; used by exhaustive
   * validation and longest-word baselines. Production search collapses only
   * strategically equivalent anagrams, never distinct letter counts. */
  allPlayable(rack:Rack):number[] {
    const found:number[]=[],available=rack.slice();
    const walk=(node:number)=>{
      for(let id=this.terminal[node];id!==-1;id=this.anagramNext[id]) found.push(id);
      for(let child=this.first[node];child!==-1;child=this.next[child]) {
        const c=this.letter[child];if(!available[c])continue;
        available[c]--;walk(child);available[c]++;
      }
    };walk(0);return found;
  }
  private sameSignature(a:number,b:number):boolean {
    if(this.lengths[a]!==this.lengths[b]||this.masks[a]!==this.masks[b]) return false;
    for(let c=0;c<26;c++) if(this.signatures[a*26+c]!==this.signatures[b*26+c]) return false;
    return true;
  }
}
/** Incrementally maintained count vector, updated from authoritative rack rows. */
export class RackState {
  readonly counts=new Uint8Array(26); version=0;
  update(rack: ReadonlyMap<string,number>): boolean {
    let changed=false;
    for(let i=0;i<26;i++) { const n=rack.get(String.fromCharCode(65+i))??0;if(n!==this.counts[i]) {changed=true;this.counts[i]=n;} }
    if(changed) this.version++;
    return changed;
  }
}
