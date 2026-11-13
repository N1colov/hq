import { defineConfig } from 'vite'

// Relative base so the build works from GitHub Pages (/hq/) or inside an .ehpk.
export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  build: { target: 'es2020', outDir: 'dist' },
})
