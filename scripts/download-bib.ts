#!/usr/bin/env bun

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const BIBLIOGRAPHY_URLS = [
	'https://cryptobib.di.ens.fr/cryptobib/static/files/abbrev0.bib',
	'https://cryptobib.di.ens.fr/cryptobib/static/files/crypto_crossref.bib'
];

interface BibEntry {
	id: string;
	type: string;
	[key: string]: any;
}

async function downloadFile(url: string): Promise<string> {
	console.log(`Downloading ${url}...`);
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download ${url}: ${response.statusText}`);
	}
	return await response.text();
}

function parseBibTeX(content: string): BibEntry[] {
	const entries: BibEntry[] = [];
	
	// Simple BibTeX parser - matches @type{id, fields}
	const entryRegex = /@(\w+)\s*\{\s*([^,\s]+)\s*,\s*([\s\S]*?)\n\}/gm;
	let match;
	
	while ((match = entryRegex.exec(content)) !== null) {
		const [, type, id, fieldsStr] = match;
		const entry: BibEntry = { id: id.trim(), type: type.toLowerCase() };
		
		// Parse fields
		const fieldRegex = /(\w+)\s*=\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}|(\w+)\s*=\s*"([^"]*)"/g;
		let fieldMatch;
		
		while ((fieldMatch = fieldRegex.exec(fieldsStr)) !== null) {
			const fieldName = (fieldMatch[1] || fieldMatch[3]).toLowerCase();
			const fieldValue = (fieldMatch[2] || fieldMatch[4])
				.replace(/\s+/g, ' ')
				.replace(/\{([^{}]*)\}/g, '$1')
				.trim();
			entry[fieldName] = fieldValue;
		}
		
		entries.push(entry);
	}
	
	return entries;
}

async function main() {
	try {
		console.log('Starting bibliography download and processing...');
		
		let allEntries: BibEntry[] = [];
		
		for (const url of BIBLIOGRAPHY_URLS) {
			const content = await downloadFile(url);
			const entries = parseBibTeX(content);
			console.log(`Parsed ${entries.length} entries from ${url}`);
			allEntries = allEntries.concat(entries);
		}
		
		// Remove duplicates by id
		const uniqueEntries = Array.from(
			new Map(allEntries.map(entry => [entry.id, entry])).values()
		);
		
		console.log(`Total unique entries: ${uniqueEntries.length}`);
		
		// Ensure static directory exists
		const staticDir = join(process.cwd(), 'static');
		if (!existsSync(staticDir)) {
			mkdirSync(staticDir, { recursive: true });
		}
		
		// Write to static directory for client-side access
		const outputPath = join(staticDir, 'bibliography.json');
		writeFileSync(outputPath, JSON.stringify(uniqueEntries, null, 2));
		
		console.log(`Bibliography data written to ${outputPath}`);
		console.log('Download and processing complete!');
		
	} catch (error) {
		console.error('Error:', error);
		process.exit(1);
	}
}

main();