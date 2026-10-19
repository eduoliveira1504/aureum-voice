#!/usr/bin/env node
// Builds the Windows installer and uploads it, with the update files, as a DRAFT release on
// GitHub (see apps/desktop/electron-builder.yml). Nothing reaches the testers until the draft
// is published on GitHub. Run from apps/desktop with `npm run release`.
//
// The GitHub token is read from GH_TOKEN in the root .env (never from the code). Use a
// fine-grained token limited to this repository with "Contents: read and write".
// Bump "version" in apps/desktop/package.json first (e.g. 0.2.0-beta.2): updates only go to
// a higher version.

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

const run = (args) => {
  const result = spawnSync('npm', args, {
    cwd: desktop,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, GH_TOKEN: token }
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(['run', 'build'])
run(['exec', '--', 'electron-builder', '--win', '--publish', 'always'])
console.log('Draft release uploaded. Review and publish it on GitHub to ship the update.')
