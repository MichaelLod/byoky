// Shared by the release-script tests (node --test scripts/tests/).

import { spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))
const STUB = pathToFileURL(join(SCRIPTS, 'tests', 'fetch-stub.mjs')).href

// A throwaway App Store Connect key: the scripts sign their JWT with it.
const ascKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })

export const FAKE_ASC_ENV = { ASC_KEY_ID: 'TESTKEY', ASC_ISSUER_ID: 'test-issuer', ASC_PRIVATE_KEY: ascKey }

// Runs a script with fetch stubbed (see fetch-stub.mjs) and only the given
// environment, so real credentials in the shell never reach it. Returns the
// exit code, the output and every request the script made.
export function runWithFetchStub(script, args, { routes, env = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'byoky-script-test-'))
  try {
    const routesFile = join(dir, 'routes.json')
    const log = join(dir, 'calls.log')
    writeFileSync(routesFile, JSON.stringify(routes))
    const res = spawnSync(process.execPath, ['--import', STUB, join(SCRIPTS, script), ...args], {
      env: { PATH: process.env.PATH, HOME: dir, FETCH_STUB_ROUTES: routesFile, FETCH_STUB_LOG: log, ...env },
      encoding: 'utf8',
      timeout: 30_000,
    })
    const calls = existsSync(log)
      ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : []
    return { code: res.status, out: res.stdout + res.stderr, calls }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export const writes = (calls) => calls.filter((c) => c.method !== 'GET')
