import type { TurnFailure } from '../../../domain/model/turn'
import { t, type MessageKey } from '../i18n'

/**
 * Which half of the world a failure belongs to. It is the whole point of the failure screen:
 * `yours` is the user's machine and is fixed once; `turn` is this attempt and is retried.
 * The design gives them different bands — filled versus hairline — so nobody has to read the
 * body to know which they are looking at (`docs/design/DESIGN-BRIEF.md` §5).
 */
export type FailureSide = 'yours' | 'turn'

/** What the one action button does. `none` is a real answer: some failures have only Dismiss. */
export type FailureAction = 'open-settings' | 'copy-install' | 'retry' | 'none'

export interface PresentedFailure {
  readonly side: FailureSide
  readonly title: string
  readonly body: string
  /** Set when the body is another program's output, which the design renders as a mono block. */
  readonly detail: string | null
  readonly action: FailureAction
  /** `1001 · 000` — the design project's registry code, carried into the window (§5). */
  readonly code: string
}

/**
 * The error-code registry, exactly as the canvas renders it.
 *
 * The four codes are read off the artboards rather than assigned here: `1001` is on the
 * microphone board, `1101` on setup, `1201` on agent-failed and `1211` on timed-out. They exist
 * so an implementation can be checked against the design failure by failure rather than screen
 * by screen — which only works if this table is the design's table and not a plausible one.
 *
 * The second half (`· 000`, `· 127`, `· 001`, `· 124`) is the sub-code the artboards show:
 * a shell's "command not found" is 127 and its "timeout" is 124, which is where those came from.
 */
const CODES = {
  micDenied: '1001 · 000',
  setup: '1101 · 127',
  agentFailed: '1201 · 001',
  timedOut: '1211 · 124',
} as const

/**
 * A failure, as the window shows it.
 *
 * `docs/PLAN.md` §7 declares FIVE failure kinds and the canvas draws FOUR boards, so one kind
 * has no surface of its own: `empty-speech`. It is not an omission — a silent recording is a
 * slip, not a broken machine and not a failed agent — so it borrows the quietest treatment
 * available and is filed under this turn. That divergence is recorded in the brief §12 rather
 * than resolved by inventing a fifth artboard.
 */
export function presentFailure(failure: TurnFailure): PresentedFailure {
  switch (failure.kind) {
    case 'mic-denied':
      // The two denials need different actions: one is undoable only in System Settings, the
      // other is just "the prompt was dismissed", and holding again can still succeed.
      return failure.denial === 'system-settings'
        ? {
            side: 'yours',
            title: t('err.mic.deniedTitle'),
            body: t('err.mic.deniedBody'),
            detail: null,
            action: 'open-settings',
            code: CODES.micDenied,
          }
        : {
            side: 'yours',
            title: t('err.mic.retryTitle'),
            body: t('err.mic.retryBody'),
            detail: null,
            action: 'none',
            code: CODES.micDenied,
          }

    case 'no-microphone':
      return {
        side: 'yours',
        title: t('err.mic.noneTitle'),
        body: t('err.mic.noneBody'),
        detail: null,
        action: 'none',
        code: CODES.micDenied,
      }

    case 'setup':
      // The hint is written by whichever adapter failed and already names the exact fix, so it
      // is shown verbatim rather than replaced by a generic sentence about setup.
      return {
        side: 'yours',
        title: t('err.setupTitle'),
        body: failure.hint,
        detail: null,
        action: 'copy-install',
        code: CODES.setup,
      }

    case 'transcribe-failed':
      return {
        side: 'turn',
        title: t('err.transcribeTitle'),
        body: '',
        detail: failure.stderr,
        action: 'retry',
        code: CODES.agentFailed,
      }

    case 'agent-failed':
      return {
        side: 'turn',
        title: t('err.agentTitle'),
        body: '',
        detail: failure.stderr,
        action: 'retry',
        code: CODES.agentFailed,
      }

    case 'timeout':
      return {
        side: 'turn',
        title: t('err.timeoutTitle'),
        // The number comes from the failure, not from a constant in the window: the deadline
        // that actually fired is the only honest one to quote.
        body: `The agent did not answer within ${Math.round(failure.afterMs / 1000)} seconds and was stopped.`,
        detail: null,
        action: 'retry',
        code: CODES.timedOut,
      }

    case 'empty-speech':
      return {
        side: 'turn',
        title: t('err.emptyTitle'),
        body: t('err.emptyBody'),
        detail: null,
        action: 'none',
        code: CODES.agentFailed,
      }

    default: {
      const unhandled: never = failure
      throw new Error(`unhandled failure: ${JSON.stringify(unhandled)}`)
    }
  }
}

/** The label on the one action button, or `null` when the failure offers only Dismiss. */
export function actionLabel(action: FailureAction): MessageKey | null {
  switch (action) {
    case 'open-settings':
      return 'err.openSettings'
    case 'copy-install':
      return 'err.copyInstall'
    case 'retry':
      return 'err.retry'
    case 'none':
      return null
    default: {
      const unhandled: never = action
      throw new Error(`unhandled action: ${String(unhandled)}`)
    }
  }
}
