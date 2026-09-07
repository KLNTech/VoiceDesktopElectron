import { useCallback, useState } from 'react'

import type { TurnFailure } from '../../../domain/model/turn'
import { actionLabel, presentFailure } from './failure'
import { t } from '../i18n'

/**
 * One layout, four contents (`docs/design/DESIGN-BRIEF.md` §5).
 *
 * The band across the top is the screen's whole job: filled means the user's machine and is
 * fixed once, hairline means this turn and is retried. Someone should know which they are
 * looking at before reading a word of the body — that is what stops people debugging the wrong
 * thing.
 */
export function FailurePanel({
  failure,
  onDismiss,
  onRetry,
}: {
  readonly failure: TurnFailure
  readonly onDismiss: () => void
  readonly onRetry: () => void
}): React.JSX.Element {
  const shown = presentFailure(failure)
  const label = actionLabel(shown.action)

  return (
    <div className={`failure is-${shown.side}`} role="alert">
      <div className="failure-band">
        {t(shown.side === 'yours' ? 'err.band.yours' : 'err.band.turn')}
      </div>

      <div className="failure-body">
        <span className="failure-icon">
          <AlertIcon />
        </span>
        <div>
          <h3>{shown.title}</h3>
          {shown.body === '' ? null : <p>{shown.body}</p>}
          {/* Another program's output, quoted rather than paraphrased — and selectable, because
              the first thing anyone does with it is paste it somewhere. */}
          {shown.detail === null ? null : <pre>{shown.detail}</pre>}
        </div>
      </div>

      <div className="failure-actions">
        {label === null ? null : (
          <ActionButton action={shown.action} label={t(label)} onRetry={onRetry} failure={failure} />
        )}
        <button type="button" className="btn btn-secondary" onClick={onDismiss}>
          {t('err.dismiss')}
        </button>
        <span className="failure-code">
          <code>{shown.code}</code>
          <CopyButton value={shown.code} />
        </span>
      </div>
    </div>
  )
}

/**
 * The one action the failure offers. Each kind gets its own, because "Try again" on a missing
 * binary is a button that cannot work and a screen that wastes the user's time.
 */
function ActionButton({
  action,
  label,
  onRetry,
  failure,
}: {
  readonly action: string
  readonly label: string
  readonly onRetry: () => void
  readonly failure: TurnFailure
}): React.JSX.Element {
  const run = useCallback(() => {
    if (action === 'retry') {
      onRetry()
      return
    }
    if (action === 'open-settings') {
      // Deep link to the exact pane, so the user is not left to find it. This is the one
      // outbound URL the app opens, and it is a system settings scheme, not the web.
      void window.voicedesk.openSettings()
      return
    }
    if (action === 'copy-install' && failure.kind === 'setup') {
      void navigator.clipboard.writeText(failure.hint)
    }
  }, [action, failure, onRetry])

  return (
    <button type="button" className="btn btn-primary" onClick={run}>
      {label}
    </button>
  )
}

/** `Copy code` — the design puts the registry code next to a control that copies it. */
function CopyButton({ value }: { readonly value: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(() => {
    void (async () => {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      // Reverts on its own: a button that stays "Copied" forever stops reporting anything.
      setTimeout(() => setCopied(false), 1_500)
    })()
  }, [value])

  return (
    <button type="button" className="btn btn-ghost" onClick={copy}>
      {t(copied ? 'err.copied' : 'err.copyCode')}
    </button>
  )
}

function AlertIcon(): React.JSX.Element {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  )
}
