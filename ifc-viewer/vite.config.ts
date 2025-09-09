import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
	plugins: [react()],
	server: {
		host: '127.0.0.1',
		port: 5173,
		headers: {
			'Cross-Origin-Embedder-Policy': 'require-corp',
			'Cross-Origin-Opener-Policy': 'same-origin',
		},
	},
	preview: {
		host: '127.0.0.1',
		port: 4173,
		headers: {
			'Cross-Origin-Embedder-Policy': 'require-corp',
			'Cross-Origin-Opener-Policy': 'same-origin',
		},
	},
	assetsInclude: ['**/*.wasm'],
	build: {
		rollupOptions: {
			output: {
				assetFileNames: (assetInfo) => {
					if (assetInfo.name && assetInfo.name.endsWith('.wasm')) {
						return 'assets/[name][extname]'
					}
					return 'assets/[name]-[hash][extname]'
				},
			},
		},
	},
})
