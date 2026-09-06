import { useCallback } from 'react'

import type { TalkControl } from './talkControl'
import { t } from '../i18n'

interface Props {
  readonly control: TalkControl
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
export function TalkButton({ control, level, onHoldStart, onHoldEnd }: Props): React.JSX.Element {
  const recording = control === 'recording'

  /**
   * Named, and hoisted out of the JSX, because it is two statements doing two different things
   * — claiming the pointer, then starting the turn — and an attribute value is the wrong place
   * to read that. It is also a new function identity on every render while it sits inline, so
   * the button re-renders whenever anything above it does, meter frames included.
   */
  const beginHold = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      // Capture so the pointer leaving the button still reports its release here.
      event.currentTarget.setPointerCapture(event.pointerId)
      onHoldStart()
    },
    [onHoldStart],
  )

  return (
    <div className="talk">
      <button
        type="button"
        className={recording ? 'talk-button is-recording' : 'talk-button'}
        disabled={control === 'busy'}
        aria-pressed={recording}
        onPointerDown={beginHold}
        onPointerUp={onHoldEnd}
        onPointerLeave={onHoldEnd}
        onPointerCancel={onHoldEnd}
      >
        {recording ? t('talk.listening') : t('talk.hold')}
      </button>
      <LevelMeter level={level} control={control} />
      <p className="hint">{t('talk.hint')}</p>
    </div>
  )
}

/**
 * The bars, identified rather than counted.
 *
 * They are keyed by name because a bare array index keys a row by *where it sits*: the day the
 * meter gains or reorders a bar, React reuses the wrong DOM node and the new bar animates out
 * of the old one's height. The names also say what the shape is — a symmetric hump — which
 * seven loose numbers did not. Their heights are CSS's business (`index.css`, `.meter i`); this
 * list carries identity only.
 */
const METER_BARS = [
  'outer-left',
  'mid-left',
  'inner-left',
  'centre',
  'inner-right',
  'mid-right',
  'outer-right',
] as const

/**
 * The meter is not decoration: its absence is the most common reason a voice UI feels broken.
 * It is never the only cue that recording is live — the button's label and pressed state carry
 * it too, so the state survives colour blindness and a screen reader.
 */
function LevelMeter({ level, control }: { level: number; control: TalkControl }): React.JSX.Element {
  // Zero unless the microphone is actually open. A meter that moves at any other time is a
  // meter that lies about the one thing it exists to report.
  const shown = control === 'recording' ? Math.max(0, Math.min(1, level)) : 0
  return (
    // One custom property for the whole meter, updated per animation frame, instead of a style
    // object per bar. Each bar's own weight is a constant and lives in the stylesheet.
    <div className="meter" style={levelStyle(shown)} aria-hidden="true">
      {METER_BARS.map((bar) => (
        <i key={bar} />
      ))}
    </div>
  )
}

/**
 * `--level` is a custom property, and `CSSProperties` enumerates only the known ones. Widening
 * the RETURN TYPE to include it keeps the compiler checking the object — `as CSSProperties`
 * would have been an assertion onto a type that does not contain the one field being written,
 * which is exactly the claim `ts-type-discipline` says not to make.
 */
function levelStyle(level: number): React.CSSProperties & { '--level': number } {
  return { '--level': level }
}
