import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { accessSync, constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { z } from 'zod'

import { failed, succeeded, type Outcome } from '../../domain/model/turn'
import type { Transcript } from '../../domain/model/transcript'
import type { AudioClip, Transcriber } from '../../domain/ports/Transcriber'
import { couldNotFinish, readSpawnFailure } from '../process/spawn-failure'
import { encodeWav } from './wav'

const run = promisify(execFile)

/**
 * Only the field the adapter actually consumes; anything else whisper writes is ignored.
 *
 * Parsed, not cast. This is another program's output format, which this project neither owns
 * nor versions, so `as` here would be a promise the compiler cannot keep — the same rule
 * `docs/PLAN.md` §5.3 states for the agent's reply.
 */
const WhisperOutput = z.object({
  transcription: z.array(z.object({ text: z.string().optional() })).optional(),
})

/**
 * Speech to text with `whisper-cli`, on this machine: no API key, no account, no network.
 *
 * The binary is a process boundary and gets network-call treatment — an argv array with no
 * shell, a timeout that kills, and failures separated into "your machine needs something
 * installed" and "the run failed", because collapsing those sends the user to debug the wrong
 * thing (`docs/PLAN.md` §5.6, §6).
 */
export class WhisperCppTranscriber implements Transcriber {
  constructor(
    private readonly binPath: string | null,
    private readonly modelPath: string,
    private readonly timeoutMs = 60_000,
  ) {}

  async transcribe(clip: AudioClip, signal: AbortSignal): Promise<Outcome<Transcript>> {
    if (this.binPath === null) {
      return failed({
        kind: 'setup',
        what: 'whisper',
        hint: 'whisper-cli was not found. Install it with `brew install whisper-cpp`, or set VOICEDESK_WHISPER_BIN to its absolute path.',
      })
    }
    if (!exists(this.modelPath)) {
      return failed({
        kind: 'setup',
        what: 'model',
        hint: `No Whisper model at ${this.modelPath}. Download ggml-base.en.bin (see the README), or point VOICEDESK_WHISPER_MODEL somewhere else.`,
      })
    }

    const workDir = await mkdtemp(join(tmpdir(), 'voicedesk-'))
    const wavPath = join(workDir, 'clip.wav')
    const outBase = join(workDir, 'out')

    try {
      await writeFile(wavPath, encodeWav(clip.samples, clip.sampleRate))

      await run(
        this.binPath,
        // An argv array, never a shell: none of these values is ever quoted, so none can be
        // mis-quoted. `-l en` matches the English-only model the README installs by default.
        ['-m', this.modelPath, '-f', wavPath, '-oj', '-of', outBase, '-np', '-l', 'en'],
        { timeout: this.timeoutMs, maxBuffer: 8 << 20, signal },
      )

      const raw: unknown = JSON.parse(await readFile(`${outBase}.json`, 'utf8'))
      const segments = WhisperOutput.parse(raw).transcription ?? []
      const text = segments
        .map((segment) => segment.text ?? '')
        .join('')
        .trim()

      return succeeded({ text, heldMs: clip.heldMs })
    } catch (error) {
      return failed(this.classify(error))
    } finally {
      /*
       * Runs on every path, including the aborted one: a temp directory per turn otherwise
       * accumulates a WAV of every sentence the user has ever spoken.
       *
       * The cleanup CANNOT be allowed to reject, and that is not defensive habit. A `finally`
       * that throws replaces the value the function had already computed — verified: the
       * returned `Outcome` is discarded and the caller gets a rejection instead. It would do
       * that precisely on the failure paths, where the discarded value is the explanation of
       * what went wrong, and it would break this adapter's one contract: failures come back as
       * typed data, never as a throw.
       *
       * `force: true` already makes "the directory is gone" a no-op, so what is swallowed here
       * is the genuinely exceptional case — EACCES, EBUSY, a filesystem that refuses. Losing a
       * temp directory is worth strictly less than losing the reason the turn failed.
       *
       * Note this is safe against overlapping and twice-cancelled turns without any locking:
       * `mkdtemp` hands every call its own directory, so no two turns share the path being
       * removed, and a second removal of the same path is a no-op.
       */
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private classify(error: unknown): Parameters<typeof failed>[0] {
    // Every field this reads, and the three traps in them, are documented once in
    // `spawn-failure.ts` — including why an abort and a deadline cannot be told apart here.
    const failure = readSpawnFailure(error)

    if (failure.errno === 'ENOENT' || failure.errno === 'EACCES') {
      return {
        kind: 'setup',
        what: 'whisper',
        hint: `${this.binPath ?? 'whisper-cli'} could not be run. Reinstall it with \`brew install whisper-cpp\`.`,
      }
    }
    // A deadline, an abort, or a signal from outside: the run did not reach its own end and the
    // child is already dead. Reading `killed` alone missed the last of those, and reported it
    // as a failed transcription carrying an empty message.
    if (couldNotFinish(failure)) {
      return { kind: 'timeout', afterMs: this.timeoutMs }
    }
    return { kind: 'transcribe-failed', stderr: failure.detail }
  }
}

function exists(path: string): boolean {
  try {
    accessSync(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

