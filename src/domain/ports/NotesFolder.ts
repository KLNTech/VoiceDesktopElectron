import type { NoteFile } from '../model/note-file'

/**
 * The notes folder, as the interface needs to see it.
 *
 * A port rather than a direct `readdir` in the IPC handler for the usual reason: the panel is
 * rendered before any turn has run, so "what is in the folder" is a question the app asks on
 * its own, and every test of that answer would otherwise need a real directory. Its second
 * implementation is the test double, which is what the litmus in `docs/PLAN.md` §4 asks for.
 */
export interface NotesFolder {
  /** Every `.md` file in the folder, all `unchanged` — a listing is not a turn. */
  list(): Promise<readonly NoteFile[]>
}
