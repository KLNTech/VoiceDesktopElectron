import { mkdir, readdir, realpath } from 'node:fs/promises'
import { basename, extname, relative, resolve } from 'node:path'

import type { NoteFile, NoteStatus } from '../../domain/model/note-file'
import type { NotesFolder } from '../../domain/ports/NotesFolder'

/**
 * The `notes/` folder, read as the interface shows it: `.md` files, by name, sorted.
 *
 * It creates the folder if it is missing rather than reporting an empty list, because the
 * agent is about to be told this directory is its writable area and a `--add-dir` pointing at
 * nothing is a turn that fails for a reason the user cannot act on.
 */
export class MarkdownNotesFolder implements NotesFolder {
  constructor(private readonly dir: string) {}

  async list(): Promise<readonly NoteFile[]> {
    return (await this.names()).map((name) => ({ name, status: 'unchanged' as const }))
  }

  /** Just the names, which is what the status merge below works from. */
  async names(): Promise<readonly string[]> {
    await mkdir(this.dir, { recursive: true })
    const entries = await readdir(this.dir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.md')
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
  }

  /**
   * The folder after a turn, with each file carrying what the turn did to it.
   *
   * The listing comes from the FOLDER and the statuses come from the agent's own tool calls,
   * and it matters which supplies which. The panel's footer claims to show what the agent did
   * to this directory, so the set of rows has to be the directory — a file the agent said it
   * wrote but did not, or one deleted behind the app's back, must not appear. A tool call is
   * evidence of intent; `readdir` is evidence of outcome, and the rows are the outcome.
   */
  async statusAfterTurn(touched: TouchedPaths): Promise<readonly NoteFile[]> {
    const names = await this.names()
    const edited = await this.namesWithin(touched.edited)
    const read = await this.namesWithin(touched.read)

    return names.map((name) => ({
      name,
      // `edited` outranks `read`: opening a file and then rewriting it is one event to report,
      // and the change is the half the user needs to see.
      status: (edited.has(name) ? 'edited' : read.has(name) ? 'read' : 'unchanged') as NoteStatus,
    }))
  }

  /**
   * Absolute paths from the agent, reduced to bare names inside this folder.
   *
   * Anything outside is dropped rather than rendered. The agent is confined to `notes/` by
   * `--add-dir` and `--restricted`, but that is the CLI's promise, not this app's knowledge, and
   * a panel that will draw any path it is handed turns a confinement bug into a display of the
   * user's home directory. `relative` climbing out with `..` is the check that catches it.
   */
  private async namesWithin(paths: readonly string[]): Promise<ReadonlySet<string>> {
    /*
     * Compared through `realpath`, and that is not tidiness — it is the difference between a
     * populated panel and an empty one.
     *
     * On macOS the temporary and home directories reach the app through symlinks: `/var` is a
     * link to `/private/var`, so this app holds `/var/folders/…/notes` while the agent reports
     * the same file as `/private/var/folders/…/notes/shopping.md`. `resolve` normalises `..`
     * and nothing else, so those two strings compare as different trees and `relative` climbs
     * out with `..` — every path is discarded as "outside the folder", every row reads
     * `unchanged`, and the panel silently claims the agent did nothing. It is silent precisely
     * because dropping an outside path is the correct behaviour when the path really is
     * outside; the containment check cannot tell the two apart without resolving the links
     * first.
     */
    const root = await realpath(this.dir).catch(() => resolve(this.dir))
    const names = new Set<string>()

    for (const path of paths) {
      const absolute = resolve(root, path)
      // A file the agent deleted has no realpath left; its literal path is the best available
      // answer and is still subjected to the containment check below.
      const real = await realpath(absolute).catch(() => absolute)
      const rel = relative(root, real)
      // One segment, still inside, and a note: no separators, no `..`, no absolute escape.
      if (rel !== '' && !rel.startsWith('..') && rel === basename(rel)) names.add(rel)
    }
    return names
  }
}

/** Absolute file paths the agent reported opening and changing during one turn. */
export interface TouchedPaths {
  readonly read: readonly string[]
  readonly edited: readonly string[]
}
