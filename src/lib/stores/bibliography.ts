import { writable } from 'svelte/store';
import Fuse from 'fuse.js';
import type { BibEntry, SearchResult } from '../types/bibliography.js';

export const bibliography = writable<BibEntry[]>([]);
export const searchResults = writable<SearchResult[]>([]);
export const isLoading = writable(false);
export const isSearching = writable(false);
export const searchQuery = writable('');
export const hasSearched = writable(false);

let fuse: Fuse<BibEntry> | null = null;
let bibliographyData: BibEntry[] = [];
let isDataLoaded = false;

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

// Lazy load bibliography data only when needed
async function ensureDataLoaded(): Promise<void> {
	if (isDataLoaded) return;
	
	isLoading.set(true);
	
	try {
		const response = await fetch('/bibliography.json');
		if (!response.ok) throw new Error('Failed to load bibliography');
		
		bibliographyData = await response.json();
		fuse = new Fuse(bibliographyData, fuseOptions);
		bibliography.set(bibliographyData);
		isDataLoaded = true;
		
		console.log(`Loaded ${bibliographyData.length} bibliography entries`);
	} catch (error) {
		console.error('Error loading bibliography:', error);
		throw error;
	} finally {
		isLoading.set(false);
	}
}

export async function search(query: string) {
	if (!query.trim()) {
		searchResults.set([]);
		hasSearched.set(false);
		return;
	}
	
	isSearching.set(true);
	hasSearched.set(true);
	
	try {
		// Ensure data is loaded before searching
		await ensureDataLoaded();
		
		if (!fuse) {
			searchResults.set([]);
			return;
		}
		
		const results = fuse.search(query.trim()).slice(0, 50);
		
		const searchResultsData: SearchResult[] = results.map(result => ({
			entry: result.item,
			score: result.score || 0,
			matches: result.matches?.flatMap(match => 
				match.indices?.map(() => match.value || '') || []
			) || []
		}));
		
		searchResults.set(searchResultsData);
	} catch (error) {
		console.error('Search error:', error);
		searchResults.set([]);
	} finally {
		isSearching.set(false);
	}
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
	if (entry.rawEntry) {
		return entry.rawEntry;
	}
	
	const type = entry.type || 'misc';
	let bibTeX = `@${type}{${entry.id}`;
	
	const fields: Array<[string, string]> = [];
	const fieldOrder = ['author', 'title', 'journal', 'booktitle', 'year', 'volume', 'number', 'pages', 'publisher', 'doi', 'url'];
	
	for (const field of fieldOrder) {
		if (entry[field] && entry[field].trim()) {
			fields.push([field, entry[field]]);
		}
	}
	
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