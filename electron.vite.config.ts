import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
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
    /*
     * The preload must be SELF-CONTAINED.
     *
     * It runs sandboxed, and a sandboxed preload has no module resolver: `require` there
     * reaches Electron's own builtins and nothing else. electron-vite externalises everything
     * in `dependencies` by default — right for main, fatal here. Left external, `zod` (pulled
     * in through `shared/ipc.ts`) fails at load with "module not found", so
     * `contextBridge.exposeInMainWorld` never runs and the page sees
     * `window.voicedesk === undefined`. Every bridge call then throws on `undefined`, which
     * presents as a hang rather than an error.
     */
    plugins: [externalizeDepsPlugin({ exclude: ['zod'] })],
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
      /*
       * The AudioWorklet must be emitted as a FILE, never inlined.
       *
       * Vite inlines small assets as `data:` URLs, and `audioWorklet.addModule()` is governed
       * by `script-src`. Our CSP is `script-src 'self'` with no `data:`, so an inlined worklet
       * is blocked — silently, with no error the page can catch, and push-to-talk simply never
       * records. Emitting it keeps the strict CSP and the working app.
       */
      assetsInlineLimit: (filePath: string) => !filePath.endsWith('pcm-worklet.js'),
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [react()],
  },
})
