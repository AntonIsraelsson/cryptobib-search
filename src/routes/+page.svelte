<script lang="ts">
	import SearchInterface from '$lib/components/SearchInterface.svelte';
</script>

<svelte:head>
	<title>CryptoBib Search - Fast Cryptography Bibliography Search</title>
	<meta name="description" content="Fast and efficient search for cryptography bibliography entries. Search through thousands of crypto research papers, conferences, and journals instantly." />
	<meta name="keywords" content="cryptography, bibliography, search, crypto, research papers, IACR, cryptobib" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	
	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="website" />
	<meta property="og:title" content="CryptoBib Search - Fast Cryptography Bibliography Search" />
	<meta property="og:description" content="Fast and efficient search for cryptography bibliography entries. Search through thousands of crypto research papers instantly." />
	
	<!-- Twitter -->
	<meta property="twitter:card" content="summary_large_image" />
	<meta property="twitter:title" content="CryptoBib Search - Fast Cryptography Bibliography Search" />
	<meta property="twitter:description" content="Fast and efficient search for cryptography bibliography entries. Search through thousands of crypto research papers instantly." />
	
	<!-- Preload critical resources -->
	<link rel="preload" href="/bibliography.json" as="fetch" crossorigin="anonymous" />
	
	<!-- Performance optimizations -->
	<link rel="dns-prefetch" href="//cryptobib.di.ens.fr" />
	
	<!-- Structured data for search engines -->
	<script type="application/ld+json">
	{
		"@context": "https://schema.org",
		"@type": "WebApplication",
		"name": "CryptoBib Search",
		"description": "Fast and efficient search for cryptography bibliography entries",
		"url": "https://yourusername.github.io/cryptobib-search",
		"applicationCategory": "EducationalApplication",
		"operatingSystem": "Any",
		"browserRequirements": "Requires JavaScript. Requires HTML5.",
		"softwareVersion": "1.0",
		"author": {
			"@type": "Person",
			"name": "Your Name"
		}
	}
	</script>
</svelte:head>

<SearchInterface />