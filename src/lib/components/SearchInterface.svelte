<script lang="ts">
	import { onMount } from 'svelte';
	import { bibliography, searchResults, isLoading, loadingProgress, searchQuery, loadBibliography, search, copyToClipboard, formatForHayagriva } from '../stores/bibliography.js';
	import type { SearchResult } from '../types/bibliography.js';
	
	let searchInput = '';
	let debounceTimer: ReturnType<typeof setTimeout>;
	let copyStatus: { [key: string]: 'idle' | 'copying' | 'success' | 'error' } = {};
	
	onMount(() => {
		loadBibliography();
	});
	
	function handleInput() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			searchQuery.set(searchInput);
			search(searchInput);
		}, 300);
	}
	
	function formatAuthors(authors?: string): string {
		if (!authors) return '';
		return authors.split(' and ').slice(0, 3).join(', ') + 
			(authors.split(' and ').length > 3 ? ', et al.' : '');
	}
	
	function getDisplayTitle(entry: any): string {
		return entry.title || entry.id || 'Untitled';
	}
	
	function highlightMatches(text: string, matches: string[]): string {
		if (!matches.length) return text;
		
		let highlighted = text;
		matches.forEach(match => {
			const regex = new RegExp(`(${match})`, 'gi');
			highlighted = highlighted.replace(regex, '<mark>$1</mark>');
		});
		return highlighted;
	}
	
	async function handleCopy(entryId: string, entry: any) {
		copyStatus[entryId] = 'copying';
		copyStatus = { ...copyStatus };
		
		try {
			const hayagrivaText = formatForHayagriva(entry);
			await copyToClipboard(hayagrivaText);
			copyStatus[entryId] = 'success';
			
			// Reset status after 2 seconds
			setTimeout(() => {
				copyStatus[entryId] = 'idle';
				copyStatus = { ...copyStatus };
			}, 2000);
		} catch (error) {
			console.error('Copy failed:', error);
			copyStatus[entryId] = 'error';
			
			// Reset status after 2 seconds
			setTimeout(() => {
				copyStatus[entryId] = 'idle';
				copyStatus = { ...copyStatus };
			}, 2000);
		}
		
		copyStatus = { ...copyStatus };
	}
	
	function getCopyButtonText(entryId: string): string {
		const status = copyStatus[entryId] || 'idle';
		switch (status) {
			case 'copying': return 'Copying...';
			case 'success': return 'Copied!';
			case 'error': return 'Failed';
			default: return 'Copy BibTeX';
		}
	}
	
	function getCopyButtonClass(entryId: string): string {
		const status = copyStatus[entryId] || 'idle';
		const baseClass = 'copy-button';
		switch (status) {
			case 'copying': return `${baseClass} copying`;
			case 'success': return `${baseClass} success`;
			case 'error': return `${baseClass} error`;
			default: return baseClass;
		}
	}
</script>

<div class="search-container">
	<div class="search-header">
		<h1>CryptoBib Search</h1>
		<p>Search cryptography bibliography entries</p>
	</div>
	
	<div class="search-box">
		<input
			bind:value={searchInput}
			on:input={handleInput}
			placeholder="Search entries (e.g., CKKS18, Regev05, lattice-based)..."
			disabled={$isLoading}
			autofocus
		/>
		{#if $isLoading}
			<div class="loading">
				<div class="loading-text">Loading bibliography...</div>
				<div class="progress-bar">
					<div class="progress-fill" style="width: {$loadingProgress}%"></div>
				</div>
				<div class="progress-text">{Math.round($loadingProgress)}%</div>
			</div>
		{/if}
	</div>
	
	{#if $searchResults.length > 0}
		<div class="results">
			<div class="results-header">
				{$searchResults.length} result{$searchResults.length === 1 ? '' : 's'} for "{$searchQuery}"
			</div>
			
			{#each $searchResults as result}
				<div class="result-item">
					<div class="result-header">
						<div class="result-id">
							{@html highlightMatches(result.entry.id, result.matches)}
						</div>
						<button
							class={getCopyButtonClass(result.entry.id)}
							on:click={() => handleCopy(result.entry.id, result.entry)}
							disabled={copyStatus[result.entry.id] === 'copying'}
						>
							{getCopyButtonText(result.entry.id)}
						</button>
					</div>
					
					<div class="result-title">
						{@html highlightMatches(getDisplayTitle(result.entry), result.matches)}
					</div>
					
					{#if result.entry.author}
						<div class="result-authors">
							{@html highlightMatches(formatAuthors(result.entry.author), result.matches)}
						</div>
					{/if}
					
					<div class="result-meta">
						{#if result.entry.year}
							<span class="year">{result.entry.year}</span>
						{/if}
						
						{#if result.entry.journal}
							<span class="venue">{result.entry.journal}</span>
						{:else if result.entry.booktitle}
							<span class="venue">{result.entry.booktitle}</span>
						{/if}
						
						{#if result.entry.type}
							<span class="type">{result.entry.type}</span>
						{/if}
					</div>
					
					{#if result.entry.doi || result.entry.url}
						<div class="result-links">
							{#if result.entry.doi}
								<a href="https://doi.org/{result.entry.doi}" target="_blank" rel="noopener">DOI</a>
							{/if}
							{#if result.entry.url}
								<a href={result.entry.url} target="_blank" rel="noopener">URL</a>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{:else if $searchQuery && !$isLoading}
		<div class="no-results">
			No results found for "{$searchQuery}"
		</div>
	{:else if !$searchQuery && !$isLoading}
		<div class="welcome">
			<p>Enter a search term to find bibliography entries.</p>
			<p><strong>Examples:</strong> CKKS18, Regev05, "lattice-based cryptography"</p>
		</div>
	{/if}
</div>

<style>
	.search-container {
		max-width: 800px;
		margin: 0 auto;
		padding: 2rem 1rem;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}
	
	.search-header {
		text-align: center;
		margin-bottom: 2rem;
	}
	
	.search-header h1 {
		font-size: 2.5rem;
		margin: 0 0 0.5rem 0;
		color: #2563eb;
		font-weight: 700;
	}
	
	.search-header p {
		color: #6b7280;
		font-size: 1.1rem;
		margin: 0;
	}
	
	.search-box {
		margin-bottom: 2rem;
		position: relative;
	}
	
	.search-box input {
		width: 100%;
		padding: 1rem 1.5rem;
		font-size: 1.1rem;
		border: 2px solid #e5e7eb;
		border-radius: 12px;
		outline: none;
		transition: all 0.2s ease;
		box-sizing: border-box;
	}
	
	.search-box input:focus {
		border-color: #2563eb;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
	}
	
	.search-box input:disabled {
		background-color: #f9fafb;
		cursor: not-allowed;
	}
	
	.loading {
		text-align: center;
		margin-top: 1rem;
	}
	
	.loading-text {
		color: #6b7280;
		margin-bottom: 0.5rem;
	}
	
	.progress-bar {
		width: 100%;
		height: 8px;
		background-color: #e5e7eb;
		border-radius: 4px;
		overflow: hidden;
		margin-bottom: 0.5rem;
	}
	
	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #2563eb, #3b82f6);
		transition: width 0.3s ease;
		border-radius: 4px;
	}
	
	.progress-text {
		font-size: 0.875rem;
		color: #6b7280;
	}
	
	.results-header {
		margin-bottom: 1rem;
		font-weight: 600;
		color: #374151;
		font-size: 0.95rem;
	}
	
	.result-item {
		padding: 1.5rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		margin-bottom: 1rem;
		background: white;
		transition: all 0.2s ease;
	}
	
	.result-item:hover {
		border-color: #d1d5db;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
	}
	
	.result-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 0.5rem;
		gap: 1rem;
	}
	
	.result-id {
		font-family: 'SF Mono', Monaco, 'Roboto Mono', monospace;
		font-weight: 700;
		color: #2563eb;
		font-size: 1.1rem;
		flex: 1;
	}
	
	.copy-button {
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		border: 1px solid #d1d5db;
		border-radius: 6px;
		background: white;
		color: #374151;
		cursor: pointer;
		transition: all 0.2s ease;
		white-space: nowrap;
	}
	
	.copy-button:hover {
		border-color: #2563eb;
		color: #2563eb;
	}
	
	.copy-button:disabled,
	.copy-button.copying {
		cursor: not-allowed;
		opacity: 0.6;
	}
	
	.copy-button.success {
		border-color: #059669;
		color: #059669;
		background-color: #f0fdf4;
	}
	
	.copy-button.error {
		border-color: #dc2626;
		color: #dc2626;
		background-color: #fef2f2;
	}
	
	.result-title {
		font-weight: 600;
		font-size: 1.05rem;
		line-height: 1.4;
		margin-bottom: 0.5rem;
		color: #111827;
	}
	
	.result-authors {
		color: #6b7280;
		margin-bottom: 0.5rem;
		font-size: 0.95rem;
	}
	
	.result-meta {
		display: flex;
		gap: 1rem;
		margin-bottom: 0.75rem;
		font-size: 0.9rem;
		flex-wrap: wrap;
	}
	
	.year {
		font-weight: 600;
		color: #059669;
	}
	
	.venue {
		color: #7c3aed;
		font-style: italic;
	}
	
	.type {
		color: #dc2626;
		text-transform: uppercase;
		font-size: 0.8rem;
		font-weight: 600;
	}
	
	.result-links {
		display: flex;
		gap: 1rem;
	}
	
	.result-links a {
		color: #2563eb;
		text-decoration: none;
		font-size: 0.9rem;
		font-weight: 500;
	}
	
	.result-links a:hover {
		text-decoration: underline;
	}
	
	.no-results {
		text-align: center;
		color: #6b7280;
		padding: 3rem 1rem;
		font-size: 1.1rem;
	}
	
	.welcome {
		text-align: center;
		color: #6b7280;
		padding: 3rem 1rem;
		line-height: 1.6;
	}
	
	.welcome p {
		margin: 0 0 1rem 0;
	}
	
	:global(mark) {
		background-color: #fef3c7;
		color: #92400e;
		padding: 0.1em 0.2em;
		border-radius: 3px;
	}
	
	@media (max-width: 640px) {
		.search-container {
			padding: 1rem 0.5rem;
		}
		
		.search-header h1 {
			font-size: 2rem;
		}
		
		.result-item {
			padding: 1rem;
		}
		
		.result-header {
			flex-direction: column;
			gap: 0.5rem;
		}
		
		.copy-button {
			align-self: flex-start;
		}
		
		.result-meta {
			flex-direction: column;
			gap: 0.25rem;
		}
	}
</style>