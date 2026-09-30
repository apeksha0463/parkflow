/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Share the workspace-root .env; only VITE_* variables are exposed to the browser.
  envDir: '../..',
  // Main chunk is react-dom + router (~175 kB gzip); map pages are lazy-loaded separately.
  build: { chunkSizeWarningLimit: 650 },
  server: {
    // Same-origin API in development (mirrors the production rewrite on the host).
    proxy: { '/api': 'http://localhost:4000', '/health': 'http://localhost:4000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.tsx'],
    css: false,
    testTimeout: 40_000,
  },
})
