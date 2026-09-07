import { useCallback, useState } from 'react'

import { FailurePanel } from './components/FailurePanel'
import { NotesPane } from './components/NotesPane'
import { TalkButton } from './components/TalkButton'
import { TitleBar } from './components/TitleBar'
import { TurnLog } from './components/TurnLog'
import { AboutSheet } from './components/AboutSheet'
import { FirstRun } from './components/FirstRun'
import { talkControl } from './components/talkControl'
import { t, type MessageKey } from './i18n'
import { useTurn } from './useTurn'

/**
 * The window, implemented against the canvas `Voice Desktop.dc.html` at design `0.3.1`.
 *
 * One window, two panes, and a state machine with a face: every artboard in group A is a state
 * of this component rather than a screen of its own, which is why there is no routing here and
 * no navigation anywhere in the app.
 */
export function App(): React.JSX.Element {
  const turn = useTurn()
  const [aboutOpen, setAboutOpen] = useState(false)

  const openAbout = useCallback(() => setAboutOpen(true), [])
  const closeAbout = useCallback(() => setAboutOpen(false), [])

  const control = talkControl(turn.state)
  const busy = busyPhase(turn.state)

  return (
    <div className="shell">
      <TitleBar
        state={turn.state}
        model={turn.model}
        version={__APP_VERSION__}
        stage={turn.stage}
        onAbout={openAbout}
      />

      <div className="panes">
        <NotesPane files={turn.notes} folderChosen={turn.folderChosen} />

        <main className="turn-pane">
          <div className="turn-head">
            {t(turn.turns.length > 1 ? 'turn.head.last' : 'turn.head.this')}
          </div>

          <div className="turn-log">
            {/* First run is the empty state that is DESIGNED rather than left over: the left
                pane is the thing being asked for, so the right pane explains the two steps. */}
            {turn.firstRun ? <FirstRun notesDir={turn.notesDir} /> : null}

            {!turn.firstRun && turn.turns.length === 0 && turn.state.k !== 'error' ? (
              <p className="turn-empty">
                <strong>{t('turn.emptyTitle')}</strong>
                {t('turn.emptyBody')}
              </p>
            ) : null}

            <TurnLog turns={turn.turns} onSpeak={turn.speak} speakable={turn.speakable} />

            {busy === null ? null : (
              <BusyRow
                kicker={busy.kicker}
                meta={busy.meta}
                progress={busy.progress}
                onStop={turn.cancel}
              />
            )}

            {turn.state.k === 'error' ? (
              <FailurePanel
                failure={turn.state.failure}
                onDismiss={turn.dismiss}
                onRetry={turn.dismiss}
              />
            ) : null}
          </div>

          <TalkButton
            control={control}
            level={turn.level}
            heldSeconds={turn.heldSeconds}
            disabledReason={disabledReason(turn.state, control)}
            onHoldStart={turn.beginHold}
            onHoldEnd={turn.endHold}
          />
          {turn.notice === null ? null : <p className="pane-empty">{t('talk.tooShort')}</p>}
        </main>
      </div>

      {aboutOpen ? (
        <AboutSheet
          version={__APP_VERSION__}
          stage={turn.stage}
          notices={turn.notices}
          onClose={closeAbout}
        />
      ) : null}
    </div>
  )
}

/**
 * The two waits, made legible rather than stretched (`docs/design/DESIGN-BRIEF.md` §9).
 *
 * `thinking` gets a bounded progress bar because it is the long one — seconds to a minute — and
 * a wait with no visible end reads as hung. `transcribing` gets a label and no bar: it is
 * short, and a bar that fills in half a second is decoration.
 */
function busyPhase(
  state: ReturnType<typeof useTurn>['state'],
): { kicker: MessageKey; meta: string; progress: number | null } | null {
  switch (state.k) {
    case 'transcribing':
      return { kicker: 'busy.transcribing', meta: t('busy.local'), progress: null }
    case 'thinking':
      return { kicker: 'busy.thinking', meta: '', progress: 0 }
    case 'idle':
    case 'recording':
    case 'speaking':
    case 'error':
      return null
    default: {
      const unhandled: never = state
      throw new Error(`unhandled turn state: ${JSON.stringify(unhandled)}`)
    }
  }
}

/** Why the control cannot be held, when it cannot. The design labels the reason rather than
    presenting a dead button (artboards 05, 07, 08). */
function disabledReason(
  state: ReturnType<typeof useTurn>['state'],
  control: ReturnType<typeof talkControl>,
): MessageKey | null {
  if (control === 'busy') return 'talk.busy'
  if (state.k === 'error' && state.failure.kind === 'mic-denied') return 'talk.noMic'
  if (state.k === 'error' && state.failure.kind === 'no-microphone') return 'talk.noMic'
  if (state.k === 'error' && state.failure.kind === 'setup' && state.failure.what === 'whisper') {
    return 'talk.noWhisper'
  }
  return null
}

/** The agent working, with the bound it is working against — never an unbounded spinner. */
function BusyRow({
  kicker,
  meta,
  progress,
  onStop,
}: {
  readonly kicker: MessageKey
  readonly meta: string
  readonly progress: number | null
  readonly onStop: () => void
}): React.JSX.Element {
  return (
    <article className="turn-entry">
      <span className="turn-who">{t('turn.agent')}</span>
      <span className="turn-time" />
      <div className="progress">
        <div className="progress-meta">
          <span>{t(kicker)}</span>
          {meta === '' ? null : <span>{meta}</span>}
        </div>
        {progress === null ? null : (
          <div className="progress-track">
            <div className="progress-fill" style={progressStyle(progress)} />
          </div>
        )}
        <div>
          <button type="button" className="btn btn-ghost" onClick={onStop}>
            {t('busy.stop')}
          </button>
        </div>
      </div>
    </article>
  )
}

/** `--progress` is a custom property, so the return type is widened rather than asserted. */
function progressStyle(value: number): React.CSSProperties & { '--progress': number } {
  return { '--progress': value }
}
