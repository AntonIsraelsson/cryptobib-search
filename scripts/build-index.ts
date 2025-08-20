import { readFile, writeFile, mkdir } from 'fs/promises';
import yaml from 'js-yaml';
import { createHash } from 'crypto';

type HayEntry = {
  type?: string;
  title?: string;
  author?: string[] | string; // can be array or single string
  date?: string; // YYYY-MM
  'page-range'?: string;
  'serial-number'?: { doi?: string };
  parent?: any; // nested
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
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p || STOP.has(p)) continue;
    positions.push(tokens.length);
    tokens.push(p);
  }
  return { tokens, positions };
}

function flattenVenue(e: any): string {
  // choose best available: parent.title or journal/booktitle or proceedings' chain
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
  await mkdir('static/search', { recursive: true });
  
  console.log('Loading YAML data...');
  // Use test data if cryptobib.yaml doesn't exist
  let yamlFile = 'data/cryptobib.yaml';
  try {
    await readFile(yamlFile, 'utf8');
  } catch (e) {
    console.log('cryptobib.yaml not found, using test data...');
    yamlFile = 'data/test.yaml';
  }
  const yamlContent = await readFile(yamlFile, 'utf8');
  const y = yaml.load(yamlContent) as Record<string, HayEntry>;
  
  console.log(`Processing ${Object.keys(y).length} entries...`);
  
  const entries: {
    id: number; key: string; title: string; authors: string[]; authors_str: string;
    venue: string; year?: number; page_range?: string; doi?: string;
  }[] = [];

  let id = 0;
  for (const [key, e] of Object.entries(y)) {
    const title = e.title || '';
    
    // Handle author field which can be string, array, or undefined
    let authors: string[] = [];
    if (e.author) {
      if (Array.isArray(e.author)) {
        authors = e.author.map(a => String(a));
      } else {
        authors = [String(e.author)];
      }
    }
    const authors_str = authors.join('; ');
    
    const venue = flattenVenue(e) || '';
    const year = e.date ? +String(e.date).slice(0, 4) : undefined;
    const doi = e['serial-number']?.doi;
    const page_range = e['page-range'];

    entries.push({ id: id++, key, title, authors, authors_str, venue, year, page_range, doi });
  }

  console.log(`Building index for ${entries.length} entries...`);

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

  console.log(`Core terms: ${termsCore.length}, Extended terms: ${termsExt.length}`);

  // Sort terms, remap termIds to sorted order
  function finalizeTerms(terms: string[], maps: Map<number, PostRec>[]) {
    const idx = terms.map((t, i) => ({ t, i }));
    idx.sort((a, b) => a.t.localeCompare(b.t));
    const remap = new Uint32Array(idx.length);
    const sorted = new Array<string>(idx.length);
    for (let newId = 0; newId < idx.length; newId++) {
      sorted[newId] = idx[newId].t; 
      remap[idx[newId].i] = newId;
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
    out.set(header, 0); 
    out.set(offBytes, header.length); 
    out.set(blob, header.length + offBytes.length);
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
      if (recT) { 
        titlePtrStart[tid] = bytes.length; 
        encodePositions(recT); 
        titlePtrLen[tid] = bytes.length - titlePtrStart[tid]; 
      }
      const recA = coreFinal.maps[1].get(tid);
      if (recA) { 
        authorsPtrStart[tid] = bytes.length; 
        encodePositions(recA); 
        authorsPtrLen[tid] = bytes.length - authorsPtrStart[tid]; 
      }
      const recK = coreFinal.maps[2].get(tid);
      if (recK) { 
        keyPtrStart[tid] = bytes.length; 
        encodeTF(recK); 
        keyPtrLen[tid] = bytes.length - keyPtrStart[tid]; 
      }
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
      if (rv) { 
        venuePtrStart[tid] = bytes.length; 
        encodeTF(rv); 
        venuePtrLen[tid] = bytes.length - venuePtrStart[tid]; 
      }
      const ry = extFinal.maps[1].get(tid);
      if (ry) { 
        yearPtrStart[tid] = bytes.length; 
        encodeTF(ry); 
        yearPtrLen[tid] = bytes.length - yearPtrStart[tid]; 
      }
      const rd = extFinal.maps[2].get(tid);
      if (rd) { 
        doiPtrStart[tid] = bytes.length; 
        encodeTF(rd); 
        doiPtrLen[tid] = bytes.length - doiPtrStart[tid]; 
      }
    }
    return {
      ptrs: { venuePtrStart, venuePtrLen, yearPtrStart, yearPtrLen, doiPtrStart, doiPtrLen },
      postings: Uint8Array.from(bytes),
    };
  }

  console.log('Building core postings...');
  const corePosts = buildCorePostings();
  
  console.log('Building extended postings...');
  const extPosts = buildExtPostings();

  // Build docstore
  const enc = new TextEncoder();
  const docOffsets: number[] = [];
  const docBytes: number[] = [];
  const idmap: Record<string, number> = {};

  for (const d of entries) {
    idmap[d.key] = d.id;
    // For simplicity, write a JSON docstore
    docOffsets.push(docBytes.length);
    const obj = {
      id: d.id, key: d.key, title: d.title, authors_str: d.authors_str, venue: d.venue,
      year: d.year, page_range: d.page_range, doi: d.doi
    };
    const b = enc.encode(JSON.stringify(obj) + '\n');
    docBytes.push(...b);
  }
  docOffsets.push(docBytes.length);

  console.log('Writing index files...');

  // Helper function to write files to both locations
  async function writeToSearchDirs(filename: string, data: any) {
    await writeFile(`search/${filename}`, data);
    await writeFile(`static/search/${filename}`, data);
  }

  const coreDict = buildDictBin(coreFinal.sorted);
  await writeToSearchDirs('index.core.dict.bin', coreDict);
  
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

  await writeToSearchDirs('index.core.ptrs.bin', ptrsBuf);
  await writeToSearchDirs('index.core.postings.bin', corePosts.postings);

  const coreMeta = JSON.stringify({
    version: createHash('sha256').update(corePosts.postings).digest('hex').slice(0, 8),
    numDocs: entries.length
  });
  await writeToSearchDirs('index.core.meta.json', coreMeta);

  // Extended
  const extDict = buildDictBin(extFinal.sorted);
  await writeToSearchDirs('index.ext.dict.bin', extDict);
  
  const extPtrsBuf = new Uint8Array(
    extPosts.ptrs.venuePtrStart.byteLength + extPosts.ptrs.venuePtrLen.byteLength +
    extPosts.ptrs.yearPtrStart.byteLength + extPosts.ptrs.yearPtrLen.byteLength +
    extPosts.ptrs.doiPtrStart.byteLength + extPosts.ptrs.doiPtrLen.byteLength
  );
  po = 0;
  append(extPosts.ptrs.venuePtrStart); append(extPosts.ptrs.venuePtrLen);
  append(extPosts.ptrs.yearPtrStart); append(extPosts.ptrs.yearPtrLen);
  append(extPosts.ptrs.doiPtrStart); append(extPosts.ptrs.doiPtrLen);

  await writeToSearchDirs('index.ext.ptrs.bin', extPtrsBuf);
  await writeToSearchDirs('index.ext.postings.bin', extPosts.postings);
  
  const extMeta = JSON.stringify({
    version: createHash('sha256').update(extPosts.postings).digest('hex').slice(0, 8),
  });
  await writeToSearchDirs('index.ext.meta.json', extMeta);

  // Docstore
  const docIndex = new Uint8Array(new Uint32Array(docOffsets).buffer);
  const docBlob = new Uint8Array(docBytes);
  const idmapJson = JSON.stringify(idmap);
  
  await writeToSearchDirs('doc.index.bin', docIndex);
  await writeToSearchDirs('doc.blob.bin', docBlob);
  await writeToSearchDirs('idmap.json', idmapJson);
  
  console.log('Index built successfully!');
  console.log(`Core postings size: ${corePosts.postings.length} bytes`);
  console.log(`Extended postings size: ${extPosts.postings.length} bytes`);
  console.log(`Docstore size: ${docBytes.length} bytes`);
}

main().catch(e => { 
  console.error('Error:', e.message); 
  console.error(e.stack);
  process.exit(1); 
});