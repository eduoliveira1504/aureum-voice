/**
 * The repo's CHANGELOG.md ("Novidades do Aureum"), built into the app: "## <version>" sections
 * with "- " items that may wrap onto indented lines. "Próxima versão" holds what isn't out yet.
 */

import changelog from '../../../../../../CHANGELOG.md?raw'

export interface ChangelogSection {
  title: string
  items: string[]
}

const UNRELEASED = 'Próxima versão'

export function parseChangelog(markdown: string): ChangelogSection[] {
  const sections: ChangelogSection[] = []
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('## ')) sections.push({ title: line.slice(3).trim(), items: [] })
    const section = sections.at(-1)
    if (!section) continue
    if (line.startsWith('- ')) section.items.push(line.slice(2).trim())
    else if (/^\s+\S/.test(line) && section.items.length) section.items[section.items.length - 1] += ` ${line.trim()}`
  }
  return sections
}

/** The notes of a version, or of the newest released one when it isn't listed (a dev build). */
export function releaseNotes(sections: ChangelogSection[], version: string): ChangelogSection | null {
  const released = sections.filter((s) => s.title !== UNRELEASED)
  return released.find((s) => s.title === version) ?? released[0] ?? null
}

export const CHANGELOG = parseChangelog(changelog)
