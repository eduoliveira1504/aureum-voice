/// <reference types="node" />
/**
 * No fixed text left on the screens (block 4.2.6): every text people read comes from the
 * translation files. Flags text written straight in JSX, string props that are shown
 * (label, title, aria-label...), and any string with Portuguese accents. A string that must stay
 * as it is (a brand, a sample shortcut) goes in ALLOWED with the reason.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Tests run from apps/desktop (jsdom has no file: URL for import.meta).
const SRC = resolve(process.cwd(), 'src/renderer/src')

/** Props whose string value is shown to people. */
const TEXT_PROPS = new Set([
  'label', 'title', 'aria-label', 'placeholder', 'confirmLabel', 'description', 'message', 'subtitle',
  'hint', 'alt', 'text', 'heading', 'emptyText', 'tooltip', 'aria-description', 'aria-roledescription'
])

/** Calls whose string argument is shown (an error, a notice). */
const SHOWN_CALLS = /^(set(Error|Info|Status|Notice|Message|Hint|Toast)|toast|notify|flash|showToast)$/

/** Portuguese letters: a string with one of them is text for people (code and keys are ASCII). */
const PORTUGUESE = /[ãõçáéíóúâêôàÃÕÇÁÉÍÓÚÂÊÔÀ]/
const LETTERS = /\p{L}{2,}/u

/** "file › text" that stays fixed on purpose. */
const ALLOWED = new Set<string>([
  // Names: the app, its brand and the projects and services it credits or embeds.
  'components/AboutSettings.tsx › Aureum Voice',
  'components/AboutSettings.tsx › Excalidraw (MIT)',
  'components/AppearanceSettings.tsx › Aureum',
  'components/TopBar.tsx › Aureum',
  'components/Overlay.tsx › Aureum Voice — overlay',
  'components/LinkPreviews.tsx › YouTube',
  // KLIPY's attribution asks for these exact words.
  'components/Gifs.tsx › Search KLIPY',
  'components/Gifs.tsx › Powered by KLIPY',
  // Keys, units, a sample name and examples of what to type.
  'components/MessageActions.tsx › Del',
  'components/OverlayCameras.tsx › Fê',
  'components/OverlayCameras.tsx › px',
  'components/OverlaySettings.tsx › .exe',
  'components/ProfileEditor.tsx › https://…',
  'components/ServerSettings.tsx › @everyone',
  'screens/AuthScreen.tsx › http://localhost:8000',
  // The CHANGELOG's heading for what isn't released yet (matched, not shown).
  'lib/changelog.ts › Próxima versão'
])

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'test' ? [] : files(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$|\.d\.ts$/.test(entry.name) ? [path] : []
  })
}

/** Strings inside these calls are keys, logs or internal errors, not text on screen. */
function insideIgnoredCall(node: ts.Node): boolean {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText()
      if (/^(t|i18n\.t|console\.\w+|cn|twMerge|import|require|matchMedia|querySelector(All)?)$/.test(callee)) return true
    }
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isLiteralTypeNode(n)) return true
    if (ts.isJsxAttribute(n) && ['className', 'i18nKey', 'id', 'name', 'type', 'role', 'href', 'src', 'd'].includes(n.name.getText())) return true
  }
  return false
}

function findings(path: string): string[] {
  const text = readFileSync(path, 'utf8')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const file = relative(SRC, path).split(sep).join('/')
  const out: string[] = []
  const flag = (node: ts.Node, value: string): void => {
    const key = `${file} › ${value.trim()}`
    if (!ALLOWED.has(key)) out.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${value.trim()}`)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && LETTERS.test(node.text)) flag(node, node.text)
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent
      const shownProp =
        (ts.isJsxAttribute(parent) || (ts.isPropertyAssignment(parent) && parent.initializer === node)) &&
        TEXT_PROPS.has(parent.name.getText().replace(/['"]/g, ''))
      const shownCall = ts.isCallExpression(parent) && SHOWN_CALLS.test(parent.expression.getText())
      if (((shownProp || shownCall) && LETTERS.test(node.text)) || PORTUGUESE.test(node.text)) {
        if (!insideIgnoredCall(node)) flag(node, node.text)
      }
    } else if (ts.isTemplateExpression(node) && !insideIgnoredCall(node)) {
      // A template in a shown prop ({`${n} feitos`}) or with Portuguese letters.
      const parent = node.parent.kind === ts.SyntaxKind.JsxExpression ? node.parent.parent : node.parent
      const shownProp = ts.isJsxAttribute(parent) && TEXT_PROPS.has(parent.name.getText())
      const words = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ')
      if (PORTUGUESE.test(node.getText()) || (shownProp && LETTERS.test(words))) flag(node, node.getText())
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return out
}

describe('fixed text', () => {
  it('every text on screen comes from the translation files', () => {
    const found = files(SRC).flatMap(findings)
    // HARDCODED_TEXT_OUT=<file> writes the full list there (the diff below gets cut when it's long).
    if (process.env.HARDCODED_TEXT_OUT) writeFileSync(process.env.HARDCODED_TEXT_OUT, found.join('\n'))
    expect(found).toEqual([])
  })
})
