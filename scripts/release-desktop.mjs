#!/usr/bin/env node
// Builds the Windows installer and uploads it, with the update files, as a DRAFT release on
// GitHub (see apps/desktop/electron-builder.yml), then has GitHub's macOS runner build the Mac
// app into the same draft (.github/workflows/release-mac.yml, docs/decisions/0045-macos.md) and
// waits for it. Nothing reaches the testers until the draft is published on GitHub. Run from
// apps/desktop with `npm run release`.
//
// The Mac is built from the commit on GitHub, so everything must be committed and pushed first:
// the script stops if the tree has changes or HEAD isn't on origin/main. Both builds then come
// from the same code.
//
// The GitHub token is read from GH_TOKEN in the root .env (never from the code). Use a
// fine-grained token limited to this repository with "Contents" and "Actions" set to "read and
// write" (Actions starts the Mac build).
// Bump "version" in apps/desktop/package.json first (e.g. 0.2.0-beta.2): updates only go to
// a higher version.
//
// The draft for the tag is created (or reused) BEFORE electron-builder runs: its uploads run in
// parallel and, with no release to find, each one used to create its own draft. At the end the
// script checks there is exactly one draft for the tag, holding the .exe, its .blockmap and
// latest.yml, plus the Mac's dmg and zip for both chips and latest-mac.yml.
//
// The release text is this version's section of CHANGELOG.md ("## <version>"): @aureum posts it
// in the avisos channel once the release is published (apps/api/app/bot/releases.py). It may not
// @mention anyone: on GitHub "@name" is a real account (there is a stranger called "aureum"),
// which would be notified and listed as a contributor of the release.
//
// `npm run release -- --notes-only` just rewrites the existing draft's text from CHANGELOG.md,
// without building or uploading anything.
// `npm run release -- --mac-only` builds only the Mac again (e.g. after its workflow failed): it
// removes the Mac files from the draft, starts the workflow and waits for it.

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

const MAC_WORKFLOW = 'release-mac.yml'
const MAC_WAIT_MS = 60 * 60 * 1000
const MAC_POLL_MS = 20 * 1000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
    const hint =
      response.status === 403 && path.startsWith('/actions/') ? ' Does GH_TOKEN have "Actions: read and write"?' : ''
    fail(`GitHub answered ${response.status} to ${method} ${path}.${hint} ${detail.slice(0, 300)}`)
  }
  return response.status === 204 ? null : response.json()
}

const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) fail(`git ${args.join(' ')} failed: ${(result.stderr || '').trim()}`)
  return result.stdout.trim()
}

/** The commit both builds come from: HEAD, with nothing uncommitted, already on origin/main. */
const pushedCommit = () => {
  if (git('status', '--porcelain')) {
    fail('there are uncommitted changes. Commit them (and push) first: the Mac is built from GitHub.')
  }
  git('fetch', '--quiet', 'origin', 'main')
  const sha = git('rev-parse', 'HEAD')
  const pushed = spawnSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], { cwd: root })
  if (pushed.status !== 0) {
    fail(`HEAD (${sha.slice(0, 7)}) is not on origin/main. Push main first: the Mac is built from GitHub.`)
  }
  return sha
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

const theDraft = async () => {
  const releases = await releasesForTag()
  if (releases.length !== 1) {
    fail(`expected exactly 1 release for ${tag} on GitHub, found ${releases.length}.`)
  }
  const [release] = releases
  if (!release.draft) fail(`the release for ${tag} is not a draft.`)
  return release
}

// Each required file must be there exactly once; the dmgs' and zips' .blockmap may come along.
// Anything else in the draft stops the release.
const REQUIRED = [
  ['the Windows installer (.exe)', (name) => name.endsWith('.exe')],
  ['the .exe.blockmap', (name) => name.endsWith('.exe.blockmap')],
  ['latest.yml', (name) => name === 'latest.yml'],
  ['the Apple Silicon dmg', (name) => name.endsWith('-arm64.dmg')],
  ['the Intel dmg', (name) => name.endsWith('-x64.dmg')],
  ['the Apple Silicon zip', (name) => name.endsWith('-arm64-mac.zip')],
  ['the Intel zip', (name) => name.endsWith('-x64-mac.zip')],
  ['latest-mac.yml', (name) => name === 'latest-mac.yml']
]
const isOptional = (name) => /\.(dmg|zip)\.blockmap$/.test(name)
const isMacFile = (name) => /\.(dmg|zip)(\.blockmap)?$/.test(name) || name === 'latest-mac.yml'

const verifyDraft = async () => {
  const release = await theDraft()
  const names = release.assets.map((asset) => asset.name)
  const problems = REQUIRED.filter(([, matches]) => names.filter(matches).length !== 1).map(([label]) => label)
  const unexpected = names.filter((name) => !isOptional(name) && !REQUIRED.some(([, matches]) => matches(name)))
  if (problems.length || unexpected.length) {
    fail(
      `the draft for ${tag} has: ${names.join(', ') || 'nothing'}.` +
        (problems.length ? ` Missing or repeated: ${problems.join(', ')}.` : '') +
        (unexpected.length ? ` Not expected: ${unexpected.join(', ')}.` : '')
    )
  }
  console.log(`\nOne draft for ${tag} with ${names.join(', ')}.`)
  console.log(`Review and publish it on GitHub to ship the update: ${release.html_url}`)
}

/** Clears the Mac files out of the draft, so a new Mac build uploads into a clean slate. */
const removeMacFiles = async () => {
  const release = await theDraft()
  for (const asset of release.assets.filter((a) => isMacFile(a.name))) {
    await github('DELETE', `/releases/assets/${asset.id}`)
    console.log(`Removed ${asset.name} from the draft.`)
  }
}

/** Starts the macOS workflow for this commit (title as in its run-name) and waits for it. */
const buildMac = async (sha) => {
  const title = `macOS ${version} at ${sha}`
  const startedAt = Date.now()
  await github('POST', `/actions/workflows/${MAC_WORKFLOW}/dispatches`, {
    ref: 'main',
    inputs: { sha, version, publish: 'true' }
  })
  console.log(`\nStarted the Mac build on GitHub (${title}). Waiting for it (usually 10-15 min)...`)
  let run = null
  let last = ''
  while (Date.now() - startedAt < MAC_WAIT_MS) {
    await sleep(MAC_POLL_MS)
    if (!run) {
      const { workflow_runs: runs } = await github(
        'GET',
        `/actions/workflows/${MAC_WORKFLOW}/runs?event=workflow_dispatch&per_page=20`
      )
      // A minute of slack for the clocks of this PC and GitHub.
      run = runs.find((r) => r.display_title === title && Date.parse(r.created_at) >= startedAt - 60_000) ?? null
      if (!run) continue
    }
    run = await github('GET', `/actions/runs/${run.id}`)
    const status = run.status === 'completed' ? `completed (${run.conclusion})` : run.status
    if (status !== last) console.log(`  Mac build: ${status}  ${run.html_url}`)
    last = status
    if (run.status !== 'completed') continue
    if (run.conclusion !== 'success') {
      fail(
        `the Mac build ended as "${run.conclusion}": ${run.html_url}. ` +
          'The Windows files are in the draft; fix it and run `npm run release -- --mac-only`.'
      )
    }
    return
  }
  fail(
    `the Mac build didn't finish within ${MAC_WAIT_MS / 60000} minutes` +
      (run ? `: ${run.html_url}.` : ' (it never showed up in Actions).') +
      ' When it ends, check the draft or run `npm run release -- --mac-only`.'
  )
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

if (process.argv.includes('--mac-only')) {
  const sha = pushedCommit()
  await removeMacFiles()
  await buildMac(sha)
  await verifyDraft()
  process.exit(0)
}

const sha = pushedCommit()
run(['run', 'build'])
await prepareDraft()
run(['exec', '--', 'electron-builder', '--win', '--publish', 'always'])
await buildMac(sha)
await verifyDraft()
