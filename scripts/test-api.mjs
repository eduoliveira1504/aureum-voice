#!/usr/bin/env node
// Runs the API test suite in a throwaway container on the compose network (see
// infra/docker-compose.test.yml). Works whether the stack runs in dev or plan B mode, and never
// recreates the running containers. Extra arguments go to pytest:
//
//   node scripts/test-api.mjs
//   node scripts/test-api.mjs tests/test_attachments.py -k download -x

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(root, '.env'))) {
  console.error('Missing .env at the repository root (copy .env.example and fill it in).')
  process.exit(1)
}

const args = [
  'compose',
  '--env-file', '.env',
  '-f', 'infra/docker-compose.yml',
  '-f', 'infra/docker-compose.test.yml',
  'run', '--rm', '--build', 'api-test',
  'python', '-m', 'pytest', '-p', 'no:cacheprovider',
  ...process.argv.slice(2)
]
const result = spawnSync('docker', args, { cwd: root, stdio: 'inherit' })
process.exit(result.status ?? 1)
