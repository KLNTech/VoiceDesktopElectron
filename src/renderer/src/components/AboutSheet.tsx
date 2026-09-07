import { useCallback, useEffect, useRef } from 'react'

import type { NoticeSchema } from '../../../../shared/ipc'
import { t } from '../i18n'

/**
 * Artboard 12: a sheet over both panes, never a second window (`docs/design/DESIGN-BRIEF.md` §7).
 *
 * It exists because the app bundles open-source components whose licences require their notices
 * to travel with it — a legal surface, so it is designed rather than a text dump.
 */
export function AboutSheet({
  version,
  stage,
  notices,
  onClose,
}: {
  readonly version: string
  readonly stage: string
  readonly notices: readonly NoticeSchema[]
  readonly onClose: () => void
}): React.JSX.Element {
  const sheet = useRef<HTMLDivElement>(null)

  // Esc closes it, and focus moves into the sheet when it opens. Both are what a modal owes a
  // keyboard: without them the sheet is a trap that only a mouse can leave.
  useEffect(() => {
    sheet.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const stopInside = useCallback((event: React.MouseEvent) => event.stopPropagation(), [])

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('about.title')}
        tabIndex={-1}
        ref={sheet}
        onClick={stopInside}
      >
        <div className="sheet-head">
          <h2>{t('about.title')}</h2>
          <span className="version">
            v{version} · {stage}
          </span>
        </div>

        <div className="sheet-body">
          <p>{t('about.body')}</p>
          <h3>{t('about.notices')}</h3>
          <table className="notices">
            <thead>
              <tr>
                <th>{t('about.component')}</th>
                <th>{t('about.version')}</th>
                <th>{t('about.licence')}</th>
              </tr>
            </thead>
            <tbody>
              {notices.map((notice) => (
                <tr key={notice.name}>
                  <td>{notice.name}</td>
                  <td>{notice.version}</td>
                  <td>{notice.licence}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>{t('about.foot')}</p>
        </div>

        <div className="sheet-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('about.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
