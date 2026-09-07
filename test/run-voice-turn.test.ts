import { describe, expect, it, vi } from 'vitest'

import { failed, succeeded } from '../src/domain/model/turn'
import { makeRunVoiceTurn } from '../src/domain/usecases/runVoiceTurn'
import type { AudioClip } from '../src/domain/ports/Transcriber'
import type { AgentReply } from '../src/domain/model/agent-reply'

const clip: AudioClip = { samples: new Float32Array(16_000), sampleRate: 16_000, heldMs: 1_000 }

const reply: AgentReply = {
  text: 'Added it to shopping.md.',
  notes: [{ name: 'shopping.md', status: 'edited' }],
  model: 'claude-haiku-4-5',
  sessionId: 'session-1',
  costUsd: 0.0004,
}

/** The second implementation of every port. Fakes here are the reason the ports exist. */
function ports(over: {
  transcript?: string
  transcribeFails?: boolean
  agentFails?: boolean
  speechFails?: boolean
} = {}) {
  const transcriber = {
    transcribe: vi.fn(async () =>
      over.transcribeFails === true
        ? failed<{ text: string; heldMs: number }>({
            kind: 'setup',
            what: 'model',
            hint: 'download the model',
          })
        : succeeded({ text: over.transcript ?? 'add milk to my shopping list', heldMs: 1_000 }),
    ),
  }
  const agent = {
    run: vi.fn(async () =>
      over.agentFails === true
        ? failed<AgentReply>({ kind: 'timeout', afterMs: 90_000 })
        : succeeded(reply),
    ),
  }
  const voice = {
    speak: vi.fn(async () =>
      over.speechFails === true
        ? failed<void>({ kind: 'setup', what: 'agent-cli', hint: 'no say binary' })
        : succeeded(undefined),
    ),
  }
  return { transcriber, agent, voice }
}

describe('runVoiceTurn', () => {
  it('carries audio through to a reply', async () => {
    const p = ports()
    const result = await makeRunVoiceTurn(p)(
      { clip, sessionId: null, speakReply: false },
      AbortSignal.timeout(1_000),
    )

    expect(result).toEqual({
      k: 'ok',
      value: {
        transcript: { text: 'add milk to my shopping list', heldMs: 1_000 },
        reply,
        speech: 'not-requested',
      },
    })
    expect(p.agent.run).toHaveBeenCalledWith(
      { text: 'add milk to my shopping list', sessionId: null },
      expect.anything(),
    )
  })

  it('shows the transcript before the agent is asked anything', async () => {
    const p = ports()
    const order: string[] = []
    p.agent.run.mockImplementation(async () => {
      order.push('agent')
      return succeeded(reply)
    })

    await makeRunVoiceTurn(p)(
      {
        clip,
        sessionId: null,
        speakReply: false,
        onTranscript: () => order.push('transcript'),
      },
      AbortSignal.timeout(1_000),
    )

    expect(order).toEqual(['transcript', 'agent'])
  })

  it('ends a silent clip without spending an agent call', async () => {
    const p = ports({ transcript: '  ...  ' })
    const result = await makeRunVoiceTurn(p)(
      { clip, sessionId: null, speakReply: false },
      AbortSignal.timeout(1_000),
    )

    expect(result).toEqual({ k: 'failed', failure: { kind: 'empty-speech' } })
    expect(p.agent.run).not.toHaveBeenCalled()
  })

  it('propagates a transcriber failure without reaching the agent', async () => {
    const p = ports({ transcribeFails: true })
    const result = await makeRunVoiceTurn(p)(
      { clip, sessionId: null, speakReply: false },
      AbortSignal.timeout(1_000),
    )

    expect(result).toMatchObject({ k: 'failed', failure: { kind: 'setup', what: 'model' } })
    expect(p.agent.run).not.toHaveBeenCalled()
  })

  it('propagates an agent failure', async () => {
    const p = ports({ agentFails: true })
    const result = await makeRunVoiceTurn(p)(
      { clip, sessionId: null, speakReply: false },
      AbortSignal.timeout(1_000),
    )

    expect(result).toMatchObject({ k: 'failed', failure: { kind: 'timeout' } })
  })

  it('still delivers the reply when the voice will not start', async () => {
    const p = ports({ speechFails: true })
    const result = await makeRunVoiceTurn(p)(
      { clip, sessionId: null, speakReply: true },
      AbortSignal.timeout(1_000),
    )

    // The answer is already on screen. Failing the turn here would throw it away.
    // 'unavailable' rather than 'not-requested': speech WAS asked for and could not be
    // produced. A boolean could not tell those apart.
    expect(result).toMatchObject({ k: 'ok', value: { speech: 'unavailable', reply } })
  })

  it('does not speak unless asked', async () => {
    const p = ports()
    await makeRunVoiceTurn(p)(
      { clip, sessionId: null, speakReply: false },
      AbortSignal.timeout(1_000),
    )
    expect(p.voice.speak).not.toHaveBeenCalled()
  })
})
