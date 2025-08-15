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
				manualChunks: (id) => {
					// Only chunk modules that are actually bundled, not external
					if (id.includes('node_modules')) {
						if (id.includes('fuse.js')) {
							return 'search-vendor';
						}
						if (id.includes('bibtex-parse-js')) {
							return 'bibtex-vendor';
						}
						return 'vendor';
					}
				}
			}
		},
		sourcemap: false,
		cssMinify: true,
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