// Web Worker (module) that owns all heavy CPU. No external deps.

type InitMsg = { type: 'init'; basePath?: string };
type SearchMsg = { type: 'search'; q: string; opts?: SearchOpts };
type GetMsg = { type: 'get'; idOrKey: number | string };
type AnyMsg = InitMsg | SearchMsg | GetMsg;

export type SearchOpts = { limit?: number; fuzzy?: boolean; useExtended?: boolean };

type HighlightSpan = { start: number; end: number };
export type Entry = {
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
      // tf is present but we don't need to parse it separately for now; skip nPos varint
      let tf; [tf, p] = uvarint(postings, p);
      docs.push(docId);
    }
  }
  return withPositions ? { docs, positions } : { docs };
}

// Get base path - in production, this will be set by SvelteKit's base path handling
// For Web Workers, we'll pass the base path from the main thread
let basePath = '';

async function loadCore() {
  const meta = await (await fetch(`${basePath}/search/index.core.meta.json`)).json();
  state.version = meta.version;
  state.numDocs = meta.numDocs;

  const [dictBuf, ptrsBuf, postBuf, docIdxBuf, docBlobBuf, keyMapRes] = await Promise.all([
    fetchBin(`${basePath}/search/index.core.dict.bin`),
    fetchBin(`${basePath}/search/index.core.ptrs.bin`),
    fetchBin(`${basePath}/search/index.core.postings.bin`),
    fetchBin(`${basePath}/search/doc.index.bin`),
    fetchBin(`${basePath}/search/doc.blob.bin`),
    fetch(`${basePath}/search/idmap.json`),
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
  const meta = await (await fetch(`${basePath}/search/index.ext.meta.json`)).json();
  const [dictBuf, ptrsBuf, postBuf] = await Promise.all([
    fetchBin(`${basePath}/search/index.ext.dict.bin`),
    fetchBin(`${basePath}/search/index.ext.ptrs.bin`),
    fetchBin(`${basePath}/search/index.ext.postings.bin`),
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

// Build Entry from docstore
function getEntryById(id: number): Entry | null {
  if (id < 0 || id >= state.numDocs) return null;
  
  // Simple JSON-based docstore
  const start = state.docIndex[id];
  const end = state.docIndex[id + 1];
  const jsonStr = new TextDecoder().decode(state.docBlob.subarray(start, end));
  
  try {
    return JSON.parse(jsonStr.trim()) as Entry;
  } catch (e) {
    console.error('Failed to parse entry', id, e);
    return null;
  }
}

async function handleInit(msg: InitMsg) {
  if (state.inited) return;
  if (msg.basePath) {
    basePath = msg.basePath;
  }
  await loadCore();
  state.inited = true;
  (self as any).postMessage({ type: 'init:ok' });
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

// Full search flow
async function handleSearch(q: string, opts: SearchOpts = {}) {
  if (!state.inited) await handleInit();
  const limit = Math.max(1, Math.min(1000, opts.limit ?? 50));
  const t0 = performance.now();

  const { phrases, tokens, lastIsPrefix } = tokenizeQuery(q);
  
  // If no tokens and no phrases, return empty
  if (tokens.length === 0 && phrases.length === 0) {
    (self as any).postMessage({ type: 'search:ok', results: [] });
    return;
  }

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
        for (let i = l; i < Math.min(r, l + cap); i++) {
          if (i !== exactId) ids.push(i); // avoid duplicates
        }
      }
    }
    return ids;
  }

  // Classify needs extended tier?
  const needsExt = opts.useExtended ||
                   tokens.some(t => /^\d{4}$/.test(t) || /doi|10\.\d/.test(t) || /[A-Za-z]+:\w+/.test(t));
  if (needsExt) await ensureExtendedLoaded();

  // Resolve tokens
  const termsCore: { token: string; termIds: number[] }[] = [];
  const termsExt: { token: string; termIds: number[] }[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const pref = lastIsPrefix && i === tokens.length - 1;
    const coreIds = resolveTermRanges(tok, 'core', pref);
    const extIds = state.extLoaded ? resolveTermRanges(tok, 'ext', pref) : [];
    termsCore.push({ token: tok, termIds: coreIds });
    if (state.extLoaded) termsExt.push({ token: tok, termIds: extIds });
  }

  function postingsForCoreTerm(termId: number): { docs: number[]; src: 'title' | 'authors' | 'key'; positions?: number[][] }[] {
    const arr: ReturnType<typeof postingsForCoreTerm> = [];
    const { postings, ptrTitleStart, ptrTitleLen, ptrAuthorsStart, ptrAuthorsLen, ptrKeyStart, ptrKeyLen } = state.core;
    if (ptrTitleLen[termId]) {
      const result = readPostings(postings, ptrTitleStart[termId], ptrTitleLen[termId], true);
      arr.push({ docs: result.docs, src: 'title', positions: result.positions });
    }
    if (ptrAuthorsLen[termId]) {
      const result = readPostings(postings, ptrAuthorsStart[termId], ptrAuthorsLen[termId], true);
      arr.push({ docs: result.docs, src: 'authors', positions: result.positions });
    }
    if (ptrKeyLen[termId]) {
      const result = readPostings(postings, ptrKeyStart[termId], ptrKeyLen[termId], false);
      arr.push({ docs: result.docs, src: 'key' });
    }
    return arr;
  }

  function postingsForExtTerm(termId: number): { docs: number[]; src: 'venue' | 'year' | 'doi' }[] {
    const arr: ReturnType<typeof postingsForExtTerm> = [];
    const { postings, ptrVenueStart, ptrVenueLen, ptrYearStart, ptrYearLen, ptrDoiStart, ptrDoiLen } = state.ext;
    if (ptrVenueLen[termId]) {
      const result = readPostings(postings, ptrVenueStart[termId], ptrVenueLen[termId], false);
      arr.push({ docs: result.docs, src: 'venue' });
    }
    if (ptrYearLen[termId]) {
      const result = readPostings(postings, ptrYearStart[termId], ptrYearLen[termId], false);
      arr.push({ docs: result.docs, src: 'year' });
    }
    if (ptrDoiLen[termId]) {
      const result = readPostings(postings, ptrDoiStart[termId], ptrDoiLen[termId], false);
      arr.push({ docs: result.docs, src: 'doi' });
    }
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
    const coreIds = termsCore[t].termIds;
    const extIds = state.extLoaded ? termsExt[t].termIds : [];
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
  const results: { id: number; score: number }[] = [];
  for (const id of intersection) {
    let score = 0;
    // Basic scoring: each token contributes the max field weight it matched in
    for (const s of tokenDocSets) {
      // If the token doc set includes this id, add weight depending on which fields had postings for that token
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

self.onmessage = async (ev: MessageEvent<AnyMsg>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') await handleInit(msg);
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