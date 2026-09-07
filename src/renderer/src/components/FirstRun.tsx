import { t } from '../i18n'

/**
 * Artboard 11: never used before. No folder yet, so the left pane is the thing being asked for
 * and this pane explains the two steps between here and talking.
 *
 * It is a designed empty state rather than a leftover one, and it says what the app will do
 * with the folder it writes to before it writes anything — which is the point of showing it at
 * all (`docs/design/DESIGN-BRIEF.md` §2 group C).
 */
export function FirstRun({ notesDir }: { readonly notesDir: string }): React.JSX.Element {
  return (
    <section className="firstrun">
      <h3>{t('first.title')}</h3>
      <p>{t('first.body')}</p>

      <div className="firstrun-step">
        <span className="firstrun-num">01</span>
        <span className="firstrun-title">{t('first.micTitle')}</span>
        <p>{t('first.micBody')}</p>
      </div>

      <div className="firstrun-step">
        <span className="firstrun-num">02</span>
        <span className="firstrun-title">{t('first.folderTitle')}</span>
        <p>{t('first.folderBody')}</p>
        {/* The real path, not the canvas's `~/notes/` placeholder: the user is being told where
            an agent is about to write, and a generic example would be the wrong reassurance. */}
        <code className="firstrun-path">{notesDir}</code>
      </div>
    </section>
  )
}
