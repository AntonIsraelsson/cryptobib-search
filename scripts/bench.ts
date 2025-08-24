// Bench script to run performance tests and measure query latency
// This should be run in a browser environment where the search index is available

const queries = [
	'aes',
	'elliptic curves',
	'"zero knowledge"',
	'rogaway',
	'bellare rogaway',
	'lattice signatures',
	'post-quantum',
	'nist 2015',
	'doi 10.1007',
	'acisp 2024',
	'cryptography',
	'encryption',
	'hash function',
	'digital signature',
	'rsa',
	'sha256',
	'public key',
	'symmetric',
	'block cipher'
];

export async function runBenchmarks() {
	// This function needs to be called from a browser environment
	// Import the SearchDB here to avoid Node.js issues
	const { SearchDB } = await import('../src/lib/search/db.js');

	console.log('Initializing search database...');
	const db = new SearchDB();
	await db.init();
	console.log('Database initialized.');

	const times: number[] = [];
	const results: { query: string; time: number; resultCount: number }[] = [];

	console.log(`Running ${queries.length} queries, 5 iterations each...`);

	for (let iteration = 0; iteration < 5; iteration++) {
		console.log(`Iteration ${iteration + 1}/5`);

		for (const query of queries) {
			const t0 = performance.now();
			const searchResults = await db.search(query, { limit: 50 });
			const t1 = performance.now();
			const time = t1 - t0;

			times.push(time);
			results.push({ query, time, resultCount: searchResults.length });
		}
	}

	// Calculate percentiles
	times.sort((a, b) => a - b);
	const p = (x: number) => times[Math.floor(times.length * x)];

	console.log('\n=== BENCHMARK RESULTS ===');
	console.log(`Total queries: ${times.length}`);
	console.log(`p50: ${p(0.5).toFixed(2)}ms`);
	console.log(`p75: ${p(0.75).toFixed(2)}ms`);
	console.log(`p90: ${p(0.9).toFixed(2)}ms`);
	console.log(`p95: ${p(0.95).toFixed(2)}ms`);
	console.log(`p99: ${p(0.99).toFixed(2)}ms`);
	console.log(`max: ${times[times.length - 1].toFixed(2)}ms`);
	console.log(`min: ${times[0].toFixed(2)}ms`);
	console.log(`avg: ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2)}ms`);

	console.log('\n=== INDIVIDUAL QUERY PERFORMANCE ===');
	const queryStats = new Map<string, number[]>();

	for (const result of results) {
		if (!queryStats.has(result.query)) {
			queryStats.set(result.query, []);
		}
		queryStats.get(result.query)!.push(result.time);
	}

	for (const [query, queryTimes] of queryStats.entries()) {
		queryTimes.sort((a, b) => a - b);
		const avg = queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length;
		const median = queryTimes[Math.floor(queryTimes.length / 2)];
		const sampleResult = results.find((r) => r.query === query);

		console.log(
			`"${query}": avg=${avg.toFixed(1)}ms, median=${median.toFixed(1)}ms, results=${sampleResult?.resultCount || 0}`
		);
	}

	db.destroy();

	return {
		totalQueries: times.length,
		p50: p(0.5),
		p75: p(0.75),
		p90: p(0.9),
		p95: p(0.95),
		p99: p(0.99),
		max: times[times.length - 1],
		min: times[0],
		avg: times.reduce((a, b) => a + b, 0) / times.length,
		queryStats: Array.from(queryStats.entries()).map(([query, queryTimes]) => ({
			query,
			avg: queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length,
			median: queryTimes[Math.floor(queryTimes.length / 2)],
			resultCount: results.find((r) => r.query === query)?.resultCount || 0
		}))
	};
}

// For use in browser console or test page
if (typeof window !== 'undefined') {
	(window as unknown as { runBenchmarks: typeof runBenchmarks }).runBenchmarks = runBenchmarks;
}
