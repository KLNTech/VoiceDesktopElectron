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
  /** `false` when the policy let the app's own code run; a string is the error it raised. */
  cspBlocksApp: z.union([z.boolean(), z.string()]).nullable(),
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
      ['transcribe', 'ask', 'speak', 'appInfo', 'notes', 'openSettings', 'onTurnState'].toSorted(),
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
   * The production Content-Security-Policy is installed in the probe, because a policy is a
   * HEADER and therefore does not exist unless something serves it.
   *
   * The defect this is in front of has happened here: zod JIT-compiles object validators with
   * `new Function`, the policy has no `'unsafe-eval'`, and the preload parses inbound pushes
   * with one. Under Node — where `vitest` runs and eval is allowed — every test stayed green
   * while every IPC reply failed to parse inside the window.
   */
  it('runs the app\'s own code under the real policy, with no eval refused', () => {
    expect(seen.cspBlocksApp).toBe(false)
  })
})
