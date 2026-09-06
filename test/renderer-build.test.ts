import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const OUT = join(process.cwd(), 'out/renderer/assets')

/**
 * Guards a defect that exists only in a BUILT app and is invisible in `npm run dev`.
 *
 * Vite inlines small assets as `data:` URLs. `audioWorklet.addModule()` is governed by
 * `script-src`, and the app's CSP is `script-src 'self'` with no `data:` — so an inlined
 * worklet is refused with "Unable to load a worklet's module" and push-to-talk silently never
 * records. Verified both ways in a real renderer under the real CSP.
 *
 * This suite deliberately does NOT skip when the build is missing. It used to, via
 * `describe.skipIf`, which does not work: Vitest still runs the suite body to collect tests, so
 * the eager `readdirSync` threw ENOENT and the whole FILE failed on any checkout that had not
 * been built. `npm test` now builds first, so the build is always there to inspect.
 */
describe('the built renderer', () => {
  it('has a build to inspect at all', () => {
    // The scan's own failure mode, asserted first: a gate that inspects nothing passes
    // everything. `npm test` runs the build before vitest precisely so this cannot happen.
    expect(existsSync(OUT), `no build at ${OUT} — run \`npm run build\``).toBe(true)
    expect(readdirSync(OUT).length).toBeGreaterThan(0)
  })

  it('emits the audio worklet as its own file rather than inlining it', () => {
    expect(readdirSync(OUT).filter((name) => name.includes('pcm-worklet'))).not.toEqual([])
  })

  it('never references a worklet as a data: URL', () => {
    const inlined = readdirSync(OUT)
      .filter((name) => name.endsWith('.js'))
      .filter((name) => /addModule\(\s*["']data:/.test(readFileSync(join(OUT, name), 'utf8')))
    expect(inlined).toEqual([])
  })
})
