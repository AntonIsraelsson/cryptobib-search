import { writable } from 'svelte/store';
import Fuse from 'fuse.js';
import type { BibEntry, SearchResult } from '../types/bibliography.js';

export const bibliography = writable<BibEntry[]>([]);
export const searchResults = writable<SearchResult[]>([]);
export const isLoading = writable(true);
export const loadingProgress = writable(0);
export const searchQuery = writable('');

const CACHE_KEY = 'cryptobib_bibliography';
const CACHE_VERSION_KEY = 'cryptobib_cache_version';
const CURRENT_CACHE_VERSION = '1.0'; // Increment when you want to invalidate cache


let fuse: Fuse<BibEntry> | null = null;

const fuseOptions = {
	keys: [
		{ name: 'id', weight: 2 },
		{ name: 'title', weight: 1.5 },
		{ name: 'author', weight: 1.2 },
		{ name: 'year', weight: 0.8 },
		{ name: 'journal', weight: 0.6 },
		{ name: 'booktitle', weight: 0.6 }
	],
	threshold: 0.4,
	includeScore: true,
	includeMatches: true,
	minMatchCharLength: 2
};

// Progressive processing function to avoid UI freezing
function processInChunks<T>(
	items: T[],
	chunkSize: number,
	processor: (chunk: T[]) => void,
	onProgress?: (progress: number) => void,
	onComplete?: () => void
) {
	let index = 0;
	
	function processChunk() {
		const chunk = items.slice(index, index + chunkSize);
		if (chunk.length === 0) {
			onComplete?.();
			return;
		}
		
		processor(chunk);
		index += chunkSize;
		
		const progress = Math.min(100, (index / items.length) * 100);
		onProgress?.(progress);
		
		// Use requestAnimationFrame to avoid blocking the UI
		requestAnimationFrame(processChunk);
	}
	
	requestAnimationFrame(processChunk);
}

// Add these helper functions
function saveBibliographyToCache(data: BibEntry[]) {
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify(data));
		localStorage.setItem(CACHE_VERSION_KEY, CURRENT_CACHE_VERSION);
		console.log('Bibliography cached successfully');
	} catch (error) {
		console.warn('Failed to cache bibliography:', error);
	}
}

function loadBibliographyFromCache(): BibEntry[] | null {
	try {
		const cachedVersion = localStorage.getItem(CACHE_VERSION_KEY);
		if (cachedVersion !== CURRENT_CACHE_VERSION) {
			// Cache version mismatch, clear old cache
			localStorage.removeItem(CACHE_KEY);
			localStorage.removeItem(CACHE_VERSION_KEY);
			return null;
		}
		
		const cached = localStorage.getItem(CACHE_KEY);
		if (cached) {
			return JSON.parse(cached);
		}
	} catch (error) {
		console.warn('Failed to load cached bibliography:', error);
		// Clear corrupted cache
		localStorage.removeItem(CACHE_KEY);
		localStorage.removeItem(CACHE_VERSION_KEY);
	}
	return null;
}

// Replace the entire loadBibliography function with this:
export async function loadBibliography() {
	try {
		isLoading.set(true);
		loadingProgress.set(0);
		
		// Try to load from cache first
		const cachedData = loadBibliographyFromCache();
		if (cachedData && cachedData.length > 0) {
			console.log(`Loaded ${cachedData.length} entries from cache`);
			
			// Process cached entries in chunks
			const processedEntries: BibEntry[] = [];
			
			processInChunks(
				cachedData,
				500,
				(chunk) => {
					processedEntries.push(...chunk);
				},
				(progress) => {
					loadingProgress.set(progress);
				},
				() => {
					bibliography.set(processedEntries);
					fuse = new Fuse(processedEntries, fuseOptions);
					isLoading.set(false);
					loadingProgress.set(100);
					console.log(`Loaded ${processedEntries.length} bibliography entries from cache`);
				}
			);
			return;
		}
		
		// If no cache, fetch from network
		console.log('No cache found, fetching from network...');
		const response = await fetch('/bibliography.json');
		if (!response.ok) throw new Error('Failed to load bibliography');
		
		const data: BibEntry[] = await response.json();
		console.log(`Loading ${data.length} bibliography entries from network...`);
		
		// Cache the fetched data
		saveBibliographyToCache(data);
		
		// Process entries in chunks to avoid freezing
		const processedEntries: BibEntry[] = [];
		
		processInChunks(
			data,
			500,
			(chunk) => {
				processedEntries.push(...chunk);
			},
			(progress) => {
				loadingProgress.set(progress);
			},
			() => {
				bibliography.set(processedEntries);
				fuse = new Fuse(processedEntries, fuseOptions);
				isLoading.set(false);
				loadingProgress.set(100);
				console.log(`Loaded ${processedEntries.length} bibliography entries from network`);
			}
		);
		
	} catch (error) {
		console.error('Error loading bibliography:', error);
		isLoading.set(false);
		loadingProgress.set(0);
	}
}


export function search(query: string) {
	if (!fuse || !query.trim()) {
		searchResults.set([]);
		return;
	}
	
	const results = fuse.search(query.trim()).slice(0, 50); // Limit to 50 results
	
	const searchResultsData: SearchResult[] = results.map(result => ({
		entry: result.item,
		score: result.score || 0,
		matches: result.matches?.map(match => match.key || '') || []
	}));
	
	searchResults.set(searchResultsData);
}

export function copyToClipboard(text: string): Promise<void> {
	if (navigator.clipboard && window.isSecureContext) {
		return navigator.clipboard.writeText(text);
	} else {
		// Fallback for older browsers
		const textArea = document.createElement('textarea');
		textArea.value = text;
		textArea.style.position = 'fixed';
		textArea.style.left = '-999999px';
		textArea.style.top = '-999999px';
		document.body.appendChild(textArea);
		textArea.focus();
		textArea.select();
		
		return new Promise((resolve, reject) => {
			if (document.execCommand('copy')) {
				resolve();
			} else {
				reject(new Error('Copy failed'));
			}
			document.body.removeChild(textArea);
		});
	}
}

export function formatForHayagriva(entry: BibEntry): string {
	// If we have the raw entry, use it directly
	if (entry.rawEntry) {
		return entry.rawEntry;
	}
	
	// Otherwise, reconstruct a basic BibTeX entry
	const type = entry.type || 'misc';
	let bibTeX = `@${type}{${entry.id}`;
	
	const fields: Array<[string, string]> = [];
	
	// Add fields in a reasonable order
	const fieldOrder = ['author', 'title', 'journal', 'booktitle', 'year', 'volume', 'number', 'pages', 'publisher', 'doi', 'url'];
	
	for (const field of fieldOrder) {
		if (entry[field] && entry[field].trim()) {
			fields.push([field, entry[field]]);
		}
	}
	
	// Add any other fields not in the standard order
	for (const [key, value] of Object.entries(entry)) {
		if (!fieldOrder.includes(key) && key !== 'id' && key !== 'type' && key !== 'rawEntry' && value && typeof value === 'string' && value.trim()) {
			fields.push([key, value]);
		}
	}
	
	if (fields.length > 0) {
		bibTeX += ',\n';
		bibTeX += fields.map(([key, value]) => `  ${key} = {${value}}`).join(',\n');
	}
	
	bibTeX += '\n}';
	return bibTeX;
}

