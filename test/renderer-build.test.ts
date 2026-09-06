import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const OUT = join(process.cwd(), 'out/renderer/assets')

/**
 * Guards a defect that only exists in a BUILT app and is invisible in `npm run dev`.
 *
 * Vite inlines small assets as `data:` URLs. `audioWorklet.addModule()` is governed by
 * `script-src`, and the app's CSP is `script-src 'self'` with no `data:` — so an inlined
 * worklet is refused with "Unable to load a worklet's module" and push-to-talk silently never
 * records. Verified both ways in a real renderer under the real CSP before this test existed.
 */
describe.skipIf(!existsSync(OUT))('the built renderer', () => {
  const assets = readdirSync(OUT)

  it('emits the audio worklet as its own file rather than inlining it', () => {
    expect(assets.filter((name) => name.includes('pcm-worklet'))).not.toEqual([])
  })

  it('never references a worklet as a data: URL', () => {
    const bundles = assets.filter((name) => name.endsWith('.js'))
    const inlined = bundles.filter((name) =>
      /addModule\(\s*["']data:/.test(readFileSync(join(OUT, name), 'utf8')),
    )
    expect(inlined).toEqual([])
  })
})
