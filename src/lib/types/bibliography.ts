export interface BibEntry {
	id: string;
	type: string;
	rawEntry?: string; // Original BibTeX entry for hayagriva format
	title?: string;
	author?: string;
	year?: string;
	journal?: string;
	booktitle?: string;
	pages?: string;
	volume?: string;
	number?: string;
	doi?: string;
	url?: string;
	note?: string;
	publisher?: string;
	series?: string;
	editor?: string;
	organization?: string;
	address?: string;
	month?: string;
	isbn?: string;
	[key: string]: any;
}

export interface SearchResult {
	entry: BibEntry;
	score: number;
	matches: string[];
}