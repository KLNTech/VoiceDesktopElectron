import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import { TurnFailureSchema, TurnStatePush, NoteFileSchema } from '../shared/ipc'
import type { NoteFile } from '../src/domain/model/note-file'
import type { TurnFailure, TurnState } from '../src/domain/model/turn'

/**
 * The wire and the domain describe the same shapes twice, and nothing made them agree.
 *
 * `shared/ipc.ts` imports only `zod` — not one line of `src/domain` — and re-declares
 * `TurnFailure`, `TurnState` and the note row by hand. The copies match today. What was missing
 * is any reason they would still match tomorrow: adding a `TurnFailure` kind and forgetting the
 * schema means main returns a value the preload's `safeParse` silently drops, and the interface
 * sits in a state it was never told to leave.
 *
 * TypeScript caught *part* of that, in one direction, only while every handler kept an explicit
 * return annotation, and not at all for `TurnState`. The assertions below make it a compile
 * error in both directions instead — they cost four lines per schema and run at build time, so
 * the `expect` calls here exist only so the file is also a test that has been seen to pass.
 */

/**
 * Fails to compile unless the two types are mutually assignable.
 *
 * Mutual is the point. One-way assignability accepts a schema that has grown a field the domain
 * does not have, and also a schema that has quietly LOST one — which is the direction that
 * turns into a dropped message rather than a type error.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

/** Reading these as `true` is the assertion; anything else is a compile error above. */
const failureMatches: Exact<TurnFailure, z.infer<typeof TurnFailureSchema>> = true
const stateMatches: Exact<TurnState, z.infer<typeof TurnStatePush>> = true
const noteMatches: Exact<NoteFile, z.infer<typeof NoteFileSchema>> = true

describe('the wire schemas and the domain types', () => {
  it('describe the same failure, state and note shapes', () => {
    // The real check happened at compile time. This asserts the file was actually reached, so
    // a suite that stopped compiling it cannot read as a pass.
    expect([failureMatches, stateMatches, noteMatches]).toEqual([true, true, true])
  })

  it('accepts every failure kind the domain declares, with no kind unlisted', () => {
    // The enumeration the type system cannot do for us: a discriminated union's tags, compared
    // against the schema's. Adding a kind to `turn.ts` and not to `shared/ipc.ts` fails here
    // even if the shapes happened to stay assignable.
    const kinds: TurnFailure['kind'][] = [
      'mic-denied',
      'no-microphone',
      'setup',
      'transcribe-failed',
      'agent-failed',
      'timeout',
      'empty-speech',
    ]
    expect(TurnFailureSchema.options.map((option) => option.shape.kind.value).toSorted()).toEqual(
      kinds.toSorted(),
    )
  })

  it('accepts every turn state the machine can be in', () => {
    const states: TurnState['k'][] = [
      'idle',
      'recording',
      'transcribing',
      'thinking',
      'speaking',
      'error',
    ]
    expect(TurnStatePush.options.map((option) => option.shape.k.value).toSorted()).toEqual(
      states.toSorted(),
    )
  })

  it('round-trips a real failure through the schema unchanged', () => {
    // Assignability says the types line up; this says the VALUES survive the trip, which is
    // what actually crosses the bridge.
    const failure: TurnFailure = { kind: 'setup', what: 'agent-auth', hint: 'run claude' }
    expect(TurnFailureSchema.parse(failure)).toEqual(failure)
  })
})
