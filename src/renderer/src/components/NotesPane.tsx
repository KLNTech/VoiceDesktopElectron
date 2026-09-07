import type { NoteFile, NoteStatus } from '../../../domain/model/note-file'
import { plural, t, type MessageKey } from '../i18n'

/**
 * The left pane: the `notes/` folder as standing evidence of what the agent wrote.
 *
 * It exists because the reply scrolls away and the folder does not. Its footer says, on every
 * artboard, that the agent writes these files and VoiceDesk does not — the app must never
 * present itself as the author (`docs/design/DESIGN-BRIEF.md` §3, §9).
 */
export function NotesPane({
  files,
  folderChosen,
}: {
  readonly files: readonly NoteFile[]
  /** `false` only before a folder exists at all — the first-run board, where the pane is the ask. */
  readonly folderChosen: boolean
}): React.JSX.Element {
  return (
    <aside className="notes-pane">
      <div className="pane-head">
        <h2>{folderChosen ? t('notes.title') : t('notes.none')}</h2>
        {folderChosen && files.length > 0 ? (
          <span className="pane-count">
            {plural(files.length, 'notes.count.one', 'notes.count.many')}
          </span>
        ) : (
          <span className="pane-count">{folderChosen ? t('notes.empty') : ''}</span>
        )}
      </div>

      {files.length === 0 ? (
        <p className="pane-empty">{folderChosen ? t('notes.emptyBody') : t('notes.noneBody')}</p>
      ) : (
        <ul className="note-list">
          {files.map((file) => (
            // Keyed by NAME, which is the row's identity: a bare index would key it by where it
            // sits, and this list reorders whenever the agent adds a file.
            <li key={file.name} className="note-row">
              <span className="note-name">{file.name}</span>
              <span className={`note-mark is-${file.status}`}>{t(markLabel(file.status))}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="pane-foot">{t('notes.foot')}</p>
    </aside>
  )
}

/** The three markers, as words. Colour is never the only carrier of the difference (§9). */
function markLabel(status: NoteStatus): MessageKey {
  switch (status) {
    case 'edited':
      return 'notes.mark.edited'
    case 'read':
      return 'notes.mark.read'
    case 'unchanged':
      return 'notes.mark.unchanged'
    default: {
      const unhandled: never = status
      throw new Error(`unhandled note status: ${String(unhandled)}`)
    }
  }
}
