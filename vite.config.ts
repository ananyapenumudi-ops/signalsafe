/// <reference types="vitest/config" />
import { realpathSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

const cwd = process.cwd()

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // Allow the project's real path too: on redirected or symlinked folders the
  // worker URL resolves via the real path, which Vite would otherwise refuse.
  server: { fs: { allow: [searchForWorkspaceRoot(cwd), realpathSync.native(cwd)] } },
  test: { include: ['src/**/*.test.ts'] },
})
