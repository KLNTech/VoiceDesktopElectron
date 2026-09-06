import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { WhisperCppTranscriber } from '../src/infrastructure/transcribe/WhisperCppTranscriber'
import { resolveBinary } from '../src/infrastructure/process/resolveBinary'

/**
 * The one test in this project that runs the real speech pipeline: macOS `say` produces an
 * utterance, and `whisper-cli` has to turn it back into words. It skips rather than fails where
 * the binary or the model is absent, because those are the user's install steps, not a defect.
 */
const whisperBin = resolveBinary('whisper-cli', process.env['VOICEDESK_WHISPER_BIN'])
const modelPath = process.env['VOICEDESK_WHISPER_MODEL'] ?? join(homedir(), '.whisper/ggml-base.en.bin')
const sayBin = resolveBinary('say', undefined)
const ready = whisperBin !== null && sayBin !== null && existsSync(modelPath)

const work = mkdtempSync(join(tmpdir(), 'voicedesk-test-'))
afterAll(() => rmSync(work, { recursive: true, force: true }))

/**
 * Decodes the 16-bit mono WAV `say` writes back into the Float32 the capture path produces.
 *
 * The chunks are walked rather than assumed: `say` emits `JUNK` (28 bytes) and `FLLR` (4008
 * bytes) before `fmt `, so the familiar "header is 44 bytes, rate lives at offset 24" shortcut
 * reads a sample rate of 0 here and starts the audio 4 KB late.
 */
function readWavAsFloat32(path: string): { samples: Float32Array; sampleRate: number } {
  const bytes = readFileSync(path)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4))

  let sampleRate = 0
  let dataAt = -1
  let dataBytes = 0

  let pos = 12 // past "RIFF" + size + "WAVE"
  while (pos + 8 <= bytes.byteLength) {
    const id = ascii(pos)
    const size = view.getUint32(pos + 4, true)
    if (id === 'fmt ') sampleRate = view.getUint32(pos + 12, true)
    if (id === 'data') {
      dataAt = pos + 8
      dataBytes = size
      break
    }
    pos += 8 + size + (size % 2) // chunks are word-aligned
  }
  if (sampleRate === 0 || dataAt < 0) throw new Error(`unreadable wav: ${path}`)

  const count = Math.floor(Math.min(dataBytes, bytes.byteLength - dataAt) / 2)
  const samples = new Float32Array(count)
  for (let i = 0; i < count; i += 1) samples[i] = view.getInt16(dataAt + i * 2, true) / 0x8000
  return { samples, sampleRate }
}

describe.skipIf(!ready)('WhisperCppTranscriber, against the real binary', () => {
  it('turns spoken words back into text, with no key, account or network', async () => {
    const spoken = join(work, 'said.wav')
    // The suite only runs when these resolved; narrow rather than assert it.
    if (sayBin === null || whisperBin === null) throw new Error('unreachable: guarded by skipIf')
    execFileSync(sayBin, [
      '-o', spoken,
      '--data-format=LEI16@16000',
      'add milk to my shopping list',
    ])

    const { samples, sampleRate } = readWavAsFloat32(spoken)
    const transcriber = new WhisperCppTranscriber(whisperBin, modelPath)
    const result = await transcriber.transcribe(
      { samples, sampleRate, heldMs: 2_000 },
      AbortSignal.timeout(60_000),
    )

    expect(result.k).toBe('ok')
    if (result.k !== 'ok') return
    // What is asserted is the PIPELINE — Float32 → WAV → whisper → parsed text — not the
    // model's accuracy, which is not this project's code. On this machine the default
    // `base.en` hears "Ade de Milc tome shop ting cholist" from the synthetic `say` voice,
    // while `large-v3-turbo` returns "Add the Milk to my shopping list." exactly. Asserting
    // the word "milk" would therefore fail on the model the README installs by default.
    expect(result.value.text.trim().length).toBeGreaterThan(0)
    expect(result.value.text.trim().split(/\s+/).length).toBeGreaterThanOrEqual(3)
    expect(result.value.heldMs).toBe(2_000)
  }, 90_000)

  it('reports a missing model as a setup failure naming the fix, not as a failed transcription', async () => {
    const transcriber = new WhisperCppTranscriber(whisperBin, join(work, 'no-such-model.bin'))
    const result = await transcriber.transcribe(
      { samples: new Float32Array(1_600), sampleRate: 16_000, heldMs: 100 },
      AbortSignal.timeout(10_000),
    )

    expect(result).toMatchObject({ k: 'failed', failure: { kind: 'setup', what: 'model' } })
    if (result.k === 'failed' && result.failure.kind === 'setup') {
      expect(result.failure.hint).toMatch(/README|VOICEDESK_WHISPER_MODEL/)
    }
  })

  it('reports a missing binary as a setup failure naming the install command', async () => {
    const transcriber = new WhisperCppTranscriber(null, modelPath)
    const result = await transcriber.transcribe(
      { samples: new Float32Array(1_600), sampleRate: 16_000, heldMs: 100 },
      AbortSignal.timeout(10_000),
    )

    expect(result).toMatchObject({ k: 'failed', failure: { kind: 'setup', what: 'whisper' } })
    if (result.k === 'failed' && result.failure.kind === 'setup') {
      expect(result.failure.hint).toContain('brew install whisper-cpp')
    }
  })
})
