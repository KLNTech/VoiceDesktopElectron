import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { WhisperCppTranscriber } from '../src/infrastructure/transcribe/WhisperCppTranscriber'
import type { AudioClip } from '../src/domain/ports/Transcriber'

/**
 * A correctly installed whisper is never diagnosed as a missing one — the report's M7.
 *
 * Node stamps `ENOENT` on both "there is no such program" and "there is no such file", and the
 * adapter had the spawn and the reading of whisper's output file inside ONE `try`. So a whisper
 * that started, ran and simply wrote its transcript somewhere else — a renamed `-oj`/`-of` flag
 * in a new release, a full temp filesystem — was reported as *"whisper-cli could not be run.
 * Reinstall it with `brew install whisper-cpp`"*. The user is sent to reinstall the one thing
 * that is provably fine, and the real cause is never named.
 *
 * These stand in for whisper with three-line scripts, so each failure mode is produced rather
 * than described.
 */
const work = mkdtempSync(join(tmpdir(), 'voicedesk-diagnosis-'))
afterAll(() => rmSync(work, { recursive: true, force: true }))

const model = join(work, 'model.bin')
writeFileSync(model, 'not a real model, but a real file — the adapter checks it is readable')

/** Writes an executable stand-in for `whisper-cli` and returns its path. */
function fakeWhisper(name: string, script: string): string {
  const path = join(work, name)
  writeFileSync(path, `#!/bin/sh\n${script}\n`)
  chmodSync(path, 0o755)
  return path
}

const clip: AudioClip = { samples: new Float32Array(16_000), sampleRate: 16_000, heldMs: 1_000 }

/**
 * Where the adapter told whisper to write.
 *
 * The argv it builds is `-m <model> -f <wav> -oj -of <base> -np -l en`, so the base is the
 * SEVENTH positional argument, not the sixth — `$6` is the literal `-of`. Getting this wrong
 * made the malformed-JSON script write a file nobody read, and the test then proved the
 * missing-output branch twice instead of proving two branches once.
 */
const OUT_BASE = '$7'

async function transcribeWith(binPath: string | null): Promise<ReturnType<typeof describe> | unknown> {
  const transcriber = new WhisperCppTranscriber(binPath, model, 10_000)
  return transcriber.transcribe(clip, AbortSignal.timeout(10_000))
}

describe('what the user is told when transcription fails', () => {
  it('reports a genuinely missing binary as a setup problem', async () => {
    const outcome = await transcribeWith(join(work, 'no-such-program'))
    expect(outcome).toMatchObject({ k: 'failed', failure: { kind: 'setup', what: 'whisper' } })
  })

  /**
   * The regression itself: the run succeeds, the output file is not there.
   */
  it('does NOT tell the user to reinstall when whisper ran but wrote nothing', async () => {
    const outcome = await transcribeWith(fakeWhisper('silent-whisper', 'exit 0'))

    expect(outcome).toMatchObject({ k: 'failed', failure: { kind: 'transcribe-failed' } })
    const stderr = failureText(outcome)
    expect(stderr).not.toMatch(/reinstall/i)
    expect(stderr).not.toMatch(/brew install/i)
    // And it says the thing that IS true, so the user looks in the right place.
    expect(stderr).toMatch(/ran but wrote no transcript/i)
  })

  it('names malformed JSON as malformed JSON', async () => {
    const outcome = await transcribeWith(
      fakeWhisper('gibberish-whisper', `printf 'not json at all' > ${OUT_BASE}.json`),
    )

    expect(outcome).toMatchObject({ k: 'failed', failure: { kind: 'transcribe-failed' } })
    expect(failureText(outcome)).not.toMatch(/reinstall/i)
    expect(failureText(outcome)).toMatch(/not JSON/i)
  })

  it('still transcribes when whisper writes what it is supposed to', async () => {
    const outcome = await transcribeWith(
      fakeWhisper(
        'working-whisper',
        `printf '{"transcription":[{"text":" hello"},{"text":" there"}]}' > ${OUT_BASE}.json`,
      ),
    )

    expect(outcome).toMatchObject({ k: 'ok', value: { text: 'hello there', heldMs: 1_000 } })
  })

  it('reports a non-zero exit as a failed run, not a missing program', async () => {
    const outcome = await transcribeWith(
      fakeWhisper('angry-whisper', 'echo "model load failed" >&2; exit 3'),
    )

    expect(outcome).toMatchObject({ k: 'failed', failure: { kind: 'transcribe-failed' } })
    expect(failureText(outcome)).not.toMatch(/reinstall/i)
    expect(failureText(outcome)).toMatch(/model load failed/)
  })

  it('reports a missing model before it spawns anything at all', async () => {
    const transcriber = new WhisperCppTranscriber(
      fakeWhisper('never-called', 'exit 0'),
      join(work, 'absent-model.bin'),
      10_000,
    )
    const outcome = await transcriber.transcribe(clip, AbortSignal.timeout(10_000))
    expect(outcome).toMatchObject({ k: 'failed', failure: { kind: 'setup', what: 'model' } })
  })
})

/** The failure's `stderr`, or a description of why there wasn't one — never a silent ''. */
function failureText(outcome: unknown): string {
  if (typeof outcome !== 'object' || outcome === null) throw new Error('not an outcome')
  const failure: unknown = Reflect.get(outcome, 'failure')
  if (typeof failure !== 'object' || failure === null) throw new Error('outcome carries no failure')
  const stderr: unknown = Reflect.get(failure, 'stderr')
  if (typeof stderr !== 'string') throw new Error(`failure has no stderr: ${JSON.stringify(failure)}`)
  return stderr
}
