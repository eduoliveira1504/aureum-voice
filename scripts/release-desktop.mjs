#!/usr/bin/env node
// Builds the Windows installer and uploads it, with the update files, as a DRAFT release on
// GitHub (see apps/desktop/electron-builder.yml). Nothing reaches the testers until the draft
// is published on GitHub. Run from apps/desktop with `npm run release`.
//
// The GitHub token is read from GH_TOKEN in the root .env (never from the code). Use a
// fine-grained token limited to this repository with "Contents: read and write".
// Bump "version" in apps/desktop/package.json first (e.g. 0.2.0-beta.2): updates only go to
// a higher version.
//
// The draft for the tag is created (or reused) BEFORE electron-builder runs: its uploads run in
// parallel and, with no release to find, each one used to create its own draft. At the end the
// script checks there is exactly one draft for the tag, holding the .exe, its .blockmap and
// latest.yml.
//
// The release text is this version's section of CHANGELOG.md ("## <version>"): @aureum posts it
// in the avisos channel once the release is published (apps/api/app/bot/releases.py). It may not
// @mention anyone: on GitHub "@name" is a real account (there is a stranger called "aureum"),
// which would be notified and listed as a contributor of the release.
//
// `npm run release -- --notes-only` just rewrites the existing draft's text from CHANGELOG.md,
// without building or uploading anything.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const desktop = join(root, 'apps', 'desktop')
const envFile = join(root, '.env')

const line = existsSync(envFile)
  ? readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => /^\s*GH_TOKEN\s*=/.test(l))
  : undefined
const token = line?.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
if (!token) {
  console.error('GH_TOKEN is missing from the root .env (a GitHub token that can create releases).')
  process.exit(1)
}

const fail = (message) => {
  console.error(`\nRelease stopped: ${message}`)
  process.exit(1)
}

const { version } = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'))
const builderConfig = readFileSync(join(desktop, 'electron-builder.yml'), 'utf8')
const setting = (key) => builderConfig.match(new RegExp(`^\\s+${key}:\\s*(\\S+)`, 'm'))?.[1]
const owner = setting('owner')
const repo = setting('repo')
if (!owner || !repo) fail('publish.owner / publish.repo not found in electron-builder.yml.')
// electron-builder tags releases as "v" + version and names them after the version.
const tag = `v${version}`

const github = async (method, path, body) => {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    fail(`GitHub answered ${response.status} to ${method} ${path}. ${detail.slice(0, 300)}`)
  }
  return response.json()
}

const changelogNotes = () => {
  const file = join(root, 'CHANGELOG.md')
  const text = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r/g, '') : ''
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.trim() === `## ${version}`)
  if (start < 0) return ''
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim()
}

const notes = changelogNotes()
// "@name" outside `code`, not part of an e-mail address.
const mentions = notes.replace(/`[^`]*`/g, '').match(/(?<![\w.@`])@[A-Za-z0-9-]+/g)
if (mentions) {
  fail(
    `the CHANGELOG section for ${version} mentions ${[...new Set(mentions)].join(', ')}. On GitHub that ` +
      'notifies those accounts and lists them as contributors. Rephrase it (e.g. "a conta oficial do Aureum").'
  )
}
if (!notes) {
  console.warn(`CHANGELOG.md has no "## ${version}" section: the release (and @aureum's announcement) goes without notes.`)
}

// Drafts only show up in the list (never in /releases/tags/:tag), and they are listed first.
const releasesForTag = async () =>
  (await github('GET', '/releases?per_page=100')).filter((release) => release.tag_name === tag)

// Sent whole on every create or edit: editing a draft without tag_name turns it into an
// "untagged-..." draft, which would ship without its tag (and break updates).
const draftFields = { tag_name: tag, name: version, body: notes, draft: true, prerelease: false }

const prepareDraft = async () => {
  const existing = await releasesForTag()
  const published = existing.filter((release) => !release.draft)
  if (published.length) {
    fail(`${tag} is already published on GitHub. Bump "version" in apps/desktop/package.json.`)
  }
  if (existing.length > 1) {
    fail(
      `there are ${existing.length} drafts for ${tag} on GitHub. Delete the extra ones ` +
        '(keep one or none) and run the release again.'
    )
  }
  if (existing.length === 1) {
    await github('PATCH', `/releases/${existing[0].id}`, draftFields)
    console.log(`Reusing the existing draft for ${tag}.`)
    return
  }
  await github('POST', '/releases', draftFields)
  console.log(`Created the draft release for ${tag}.`)
}

const verifyDraft = async () => {
  const releases = await releasesForTag()
  if (releases.length !== 1) {
    fail(`expected exactly 1 release for ${tag} on GitHub, found ${releases.length}.`)
  }
  const [release] = releases
  if (!release.draft) fail(`the release for ${tag} is not a draft.`)
  const names = release.assets.map((asset) => asset.name)
  const missing = [
    ['the installer (.exe)', (name) => name.endsWith('.exe')],
    ['the .blockmap', (name) => name.endsWith('.exe.blockmap')],
    ['latest.yml', (name) => name === 'latest.yml']
  ].filter(([, matches]) => names.filter(matches).length !== 1)
  if (missing.length || names.length !== 3) {
    fail(
      `the draft for ${tag} should hold exactly the .exe, the .blockmap and latest.yml. ` +
        `It has: ${names.join(', ') || 'nothing'}.` +
        (missing.length ? ` Missing or repeated: ${missing.map(([label]) => label).join(', ')}.` : '')
    )
  }
  console.log(`\nOne draft for ${tag} with ${names.join(', ')}.`)
  console.log(`Review and publish it on GitHub to ship the update: ${release.html_url}`)
}

const run = (args) => {
  const result = spawnSync('npm', args, {
    cwd: desktop,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, GH_TOKEN: token }
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (process.argv.includes('--notes-only')) {
  const releases = await github('GET', '/releases?per_page=100')
  // Also finds a draft that an edit without the tag already turned into "untagged-...".
  const drafts = releases.filter((r) => r.draft && (r.tag_name === tag || (r.name === version && r.tag_name.startsWith('untagged-'))))
  if (drafts.length !== 1) fail(`expected exactly 1 draft for ${tag} on GitHub, found ${drafts.length}.`)
  await github('PATCH', `/releases/${drafts[0].id}`, draftFields)
  console.log(`Updated the text of the draft for ${tag}: ${drafts[0].html_url}`)
  process.exit(0)
}

run(['run', 'build'])
await prepareDraft()
run(['exec', '--', 'electron-builder', '--win', '--publish', 'always'])
await verifyDraft()
