import { describe, expect, it } from 'vitest'

import { en, ptBR } from './resources'

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out.set(path, value)
    else for (const [k, v] of flatten(value, path)) out.set(k, v)
  }
  return out
}

/** {{variables}} and <1>tags</1> (react-i18next's Trans): a translation must keep the same ones. */
const markers = (text: string): string[] => [...text.matchAll(/\{\{\s*[\w.]+\s*\}\}|<\/?\d+>|<\/?[a-z]+>/g)].map((m) => m[0].replace(/\s/g, '')).sort()

describe('translations', () => {
  const pt = flatten(ptBR as unknown as Tree)
  const english = flatten(en as unknown as Tree)

  it('English has exactly the keys of Portuguese', () => {
    expect([...english.keys()].filter((k) => !pt.has(k))).toEqual([])
    expect([...pt.keys()].filter((k) => !english.has(k))).toEqual([])
  })

  it('keeps the same variables and tags', () => {
    const differ = [...pt].filter(([key, text]) => markers(text).join() !== markers(english.get(key) ?? '').join())
    expect(differ.map(([key]) => key)).toEqual([])
  })

  it('has no empty text', () => {
    expect([...pt, ...english].filter(([, text]) => !text.trim()).map(([key]) => key)).toEqual([])
  })
})
