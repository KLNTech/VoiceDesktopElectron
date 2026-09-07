import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppInfoRes, CH } from '../shared/ipc'
import { failed, succeeded } from '../src/domain/model/turn'
import type { Env, Ports } from '../src/main/composition-root'
import { AgentModel } from '../shared/agent-model'

/**
 * S4's acceptance criterion, on the main side: *"every inbound payload is parsed before it
 * reaches a use case"*.
 *
 * Nothing checked this. Delete the `safeParse` in a handler, or lose the 8 MB bound on the
 * audio buffer, and an oversized or malformed payload from — quoting the file's own comment —
 * *"the least-trusted process in the app"* goes straight through to a port, with every test
 * still green. The renderer is the least-trusted process precisely because one XSS in the app's
 * own UI is a compromised client, so the boundary deserves a gate rather than a comment.
 *
 * No Electron is launched: `ipcMain.handle` is a registry, so a ten-line fake collects the
 * handlers and each one is then called directly with the payload a hostile renderer would send.
 */
const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler)
    },
  },
  shell: { openExternal: (): Promise<void> => Promise.resolve() },
}))

const { registerIpcHandlers } = await import('../src/main/ipc')

const env: Env = {
  version: '0.0.0',
  stage: 'dev',
  notesDir: '/tmp/notes',
  agentBin: null,
  agentModel: succeeded(AgentModel.Haiku),
  agentModelRaw: 'haiku',
  skipLoginCheck: true,
  whisperBin: null,
  whisperModel: '/tmp/model.bin',
  sayBin: null,
  sayVoice: undefined,
}

/** Records whether a port was reached at all — the thing a missing guard would let happen. */
const reached = { transcribe: 0, ask: 0, speak: 0 }

const ports: Ports = {
  transcriber: {
    transcribe: async () => {
      reached.transcribe += 1
      return succeeded({ text: 'hello', heldMs: 1_000 })
    },
  },
  agent: {
    run: async () => {
      reached.ask += 1
      return failed({ kind: 'agent-failed', stderr: 'not today' })
    },
  },
  voice: {
    speak: async () => {
      reached.speak += 1
      return succeeded(undefined)
    },
  },
  notes: { list: async () => [] },
}

function call(channel: string, payload: unknown): Promise<unknown> {
  const handler = handlers.get(channel)
  if (handler === undefined) throw new Error(`no handler registered for ${channel}`)
  return handler({}, payload)
}

describe('what main accepts from the renderer', () => {
  beforeEach(() => {
    handlers.clear()
    reached.transcribe = 0
    reached.ask = 0
    reached.speak = 0
    registerIpcHandlers(env, ports)
  })

  it('registers a handler for every request channel, and none beyond them', () => {
    // The silent pass this guards: if registration changed shape, every assertion below would
    // be testing a handler map that does not describe the app.
    //
    // Every channel is a request→reply channel now. `CH.state` used to be the exception — the
    // one message main PUSHED — and it was filtered out here; it has since been deleted, because
    // it had no sender and no subscriber (`shared/ipc.ts` records why). No filter, so a channel
    // added without a handler reddens instead of being quietly excused.
    expect([...handlers.keys()].toSorted()).toEqual(Object.values(CH).toSorted())
  })

  it('refuses an oversized audio buffer WITHOUT reaching the transcriber', async () => {
    // The bound that matters: an unbounded ArrayBuffer from a renderer is a memory bug, and
    // the point is that the port is never called, not merely that the reply is a failure.
    const tooBig = { pcm: new ArrayBuffer(9 * 1024 * 1024), sampleRate: 16_000, heldMs: 1_000 }

    expect(await call(CH.transcribe, tooBig)).toMatchObject({
      k: 'failed',
      failure: { kind: 'transcribe-failed' },
    })
    expect(reached.transcribe).toBe(0)
  })

  it('accepts a buffer inside the bound, and does reach the transcriber', async () => {
    // The other half: a guard that refuses everything passes the test above and breaks the app.
    const ok = { pcm: new ArrayBuffer(1_024), sampleRate: 48_000, heldMs: 1_000 }

    expect(await call(CH.transcribe, ok)).toMatchObject({ k: 'ok' })
    expect(reached.transcribe).toBe(1)
  })

  it('refuses a sample rate outside what any real device reports', async () => {
    const absurd = { pcm: new ArrayBuffer(1_024), sampleRate: 5, heldMs: 1_000 }

    expect(await call(CH.transcribe, absurd)).toMatchObject({ k: 'failed' })
    expect(reached.transcribe).toBe(0)
  })

  it.each([
    ['a number where the payload should be', 42],
    ['null', null],
    ['a missing field', { sampleRate: 16_000, heldMs: 1 }],
    ['the wrong type for pcm', { pcm: 'not audio', sampleRate: 16_000, heldMs: 1 }],
  ])('refuses %s without reaching the transcriber', async (_label, payload) => {
    expect(await call(CH.transcribe, payload)).toMatchObject({ k: 'failed' })
    expect(reached.transcribe).toBe(0)
  })

  it('refuses an empty prompt and one past the length bound, without reaching the agent', async () => {
    expect(await call(CH.ask, { text: '', sessionId: null })).toMatchObject({ k: 'failed' })
    expect(await call(CH.ask, { text: 'x'.repeat(4_001), sessionId: null })).toMatchObject({
      k: 'failed',
    })
    expect(reached.ask).toBe(0)
  })

  it('passes a well-formed ask through to the agent', async () => {
    await call(CH.ask, { text: 'add milk', sessionId: null })
    expect(reached.ask).toBe(1)
  })

  it('refuses a malformed speak request without reaching the synthesizer', async () => {
    expect(await call(CH.speak, { text: 42 })).toMatchObject({ k: 'failed' })
    expect(reached.speak).toBe(0)
  })

  it('reports the configured model verbatim, so the readout cannot invent one', async () => {
    const info = await call(CH.appInfo, undefined)
    expect(info).toMatchObject({ agentModel: 'haiku', version: '0.0.0' })
  })

  it('answers app info with a notices table that has real versions in it', async () => {
    // Parsed rather than asserted: the handler's reply is the thing under test, so claiming a
    // shape for it with `as` would be asserting exactly what should be checked.
    const info = AppInfoRes.parse(await call(CH.appInfo, undefined))
    const notices = info.notices

    expect(notices.length).toBeGreaterThan(0)
    // Built from `process.versions` and installed manifests, so this is the check that the
    // about sheet is reporting rather than reciting.
    const node = notices.find((notice) => notice.name === 'Node.js')
    expect(node?.version).toBe(process.versions.node)
  })
})
