import type { TurnFailure } from '../../domain/model/turn'
import { TalkButton, talkControl } from './components/TalkButton'
import { t } from './i18n'
import { useTurn } from './useTurn'

/**
 * The iteration-1 shell: hold, speak, release, and your words appear as text.
 *
 * This is not the approved design. The canvas ("Voice Desktop", 0.3.1) is implemented in one
 * pass in S8, against its fifteen artboards — approximating it here would mean designing the
 * interface twice and throwing one away.
 */
export function App(): React.JSX.Element {
  const { state, level, turns, notice, beginHold, endHold, dismiss } = useTurn()

  return (
    <main className="shell">
      <header className="bar">
        <h1>{t('app.name')}</h1>
        <span className="version">
          v{__APP_VERSION__} · {import.meta.env.DEV ? 'dev' : 'build'}
        </span>
        <span className={`state state-${state.k}`}>{stateLabel(state.k)}</span>
      </header>

      <section className="turns">
        {turns.length === 0 && state.k !== 'error' ? (
          <p className="empty">{t('turn.empty')}</p>
        ) : (
          turns.map((turn) => (
            <article key={turn.id} className="turn">
              <span className="who">{t('turn.you')}</span>
              <p>{turn.you}</p>
            </article>
          ))
        )}

        {state.k === 'error' ? <Failure failure={state.failure} onDismiss={dismiss} /> : null}
      </section>

      <footer className="foot">
        {notice === 'tooShort' ? <p className="notice">{t('talk.tooShort')}</p> : null}
        <TalkButton
          control={talkControl(state)}
          level={level}
          onHoldStart={beginHold}
          onHoldEnd={endHold}
        />
      </footer>
    </main>
  )
}

function stateLabel(k: string): string {
  switch (k) {
    case 'recording':
      return t('state.recording')
    case 'transcribing':
      return t('state.transcribing')
    case 'thinking':
      return t('state.thinking')
    case 'speaking':
      return t('state.speaking')
    default:
      return t('state.idle')
  }
}

/**
 * Failures are shown by KIND, and the split that matters is "your machine needs fixing" versus
 * "this turn failed" — the two need different actions from the user, and collapsing them sends
 * someone to debug the wrong thing.
 */
function Failure({
  failure,
  onDismiss,
}: {
  failure: TurnFailure
  onDismiss: () => void
}): React.JSX.Element {
  const { title, body, yours } = describe(failure)
  return (
    <div className={yours ? 'failure is-setup' : 'failure'} role="alert">
      <strong>{title}</strong>
      <p>{body}</p>
      <button type="button" onClick={onDismiss}>
        {t('err.dismiss')}
      </button>
    </div>
  )
}

function describe(failure: TurnFailure): { title: string; body: string; yours: boolean } {
  switch (failure.kind) {
    case 'mic-denied':
      return { title: t('err.mic.deniedTitle'), body: t('err.mic.deniedBody'), yours: true }
    case 'no-microphone':
      return { title: t('err.mic.noneTitle'), body: t('err.mic.noneBody'), yours: true }
    case 'setup':
      return { title: t('err.setupTitle'), body: failure.hint, yours: true }
    case 'transcribe-failed':
      return { title: t('err.transcribeTitle'), body: failure.stderr, yours: false }
    case 'agent-failed':
      return { title: t('err.agentTitle'), body: failure.stderr, yours: false }
    case 'timeout':
      return {
        title: t('err.timeoutTitle'),
        body: `Stopped after ${Math.round(failure.afterMs / 1000)}s.`,
        yours: false,
      }
    case 'empty-speech':
      return { title: t('err.emptyTitle'), body: t('err.emptyBody'), yours: false }
  }
}
