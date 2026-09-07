import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { RollupLog } from 'rollup'

import pkg from './package.json' with { type: 'json' }

/**
 * Silences one third-party warning, and nothing else.
 *
 * Every build prints two copies of this, from `zod/v4/core/regexes.js` and
 * `zod/v4/core/util.js`: *"contains an annotation that Rollup cannot interpret due to the
 * position of the comment"*. Zod annotates a few initializers with `@__PURE__` so esbuild can
 * tree-shake them, and puts an explanatory JSDoc block between the annotation and the
 * expression — a position esbuild accepts and Rollup does not. Rollup then says what it is
 * going to do about it: *"The comment will be removed to avoid issues"*. Nothing is broken.
 *
 * **Why this is not fixed where it is written.** The obvious move is to edit that comment in
 * `node_modules/`. It would work, and it would last exactly until the next `npm ci` — which is
 * every clean install, every CI run and `npm run verify:clone`, whose entire job is to prove the
 * repository does not depend on anything that only exists on this machine. An edit there is a
 * local difference that the clone check is designed to catch.
 *
 * So the warning is filtered here, narrowly: only this code, and only for files inside
 * `node_modules`. A warning about OUR code with the same code still prints, which is the
 * property that makes this a filter rather than a mute button.
 */
function ignoreThirdPartyAnnotations(
  warning: RollupLog,
  warn: (warning: RollupLog) => void,
): void {
  const fromDependency = warning.id?.includes('node_modules') === true
  if (warning.code === 'INVALID_ANNOTATION' && fromDependency) return
  warn(warning)
}

/**
 * Three build outputs, one per process, because they are three different runtimes with three
 * different privilege levels (see `docs/PLAN.md` §3). The version is injected at build time
 * rather than fetched over IPC: it is a constant of the build, and giving it a channel would
 * put a message on the bridge that carries no runtime information (§9).
 */
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        onwarn: ignoreThirdPartyAnnotations,
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        onwarn: ignoreThirdPartyAnnotations,
      },
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
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
        onwarn: ignoreThirdPartyAnnotations,
      },
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
