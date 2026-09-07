import { useCallback } from 'react'

import type { TalkControl } from './talkControl'
import { t, type MessageKey } from '../i18n'

interface Props {
  readonly control: TalkControl
  readonly level: number
  /** Seconds held so far, shown while recording. The design puts a timer on the control. */
  readonly heldSeconds: number
  /** Why the control is unavailable, when it is — the design labels the reason (artboards 05, 07, 08). */
  readonly disabledReason: MessageKey | null
  readonly onHoldStart: () => void
  readonly onHoldEnd: () => void
}

/**
 * The one control that matters, and the largest thing in the right pane.
 *
 * It must say three things without a label: that it is HELD, not clicked; that the microphone
 * is live right now; and how loud the user is (`docs/design/DESIGN-BRIEF.md` §4). All four
 * hold-ending events are wired and the pointer is captured, because `pointerup` alone is not
 * guaranteed to arrive (`docs/PLAN.md` §2). The fourth, window blur, lives in `useTurn`.
 */
export function TalkButton({
  control,
  level,
  heldSeconds,
  disabledReason,
  onHoldStart,
  onHoldEnd,
}: Props): React.JSX.Element {
  const recording = control === 'recording'
  const disabled = control === 'busy' || disabledReason !== null

  /**
   * Named and hoisted out of the JSX: it is two statements doing two different things, and an
   * attribute is the wrong place to read that. Inline it would also be a new function identity
   * every render, which on a control driven by an animation frame is every frame.
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
        disabled={disabled}
        aria-pressed={recording}
        onPointerDown={beginHold}
        onPointerUp={onHoldEnd}
        onPointerLeave={onHoldEnd}
        onPointerCancel={onHoldEnd}
      >
        <span className="talk-label">{recording ? t('talk.recording') : t('talk.hold')}</span>
        {recording ? (
          <>
            <span className="talk-timer">{formatHeld(heldSeconds)}</span>
            {/* The live cue is TEXT as well as colour and shape, so it survives a screen reader
                and a colour-blind reading (§9). */}
            <span className="talk-hint">
              {t('talk.live')} · {t('talk.release')}
            </span>
          </>
        ) : (
          <span className="talk-hint">
            {disabledReason === null ? (
              <>
                {t('talk.hint')} <kbd>{t('talk.key')}</kbd>
              </>
            ) : (
              t(disabledReason)
            )}
          </span>
        )}
      </button>

      <LevelMeter level={level} live={recording} />
    </div>
  )
}

/** `0:04`. Minutes because a hold can run long; the design shows `0:00` at rest. */
function formatHeld(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/**
 * Nine bars, identified rather than counted.
 *
 * A bare index keys a bar by where it sits, so the day the meter gains or reorders one, React
 * reuses the wrong DOM node and the new bar animates out of the old one's height. Their heights
 * are CSS's business (`index.css`, `.meter i`); this list carries identity only.
 */
const METER_BARS = ['b1', 'b2', 'b3', 'b4', 'centre', 'b6', 'b7', 'b8', 'b9'] as const

function LevelMeter({ level, live }: { level: number; live: boolean }): React.JSX.Element {
  // Zero unless the microphone is actually open. A meter that moves at any other time is a
  // meter that lies about the one thing it exists to report.
  const shown = live ? Math.max(0, Math.min(1, level)) : 0

  return (
    <div className="meter-row">
      <span>{t('talk.level')}</span>
      {/* One custom property for the whole meter, updated per animation frame, instead of a
          style object per bar. Each bar's own weight is a constant and lives in the stylesheet. */}
      <div className={live ? 'meter is-live' : 'meter'} style={levelStyle(shown)} aria-hidden="true">
        {METER_BARS.map((bar) => (
          <i key={bar} />
        ))}
      </div>
      <span className="meter-value">{live ? formatLevel(shown) : t('talk.off')}</span>
    </div>
  )
}

/**
 * The numeric readout the canvas shows beside the meter: `−9 dB`, or `Silent`.
 *
 * Decibels rather than a percentage because that is what the artboard renders, and because a
 * linear percentage of an amplitude reads as "barely moving" for a perfectly audible voice.
 */
function formatLevel(level: number): string {
  if (level <= 0.001) return t('talk.silent')
  return `${Math.round(20 * Math.log10(level))} dB`
}

/**
 * `--level` is a custom property, and `CSSProperties` enumerates only the known ones. Widening
 * the RETURN TYPE keeps the compiler checking the object, where `as CSSProperties` would be an
 * assertion onto a type that does not contain the field being written.
 */
function levelStyle(level: number): React.CSSProperties & { '--level': number } {
  return { '--level': level }
}
