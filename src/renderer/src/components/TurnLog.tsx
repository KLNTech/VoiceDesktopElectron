import { useCallback } from 'react'

import type { NoteFile } from '../../../domain/model/note-file'
import { t } from '../i18n'

/** One finished exchange, as the window keeps it. */
export interface CompletedTurn {
  readonly id: number
  readonly at: string
  readonly you: string
  /** `null` while the agent is still working — the transcript is shown before the reply exists. */
  readonly agent: string | null
  readonly edited: readonly NoteFile[]
}

/**
 * The right pane's history: the last few turns, plain.
 *
 * Not a chat transcript with avatars — the brief's non-goal, and the reason each entry is a
 * two-column grid of "who" and "what" rather than a bubble (§9).
 */
export function TurnLog({
  turns,
  onSpeak,
  speakable,
}: {
  readonly turns: readonly CompletedTurn[]
  readonly onSpeak: (text: string) => void
  /** Speech is offered only when it can actually be produced — see `SpeechOutcome`. */
  readonly speakable: boolean
}): React.JSX.Element {
  return (
    <>
      {turns.map((turn) => (
        <article key={turn.id} className="turn-entry">
          <span className="turn-who">{t('turn.you')}</span>
          <span className="turn-time">{turn.at}</span>
          <p className="turn-text">{turn.you}</p>

          {turn.agent === null ? null : (
            <>
              <span className="turn-who">{t('turn.agent')}</span>
              <span className="turn-time" />
              <p className="turn-text">{turn.agent}</p>
              {turn.edited.length === 0 ? null : (
                <div className="turn-edits">
                  <span>{t('turn.edited')}</span>
                  {turn.edited.map((file) => (
                    <span key={file.name} className="turn-edit-file">
                      notes/{file.name}
                    </span>
                  ))}
                </div>
              )}
              {speakable ? <SpeakButton text={turn.agent} onSpeak={onSpeak} /> : null}
            </>
          )}
        </article>
      ))}
    </>
  )
}

/**
 * S9's control, and the reason it is its own component: the handler needs the reply text, and
 * binding it in the parent's JSX would build a new closure per turn on every render.
 */
function SpeakButton({
  text,
  onSpeak,
}: {
  readonly text: string
  readonly onSpeak: (text: string) => void
}): React.JSX.Element {
  // Bound here rather than in the parent's JSX: the parent maps over every turn, so an inline
  // closure would build one new function per turn on every render of the log.
  const speak = useCallback(() => onSpeak(text), [onSpeak, text])
  return (
    <div className="turn-edits">
      <button type="button" className="btn btn-ghost" onClick={speak}>
        <SpeakerIcon />
        {t('turn.speak')}
      </button>
    </div>
  )
}

function SpeakerIcon(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  )
}
