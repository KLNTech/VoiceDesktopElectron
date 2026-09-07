import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { CH } from '../shared/ipc'

/**
 * S4's acceptance criterion, checked rather than assumed: "the renderer can reach exactly the
 * five declared messages and nothing else; `ipcRenderer` is not exposed."
 *
 * It launches real Electron because nothing less can see the defect it exists for. A sandboxed
 * preload has no module resolver, so a dependency left external fails at load with "module not
 * found" — the preload typechecks, bundles, and silently never runs, `window.voicedesk` is
 * `undefined`, and every call throws. That shipped here, and presented as an interface stuck
 * in "transcribing" for ever rather than as an error.
 */
const require_ = createRequire(import.meta.url)
const repoRoot = process.cwd()

/** `require('electron')` in Node resolves to the binary's path, not the module. */
const electronBinary = z.string().min(1).parse(require_('electron'))

const Probe = z.object({
  bridgeType: z.string(),
  methods: z.array(z.string()),
  ipcRendererLeaked: z.boolean(),
  nodeLeaked: z.boolean(),
  preloadErrors: z.array(z.string()),
  /** `true` when the reply came back from the real main process, over the real channel. */
  roundTrip: z.boolean().nullable(),
  roundTripError: z.string().nullable(),
})
type Probe = z.infer<typeof Probe>

function probe(): Probe {
  const stdout = execFileSync(
    electronBinary,
    [join(repoRoot, 'test/fixtures/bridge-probe.cjs'), repoRoot],
    { encoding: 'utf8', timeout: 90_000, env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } },
  )
  const line = stdout.split('\n').find((l) => l.startsWith('PROBE '))
  if (line === undefined) throw new Error(`probe produced no report:\n${stdout}`)
  return Probe.parse(JSON.parse(line.slice('PROBE '.length)))
}

describe('the preload bridge, in a real sandboxed renderer', () => {
  const seen = probe()

  it('loads at all', () => {
    // The failure this test was written for: the preload throws before exposing anything.
    expect(seen.preloadErrors).toEqual([])
    expect(seen.bridgeType).toBe('object')
  })

  it('exposes exactly one named method per declared channel, and nothing else', () => {
    expect(seen.methods).toEqual(
      ['transcribe', 'ask', 'speak', 'appInfo', 'notes', 'micAccess', 'openSettings'].toSorted(),
    )
    // The bridge must stay enumerable: one method per message, no more.
    expect(seen.methods).toHaveLength(Object.keys(CH).length)
  })

  it('leaks neither ipcRenderer nor Node into the page', () => {
    expect(seen.ipcRendererLeaked).toBe(false)
    expect(seen.nodeLeaked).toBe(false)
  })

  /**
   * S10's acceptance criterion: *"something in this project executes in the renderer, so a CSP
   * or preload-wiring defect has a gate in front of it."*
   *
   * The round trip is the half a unit test cannot reach. Renderer → preload → `ipcMain.handle`
   * → back, over a real channel, in a real sandboxed page: every layer of the wiring at once,
   * and the only test in the suite that fails if any of them is disconnected.
   */
  it('completes a round trip across the real IPC seam', () => {
    expect(seen.roundTripError).toBeNull()
    expect(seen.roundTrip).toBe(true)
  })

  /**
   * Everything above happens under the PRODUCTION Content-Security-Policy, which the probe
   * installs because a policy is a header and therefore does not exist unless something serves
   * it. A policy that refused the app's own code shows up here as a preload error or a failed
   * round trip.
   *
   * **What stopped being covered when the `turn:state` channel was deleted**, recorded rather
   * than left implied: this file used to assert specifically that zod's `new Function` was not
   * refused under a policy with no `'unsafe-eval'` — the preload JIT-compiled a validator every
   * time it parsed an inbound push. With the push gone, the preload no longer parses anything in
   * the renderer process, so that particular eval no longer happens and the assertion had
   * nothing left to assert. If a future change makes the preload parse in the page again, the
   * check that eval survives the policy has to come back with it; nothing here will notice on
   * its own.
   */
  it('loads the page and the bridge under the real policy', () => {
    expect(seen.preloadErrors).toEqual([])
    expect(seen.roundTrip).toBe(true)
  })
})
