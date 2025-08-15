import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	define: {
		global: 'globalThis'
	},
	build: {
		target: 'esnext',
		rollupOptions: {
			output: {
				manualChunks: {
					// Separate vendor chunks for better caching
					'search-vendor': ['fuse.js'],
					'bibtex-vendor': ['bibtex-parse-js']
				}
			}
		},
		// Enable source maps for better debugging but keep them separate
		sourcemap: false,
		// Minimize CSS
		cssMinify: true,
		// Enable minification
		minify: 'esbuild'
	},
	server: {
		fs: {
			allow: ['..']
		}
	},
	optimizeDeps: {
		include: ['fuse.js', 'bibtex-parse-js']
	}
});