<script lang="ts">
	import { onMount } from 'svelte';
	import { searchResults, isLoading, isSearching, searchQuery, hasSearched, search, copyToClipboard, formatForHayagriva } from '../stores/bibliography.js';
	import type { SearchResult } from '../types/bibliography.js';
	
	let searchInput = '';
	let debounceTimer: ReturnType<typeof setTimeout>;
	let copyStatus: { [key: string]: 'idle' | 'copying' | 'success' | 'error' } = {};
	let searchContainer: HTMLElement;
	let isSearchActive = false;
	
	function handleInput() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			searchQuery.set(searchInput);
			search(searchInput);
		}, 300);
	}
	
	function handleFocus() {
		if (!isSearchActive) {
			isSearchActive = true;
			// Smooth transition to top
			searchContainer.classList.add('search-active');
		}
	}
	
	function formatAuthors(authors?: string): string {
		if (!authors) return '';
		const authorList = authors.split(' and ');
		if (authorList.length <= 3) {
			return authorList.join(', ');
		}
		return authorList.slice(0, 3).join(', ') + ', et al.';
	}
	
	function getDisplayTitle(entry: any): string {
		return entry.title || entry.id || 'Untitled';
	}
	
	function highlightMatches(text: string, matches: string[]): string {
		if (!matches.length) return text;
		
		let highlighted = text;
		matches.forEach(match => {
			if (match && match.trim()) {
				const regex = new RegExp(`(${match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
				highlighted = highlighted.replace(regex, '<mark>$1</mark>');
			}
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
			
			setTimeout(() => {
				copyStatus[entryId] = 'idle';
				copyStatus = { ...copyStatus };
			}, 2000);
		} catch (error) {
			console.error('Copy failed:', error);
			copyStatus[entryId] = 'error';
			
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
			default: return 'Copy';
		}
	}
	
	function getCopyButtonClass(entryId: string): string {
		const status = copyStatus[entryId] || 'idle';
		return `copy-button ${status}`;
	}
</script>

<div class="search-wrapper" class:search-active={isSearchActive}>
	<div class="search-container" bind:this={searchContainer}>
		<div class="search-header" class:compact={isSearchActive}>
			<h1>CryptoBib</h1>
			{#if !isSearchActive}
				<p class="subtitle">Search cryptography bibliography entries</p>
			{/if}
		</div>
		
		<div class="search-box">
			<div class="search-input-wrapper">
				<input
					bind:value={searchInput}
					on:input={handleInput}
					on:focus={handleFocus}
					placeholder="Search for an entry in CryptoBib..."
					class:loading={$isLoading}
				/>
				{#if $isLoading || $isSearching}
					<div class="search-indicator">
						<div class="spinner"></div>
					</div>
				{/if}
			</div>
			{#if !isSearchActive}
				<div class="search-examples">
					<span class="example-label">Try:</span>
					<button class="example" on:click={() => { searchInput = 'CKKS18'; handleInput(); handleFocus(); }}>CKKS18</button>
					<button class="example" on:click={() => { searchInput = 'Regev05'; handleInput(); handleFocus(); }}>Regev05</button>
					<button class="example" on:click={() => { searchInput = 'lattice-based'; handleInput(); handleFocus(); }}>lattice-based</button>
				</div>
			{/if}
		</div>
	</div>
	
	{#if isSearchActive}
		<div class="results-container">
			{#if $searchResults.length > 0}
				<div class="results">
					<div class="results-header">
						<span class="results-count">{$searchResults.length}</span>
						{$searchResults.length === 1 ? 'result' : 'results'}
						{#if $searchQuery}for <span class="search-term">"{$searchQuery}"</span>{/if}
					</div>
					
					{#each $searchResults as result}
						<article class="result-item">
							<div class="result-main">
								<div class="result-id">
									{@html highlightMatches(result.entry.id, result.matches)}
								</div>
								
								<h3 class="result-title">
									{@html highlightMatches(getDisplayTitle(result.entry), result.matches)}
								</h3>
								
								{#if result.entry.author}
									<div class="result-authors">
										{@html highlightMatches(formatAuthors(result.entry.author), result.matches)}
									</div>
								{/if}
								
								<div class="result-meta">
									{#if result.entry.year}
										<span class="meta-item year">{result.entry.year}</span>
									{/if}
									
									{#if result.entry.journal}
										<span class="meta-item venue">{result.entry.journal}</span>
									{:else if result.entry.booktitle}
										<span class="meta-item venue">{result.entry.booktitle}</span>
									{/if}
									
									{#if result.entry.type}
										<span class="meta-item type">{result.entry.type}</span>
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
							
							<button
								class={getCopyButtonClass(result.entry.id)}
								on:click={() => handleCopy(result.entry.id, result.entry)}
								disabled={copyStatus[result.entry.id] === 'copying'}
								title="Copy BibTeX entry"
							>
								{getCopyButtonText(result.entry.id)}
							</button>
						</article>
					{/each}
				</div>
			{:else if $hasSearched && $searchQuery && !$isSearching && !$isLoading}
				<div class="no-results">
					<div class="no-results-icon">🔍</div>
					<p>No results found for <strong>"{$searchQuery}"</strong></p>
					<p class="no-results-hint">Try a different search term or check for typos</p>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.search-wrapper {
		min-height: 100vh;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
	}
	
	.search-wrapper.search-active {
		background: #f8fafc;
	}
	
	.search-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 2rem 1rem;
		transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
		max-width: 800px;
		margin: 0 auto;
	}
	
	.search-wrapper.search-active .search-container {
		min-height: auto;
		justify-content: flex-start;
		padding: 2rem 1rem 1rem 1rem;
	}
	
	.search-header {
		text-align: center;
		margin-bottom: 3rem;
		transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
	}
	
	.search-header.compact {
		margin-bottom: 1.5rem;
	}
	
	.search-header h1 {
		font-size: 4rem;
		font-weight: 800;
		margin: 0 0 1rem 0;
		background: linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
	}
	
	.search-wrapper.search-active .search-header h1 {
		font-size: 2.5rem;
		background: linear-gradient(135deg, #1e293b 0%, #475569 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		margin-bottom: 0;
	}
	
	.subtitle {
		color: rgba(255, 255, 255, 0.9);
		font-size: 1.2rem;
		margin: 0;
		font-weight: 400;
	}
	
	.search-box {
		width: 100%;
		max-width: 600px;
		transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
	}
	
	.search-input-wrapper {
		position: relative;
		margin-bottom: 1.5rem;
	}
	
	.search-input-wrapper input {
		width: 100%;
		padding: 1.2rem 1.5rem;
		font-size: 1.1rem;
		border: none;
		border-radius: 16px;
		background: rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(10px);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
		outline: none;
		transition: all 0.3s ease;
		box-sizing: border-box;
	}
	
	.search-wrapper.search-active .search-input-wrapper input {
		background: white;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		border: 2px solid transparent;
	}
	
	.search-input-wrapper input:focus {
		transform: translateY(-2px);
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
	}
	
	.search-wrapper.search-active .search-input-wrapper input:focus {
		border-color: #3b82f6;
		box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
		transform: none;
	}
	
	.search-indicator {
		position: absolute;
		right: 1rem;
		top: 50%;
		transform: translateY(-50%);
	}
	
	.spinner {
		width: 20px;
		height: 20px;
		border: 2px solid #e5e7eb;
		border-top: 2px solid #3b82f6;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}
	
	@keyframes spin {
		0% { transform: rotate(0deg); }
		100% { transform: rotate(360deg); }
	}
	
	.search-examples {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		flex-wrap: wrap;
		transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
	}
	
	.example-label {
		color: rgba(255, 255, 255, 0.8);
		font-size: 0.9rem;
		font-weight: 500;
	}
	
	.example {
		background: rgba(255, 255, 255, 0.2);
		color: white;
		border: 1px solid rgba(255, 255, 255, 0.3);
		padding: 0.5rem 1rem;
		border-radius: 20px;
		font-size: 0.9rem;
		cursor: pointer;
		transition: all 0.2s ease;
		backdrop-filter: blur(10px);
	}
	
	.example:hover {
		background: rgba(255, 255, 255, 0.3);
		transform: translateY(-2px);
	}
	
	.results-container {
		width: 100%;
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1rem 2rem 1rem;
		animation: fadeInUp 0.5s ease-out;
	}
	
	@keyframes fadeInUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	
	.results-header {
		margin-bottom: 1.5rem;
		font-weight: 600;
		color: #374151;
		font-size: 0.95rem;
	}
	
	.results-count {
		color: #3b82f6;
		font-weight: 700;
	}
	
	.search-term {
		color: #6366f1;
	}
	
	.result-item {
		display: flex;
		padding: 1.5rem;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		margin-bottom: 1rem;
		background: white;
		transition: all 0.2s ease;
		gap: 1rem;
		align-items: flex-start;
	}
	
	.result-item:hover {
		border-color: #d1d5db;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
		transform: translateY(-1px);
	}
	
	.result-main {
		flex: 1;
	}
	
	.result-id {
		font-family: 'JetBrains Mono', 'SF Mono', Monaco, monospace;
		font-weight: 700;
		color: #3b82f6;
		font-size: 1rem;
		margin-bottom: 0.5rem;
	}
	
	.result-title {
		font-weight: 600;
		font-size: 1.1rem;
		line-height: 1.4;
		margin: 0 0 0.5rem 0;
		color: #111827;
	}
	
	.result-authors {
		color: #6b7280;
		margin-bottom: 0.75rem;
		font-size: 0.95rem;
	}
	
	.result-meta {
		display: flex;
		gap: 1rem;
		margin-bottom: 0.75rem;
		flex-wrap: wrap;
	}
	
	.meta-item {
		font-size: 0.85rem;
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		font-weight: 500;
	}
	
	.year {
		background: #dcfce7;
		color: #166534;
	}
	
	.venue {
		background: #ede9fe;
		color: #7c2d12;
	}
	
	.type {
		background: #fee2e2;
		color: #dc2626;
		text-transform: uppercase;
		font-size: 0.75rem;
	}
	
	.result-links {
		display: flex;
		gap: 1rem;
	}
	
	.result-links a {
		color: #3b82f6;
		text-decoration: none;
		font-size: 0.9rem;
		font-weight: 500;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		transition: all 0.2s ease;
	}
	
	.result-links a:hover {
		background: #eff6ff;
		text-decoration: underline;
	}
	
	.copy-button {
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		background: white;
		color: #374151;
		cursor: pointer;
		transition: all 0.2s ease;
		white-space: nowrap;
		height: fit-content;
		font-weight: 500;
	}
	
	.copy-button:hover {
		border-color: #3b82f6;
		color: #3b82f6;
		background: #eff6ff;
	}
	
	.copy-button:disabled,
	.copy-button.copying {
		cursor: not-allowed;
		opacity: 0.6;
	}
	
	.copy-button.success {
		border-color: #10b981;
		color: #10b981;
		background: #ecfdf5;
	}
	
	.copy-button.error {
		border-color: #ef4444;
		color: #ef4444;
		background: #fef2f2;
	}
	
	.no-results {
		text-align: center;
		padding: 4rem 1rem;
		color: #6b7280;
	}
	
	.no-results-icon {
		font-size: 3rem;
		margin-bottom: 1rem;
	}
	
	.no-results p {
		margin: 0.5rem 0;
		font-size: 1.1rem;
	}
	
	.no-results-hint {
		font-size: 0.9rem !important;
		opacity: 0.8;
	}
	
	:global(mark) {
		background-color: #fef3c7;
		color: #92400e;
		padding: 0.1em 0.2em;
		border-radius: 3px;
		font-weight: 600;
	}
	
	@media (max-width: 768px) {
		.search-header h1 {
			font-size: 3rem;
		}
		
		.search-wrapper.search-active .search-header h1 {
			font-size: 2rem;
		}
		
		.result-item {
			padding: 1rem;
			flex-direction: column;
			gap: 0.75rem;
		}
		
		.copy-button {
			align-self: flex-start;
		}
		
		.result-meta {
			flex-direction: column;
			gap: 0.5rem;
		}
		
		.search-examples {
			flex-direction: column;
			gap: 0.75rem;
		}
	}
</style>