/**
 * One Markdown file in `notes/`, and what this turn did to it.
 *
 * The interface keeps a standing list of these beside the turn, because the reply scrolls away
 * and the folder does not: it is the durable evidence of the thing being demonstrated. The app
 * never writes these files — the agent does — and the panel says so.
 */
export interface NoteFile {
  /** Relative to `notes/`, so nothing renders an absolute path from the user's home directory. */
  readonly name: string
  readonly status: NoteStatus
}

/**
 * A tag, not two booleans.
 *
 * `{ wasRead: boolean; wasWritten: boolean }` makes `read && written` representable and leaves
 * every reader to decide what to show for it; the design has exactly three markers, so the type
 * has exactly three values and the mapping is total.
 *
 * `edited` outranks `read` when both happened, because that is what the user needs to see: a
 * file the agent changed is the consequence of the turn, and one it merely consulted is not.
 */
export type NoteStatus =
  /** The agent created or changed this file during the turn. */
  | 'edited'
  /** The agent opened it and left it as it was. */
  | 'read'
  /** It sits in the folder and this turn did not touch it. Most of the panel, most of the time. */
  | 'unchanged'
