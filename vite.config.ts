/// <reference types="vitest/config" />
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

const cwd = process.cwd()

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // Two pages: the 3D landing page and the workbench (three.js stays out of the bench bundle)
  build: { rollupOptions: { input: { main: resolve(cwd, 'index.html'), bench: resolve(cwd, 'bench.html') } } },
  // Allow the project's real path too: on redirected or symlinked folders the
  // worker URL resolves via the real path, which Vite would otherwise refuse.
  server: { fs: { allow: [searchForWorkspaceRoot(cwd), realpathSync.native(cwd)] } },
  test: { include: ['src/**/*.test.ts'] },
})
