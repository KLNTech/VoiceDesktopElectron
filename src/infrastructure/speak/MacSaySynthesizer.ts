import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { failed, succeeded, type Outcome } from '../../domain/model/turn'
import type { SpeechSynthesizer } from '../../domain/ports/SpeechSynthesizer'
import { couldNotFinish, readSpawnFailure } from '../process/spawn-failure'
import { chooseVoice, parseVoices } from './voice'

const run = promisify(execFile)

/**
 * The reply, spoken, via the macOS `say` binary (`docs/PLAN.md` §6 "Voice out").
 *
 * This is the brief's stretch goal and it stays cheap on purpose: one adapter, one control, no
 * new dependency. `say` ships with the OS, so there is nothing to install and nothing to
 * license — the reason it was chosen over a hosted voice.
 */
export class MacSaySynthesizer implements SpeechSynthesizer {
  /**
   * The resolved voice, looked up once and then reused — as a PROMISE, not a value.
   *
   * Memoising the promise rather than its result is what makes two replies spoken at the same
   * time share one lookup instead of racing two `say -v '?'` spawns.
   */
  private voice: Promise<string | null> | null = null

  constructor(
    private readonly binPath: string | null,
    private readonly timeoutMs = 120_000,
    /** `VOICEDESK_SAY_VOICE`: an operator naming a voice outranks anything decided here. */
    private readonly voiceOverride: string | undefined = undefined,
  ) {}

  /**
   * Asks `say` which voices this machine has, once.
   *
   * A failure here is not a failure to speak: the reply is still read, in the system voice,
   * which is the behaviour this whole file replaced. Falling back is strictly better than
   * turning a listing problem into a silent app.
   */
  private async chosenVoice(): Promise<string | null> {
    this.voice ??= (async (): Promise<string | null> => {
      if (this.binPath === null) return null
      try {
        const { stdout } = await run(this.binPath, ['-v', '?'], {
          timeout: 10_000,
          maxBuffer: 1 << 20,
        })
        return chooseVoice(parseVoices(stdout), this.voiceOverride)
      } catch {
        return this.voiceOverride ?? null
      }
    })()
    return this.voice
  }

  async speak(text: string, signal: AbortSignal): Promise<Outcome<void>> {
    if (this.binPath === null) {
      return failed({
        kind: 'setup',
        what: 'agent-cli',
        hint: 'The macOS `say` command was not found, so replies cannot be spoken. Everything else works.',
      })
    }

    // Chosen BEFORE the try, so a listing failure cannot be reported as a failure to speak.
    const voice = await this.chosenVoice()

    try {
      // An argv array, never a shell. The text here is a model's reply rather than a dictated
      // sentence, which makes it no safer: it is still text this app did not write. The same
      // applies to the voice name, which came off another program's stdout.
      const args = voice === null ? ['--', text] : ['-v', voice, '--', text]
      await run(this.binPath, args, { timeout: this.timeoutMs, maxBuffer: 1 << 20, signal })
      return succeeded(undefined)
    } catch (error) {
      const failure = readSpawnFailure(error)
      // A voice that will not start is never a failed TURN — the answer is already on screen,
      // and `runVoiceTurn` maps this to `speech: 'unavailable'` rather than losing the reply.
      // The distinction is why `SpeechOutcome` has three values instead of a boolean.
      return failed(
        couldNotFinish(failure)
          ? { kind: 'timeout', afterMs: this.timeoutMs }
          : { kind: 'agent-failed', stderr: failure.detail },
      )
    }
  }
}
