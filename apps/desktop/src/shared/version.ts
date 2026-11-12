/**
 * Comparing the app's versions (0.2.0-beta.10, 0.2.0-beta.7.b, 1.0.0) the way semver does: numbers
 * by value, a release above its pre-releases, pre-release parts numeric below text. Used by the
 * window's own check against the API (block 4.1.4).
 */

function parse(version: string): { core: number[]; pre: string[] } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim())
  if (!match) return null
  return { core: match.slice(1, 4).map(Number), pre: match[4] ? match[4].split('.') : [] }
}

function comparePart(a: string, b: string): number {
  const na = /^\d+$/.test(a)
  const nb = /^\d+$/.test(b)
  if (na && nb) return Number(a) - Number(b)
  if (na !== nb) return na ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Negative if a is older than b, positive if newer, 0 if the same; null if either isn't valid. */
export function compareVersions(a: string, b: string): number | null {
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return null
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i]
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length // the release is newer
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const diff = comparePart(x.pre[i], y.pre[i])
    if (diff) return diff
  }
  return x.pre.length - y.pre.length
}

export function isNewer(candidate: string, installed: string): boolean {
  return (compareVersions(candidate, installed) ?? 0) > 0
}
