import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { failed, succeeded, type Outcome } from '../../domain/model/turn'
import type { SpeechSynthesizer } from '../../domain/ports/SpeechSynthesizer'
import { couldNotFinish, readSpawnFailure } from '../process/spawn-failure'

const run = promisify(execFile)

/**
 * The reply, spoken, via the macOS `say` binary (`docs/PLAN.md` §6 "Voice out").
 *
 * This is the brief's stretch goal and it stays cheap on purpose: one adapter, one control, no
 * new dependency. `say` ships with the OS, so there is nothing to install and nothing to
 * license — the reason it was chosen over a hosted voice.
 */
export class MacSaySynthesizer implements SpeechSynthesizer {
  constructor(
    private readonly binPath: string | null,
    private readonly timeoutMs = 120_000,
  ) {}

  async speak(text: string, signal: AbortSignal): Promise<Outcome<void>> {
    if (this.binPath === null) {
      return failed({
        kind: 'setup',
        what: 'agent-cli',
        hint: 'The macOS `say` command was not found, so replies cannot be spoken. Everything else works.',
      })
    }

    try {
      // An argv array, never a shell. The text here is a model's reply rather than a dictated
      // sentence, which makes it no safer: it is still text this app did not write.
      await run(this.binPath, ['--', text], { timeout: this.timeoutMs, maxBuffer: 1 << 20, signal })
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
