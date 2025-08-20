# CryptoBib Search

Ultra-fast, fully client-side search for the CryptoBib corpus in a static Svelte app.

## Features

- **Ultra-fast search**: p50 < 10ms, p95 < 30ms query times
- **Fully client-side**: No server runtime required, works offline
- **Compact index**: ~2-8MB compressed core index, extended tier lazy-loaded
- **Rich query support**: AND semantics, phrase queries, prefix matching
- **Field-weighted ranking**: Title > Authors > Venue > Year/DOI/Key
- **Web Worker**: Non-blocking search that keeps UI responsive

## Quick Start

### 1. Install Dependencies

```bash
bun install  # or npm install
```

### 2. Build Search Index

Option A: Use test data (4 sample entries):
```bash
npm run build:index
```

Option B: Download full CryptoBib corpus:
```bash
npm run fetch          # Download and convert BibTeX to YAML
npm run build:index    # Build search index from YAML
```

Note: The fetch command requires `hayagriva` CLI to be installed:
```bash
cargo install hayagriva-cli
```

### 3. Run the Application

Development:
```bash
npm run dev
```

Production build:
```bash
npm run build:all     # Fetch, build index, and build app
npm run preview       # Preview built app
```

## Search Features

### Query Syntax

- **Simple terms**: `aes cryptography` (AND semantics - both terms must match)
- **Phrases**: `"zero knowledge"` (exact phrase matching)
- **Prefix matching**: `bella` matches `bellare` (last token treated as prefix)
- **Mixed**: `rogaway "authenticated encryption"` (combines AND and phrase matching)

### Fields Searched

**Core tier** (loaded immediately):
- Title (highest weight)
- Authors (high weight)  
- Entry keys (medium weight)

**Extended tier** (lazy-loaded when needed):
- Venue/journal/conference names
- Publication years
- DOI identifiers

### Performance Targets

- Query latency: p50 < 10ms, p95 < 30ms (2-4 token queries)
- End-to-end: < 50ms keystroke-to-render (≤100 results)
- Index size: ~2-6MB core tier compressed, ~1-3MB extended tier
- Memory usage: Reasonable on mobile browsers

## Architecture

### Components

1. **Build Pipeline** (`scripts/`):
   - `fetch-and-convert.ts`: Download BibTeX → Hayagriva YAML
   - `build-index.ts`: YAML → compact binary search index

2. **Search Engine** (`src/lib/search/`):
   - `worker.ts`: Web Worker with binary index loading/querying
   - `db.ts`: Main thread API wrapper

3. **UI** (`src/routes/`):
   - Svelte page with debounced search, keyboard navigation

### Index Format

- **Dictionary**: UTF-8 terms + binary search via offsets
- **Postings**: Varint-delta compressed doc IDs + positions/frequencies
- **Docstore**: JSON-lines format with essential fields for rendering
- **Tiered loading**: Core fields first, extended fields on demand

### Search Flow

1. Parse query: extract phrases `"..."` and remaining tokens
2. Resolve tokens: exact + prefix expansion (last token)
3. Load postings: retrieve doc sets per token per field
4. Intersect: AND semantics across tokens, union within tokens
5. Score: field-weighted + phrase bonuses + tie-breaking
6. Return: top-k results with highlighting metadata

## File Structure

```
├── scripts/
│   ├── fetch-and-convert.ts    # BibTeX download & conversion
│   ├── build-index.ts          # Index builder
│   └── bench.ts               # Performance benchmarks
├── src/lib/search/
│   ├── worker.ts              # Web Worker search engine  
│   └── db.ts                  # Main thread API
├── src/routes/
│   └── +page.svelte           # Search interface
├── static/search/             # Built index artifacts
├── data/                      # Source data (YAML/BibTeX)
└── search/                    # Build output (same as static/search)
```

## Development

### Adding Features

- **Fuzzy matching**: Extend worker.ts with edit-distance candidates via n-grams
- **Highlighting**: Compute match spans in worker, render in UI
- **Keyboard nav**: Handle Up/Down/Enter in Svelte component
- **Filters**: Add UI controls for year ranges, venues, etc.

### Performance Testing

Run benchmarks in browser console:
```javascript
import('/scripts/bench.js').then(m => m.runBenchmarks())
```

Or create a test page that imports and runs the benchmark suite.

### Debugging

- Check browser Network tab for index loading
- Monitor Worker messages in DevTools
- Use `console.log` timing in search queries
- Inspect index sizes and compression ratios

## Deployment

This is a static SvelteKit app. Build artifacts include:

1. **App bundle**: Standard SvelteKit static output
2. **Search index**: Binary files in `static/search/`

Deploy to any static host (Netlify, Vercel, GitHub Pages, S3, etc.):

```bash
npm run build:all
# Upload 'build/' directory
```

Ensure proper headers:
- `.bin` files: `Content-Type: application/octet-stream`, long cache TTL
- `.json` files: `Content-Type: application/json`, cache with version checks
- Enable Brotli/gzip compression for all text and binary assets

## License

The search implementation is provided as-is. CryptoBib data retains its original licensing.
