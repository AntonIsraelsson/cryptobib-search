import { writeFile, mkdir } from 'fs/promises';
import { spawn } from 'child_process';

const CRYPTOBIB = 'https://cryptobib.di.ens.fr/cryptobib/static/files/crypto.bib';
const ABBREV0 = 'https://cryptobib.di.ens.fr/cryptobib/static/files/abbrev0.bib';

async function download(url: string) {
	const r = await fetch(url);
	if (!r.ok) throw new Error('Failed to download ' + url);
	return await r.text();
}

async function runHayagriva(bibPath: string, outYaml: string) {
	// Hayagriva CLI command
	// hayagriva input.bib > output.yaml
	await new Promise<void>((resolve, reject) => {
		const command = `hayagriva "${bibPath}" > "${outYaml}"`;
		const p = spawn(command, { stdio: 'inherit', shell: true });

		p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('hayagriva exit ' + code))));
		p.on('error', (err) => reject(new Error(`Failed to start hayagriva: ${err.message}`)));
	});
}

async function main() {
	// Ensure data directory exists
	await mkdir('data', { recursive: true });

	console.log('Downloading CryptoBib files...');
	const crypto = await download(CRYPTOBIB);
	const abbrev = await download(ABBREV0);

	// Concatenate so abbreviations resolve correctly
	const concatenated = abbrev + '\n\n' + crypto;
	await writeFile('data/cryptobib+abbrev.bib', concatenated, 'utf8');
	console.log('Concatenated BibTeX files saved to data/cryptobib+abbrev.bib');

	console.log('Converting to Hayagriva YAML...');
	await runHayagriva('data/cryptobib+abbrev.bib', 'data/cryptobib.yaml');
	console.log('Converted to data/cryptobib.yaml');
}

main().catch((e) => {
	console.error('Error:', e.message);
	process.exit(1);
});
