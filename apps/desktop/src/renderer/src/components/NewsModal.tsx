import { Fragment, useEffect, useState, type ReactNode } from 'react'

import { CHANGELOG, releaseNotes } from '../lib/changelog'
import { useAppearance } from '../store/appearance'
import { Modal } from './Modal'
import { t } from '../lib/i18n'

/** "**bold**" in changelog lines. */
function Inline({ text }: { text: string }): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>
  )
}

/**
 * The installed version while its notes haven't been opened, for the bell's notification.
 * `markSeen` keeps it away until the next version (saved in news_dismissed).
 */
export function useUnseenNews(): { title: string | null; markSeen(): void } {
  const dismissed = useAppearance((s) => s.settings.news_dismissed)
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    window.aureum.app.info().then((info) => setVersion(info.version), () => {})
  }, [])
  const notes = version ? releaseNotes(CHANGELOG, version) : null
  return {
    title: version && notes && dismissed !== version ? notes.title : null,
    markSeen: () => {
      if (version) useAppearance.getState().update({ news_dismissed: version })
    }
  }
}

/** Everything that changed, version by version. */
export function NewsModal({ onClose }: { onClose(): void }): ReactNode {
  return (
    <Modal title={t('shell.news')} onClose={onClose} wide>
      <div className="space-y-5 pr-1">
        {CHANGELOG.map((section) => (
          <section key={section.title}>
            <h3 className="font-display font-semibold">{section.title}</h3>
            <ul className="mt-1.5 list-disc space-y-1.5 pl-5 text-sm text-fg-muted">
              {section.items.map((item) => (
                <li key={item}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  )
}
