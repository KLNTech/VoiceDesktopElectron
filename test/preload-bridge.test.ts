import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

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
const electronBinary = require_('electron') as unknown as string
const repoRoot = process.cwd()

interface Probe {
  bridgeType: string
  methods: string[]
  ipcRendererLeaked: boolean
  nodeLeaked: boolean
  preloadErrors: string[]
}

function probe(): Probe {
  const stdout = execFileSync(
    electronBinary,
    [join(repoRoot, 'test/fixtures/bridge-probe.cjs'), repoRoot],
    { encoding: 'utf8', timeout: 90_000, env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } },
  )
  const line = stdout.split('\n').find((l) => l.startsWith('PROBE '))
  if (line === undefined) throw new Error(`probe produced no report:\n${stdout}`)
  return JSON.parse(line.slice('PROBE '.length)) as Probe
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
      ['transcribe', 'ask', 'speak', 'appInfo', 'onTurnState'].sort(),
    )
    // The bridge must stay enumerable: one method per message, no more.
    expect(seen.methods).toHaveLength(Object.keys(CH).length)
  })

  it('leaks neither ipcRenderer nor Node into the page', () => {
    expect(seen.ipcRendererLeaked).toBe(false)
    expect(seen.nodeLeaked).toBe(false)
  })
})
