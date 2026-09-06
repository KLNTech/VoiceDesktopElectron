/*
 * Put the Electron binary on disk, because nothing else will.
 *
 * Electron 44 publishes no install script of its own: `npm view electron@44.2.0 scripts` is
 * empty. The binary is fetched lazily, the first time `require('electron')` runs. That is fine
 * for code that requires Electron — and useless for the tooling that starts it, because
 * `electron-vite` reads `node_modules/electron/path.txt` directly and never goes through
 * `require`. So after a clean `npm ci`, `npm run dev` dies with:
 *
 *     Error: Electron uninstall
 *         at getElectronPath (.../electron-vite/dist/chunks/lib-*.js)
 *
 * which is the tool reporting a missing file, not a broken version. Running Electron's own
 * installer here restores the invariant every downstream tool assumes: once install finishes,
 * the binary exists. This is the difference between "it runs on a clean machine following your
 * README" and "it runs on the machine that happened to require Electron once".
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve from this file, not the working directory: npm may run lifecycle scripts from
// anywhere, and a relative path that happens to work locally is a defect waiting for CI.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const marker = join(repoRoot, 'node_modules/electron/path.txt')
const installer = join(repoRoot, 'node_modules/electron/install.js')

// A production-only install has no Electron and needs none; already-installed needs nothing.
if (existsSync(marker) || !existsSync(installer)) {
  process.exit(0)
}

console.log('postinstall: fetching the Electron binary (Electron 44 ships no install script)')
// Spawned, not imported: `install.js` is an executable CommonJS script with a shebang, and
// this is how npm itself would have run it.
const { status } = spawnSync(process.execPath, [installer], { stdio: 'inherit', cwd: repoRoot })
process.exit(status ?? 1)
