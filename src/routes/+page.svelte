<script lang="ts">
  import { onMount } from 'svelte';
  import { SearchDB, type Entry } from '$lib/search/db';
  import { Copy, ExternalLink } from 'lucide-svelte';
  
  let db: SearchDB;
  let q = '';
  let results: Entry[] = [];
  let loading = true;
  let searching = false;
  let timer: any;

  onMount(async () => {
    try {
      db = new SearchDB();
      await db.init();
      loading = false;
    } catch (error) {
      console.error('Failed to initialize search:', error);
      loading = false;
    }
  });

  function onInput(e: Event) {
    q = (e.target as HTMLInputElement).value;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!q.trim()) { 
        results = []; 
        return; 
      }
      
      searching = true;
      try {
        const t0 = performance.now();
        results = await db.search(q, { limit: 50 });
        const t1 = performance.now();
        console.log(`Search took ${(t1-t0).toFixed(1)}ms`);
      } catch (error) {
        console.error('Search failed:', error);
        results = [];
      }
      searching = false;
    }, 60); // small debounce
  }

  function onKeydown(e: KeyboardEvent) {
    // TODO: implement keyboard nav: Up/Down, Enter, etc.
  }

  async function copyHayagriva(entry: Entry) {
    const hayagrivaText = entry.original_hayagriva || entry.key + ':\n  title: ' + entry.title;
    try {
      await navigator.clipboard.writeText(hayagrivaText);
      console.log('Hayagriva entry copied to clipboard');
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }
</script>

<div class="container">
  <h1>CryptoBib Search</h1>
  <p class="subtitle">Ultra-fast client-side search for cryptography bibliography</p>
  
  <div class="search-section">
    <input 
      class="search-input"
      placeholder="Search titles, authors, venues, years, DOIs..." 
      value={q} 
      on:input={onInput} 
      on:keydown={onKeydown}
      disabled={loading}
    />
    
    {#if loading}
      <div class="status">Loading search index...</div>
    {:else if searching}
      <div class="status">Searching...</div>
    {:else if q.trim() && results.length === 0}
      <div class="status">No results found</div>
    {:else if results.length > 0}
      <div class="status">{results.length} results</div>
    {/if}
  </div>

  {#if !loading}
    <div class="results">
      {#each results as r (r.id)}
        <div class="result-item">
          <div class="result-header">
            <h3 class="title">{r.title}</h3>
            <button class="copy-btn" on:click={() => copyHayagriva(r)} title="Copy Hayagriva entry">
              <Copy size={16} />
              <span class="copy-text">Copy</span>
            </button>
          </div>
          <div class="authors">{r.authors_str}</div>
          <div class="meta">
            {#if r.venue}<span class="venue">{r.venue}</span>{/if}
            {#if r.year}<span class="year">{r.year}</span>{/if}
            {#if r.page_range}<span class="pages">pp. {r.page_range}</span>{/if}
          </div>
          <div class="identifiers">
            {#if r.doi}
              <a href="https://doi.org/{r.doi}" target="_blank" class="doi">
                <ExternalLink size={14} />
                DOI: {r.doi}
              </a>
            {/if}
            <span class="key">{r.key}</span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .container {
    max-width: 1000px;
    margin: 0 auto;
    padding: 2rem;
  }

  h1 {
    color: #2563eb;
    margin-bottom: 0.5rem;
  }

  .subtitle {
    color: #6b7280;
    margin-bottom: 2rem;
  }

  .search-section {
    margin-bottom: 2rem;
  }

  .search-input {
    width: 100%;
    padding: 0.75rem 1rem;
    border: 2px solid #e5e7eb;
    border-radius: 0.5rem;
    font-size: 1rem;
    transition: border-color 0.2s;
  }

  .search-input:focus {
    outline: none;
    border-color: #2563eb;
  }

  .search-input:disabled {
    background-color: #f9fafb;
    color: #6b7280;
  }

  .status {
    margin-top: 0.5rem;
    color: #6b7280;
    font-size: 0.875rem;
  }

  .results {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .result-item {
    padding: 1.5rem;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    background: white;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  }

  .result-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }

  .title {
    font-size: 1.125rem;
    font-weight: 600;
    color: #1f2937;
    line-height: 1.4;
    flex: 1;
    margin: 0;
  }

  .authors {
    color: #374151;
    margin-bottom: 0.5rem;
    font-weight: 500;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 0.5rem;
    color: #6b7280;
    font-size: 0.875rem;
  }

  .venue {
    font-style: italic;
  }

  .identifiers {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    font-size: 0.875rem;
  }

  .doi {
    color: #2563eb;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  .doi:hover {
    text-decoration: underline;
  }

  .key {
    color: #6b7280;
    font-family: monospace;
  }

  .copy-btn {
    background: #f3f4f6;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    color: #374151;
    cursor: pointer;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    flex-shrink: 0;
    height: fit-content;
  }

  .copy-btn:hover {
    background: #e5e7eb;
    border-color: #9ca3af;
    color: #1f2937;
  }

  .copy-btn:active {
    background: #d1d5db;
    transform: translateY(1px);
  }

  .copy-text {
    font-weight: 500;
  }

  @media (max-width: 768px) {
    .container {
      padding: 1rem;
    }
    
    .result-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
    }
    
    .copy-btn {
      align-self: flex-end;
    }
    
    .copy-text {
      display: none;
    }
    
    .meta,
    .identifiers {
      flex-direction: column;
      gap: 0.25rem;
    }
  }

  @media (max-width: 480px) {
    .result-header {
      gap: 0.5rem;
    }
    
    .copy-btn {
      padding: 0.375rem 0.5rem;
      font-size: 0.75rem;
    }
  }
</style>
