import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

import pkg from './package.json' with { type: 'json' }

/**
 * Three build outputs, one per process, because they are three different runtimes with three
 * different privilege levels (see `docs/PLAN.md` §3). The version is injected at build time
 * rather than fetched over IPC: it is a constant of the build, and giving it a channel would
 * put a message on the bridge that carries no runtime information (§9).
 */
export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
  },
  preload: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [react()],
  },
})
