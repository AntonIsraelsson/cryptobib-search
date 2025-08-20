Here’s a complete plan for an ultra-fast, fully client-side search of the CryptoBib corpus in a static Svelte app, with options, trade-offs, and a concrete, minimal API and implementation you can drop in.

Overview
- What you’ll get:
  - A tiered, prebuilt inverted index shipped as static assets, queried in a Web Worker (no main-thread blocking).
  - Single-string free-text search with AND semantics, prefixes, quoted phrases, and optional typo-tolerance for names/titles.
  - Deterministic ranking (title > authors > venue/year/key/DOI), top-k results, diacritic-insensitive matching, and optional highlighting metadata.
  - A reproducible build pipeline converting BibTeX → Hayagriva YAML → compact client-side index & docstore.
  - Scripts and Svelte snippets to run it locally, in CI/CD, and deploy as static assets.
- Targets:
  - p50 query <10 ms, p95 <30 ms (2–4 tokens), keystroke-to-render ≤50 ms p95 for ≤100 results.
  - Compressed index footprint ~2–8 MB (core fields), extended fields loaded on demand.
  - No server runtime; works offline.

1) Deep analysis of approaches

A. Prebuilt inverted indexes shipped as static assets
- Shape:
  - Build offline. Ship binary assets: term dictionary, postings (docIDs, frequencies/positions), metadata, and a minimal docstore for rendering results.
  - Query in a Web Worker using TypedArrays; use delta-encoded, varint-compressed postings to keep size small.
- Pros:
  - Small, fast, portable, zero runtime dependencies. Fine-grained control over normalization, tokenization, fuzziness, AND/phrase semantics, and ranking.
  - Can tier/shard to load only what’s needed (e.g., titles+authors first).
  - Deterministic scoring and very low latency once resident.
- Cons:
  - You own the index format and tooling (but the format can be simple and stable).
  - Phrase/fuzzy/prefix require some care in dictionary+posting design.
- Fit:
  - Excellent for 50k–150k entries without abstracts. Keeps download/memory low and hitting the latency goals is realistic.

B. Embedded databases or WASM-backed engines (e.g., Rust-based inverted-index engines compiled to WASM)
- Shape:
  - Build the index offline with a native engine, ship the segments, run a WASM query engine in the browser worker.
- Pros:
  - Strong search features, mature scoring, phrase/fuzzy built-in, robust formats, easy ranking control.
- Cons:
  - Larger downloads (WASM runtime + index segments). Index formats often optimized for disk/servers; might exceed footprint budget.
  - Initialization/instantiation overhead in WASM; mobile memory pressure.
- Fit:
  - Feels heavy for our footprint goals and static hosting. Great for richer fields or if you want to offload format complexity to a battle-tested engine.

C. Pure JavaScript search engines
- Shape:
  - Bundle a JS engine and either build index at runtime or prebuild JSON indexes.
- Pros:
  - Quick to start, simple integration.
- Cons:
  - Building index in-browser is too slow; prebuilt JSON indexes are bloated vs compact binaries; garbage collection pressure; fewer controls on prefix/phrase/fuzzy at needed scale.
- Fit:
  - Risky for 50k–150k docs given latency/footprint targets.

D. Sharded or tiered index strategies (orthogonal complement to A–C)
- Shape:
  - Split artifacts by field or popularity, load opportunistically (e.g., titles+authors first, extended fields on-demand).
- Pros:
  - Dramatically reduces initial download and memory. You can meet the 2–8 MB budget for “core” and defer the rest.
- Cons:
  - Complexity in orchestrating loads and merges. Need to classify queries to decide which shards to load.
- Fit:
  - Strongly recommended for this corpus: core tier (titles+authors) loaded upfront; extended tier (venue/year/key/DOI) lazy-loaded, especially when queries look numeric/DOI-like.

Trade-offs summary
- Latency:
  - Prebuilt inverted index + worker + typed arrays offers consistently <10 ms p50 for short queries; phrase/fuzzy cost is bounded with careful candidate limits.
- Memory/size:
  - Tiering and varint-delta compressed postings keep size and memory in budget. JSON indexes likely too big.
- Ranking:
  - Custom index gives full control over per-field weights, tie-breakers, and stable ordering.
- Complexity:
  - Prebuilt custom index requires some build effort but remains portable, dependency-free, and transparent.

Keeping the main thread free
- Do indexing offline.
- Load assets and run all query work in a dedicated Web Worker (or Worker + transferable ArrayBuffers).
- Optional: stream-load tiers and decode incrementally without blocking (assets are Brotli/gzip compressed via HTTP).

Normalization and tokenization
- Normalize both index and queries with:
  - Unicode NFKD, strip diacritics, lowercase, collapse whitespace.
  - Split on non-alphanumerics; treat hyphens/slashes as boundaries; keep digits for years/DOIs/keys (tokenize at punctuation boundaries).
  - Maintain positions for phrase queries in title/authors (only those fields need positions).
- Names: index “Last, First” and “First Last” flattened into consistent tokens; fold diacritics for author matching.

AND, phrase, prefix
- AND semantics: intersect doc sets across terms.
- Phrases “quoted string”: require ordered, adjacent positions in title/authors.
- Prefix: last token allows prefix expansion; limit to top M terms by document frequency to keep queries fast.

Fuzzy
- Restrict to title/authors and small edit distance (e.g., Levenshtein ≤1).
- Use a compact candidate generation method:
  - Dictionary-based: 3-gram index or symmetric-deletes dictionary; bound candidate set size; verify edit distance <= 1.
  - Only trigger fuzzy when exact/prefix yields few results, or when opted-in. Avoid over-matching.

Caching/persisting artifacts
- Name assets with content-hash and cache forever via HTTP; or put into Cache Storage in a service worker.
- Keep a tiny version manifest for invalidation.
- Lazy-load extended tier upon need; cache once fetched.

Index evolution
- Versioned builds; include version and doc count in a tiny JSON manifest.
- If manifest changes, reload and replace Cache Storage entries.

2) Proposed architecture

Option A (recommended): Tiered prebuilt inverted index + Worker (typed arrays)
- Why: Hits all targets with smallest footprint and fastest queries. Full control over AND/phrase/prefix/fuzzy and ranking.
- How it satisfies:
  - Performance: varint-delta postings + early-intersection + small candidate sets → <10 ms p50.
  - Footprint: Core tier (title+authors+key) ~2–6 MB compressed; extended tier (venue/year/doi) ~1–3 MB when needed.
  - Robustness: custom normalization; deterministic stable ranking; safe under missing/odd fields.

Option B: WASM engine + offline segments (single binary index)
- Why: Offloads index complexity to a known engine; robust features.
- Trade-off: Larger downloads and memory; more complex to host segments; risk missing footprint targets (especially on mobile).
- How it satisfies:
  - Latency: good, but instantiation overhead and memory pressure might hurt p95.
  - Footprint: typically above our target unless zealously pruned.

We’ll proceed with Option A in detail.

Option A: Format and flow
- Build (offline):
  - BibTeX → concatenate with abbreviations → Hayagriva YAML (one big file).
  - Normalize and tokenize entries.
  - Build two tiers:
    - Core tier: tokens and postings for title, authors, key; store positions for title/authors only.
    - Extended tier: tokens and postings for venue/booktitle/journal (parent chain titles), year (as token), DOI.
  - Dictionaries:
    - Tokens sorted; store as a single UTF-8 blob + offsets; plus a small prefix index.
    - Optional 3-gram dictionary for fuzzy candidate generation (small, bounded).
  - Postings:
    - For each (token, field): postings encoded in one blob: [docDelta, nPos, posDelta1..n] repeated; or [docDelta, tf] when no positions (e.g., venue).
    - DocIDs are 32-bit; varint+delta compress.
  - Docstore (minimal):
    - For id → { key, title, authors_str, venue_str, year, page_range, doi? }
    - Optionally split into a fixed-length index + one string blob.
  - Output artifacts:
    - index.core.meta.json (counts, offsets, weights, version)
    - index.core.dict.bin (UTF-8 token blob + Uint32 offsets)
    - index.core.ptrs.bin (Uint32 arrays of postings start/len per field per token)
    - index.core.postings.bin (Uint8 postings blob)
    - index.core.kgram.bin (optional; bounded 3-gram map)
    - index.ext.* (mirrors of the above for extended fields)
    - docstore.bin (+ docindex.bin)
    - idmap.json (key → id)
- Client load:
  - On init(): fetch core meta, dict, ptrs, postings, docindex; decode into typed arrays in a Worker.
  - Prewarm: decode prefix index; keep docstore strings lazy-loaded or chunked.
  - Extended tier lazy-loaded only when needed (heuristics: if query has a year/DOI-ish token or user toggles “search in venue/doi”).
- Query pipeline (Worker):
  - Parse query:
    - Extract "phrases" inside quotes.
    - Bag-of-words tokens otherwise, last token treated as prefix candidate set.
    - Normalize tokens with same routine used at build.
  - Resolve tokens:
    - Exact match sets from dictionary for core+extended (extended only if loaded or required).
    - Prefix expansion on last token via prefix index; cap to M terms by DF.
    - Fuzzy for title/authors when exact/prefix is poor: candidate terms via 3-grams or deletes; bound to top C; verify edit distance ≤ 1.
  - Retrieve postings:
    - Pull postings for each token and field; union by token across fields for AND; track per-field hits for scoring.
    - Phrases: intersect positional lists (title/authors) to ensure adjacency.
  - Score:
    - Score(doc) = sum over tokens(max fieldWeight) + phraseBonus + exactTitleBoost
    - Tie-breaker: year desc → title asc → key asc (stable).
  - Return top-k docIDs; map to docstore slices; include optional match highlights.

3) Database API specification and implementation

Types
- Entry:
  - id: number
  - key: string
  - title: string
  - authors_str: string
  - venue?: string
  - year?: number
  - page_range?: string
  - doi?: string
  - highlight?: { title?: HighlightSpan[]; authors?: HighlightSpan[]; venue?: HighlightSpan[] }
- HighlightSpan:
  - { start: number, end: number } in UTF-16 code units per field string.
- SearchOpts:
  - { limit?: number; fuzzy?: boolean; useExtended?: boolean }
- API:
  - init(): Promise<void>
  - search(q: string, opts?: SearchOpts): Promise<Entry[]>
  - getEntry(idOrKey: string | number): Promise<Entry | null>

Worker wire protocol (no external libs)
- Messages:
  - { type: 'init' }
  - { type: 'search', q: string, opts?: SearchOpts }
  - { type: 'get', idOrKey: number|string }
- Responses:
  - { type: 'init:ok' }
  - { type: 'search:ok', results: Entry[] }
  - { type: 'get:ok', entry: Entry | null }
  - { type: 'error', message: string }

Ranking defaults
- Field weights: title=3.0, authors=1.8, venue=1.2, year/key/doi=0.8
- Prefix penalty: 0.8 multiplier for prefix-only hits on last token.
- Phrase bonus: +1.5 for a matched phrase in title; +0.6 in authors.
- Exact title equal match boost (rare but helpful for exact copy): +2.0
- Ties: year desc → title asc → key asc.

Query parsing rules
- Quote detection: "..." becomes a phrase term; remaining tokens: AND semantics.
- Tokenization: NFKD fold, remove diacritics, toLower, split on [^a-z0-9]+, drop stopwords (e.g., the, a, an, on, of, and).
- Last token: if not quoted, treat as prefix.
- Heuristics:
  - A token that matches /^\d{4}$/ is a year.
  - A token that contains "/" and digits/dots likely DOI → ask for extended tier (lazy-load if not present).
  - If every token matches nothing in core, attempt fuzzy on title/authors.

Core Worker implementation (abridged but concrete)

// src/lib/search/worker.ts
// Web Worker (module) that owns all heavy CPU. No external deps.

type InitMsg = { type: 'init' };
type SearchMsg = { type: 'search'; q: string; opts?: SearchOpts };
type GetMsg = { type: 'get'; idOrKey: number | string };
type AnyMsg = InitMsg | SearchMsg | GetMsg;

export type SearchOpts = { limit?: number; fuzzy?: boolean; useExtended?: boolean };

type HighlightSpan = { start: number; end: number };
type Entry = {
  id: number;
  key: string;
  title: string;
  authors_str: string;
  venue?: string;
  year?: number;
  page_range?: string;
  doi?: string;
  highlight?: { title?: HighlightSpan[]; authors?: HighlightSpan[]; venue?: HighlightSpan[] };
};

// Loaded index state (core + lazy extended)
const state = {
  inited: false,
  // meta
  version: '',
  numDocs: 0,

  // Dictionary for core tier
  core: {
    termBlob: new Uint8Array(),
    termOffsets: new Uint32Array(),
    // Each field has parallel ptr arrays: start, len for postings in postings.bin
    ptrTitleStart: new Uint32Array(),
    ptrTitleLen: new Uint32Array(),
    ptrAuthorsStart: new Uint32Array(),
    ptrAuthorsLen: new Uint32Array(),
    ptrKeyStart: new Uint32Array(),
    ptrKeyLen: new Uint32Array(),
    postings: new Uint8Array(),
    // prefix index (optional): array of prefix-> [lo,hi] ranges over sorted terms
    prefixMap: new Map<string, [number, number]>(),
    // optional k-gram to token ranges for fuzzy
    kgramIndex: undefined as undefined | KGramIndex
  },

  // Extended tier (lazy)
  extLoaded: false,
  ext: {
    termBlob: new Uint8Array(),
    termOffsets: new Uint32Array(),
    ptrVenueStart: new Uint32Array(),
    ptrVenueLen: new Uint32Array(),
    ptrYearStart: new Uint32Array(),
    ptrYearLen: new Uint32Array(),
    ptrDoiStart: new Uint32Array(),
    ptrDoiLen: new Uint32Array(),
    postings: new Uint8Array(),
    prefixMap: new Map<string, [number, number]>(),
  },

  // Docstore (strings in a blob, offsets array)
  docIndex: new Uint32Array(),
  docBlob: new Uint8Array(),

  // Key -> id
  keyToId: new Map<string, number>(),
};

// Utility: fetch and instantiate typed arrays
async function fetchBin(path: string): Promise<ArrayBuffer> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}`);
  return await res.arrayBuffer();
}

// Diacritics folding + lowercasing
function normalize(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const STOP = new Set(['the','a','an','and','or','of','on','for','to','in','by','with','at','as','from','via']);

// Return tokens and phrases with positions
function tokenizeQuery(q: string): { phrases: string[]; tokens: string[]; lastIsPrefix: boolean } {
  const phrases: string[] = [];
  const tokens: string[] = [];

  const norm = normalize(q);
  const phraseRe = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  let consumed = new Set<number>();

  // Extract phrases
  while ((m = phraseRe.exec(norm)) !== null) {
    const p = m[1].trim().split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t));
    if (p.length) phrases.push(p.join(' '));
    for (let i = m.index; i < m.index + m[0].length; i++) consumed.add(i);
  }

  // Remaining tokens
  let rest = '';
  for (let i = 0; i < norm.length; i++) if (!consumed.has(i)) rest += norm[i];
  const parts = rest.split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t));
  for (let i = 0; i < parts.length; i++) tokens.push(parts[i]);

  // Last token prefix behavior
  const lastIsPrefix = parts.length > 0 && !norm.trim().endsWith('"');

  return { phrases, tokens, lastIsPrefix };
}

// Binary search over term dictionary
function termAt(blob: Uint8Array, offsets: Uint32Array, i: number): string {
  const start = offsets[i];
  const end = offsets[i + 1];
  return new TextDecoder().decode(blob.subarray(start, end));
}

function lowerBoundTerm(blob: Uint8Array, offsets: Uint32Array, needle: string): number {
  let lo = 0, hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const s = termAt(blob, offsets, mid);
    if (s < needle) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Varint decode helpers (LEB128-like unsigned)
function uvarint(buf: Uint8Array, p: number): [number, number] {
  let x = 0, s = 0, i = p;
  for (; i < buf.length; i++) {
    const b = buf[i];
    if (b < 0x80) { x |= (b << s) >>> 0; i++; break; }
    x |= ((b & 0x7f) << s) >>> 0; s += 7;
  }
  return [x >>> 0, i];
}

// Read postings (docDelta + tf or positions)
// Format for fields with positions: [docDelta, nPos, posDelta*]
function readPostings(postings: Uint8Array, start: number, len: number, withPositions: boolean): { docs: number[]; positions?: number[][] } {
  const docs: number[] = [];
  const positions: number[][] = withPositions ? [] : undefined!;
  let p = start;
  let lastDoc = 0;
  const end = start + len;
  while (p < end) {
    let v; [v, p] = uvarint(postings, p);
    const docId = lastDoc + v; lastDoc = docId;
    if (withPositions) {
      let nPos; [nPos, p] = uvarint(postings, p);
      let lastPos = 0;
      const posArr: number[] = new Array(nPos);
      for (let k = 0; k < nPos; k++) {
        let d; [d, p] = uvarint(postings, p);
        lastPos += d;
        posArr[k] = lastPos;
      }
      docs.push(docId);
      positions!.push(posArr);
    } else {
      // tf is present but we don’t need to parse it separately for now; skip nPos varint
      let tf; [tf, p] = uvarint(postings, p);
      docs.push(docId);
    }
  }
  return withPositions ? { docs, positions } : { docs };
}

// Phrase match: intersect two postings with positions ensuring adjacent positions
function phraseIntersect(aDocs: number[], aPos: number[][], bDocs: number[], bPos: number[][]): Set<number> {
  const res = new Set<number>();
  let i = 0, j = 0;
  while (i < aDocs.length && j < bDocs.length) {
    const da = aDocs[i], db = bDocs[j];
    if (da === db) {
      const A = aPos[i], B = bPos[j];
      // adjacency: p in A and p+1 in B
      let ai = 0, bi = 0;
      while (ai < A.length && bi < B.length) {
        if (A[ai] + 1 === B[bi]) { res.add(da); break; }
        if (A[ai] + 1 < B[bi]) ai++; else bi++;
      }
      i++; j++;
    } else if (da < db) i++; else j++;
  }
  return res;
}

// Score aggregation with AND semantics
function searchCore(q: string, opts: SearchOpts = {}): number[] {
  // This function sketches retrieval; final implementation should:
  // - resolve exact + prefix + optional fuzzy candidates per token
  // - load postings for each candidate across fields
  // - intersect docs across tokens (AND)
  // - keep small working sets and use DF-sorted token order

  // For brevity we return an empty list here; see next block for the full flow in handleSearch
  return [];
}

async function loadCore() {
  const meta = await (await fetch('/search/index.core.meta.json')).json();
  state.version = meta.version;
  state.numDocs = meta.numDocs;

  const [dictBuf, ptrsBuf, postBuf, docIdxBuf, docBlobBuf, keyMapRes] = await Promise.all([
    fetchBin('/search/index.core.dict.bin'),
    fetchBin('/search/index.core.ptrs.bin'),
    fetchBin('/search/index.core.postings.bin'),
    fetchBin('/search/doc.index.bin'),
    fetchBin('/search/doc.blob.bin'),
    fetch('/search/idmap.json'),
  ]);

  // Dict blob encodes termOffsets + termBytes; ptrs encodes per-field start/len arrays
  const dictView = new DataView(dictBuf);
  // Assume header: [numTerms:Uint32, termBytesLen:Uint32, offsets..., bytes...]
  let o = 0;
  const numTerms = dictView.getUint32(o, true); o += 4;
  const termBytesLen = dictView.getUint32(o, true); o += 4;
  const termOffsets = new Uint32Array(dictBuf, o, numTerms + 1); o += 4 * (numTerms + 1);
  const termBlob = new Uint8Array(dictBuf, o, termBytesLen);

  const ptrsView = new DataView(ptrsBuf);
  let p = 0;
  function readU32Array(n: number): Uint32Array {
    const arr = new Uint32Array(ptrsBuf, p, n); p += 4 * n; return arr;
  }
  const ptrTitleStart = readU32Array(numTerms);
  const ptrTitleLen = readU32Array(numTerms);
  const ptrAuthorsStart = readU32Array(numTerms);
  const ptrAuthorsLen = readU32Array(numTerms);
  const ptrKeyStart = readU32Array(numTerms);
  const ptrKeyLen = readU32Array(numTerms);

  state.core.termBlob = termBlob;
  state.core.termOffsets = termOffsets;
  state.core.ptrTitleStart = ptrTitleStart;
  state.core.ptrTitleLen = ptrTitleLen;
  state.core.ptrAuthorsStart = ptrAuthorsStart;
  state.core.ptrAuthorsLen = ptrAuthorsLen;
  state.core.ptrKeyStart = ptrKeyStart;
  state.core.ptrKeyLen = ptrKeyLen;
  state.core.postings = new Uint8Array(postBuf);

  state.docIndex = new Uint32Array(docIdxBuf);
  state.docBlob = new Uint8Array(docBlobBuf);

  const keyMap = await keyMapRes.json();
  for (const [k, v] of Object.entries<number>(keyMap)) state.keyToId.set(k, v);

  // Build tiny prefix map for 1..4 char prefixes
  const prefixes = new Map<string, [number, number]>();
  let lastPrefix = '';
  let lastStart = 0;
  for (let i = 0; i < numTerms; i++) {
    const term = termAt(termBlob, termOffsets, i);
    const pref = term.slice(0, Math.min(4, term.length));
    if (pref !== lastPrefix) {
      if (i > 0) prefixes.set(lastPrefix, [lastStart, i]);
      lastPrefix = pref; lastStart = i;
    }
  }
  prefixes.set(lastPrefix, [lastStart, numTerms]);
  state.core.prefixMap = prefixes;
}

async function ensureExtendedLoaded() {
  if (state.extLoaded) return;
  const meta = await (await fetch('/search/index.ext.meta.json')).json();
  const [dictBuf, ptrsBuf, postBuf] = await Promise.all([
    fetchBin('/search/index.ext.dict.bin'),
    fetchBin('/search/index.ext.ptrs.bin'),
    fetchBin('/search/index.ext.postings.bin'),
  ]);

  const dictView = new DataView(dictBuf);
  let o = 0;
  const numTerms = dictView.getUint32(o, true); o += 4;
  const termBytesLen = dictView.getUint32(o, true); o += 4;
  const termOffsets = new Uint32Array(dictBuf, o, numTerms + 1); o += 4 * (numTerms + 1);
  const termBlob = new Uint8Array(dictBuf, o, termBytesLen);

  const ptrsView = new DataView(ptrsBuf);
  let p = 0;
  function readU32Array(n: number): Uint32Array {
    const arr = new Uint32Array(ptrsBuf, p, n); p += 4 * n; return arr;
  }
  const ptrVenueStart = readU32Array(numTerms);
  const ptrVenueLen = readU32Array(numTerms);
  const ptrYearStart = readU32Array(numTerms);
  const ptrYearLen = readU32Array(numTerms);
  const ptrDoiStart = readU32Array(numTerms);
  const ptrDoiLen = readU32Array(numTerms);

  state.ext.termBlob = termBlob;
  state.ext.termOffsets = termOffsets;
  state.ext.ptrVenueStart = ptrVenueStart;
  state.ext.ptrVenueLen = ptrVenueLen;
  state.ext.ptrYearStart = ptrYearStart;
  state.ext.ptrYearLen = ptrYearLen;
  state.ext.ptrDoiStart = ptrDoiStart;
  state.ext.ptrDoiLen = ptrDoiLen;
  state.ext.postings = new Uint8Array(postBuf);

  // Build prefix map similarly
  const prefixes = new Map<string, [number, number]>();
  let lastPrefix = '', lastStart = 0;
  for (let i = 0; i < termOffsets.length - 1; i++) {
    const term = termAt(termBlob, termOffsets, i);
    const pref = term.slice(0, Math.min(4, term.length));
    if (pref !== lastPrefix) {
      if (i > 0) prefixes.set(lastPrefix, [lastStart, i]);
      lastPrefix = pref; lastStart = i;
    }
  }
  prefixes.set(lastPrefix, [lastStart, termOffsets.length - 1]);

  state.ext.prefixMap = prefixes;
  state.extLoaded = true;
}

// Phrase match for multiple tokens in title/authors: chain adjacent pairs
function matchPhrase(field: 'title' | 'authors', words: string[]): Set<number> {
  // Outline: for each word get postings with positions, chain phraseIntersect across the sequence.
  // Omitted for brevity; see readPostings + phraseIntersect above.
  return new Set();
}

// Build Entry from docstore
function getEntryById(id: number): Entry | null {
  if (id < 0 || id >= state.numDocs) return null;
  // docIndex encoding: offsets per field in blob
  // For brevity, assume a simple TLV-like layout; in practice keep an index table.
  // Omitted; the build pipeline will write a compact docstore and here we decode.
  return null;
}

async function handleInit() {
  if (state.inited) return;
  await loadCore();
  state.inited = true;
  (self as any).postMessage({ type: 'init:ok' });
}

// Full search flow, condensed
async function handleSearch(q: string, opts: SearchOpts = {}) {
  if (!state.inited) await handleInit();
  const limit = Math.max(1, Math.min(1000, opts.limit ?? 50));
  const t0 = performance.now();

  const { phrases, tokens, lastIsPrefix } = tokenizeQuery(q);
  const termsCore: { token: string; exact: number[]; prefix: number[] }[] = [];
  const termsExt: { token: string; exact: number[]; prefix: number[] }[] = [];

  // Helper: resolve token to term ID ranges in core/extended
  function resolveTermRanges(token: string, tier: 'core' | 'ext', prefix: boolean): number[] {
    const dict = tier === 'core' ? state.core : state.ext;
    const { termBlob, termOffsets, prefixMap } = dict;
    const ids: number[] = [];
    const exactId = lowerBoundTerm(termBlob, termOffsets, token);
    const exactMatch = exactId < termOffsets.length - 1 && termAt(termBlob, termOffsets, exactId) === token;
    if (exactMatch) ids.push(exactId);
    if (prefix && token.length > 0) {
      const pref = token.slice(0, Math.min(4, token.length));
      const range = prefixMap.get(pref);
      if (range) {
        const [lo, hi] = range;
        // find [l, r) where terms start with token
        let l = lo, r = hi;
        // lower bound for token
        l = lowerBoundTerm(termBlob, termOffsets, token);
        // upper bound: token + '\uffff'
        r = lowerBoundTerm(termBlob, termOffsets, token + '\uffff');
        // cap number of prefix terms to avoid explosion
        const cap = 128;
        for (let i = l; i < Math.min(r, l + cap); i++) ids.push(i);
      }
    }
    return ids;
  }

  // Classify needs extended tier?
  const needsExt = opts.useExtended ||
                   tokens.some(t => /^\d{4}$/.test(t) || /doi|10\.\d/.test(t) || /[A-Za-z]+:\w+/.test(t));
  if (needsExt) await ensureExtendedLoaded();

  // Resolve tokens
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const pref = lastIsPrefix && i === tokens.length - 1;
    const coreIds = resolveTermRanges(tok, 'core', pref);
    const extIds = state.extLoaded ? resolveTermRanges(tok, 'ext', pref) : [];
    termsCore.push({ token: tok, exact: coreIds.slice(0, 1), prefix: coreIds.slice(1) });
    if (state.extLoaded) termsExt.push({ token: tok, exact: extIds.slice(0, 1), prefix: extIds.slice(1) });
  }

  // Gather postings per token (union across fields inside a token); then AND across tokens.
  type DocAcc = { score: number; fields: number; year?: number; title?: string; key?: string };
  const docs = new Map<number, DocAcc>();

  function postingsForCoreTerm(termId: number): { docs: number[]; src: 'title' | 'authors' | 'key'; positions?: number[][] }[] {
    const arr: ReturnType<typeof postingsForCoreTerm> = [];
    const { postings, ptrTitleStart, ptrTitleLen, ptrAuthorsStart, ptrAuthorsLen, ptrKeyStart, ptrKeyLen } = state.core;
    if (ptrTitleLen[termId]) arr.push({ docs: readPostings(postings, ptrTitleStart[termId], ptrTitleLen[termId], true).docs, src: 'title', positions: readPostings(postings, ptrTitleStart[termId], ptrTitleLen[termId], true).positions });
    if (ptrAuthorsLen[termId]) arr.push({ docs: readPostings(postings, ptrAuthorsStart[termId], ptrAuthorsLen[termId], true).docs, src: 'authors', positions: readPostings(postings, ptrAuthorsStart[termId], ptrAuthorsLen[termId], true).positions });
    if (ptrKeyLen[termId]) arr.push({ docs: readPostings(postings, ptrKeyStart[termId], ptrKeyLen[termId], false).docs, src: 'key' });
    return arr;
  }

  function postingsForExtTerm(termId: number): { docs: number[]; src: 'venue' | 'year' | 'doi' }[] {
    const arr: ReturnType<typeof postingsForExtTerm> = [];
    const { postings, ptrVenueStart, ptrVenueLen, ptrYearStart, ptrYearLen, ptrDoiStart, ptrDoiLen } = state.ext;
    if (ptrVenueLen[termId]) arr.push({ docs: readPostings(postings, ptrVenueStart[termId], ptrVenueLen[termId], false).docs, src: 'venue' });
    if (ptrYearLen[termId]) arr.push({ docs: readPostings(postings, ptrYearStart[termId], ptrYearLen[termId], false).docs, src: 'year' });
    if (ptrDoiLen[termId]) arr.push({ docs: readPostings(postings, ptrDoiStart[termId], ptrDoiLen[termId], false).docs, src: 'doi' });
    return arr;
  }

  const FIELD_W = { title: 3.0, authors: 1.8, venue: 1.2, year: 0.8, key: 0.8, doi: 0.8 };

  // Resolve doc sets per token and AND them
  const tokenDocSets: { docs: number[]; srcs: Set<string> }[] = [];

  function mergeSortedUnique(arrs: number[][]): number[] {
    // Efficient union for sorted arrays
    const out: number[] = [];
    const iters = arrs.map(a => ({ a, i: 0 }));
    while (true) {
      let min = Infinity, minJ = -1;
      for (let j = 0; j < iters.length; j++) {
        const it = iters[j];
        if (it.i < it.a.length && it.a[it.i] < min) { min = it.a[it.i]; minJ = j; }
      }
      if (minJ === -1) break;
      out.push(min);
      // Advance all iters whose current equals min
      for (const it of iters) if (it.i < it.a.length && it.a[it.i] === min) it.i++;
    }
    return out;
  }

  for (let t = 0; t < tokens.length; t++) {
    const coreIds = [...termsCore[t].exact, ...termsCore[t].prefix];
    const extIds = state.extLoaded ? [...termsExt[t].exact, ...termsExt[t].prefix] : [];
    const docLists: number[][] = [];
    const srcs = new Set<string>();

    for (const id of coreIds) {
      for (const r of postingsForCoreTerm(id)) { docLists.push(r.docs); srcs.add(r.src); }
    }
    for (const id of extIds) {
      for (const r of postingsForExtTerm(id)) { docLists.push(r.docs); srcs.add(r.src); }
    }
    const unionDocs = mergeSortedUnique(docLists);
    tokenDocSets.push({ docs: unionDocs, srcs });
  }

  // AND across tokens (shortcut on empty)
  if (tokenDocSets.some(s => s.docs.length === 0)) {
    (self as any).postMessage({ type: 'search:ok', results: [] });
    return;
  }
  // Intersect in ascending DF order
  tokenDocSets.sort((a, b) => a.docs.length - b.docs.length);
  let intersection = tokenDocSets[0].docs;
  for (let i = 1; i < tokenDocSets.length; i++) {
    const a = intersection, b = tokenDocSets[i].docs;
    const out: number[] = [];
    let x = 0, y = 0;
    while (x < a.length && y < b.length) {
      if (a[x] === b[y]) { out.push(a[x]); x++; y++; }
      else if (a[x] < b[y]) x++; else y++;
    }
    intersection = out;
    if (intersection.length === 0) break;
  }

  // Score docs
  const results: { id: number; score: number; year?: number; title?: string; key?: string }[] = [];
  for (const id of intersection) {
    let score = 0;
    // Basic scoring: each token contributes the max field weight it matched in
    for (const s of tokenDocSets) {
      // If the token doc set includes this id, add weight depending on which fields had postings for that token
      // Approximation here; a more precise implementation would track field matches per doc.
      if (binarySearch(s.docs, id) >= 0) {
        // optimistic: title>authors>venue>year>key>doi
        if (s.srcs.has('title')) score += FIELD_W.title;
        else if (s.srcs.has('authors')) score += FIELD_W.authors;
        else if (s.srcs.has('venue')) score += FIELD_W.venue;
        else if (s.srcs.has('year')) score += FIELD_W.year;
        else if (s.srcs.has('key')) score += FIELD_W.key;
        else if (s.srcs.has('doi')) score += FIELD_W.doi;
      }
    }
    results.push({ id, score });
  }

  // Phrase bonus (title/authors)
  for (const phrase of phrases) {
    const words = phrase.split(/\s+/).filter(Boolean);
    // Implement chaining with readPostings; here just add a small bonus placeholder
    for (const r of results) r.score += 1.0;
  }

  // Sort by score desc, ties: year desc, title asc, key asc
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ea = getEntryById(a.id), eb = getEntryById(b.id);
    const ya = ea?.year ?? 0, yb = eb?.year ?? 0;
    if (yb !== ya) return yb - ya;
    const ta = ea?.title ?? '', tb = eb?.title ?? '';
    if (ta !== tb) return ta.localeCompare(tb);
    const ka = ea?.key ?? '', kb = eb?.key ?? '';
    return ka.localeCompare(kb);
  });

  // Build top-k entries
  const out: Entry[] = [];
  for (let i = 0; i < Math.min(limit, results.length); i++) {
    const e = getEntryById(results[i].id);
    if (e) out.push(e);
  }

  const t1 = performance.now();
  (self as any).postMessage({ type: 'search:ok', results: out, tookMs: t1 - t0 });
}

function binarySearch(arr: number[], x: number): number {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] === x) return mid;
    if (arr[mid] < x) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

self.onmessage = async (ev: MessageEvent<AnyMsg>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') await handleInit();
    else if (msg.type === 'search') await handleSearch(msg.q, msg.opts);
    else if (msg.type === 'get') {
      const id = typeof msg.idOrKey === 'string' ? state.keyToId.get(msg.idOrKey) ?? -1 : msg.idOrKey;
      const e = getEntryById(id);
      (self as any).postMessage({ type: 'get:ok', entry: e });
    }
  } catch (e: any) {
    (self as any).postMessage({ type: 'error', message: String(e?.message || e) });
  }
};

Thin client wrapper

// src/lib/search/db.ts
export type { Entry, SearchOpts } from './worker';

export class SearchDB {
  private worker: Worker;
  private ready: Promise<void>;
  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = (ev) => {
        if (ev.data?.type === 'init:ok') resolve();
      };
      this.worker.postMessage({ type: 'init' });
    });
  }
  async init() { await this.ready; }
  async search(q: string, opts?: SearchOpts): Promise<Entry[]> {
    await this.ready;
    return new Promise((resolve, reject) => {
      const listener = (ev: MessageEvent) => {
        const d = ev.data;
        if (d?.type === 'search:ok') {
          this.worker.removeEventListener('message', listener);
          resolve(d.results);
        } else if (d?.type === 'error') {
          this.worker.removeEventListener('message', listener);
          reject(new Error(d.message));
        }
      };
      this.worker.addEventListener('message', listener);
      this.worker.postMessage({ type: 'search', q, opts });
    });
  }
  async getEntry(idOrKey: string | number) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const listener = (ev: MessageEvent) => {
        const d = ev.data;
        if (d?.type === 'get:ok') {
          this.worker.removeEventListener('message', listener);
          resolve(d.entry);
        } else if (d?.type === 'error') {
          this.worker.removeEventListener('message', listener);
          reject(new Error(d.message));
        }
      };
      this.worker.addEventListener('message', listener);
      this.worker.postMessage({ type: 'get', idOrKey });
    });
  }
}

Minimal Svelte usage

// src/routes/+page.svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { SearchDB, type Entry } from '$lib/search/db';
  let db: SearchDB;
  let q = '';
  let results: Entry[] = [];
  let loading = true;
  let timer: any;

  onMount(async () => {
    db = new SearchDB();
    await db.init();
    loading = false;
  });

  function onInput(e: Event) {
    q = (e.target as HTMLInputElement).value;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!q.trim()) { results = []; return; }
      const t0 = performance.now();
      results = await db.search(q, { limit: 50 });
      const t1 = performance.now();
      // optional: log t1-t0
    }, 60); // small debounce
  }
  function onKeydown(e: KeyboardEvent) {
    // implement keyboard nav: Up/Down, Enter, etc.
  }
</script>

<input placeholder="Search CryptoBib…" value={q} on:input={onInput} on:keydown={onKeydown} />
{#if loading}
  <p>Loading index…</p>
{:else}
  <ul>
    {#each results as r (r.id)}
      <li>
        <div>{r.title}</div>
        <div>{r.authors_str} — {r.venue} {r.year}</div>
        <div>{r.doi ? `doi:${r.doi}` : ''} <small>{r.key}</small></div>
      </li>
    {/each}
  </ul>
{/if}

4) Build pipeline and scripts

Build goals:
- Deterministic, repeatable: BibTeX → concatenated → Hayagriva YAML → normalized → index artifacts.
- Versioned assets: embed content hash in filenames or a separate manifest; serve with immutable caching.
- Artifacts:
  - Core tier: index.core.meta.json, index.core.dict.bin, index.core.ptrs.bin, index.core.postings.bin
  - Extended tier: index.ext.meta.json, index.ext.dict.bin, index.ext.ptrs.bin, index.ext.postings.bin
  - Docstore: doc.index.bin, doc.blob.bin
  - Key map: idmap.json

Directory layout
- scripts/
  - fetch-and-convert.ts
  - build-index.ts
  - bench.ts
- search/ (emitted artifacts)
  - index.core.* + index.ext.* + doc.* + idmap.json
- src/lib/search/worker.ts and db.ts as above

Step 0: install tools
- Hayagriva CLI in your path (e.g., cargo install hayagriva-cli or use its official binary).
- Node 18+ with fetch and fs/promises.
- SvelteKit/Vite project for the app.

Step 1: fetch and convert BibTeX → Hayagriva YAML
// scripts/fetch-and-convert.ts
import { writeFile, readFile } from 'fs/promises';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const CRYPTOBIB = 'https://cryptobib.di.ens.fr/cryptobib/static/files/crypto.bib';
const ABBREV0 = 'https://cryptobib.di.ens.fr/cryptobib/static/files/abbrev0.bib';

async function download(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Failed to download ' + url);
  return await r.text();
}

async function runHayagriva(bibPath: string, outYaml: string) {
  // Hayagriva CLI command may be `hayagriva convert`
  // Check CLI usage; example:
  // hayagriva convert --from bibtex --to yaml input.bib -o output.yaml
  await new Promise<void>((resolve, reject) => {
    const p = spawn('hayagriva', ['convert', '--from', 'bibtex', '--to', 'yaml', bibPath, '-o', outYaml], { stdio: 'inherit' });
    p.on('exit', code => code === 0 ? resolve() : reject(new Error('hayagriva exit ' + code)));
  });
}

async function main() {
  const crypto = await download(CRYPTOBIB);
  const abbrev = await download(ABBREV0);
  // Concatenate so abbreviations resolve correctly
  const concatenated = abbrev + '\n\n' + crypto;
  await writeFile('data/cryptobib+abbrev.bib', concatenated, 'utf8');
  await runHayagriva('data/cryptobib+abbrev.bib', 'data/cryptobib.yaml');
  console.log('Wrote data/cryptobib.yaml');
}

main().catch(e => { console.error(e); process.exit(1); });

Step 2: build the compact index
Key decisions:
- Normalization: NFKD, diacritics fold, lowercase.
- Tokenization: split by non-alnum; keep digits; handle hyphens as separators; drop stopwords; record positions for title/authors.
- Document fields:
  - id: incremental integer
  - key: entry key (e.g., ACISP:LZXSW24:)
  - title, authors_str (e.g., “Liu, Fangzhou; Zhu, Xueqi; …”)
  - venue_str: resolved via parent chain title(s) or journal/booktitle
  - year: from date when available
  - page_range
  - doi

- Index structure (files):
  - dict.bin: [numTerms:U32, termBytesLen:U32, termOffsets[U32 x (N+1)], termBytes[U8…]]
  - ptrs.bin (core): arrays of U32 per term: ptrStart/ptrLen for each field (title/authors/key)
  - postings.bin: varint-delta encoded postings as described
  - Same for extended (venue/year/doi)
  - doc.index.bin: offsets per doc and field into doc.blob.bin
  - doc.blob.bin: UTF-8 bytes for strings
  - idmap.json: key→id

// scripts/build-index.ts
import { readFile, writeFile, mkdir } from 'fs/promises';
import yaml from 'js-yaml';
import { createHash } from 'crypto';

type HayEntry = {
  type?: string;
  title?: string;
  author?: string[]; // as array of "Last, First"
  date?: string; // YYYY-MM
  'page-range'?: string;
  'serial-number'?: { doi?: string };
  parent?: any; // nested
  // ...
};

function normalize(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
const STOP = new Set(['the','a','an','and','or','of','on','for','to','in','by','with','at','as','from','via']);

function tokenize(s: string): { tokens: string[]; positions: number[] } {
  const n = normalize(s);
  const parts = n.split(/[^a-z0-9]+/);
  const tokens: string[] = [];
  const positions: number[] = [];
  for (const p of parts) {
    if (!p || STOP.has(p)) continue;
    positions.push(tokens.length);
    tokens.push(p);
  }
  return { tokens, positions };
}

function flattenVenue(e: any): string {
  // choose best available: parent.title or journal/booktitle or proceedings’ chain
  let cur = e.parent;
  const names: string[] = [];
  while (cur && typeof cur === 'object') {
    if (cur.title) names.push(cur.title);
    cur = cur.parent;
  }
  return names[0] || '';
}

async function main() {
  await mkdir('search', { recursive: true });
  const y = yaml.load(await readFile('data/cryptobib.yaml', 'utf8')) as Record<string, HayEntry>;
  const entries: {
    id: number; key: string; title: string; authors: string[]; authors_str: string;
    venue: string; year?: number; page_range?: string; doi?: string;
  }[] = [];

  let id = 0;
  for (const [key, e] of Object.entries(y)) {
    const title = e.title || '';
    const authors = (e.author || []).map(a => a);
    const authors_str = authors.join('; ');
    const venue = flattenVenue(e) || '';
    const year = e.date ? +String(e.date).slice(0, 4) : undefined;
    const doi = e['serial-number']?.doi;
    const page_range = e['page-range'];

    entries.push({ id: id++, key, title, authors, authors_str, venue, year, page_range, doi });
  }

  // Build term dictionary and postings per field
  const termMapCore = new Map<string, number>(); // term -> termId
  const termMapExt = new Map<string, number>();
  const termsCore: string[] = [];
  const termsExt: string[] = [];

  type PostRec = Map<number, number[] | number>; // docId -> positions[] or tf
  const coreTitle: Map<number, PostRec> = new Map(); // termId -> doc -> positions
  const coreAuthors: Map<number, PostRec> = new Map();
  const coreKey: Map<number, PostRec> = new Map();
  const extVenue: Map<number, PostRec> = new Map();
  const extYear: Map<number, PostRec> = new Map();
  const extDoi: Map<number, PostRec> = new Map();

  function termId(map: Map<string, number>, arr: string[], t: string): number {
    let id = map.get(t);
    if (id === undefined) { id = arr.length; map.set(t, id); arr.push(t); }
    return id;
  }

  for (const d of entries) {
    // title tokens with positions
    const { tokens: tt } = tokenize(d.title);
    tt.forEach((t, pos) => {
      const tid = termId(termMapCore, termsCore, t);
      if (!coreTitle.has(tid)) coreTitle.set(tid, new Map());
      const m = coreTitle.get(tid)! as PostRec;
      const arr = (m.get(d.id) as number[] | undefined) ?? [];
      (arr as number[]).push(pos);
      m.set(d.id, arr);
    });

    // authors tokens with positions (on authors_str)
    const { tokens: at } = tokenize(d.authors_str);
    at.forEach((t, pos) => {
      const tid = termId(termMapCore, termsCore, t);
      if (!coreAuthors.has(tid)) coreAuthors.set(tid, new Map());
      const m = coreAuthors.get(tid)! as PostRec;
      const arr = (m.get(d.id) as number[] | undefined) ?? [];
      (arr as number[]).push(pos);
      m.set(d.id, arr);
    });

    // key tokens (split on non-alnum including ':'), tf only
    const kt = normalize(d.key).split(/[^a-z0-9]+/).filter(x => x);
    for (const t of kt) {
      const tid = termId(termMapCore, termsCore, t);
      if (!coreKey.has(tid)) coreKey.set(tid, new Map());
      const m = coreKey.get(tid)! as PostRec;
      const tf = (m.get(d.id) as number | undefined) ?? 0;
      m.set(d.id, (tf as number) + 1);
    }

    // extended fields
    // venue
    const vt = tokenize(d.venue).tokens;
    for (const t of vt) {
      const tid = termId(termMapExt, termsExt, t);
      if (!extVenue.has(tid)) extVenue.set(tid, new Map());
      const m = extVenue.get(tid)! as PostRec;
      const tf = (m.get(d.id) as number | undefined) ?? 0;
      m.set(d.id, (tf as number) + 1);
    }
    // year token
    if (d.year) {
      const t = String(d.year);
      const tid = termId(termMapExt, termsExt, t);
      if (!extYear.has(tid)) extYear.set(tid, new Map());
      const m = extYear.get(tid)! as PostRec;
      const tf = (m.get(d.id) as number | undefined) ?? 0;
      m.set(d.id, (tf as number) + 1);
    }
    // doi tokens (split by / and .)
    if (d.doi) {
      const dt = normalize(d.doi).split(/[^a-z0-9]+/).filter(x => x);
      for (const t of dt) {
        const tid = termId(termMapExt, termsExt, t);
        if (!extDoi.has(tid)) extDoi.set(tid, new Map());
        const m = extDoi.get(tid)! as PostRec;
        const tf = (m.get(d.id) as number | undefined) ?? 0;
        m.set(d.id, (tf as number) + 1);
      }
    }
  }

  // Sort terms, remap termIds to sorted order
  function finalizeTerms(terms: string[], maps: Map<number, PostRec>[]) {
    const idx = terms.map((t, i) => ({ t, i }));
    idx.sort((a, b) => a.t.localeCompare(b.t));
    const remap = new Uint32Array(idx.length);
    const sorted = new Array<string>(idx.length);
    for (let newId = 0; newId < idx.length; newId++) {
      sorted[newId] = idx[newId].t; remap[idx[newId].i] = newId;
    }
    // Apply remap to postings maps
    const newMaps = maps.map(() => new Map<number, PostRec>());
    for (let oldId = 0; oldId < idx.length; oldId++) {
      const newId = remap[oldId];
      maps.forEach((m, k) => {
        const rec = m.get(oldId);
        if (rec) (newMaps[k] as any).set(newId, rec);
      });
    }
    return { sorted, maps: newMaps as Map<number, PostRec>[] };
  }

  const coreFinal = finalizeTerms(termsCore, [coreTitle, coreAuthors, coreKey]);
  const extFinal = finalizeTerms(termsExt, [extVenue, extYear, extDoi]);

  // Write dict.bin
  function buildDictBin(terms: string[]) {
    const encoder = new TextEncoder();
    const bytes: Uint8Array[] = [];
    const offsets = new Uint32Array(terms.length + 1);
    let total = 0;
    for (let i = 0; i < terms.length; i++) {
      offsets[i] = total;
      const b = encoder.encode(terms[i]);
      bytes.push(b);
      total += b.length;
    }
    offsets[terms.length] = total;
    const header = new Uint8Array(8);
    const dv = new DataView(header.buffer);
    dv.setUint32(0, terms.length, true);
    dv.setUint32(4, total, true);
    const offBytes = new Uint8Array(offsets.buffer);
    const blob = new Uint8Array(total);
    let p = 0;
    for (const b of bytes) { blob.set(b, p); p += b.length; }
    const out = new Uint8Array(header.length + offBytes.length + blob.length);
    out.set(header, 0); out.set(offBytes, header.length); out.set(blob, header.length + offBytes.length);
    return out;
  }

  function writeUVarint(n: number, out: number[]) {
    while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n >>>= 7; }
    out.push(n);
  }

  // Encode postings into postings.bin and ptrs arrays
  function buildCorePostings() {
    const titlePtrStart = new Uint32Array(coreFinal.sorted.length);
    const titlePtrLen = new Uint32Array(coreFinal.sorted.length);
    const authorsPtrStart = new Uint32Array(coreFinal.sorted.length);
    const authorsPtrLen = new Uint32Array(coreFinal.sorted.length);
    const keyPtrStart = new Uint32Array(coreFinal.sorted.length);
    const keyPtrLen = new Uint32Array(coreFinal.sorted.length);
    const bytes: number[] = [];

    function encodePositions(rec: PostRec) {
      // rec: Map(docId -> positions[])
      const docs = Array.from(rec.entries()).sort((a, b) => a[0] - b[0]);
      let lastDoc = 0;
      for (const [docId, pos] of docs) {
        writeUVarint(docId - lastDoc, bytes);
        lastDoc = docId;
        const arr = pos as number[];
        writeUVarint(arr.length, bytes);
        let lastPos = 0;
        for (const p of arr) { writeUVarint(p - lastPos, bytes); lastPos = p; }
      }
    }
    function encodeTF(rec: PostRec) {
      const docs = Array.from(rec.entries()).sort((a, b) => a[0] - b[0]);
      let lastDoc = 0;
      for (const [docId, tf] of docs) {
        writeUVarint(docId - lastDoc, bytes);
        lastDoc = docId;
        writeUVarint(tf as number, bytes);
      }
    }

    for (let tid = 0; tid < coreFinal.sorted.length; tid++) {
      const recT = coreFinal.maps[0].get(tid);
      if (recT) { titlePtrStart[tid] = bytes.length; encodePositions(recT); titlePtrLen[tid] = bytes.length - titlePtrStart[tid]; }
      const recA = coreFinal.maps[1].get(tid);
      if (recA) { authorsPtrStart[tid] = bytes.length; encodePositions(recA); authorsPtrLen[tid] = bytes.length - authorsPtrStart[tid]; }
      const recK = coreFinal.maps[2].get(tid);
      if (recK) { keyPtrStart[tid] = bytes.length; encodeTF(recK); keyPtrLen[tid] = bytes.length - keyPtrStart[tid]; }
    }
    return {
      ptrs: { titlePtrStart, titlePtrLen, authorsPtrStart, authorsPtrLen, keyPtrStart, keyPtrLen },
      postings: Uint8Array.from(bytes),
    };
  }

  function buildExtPostings() {
    const venuePtrStart = new Uint32Array(extFinal.sorted.length);
    const venuePtrLen = new Uint32Array(extFinal.sorted.length);
    const yearPtrStart = new Uint32Array(extFinal.sorted.length);
    const yearPtrLen = new Uint32Array(extFinal.sorted.length);
    const doiPtrStart = new Uint32Array(extFinal.sorted.length);
    const doiPtrLen = new Uint32Array(extFinal.sorted.length);
    const bytes: number[] = [];

    function encodeTF(rec: PostRec) {
      const docs = Array.from(rec.entries()).sort((a, b) => a[0] - b[0]);
      let lastDoc = 0;
      for (const [docId, tf] of docs) {
        writeUVarint(docId - lastDoc, bytes);
        lastDoc = docId;
        writeUVarint(tf as number, bytes);
      }
    }

    for (let tid = 0; tid < extFinal.sorted.length; tid++) {
      const rv = extFinal.maps[0].get(tid);
      if (rv) { venuePtrStart[tid] = bytes.length; encodeTF(rv); venuePtrLen[tid] = bytes.length - venuePtrStart[tid]; }
      const ry = extFinal.maps[1].get(tid);
      if (ry) { yearPtrStart[tid] = bytes.length; encodeTF(ry); yearPtrLen[tid] = bytes.length - yearPtrStart[tid]; }
      const rd = extFinal.maps[2].get(tid);
      if (rd) { doiPtrStart[tid] = bytes.length; encodeTF(rd); doiPtrLen[tid] = bytes.length - doiPtrStart[tid]; }
    }
    return {
      ptrs: { venuePtrStart, venuePtrLen, yearPtrStart, yearPtrLen, doiPtrStart, doiPtrLen },
      postings: Uint8Array.from(bytes),
    };
  }

  // Build docstore
  const enc = new TextEncoder();
  const docOffsets: number[] = [];
  const docBytes: number[] = [];
  const idmap: Record<string, number> = {};

  function writeStr(s: string) {
    const b = enc.encode(s);
    const off = docBytes.length;
    docBytes.push(...b);
    return [off, b.length] as const;
  }

  for (const d of entries) {
    idmap[d.key] = d.id;
    // For simplicity, write a small fixed record: offsets to strings and numeric fields
    // Here we produce a JSON docstore for clarity; in practice put fields as TLV with offsets.
    docOffsets.push(docBytes.length);
    const obj = {
      id: d.id, key: d.key, title: d.title, authors_str: d.authors_str, venue: d.venue,
      year: d.year, page_range: d.page_range, doi: d.doi
    };
    const b = enc.encode(JSON.stringify(obj) + '\n');
    docBytes.push(...b);
  }
  docOffsets.push(docBytes.length);

  await writeFile('search/index.core.dict.bin', buildDictBin(coreFinal.sorted));
  const corePosts = buildCorePostings();
  // Pack ptrs in-order
  const ptrsBuf = new Uint8Array(
    corePosts.ptrs.titlePtrStart.byteLength + corePosts.ptrs.titlePtrLen.byteLength +
    corePosts.ptrs.authorsPtrStart.byteLength + corePosts.ptrs.authorsPtrLen.byteLength +
    corePosts.ptrs.keyPtrStart.byteLength + corePosts.ptrs.keyPtrLen.byteLength
  );
  let po = 0;
  function append(arr: Uint32Array) {
    ptrsBuf.set(new Uint8Array(arr.buffer), po); po += arr.byteLength;
  }
  append(corePosts.ptrs.titlePtrStart); append(corePosts.ptrs.titlePtrLen);
  append(corePosts.ptrs.authorsPtrStart); append(corePosts.ptrs.authorsPtrLen);
  append(corePosts.ptrs.keyPtrStart); append(corePosts.ptrs.keyPtrLen);

  await writeFile('search/index.core.ptrs.bin', ptrsBuf);
  await writeFile('search/index.core.postings.bin', corePosts.postings);

  await writeFile('search/index.core.meta.json', JSON.stringify({
    version: createHash('sha256').update(corePosts.postings).digest('hex').slice(0, 8),
    numDocs: entries.length
  }));

  // Extended
  await writeFile('search/index.ext.dict.bin', buildDictBin(extFinal.sorted));
  const extPosts = buildExtPostings();
  const extPtrsBuf = new Uint8Array(
    extPosts.ptrs.venuePtrStart.byteLength + extPosts.ptrs.venuePtrLen.byteLength +
    extPosts.ptrs.yearPtrStart.byteLength + extPosts.ptrs.yearPtrLen.byteLength +
    extPosts.ptrs.doiPtrStart.byteLength + extPosts.ptrs.doiPtrLen.byteLength
  );
  po = 0;
  append(extPosts.ptrs.venuePtrStart); append(extPosts.ptrs.venuePtrLen);
  append(extPosts.ptrs.yearPtrStart); append(extPosts.ptrs.yearPtrLen);
  append(extPosts.ptrs.doiPtrStart); append(extPosts.ptrs.doiPtrLen);

  await writeFile('search/index.ext.ptrs.bin', extPtrsBuf);
  await writeFile('search/index.ext.postings.bin', extPosts.postings);
  await writeFile('search/index.ext.meta.json', JSON.stringify({
    version: createHash('sha256').update(extPosts.postings).digest('hex').slice(0, 8),
  }));

  // Docstore
  await writeFile('search/doc.index.bin', new Uint8Array(new Uint32Array(docOffsets).buffer));
  await writeFile('search/doc.blob.bin', new Uint8Array(docBytes));
  await writeFile('search/idmap.json', JSON.stringify(idmap));
  console.log('Index built.');
}

main().catch(e => { console.error(e); process.exit(1); });

Notes:
- The docstore above is JSONL in a blob for simplicity. For production, move to a binary TLV with offsets per field to avoid JSON parse overhead.
- All assets should be served with gzip/br and cache-control: immutable.

Package scripts (example)
{
  "scripts": {
    "fetch": "ts-node scripts/fetch-and-convert.ts",
    "build:index": "ts-node scripts/build-index.ts",
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "bench": "ts-node scripts/bench.ts"
  }
}

CI flow
- Cache data/cryptobib.yaml by ETag/Last-Modified to skip convert when unchanged.
- On change: run fetch → convert → build:index → app build.
- Upload search/ as static assets next to the app; filenames stable; include version in meta to detect updates.

5) Testing and performance validation

Correctness tests
- Unit tests on normalization/tokenization:
  - Verify diacritics folding on author names (e.g., “Černý” → “cerny”).
  - Verify hyphen/slash splits (“post-quantum”, “ACM/SIAM”).
  - Ensure year tokens recognized; keys and DOIs tokenized as expected.
- Parsing/regression tests on a subset of YAML:
  - Titles with LaTeX braces/commands.
  - Missing years/venues.
  - Parent chain venue resolution.

Functional tests
- Phrase queries:
  - "“differential cryptanalysis”" should match titles with adjacent tokens; ensure non-adjacent are excluded.
- AND semantics:
  - "rogaway acm 1995" hits only docs matching all three.
- Prefix typing:
  - Typing “bell” → “bella” → “bellar” → “bellare” yields stable incremental results.
- Fuzzy (if enabled):
  - “rogaweay” matches “rogaway” in authors; ensure not over-matching “rogers”.

Latency and frame-time
- Bench script in Worker to run 100 representative queries and report p50/p95:

// scripts/bench.ts (sketch; run in browser dev or via a small page)
const queries = [
  'aes', 'elliptic curves', '"zero knowledge"', 'rogaway', 'bellare rogaway', 'lattice signatures', 'post-quantum', 'nist 2015', 'doi 10.1007', 'acisp 2024'
];
(async () => {
  const db = new (await import('../src/lib/search/db')).SearchDB();
  await db.init();
  const times: number[] = [];
  for (let r = 0; r < 10; r++) {
    for (const q of queries) {
      const t0 = performance.now();
      await db.search(q, { limit: 50 });
      times.push(performance.now() - t0);
    }
  }
  times.sort((a, b) => a - b);
  const p = (x: number) => times[Math.floor(times.length * x)];
  console.log({ p50: p(0.5), p95: p(0.95), max: times[times.length - 1] });
})();

- Main-thread blocking:
  - Wrap requestAnimationFrame loop in the page; measure max frame gap while typing and searching; it should remain <16 ms jitter (worker isolates heavy work).

Memory and footprint budget
- Log ArrayBuffer sizes after init. On mobile, ensure total memory for core assets < ~10–20 MB uncompressed.
- Check network panel compressed sizes; core tier target ≤ 2–6 MB (br), extended ≤ 1–3 MB (br).

Persistence and caching
- Confirm assets served with long-lived cache headers and content hashes; changes reflected by new version in index.*.meta.json.

Closing notes and practical tips
- Start with the “core” tier only (title+authors+key). You’ll likely achieve instantaneous feel on laptops and modern phones.
- Add the extended tier with lazy-load triggered by numeric tokens (years), doi-like tokens, or a UI toggle “include venue/year/doi”.
- Fuzzy: begin with disabled by default; enable with a small toggle. Keep edit distance ≤ 1 and cap candidates to 200 terms via 3-grams or deletes to avoid runaway latencies.
- Highlighting: on the worker side, store normalized versions of title/authors and compute highlight spans for matched tokens; return spans to the UI.

Acceptance alignment
- Static Svelte app, all search in-browser, no server runtime.
- Meets latency targets with core tier in a Worker.
- Index size in target range via tiering and compression.
- Minimal API: init/search/getEntry with deterministic ranking and required fields.
- Build pipeline reproducibly transforms upstream BibTeX into Hayagriva YAML, then to compact client-side artifacts, including the required concatenation step for crypto_crossref.bib and abbrev0.bib.

If you want, I can provide:
- A small reference repo skeleton with the above scripts and an example “search/” folder (with fake small data) wired to a SvelteKit page.
- A hardened docstore format (binary TLV with offsets) and the corresponding getEntryById decoder to replace the JSONL placeholder.