import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { accessSync, constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { failed, succeeded, type Outcome } from '../../domain/model/turn'
import type { Transcript } from '../../domain/model/transcript'
import type { AudioClip, Transcriber } from '../../domain/ports/Transcriber'
import { encodeWav } from './wav'

const run = promisify(execFile)

/** Only the field the adapter actually consumes; anything else whisper writes is ignored. */
interface WhisperJson {
  transcription?: { text?: string }[]
}

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
      const segments = (raw as WhisperJson).transcription ?? []
      const text = segments
        .map((segment) => segment.text ?? '')
        .join('')
        .trim()

      return succeeded({ text, heldMs: clip.heldMs })
    } catch (error) {
      return failed(this.classify(error))
    } finally {
      // Runs on every path, including the aborted one: a temp directory per turn otherwise
      // accumulates a WAV of every sentence the user has ever spoken.
      await rm(workDir, { recursive: true, force: true })
    }
  }

  private classify(error: unknown): Parameters<typeof failed>[0] {
    const e = error as { code?: string; killed?: boolean; stderr?: string; name?: string }

    if (e.code === 'ENOENT') {
      return {
        kind: 'setup',
        what: 'whisper',
        hint: `${this.binPath ?? 'whisper-cli'} could not be run. Reinstall it with \`brew install whisper-cpp\`.`,
      }
    }
    // execFile reports both a kill-on-timeout and an abort this way; either means the run could
    // not finish, and the child is already dead.
    if (e.killed === true || e.name === 'AbortError') {
      return { kind: 'timeout', afterMs: this.timeoutMs }
    }
    return { kind: 'transcribe-failed', stderr: lastLine(e.stderr ?? String(error)) }
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

/** The last line is the one that says what went wrong; the rest is whisper's banner. */
function lastLine(text: string): string {
  const lines = text.trim().split('\n')
  return (lines[lines.length - 1] ?? '').trim().slice(0, 500)
}
