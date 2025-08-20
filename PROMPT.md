Title: Ultra-fast, fully client-side search for the CryptoBib corpus in a static Svelte app

Context
- Build a static Svelte web application that lets users search the complete CryptoBib corpus (all cryptography references since ~1980).
- Data source is maintained in BibTeX; for this project, the data is converted to Hayagriva YAML.
- All search and indexing must run in the browser. There is no server-side runtime beyond static hosting.
- The corpus contains no abstracts. Typical fields: key, type, title, author list, page-range, year (when available), venue/booktitle/journal (often via parent), DOI, and optional URL.
- Example Hayagriva YAML snippet (shape illustration):

```yml
ACISP:LZXSW24:
  type: article
  title: The Offline Quantum Attack Against Modular Addition Variant of {Even}-{Mansour} Cipher
  author:
  - Liu, Fangzhou
  - Zhu, Xueqi
  - Xu, Ruozhou
  - Shi, Danping
  - Wang, Peng
  date: 2024-07
  editor: Tianqing Zhu, Yannan Li
  page-range: 3-19
  serial-number:
    doi: 10.1007/978-981-97-5025-2_1
  parent:
    type: proceedings
    title: 'ACISP 24: 29th Australasian Conference on Information Security and Privacy, Part~I'
    publisher:
      name: Springer, Singapore, Singapore
      location: Sydney, NSW, Australia
    volume: 14895
    parent:
      type: proceedings
      title: Lecture Notes in Computer Science
ACISP:SZRL24:
  type: article
  title: Known-Key Attack on {GIFT}-64 and {GIFT}-64{}$[g_0^c]${} Based on Correlation Matrices
  author:
  - Sun, Xiaomeng
  - Zhang, Wenying
  - Rodríguez, René
  - Liu, Huimin
  date: 2024-07
  editor: Tianqing Zhu, Yannan Li
  page-range: 20-40
  serial-number:
    doi: 10.1007/978-981-97-5025-2_2
  parent:
    type: proceedings
    title: 'ACISP 24: 29th Australasian Conference on Information Security and Privacy, Part~I'
    publisher:
      name: Springer, Singapore, Singapore
      location: Sydney, NSW, Australia
    volume: 14895
    parent:
      type: proceedings
      title: Lecture Notes in Computer Science
```

Goal
- Deliver an extremely fast, “feels instant” search experience over the full dataset entirely in-browser, with a simple, single-string free-text query.
- Provide a minimal, well-defined database API consumable by the Svelte UI.
- Provide a repeatable build pipeline that produces the client-side search artifacts from the upstream BibTeX sources via Hayagriva.

Functional requirements
- Single input: free-text query string.
- Matching modes:
  - Bag-of-words (all terms should match; AND semantics) across title, authors, venue/booktitle/journal, year, key, DOI.
  - Fuzzy or typo-tolerant matching for human names and titles (configurable; avoid over-matching).
  - Phrase support when the query includes quoted segments.
  - Prefix behavior while typing (e.g., last token can match as a prefix).
- Ranking:
  - Quality ranking that favors title matches most, authors next, then venue/year/key/DOI.
  - Deterministic and stable ordering for ties.
- Results:
  - Return a small top-k set (configurable, default ~50) with the fields needed to render results: title, authors_str, venue/journal/booktitle, year, page-range, DOI, key (and any minimal IDs needed for follow-up queries).
  - Optional highlighting metadata for UI, if available.
- Normalization:
  - Case-insensitive.
  - Unicode normalization and diacritics folding.
  - Sensible tokenization around punctuation common in names and venues (e.g., hyphens, slashes).
- API surface (browser-side):
  - init(): preload and prepare the index/data for use without blocking the UI.
  - search(q: string, options?): Promise<Entry[]> returning ranked top-k entries.
  - getEntry(idOrKey): Promise<Entry | null> to retrieve a single entry by ID or key.
- UX expectations:
  - Results update as the user types with a small debounce.
  - Keyboard-first navigation is supported (not part of this API spec, but the result shape should make this easy).
  - Search computation must not block the main UI thread.

Non-functional and performance requirements
- Scale: handle the full CryptoBib corpus (order of 50k–150k entries; no abstracts).
- Latency targets (on a mid-range laptop and a recent mobile device):
  - p50 query time: <10 ms; p95: <30 ms for typical short queries (2–4 tokens).
  - End-to-end keystroke-to-render: <50 ms at p95 for short queries and result sets ≤100 items.
- Footprint:
  - Minimize initial download size of search artifacts; target under ~2–8 MB compressed for core fields.
  - Memory usage should be reasonable on mobile browsers; avoid loading unnecessary data eagerly.
- Startup:
  - App should be interactive quickly; any heavy work should be done lazily and/or off the main thread.
- Offline/read-only:
  - Entire experience should work with static hosting and no runtime server calls after initial static asset load.
- Robustness:
  - Handle missing years, inconsistent venue fields, and varying author name formats gracefully.
  - Support diacritic-insensitive search for names and titles.

Constraints
- Static Svelte front-end (no server runtime).
- All search happens client-side in the browser.
- Hayagriva is used for conversion from BibTeX to YAML during the build process.
- Avoid binding the solution to any specific library, database, or indexing technology in advance; evaluate options.

What to produce in your response
1) Deep analysis of approaches
   - Compare multiple viable client-side search/indexing strategies suitable for a static Svelte app, including:
     - Prebuilt inverted indexes shipped as static assets.
     - Embedded databases or WASM-backed engines.
     - Pure JavaScript search engines.
     - Sharded or tiered index strategies.
   - Discuss trade-offs in:
     - Query latency, memory footprint, download size, initialization time.
     - Fuzzy matching quality vs. speed.
     - Field weighting, scoring control, and result ranking quality.
     - Complexity of build tooling and portability.
   - Address how to:
     - Keep the main thread free.
     - Normalize and tokenize multilingual names/titles.
     - Support quote-phrases, bag-of-words, and prefix behavior during typing.
     - Cache and persist index artifacts across visits.
     - Evolve the index when upstream data updates.

2) Proposed architecture
   - Present at least two architecture options, articulate why you would pick one for this corpus, and outline how it satisfies the constraints and performance targets.
   - Include how the index is built (offline), versioned, compressed, shipped, loaded, and queried in-browser.
   - Describe the minimal database API shape and any Worker/streaming considerations without binding to a specific tech.

3) Database API specification and implementation
   - Specify the API surface:
     - init(): Promise<void>
     - search(q: string, opts?: { limit?: number }): Promise<Entry[]>
     - getEntry(idOrKey: string | number): Promise<Entry | null>
     - Define Entry and any supporting types.
   - Implement the API in the context of a static Svelte web app, ensuring:
     - All heavy work runs off the main thread.
     - Reasonable defaults for ranking and field weighting.
     - Phrase, bag-of-words, and last-token prefix support in query parsing.
     - Unicode and diacritics normalization on both build and query paths.
   - Provide minimal Svelte usage snippets showing how the UI calls this API.

4) Build pipeline and scripts
   - Describe and implement a build-time pipeline that:
     - Consumes the upstream BibTeX sources.
     - Converts to Hayagriva YAML using Hayagriva.
     - Normalizes fields (authors, venue, year, page-range, DOI).
     - Builds a compact client-side index and a minimal document store needed by the UI.
     - Emits static artifacts suitable for hosting alongside the Svelte app.
   - Include instructions to run the build locally and in CI, and how to version/cache the artifacts.
   - Short comment: include a build-time script that fetches the following files:
     - https://cryptobib.di.ens.fr/cryptobib/static/files/crypto.bib
     - https://cryptobib.di.ens.fr/cryptobib/static/files/abbrev0.bib
     Concatenate them into a single file to ensure abbreviations are resolved correctly, then run Hayagriva conversion on the concatenated file before building the index.

5) Testing and performance validation
   - Provide a minimal test plan and scripts to:
     - Validate parsing/normalization correctness on a subset of records.
     - Measure query latency distributions (p50/p95) across representative queries.
     - Verify memory usage and initial load size against the stated budgets.
     - Confirm that searches do not block the main thread (e.g., via simple frame-time metrics).

Acceptance criteria
- The delivered solution runs as a static Svelte app, performs all search client-side, and meets the latency and footprint targets on the CryptoBib-scale dataset.
- The database API is minimal, documented, and stable; it returns correct, well-ranked results for typical queries over titles, authors, venues, years, keys, and DOIs.
- The build pipeline reproducibly transforms the upstream BibTeX into Hayagriva YAML and then into the shipped search artifacts, including the noted concatenation step for the two upstream files.