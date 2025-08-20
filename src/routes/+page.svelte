<script lang="ts">
  import { onMount } from 'svelte';
  import { SearchDB, type Entry } from '$lib/search/db';
  
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
          <h3 class="title">{r.title}</h3>
          <div class="authors">{r.authors_str}</div>
          <div class="meta">
            {#if r.venue}<span class="venue">{r.venue}</span>{/if}
            {#if r.year}<span class="year">{r.year}</span>{/if}
            {#if r.page_range}<span class="pages">pp. {r.page_range}</span>{/if}
          </div>
          <div class="identifiers">
            {#if r.doi}<a href="https://doi.org/{r.doi}" target="_blank" class="doi">DOI: {r.doi}</a>{/if}
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

  .title {
    font-size: 1.125rem;
    font-weight: 600;
    color: #1f2937;
    margin-bottom: 0.5rem;
    line-height: 1.4;
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
  }

  .doi:hover {
    text-decoration: underline;
  }

  .key {
    color: #6b7280;
    font-family: monospace;
  }

  @media (max-width: 640px) {
    .container {
      padding: 1rem;
    }
    
    .meta,
    .identifiers {
      flex-direction: column;
      gap: 0.25rem;
    }
  }
</style>
