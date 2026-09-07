import type { TurnState } from '../../../domain/model/turn'
import { t } from '../i18n'

/**
 * Two read-only readouts and no controls (`docs/design/DESIGN-BRIEF.md` §3).
 *
 * The model readout is read-only *because* the brief forbids a settings screen: the app states
 * what it is using and offers no way to change it from the window. Configuration is environment
 * variables, deliberately.
 */
export function TitleBar({
  state,
  model,
  version,
  stage,
  onAbout,
}: {
  readonly state: TurnState
  readonly model: string
  readonly version: string
  readonly stage: string
  readonly onAbout: () => void
}): React.JSX.Element {
  const pill = statePill(state)

  return (
    <header className="titlebar">
      <span className="titlebar-name">{t('app.name')}</span>

      <span className="readout" title={t('bar.modelTitle')}>
        <CpuIcon />
        <span className="readout-label">{t('bar.model')}</span>
        {/*
          Whatever the app ACTUALLY invoked, read back from the run — never a string typed into
          the UI. The canvas renders `claude-sonnet-4-5` on all fifteen artboards, which is stale
          artboard copy: the plan wins on behaviour (§12), and the plan pins the cheap tier. So
          this shows the configured tier until a turn reports the model that really ran.
        */}
        <span className="readout-value">{model}</span>
      </span>

      {pill === null ? null : (
        <span className="state-pill" style={roleStyle(pill.role)}>
          {t(pill.label)}
        </span>
      )}

      <span className="version">
        v{version} · {stage}
      </span>
      {/* `no-drag` or the title bar swallows the click: the whole bar is a drag region. */}
      <button
        type="button"
        className="btn btn-ghost"
        style={NO_DRAG}
        onClick={onAbout}
        aria-haspopup="dialog"
      >
        {t('bar.about')}
      </button>
    </header>
  )
}

/**
 * The pill the title bar shows while something is running — `LISTENING`, then `WORKING`.
 *
 * Six turn states collapse onto three answers here, and that is the design's intent rather than
 * a shortcut: the four state ROLES name what the session is doing, not which state it is in
 * (§11). Idle and error show no pill at all, because a pill that is always present stops
 * carrying information.
 */
function statePill(state: TurnState): { label: 'state.listening' | 'state.working'; role: string } | null {
  switch (state.k) {
    case 'recording':
      return { label: 'state.listening', role: 'var(--state-listening)' }
    case 'transcribing':
    case 'thinking':
    case 'speaking':
      return { label: 'state.working', role: 'var(--state-thinking)' }
    case 'idle':
    case 'error':
      return null
    default: {
      const unhandled: never = state
      throw new Error(`unhandled turn state: ${JSON.stringify(unhandled)}`)
    }
  }
}

/** `--role` is a custom property, so the return type is widened rather than asserted. */
function roleStyle(role: string): React.CSSProperties & { '--role': string } {
  return { '--role': role }
}

/**
 * The whole title bar is a drag region, so anything clickable inside it has to opt out or the
 * click is swallowed by the window move. `WebkitAppRegion` is an Electron property that
 * `CSSProperties` does not enumerate, so the type is widened rather than asserted.
 */
const NO_DRAG: React.CSSProperties & { WebkitAppRegion: string } = { WebkitAppRegion: 'no-drag' }

/** The cpu mark the canvas puts beside the model readout, inline so no icon set is bundled. */
function CpuIcon(): React.JSX.Element {
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
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2" />
    </svg>
  )
}
