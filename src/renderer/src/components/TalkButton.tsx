import { t } from '../i18n'

interface Props {
  readonly recording: boolean
  readonly busy: boolean
  readonly level: number
  readonly onHoldStart: () => void
  readonly onHoldEnd: () => void
}

/**
 * The one control that matters. It must say three things without a label: that it is HELD, not
 * clicked; that the microphone is live right now; and how loud the user is.
 *
 * All four hold-ending events are wired, and the pointer is captured, because `pointerup` alone
 * is not guaranteed to arrive (`docs/PLAN.md` §2). The fourth, window blur, lives in `useTurn`.
 */
export function TalkButton({ recording, busy, level, onHoldStart, onHoldEnd }: Props): React.JSX.Element {
  return (
    <div className="talk">
      <button
        type="button"
        className={recording ? 'talk-button is-recording' : 'talk-button'}
        disabled={busy}
        aria-pressed={recording}
        onPointerDown={(event) => {
          // Capture so the pointer leaving the button still reports its release here.
          event.currentTarget.setPointerCapture(event.pointerId)
          onHoldStart()
        }}
        onPointerUp={onHoldEnd}
        onPointerLeave={onHoldEnd}
        onPointerCancel={onHoldEnd}
      >
        {recording ? t('talk.listening') : t('talk.hold')}
      </button>
      <LevelMeter level={level} recording={recording} />
      <p className="hint">{t('talk.hint')}</p>
    </div>
  )
}

/**
 * The meter is not decoration: its absence is the most common reason a voice UI feels broken.
 * It is never the only cue that recording is live — the button's label and pressed state carry
 * it too, so the state survives colour blindness and a screen reader.
 */
function LevelMeter({ level, recording }: { level: number; recording: boolean }): React.JSX.Element {
  const bars = [0.35, 0.6, 0.9, 1, 0.85, 0.55, 0.3]
  return (
    <div className="meter" aria-hidden="true">
      {bars.map((weight, index) => (
        <i
          key={index}
          style={{ height: `${Math.max(3, (recording ? level : 0) * weight * 22 + 3)}px` }}
        />
      ))}
    </div>
  )
}
