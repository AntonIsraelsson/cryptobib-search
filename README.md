# CryptoBib Search

A fast, client-side search interface for the [CryptoBib](https://cryptobib.di.ens.fr/) cryptography bibliography database. Search through thousands of cryptography research papers, conferences, and journals instantly.

## Features

- **Fast Search**: Client-side fuzzy search with instant results
- **Comprehensive Database**: Built from CryptoBib's extensive collection
- **Copy Citations**: One-click BibTeX copying for your papers
- **Responsive Design**: Works seamlessly on desktop and mobile
- **No Backend Required**: Fully static, hosted on GitHub Pages

## Live Demo

Visit [antonisraelsson.github.io/cryptobib-search](https://antonisraelsson.github.io/cryptobib-search) to try it out.

## Tech Stack

- **Frontend**: [SvelteKit](https://kit.svelte.dev/) with TypeScript
- **Search**: [Fuse.js](https://fusejs.io/) for fuzzy searching
- **Hosting**: GitHub Pages with automatic deployment
- **Build Tool**: [Vite](https://vitejs.dev/) with [Bun](https://bun.sh/)

## Data Source

Bibliography data is automatically downloaded and processed from:
- [CryptoBib](https://cryptobib.di.ens.fr/) - The premier cryptography bibliography database
- Specifically from their BibTeX exports: `abbrev0.bib` and `crypto_crossref.bib`

The data is refreshed on every deployment to ensure you always have the latest entries.

## Development

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Build for production
bun run build
```

The bibliography data is automatically downloaded during the build process, so no manual setup is required.

## License

MIT License - see the source code for details.

Data is sourced from CryptoBib under their terms of use.