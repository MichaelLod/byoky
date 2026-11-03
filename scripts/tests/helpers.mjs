// Shared by the release-script tests (node --test scripts/tests/).

import { spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))
const STUB = pathToFileURL(join(SCRIPTS, 'tests', 'fetch-stub.mjs')).href

// A throwaway App Store Connect key: the scripts sign their JWT with it.
const ascKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })

export const FAKE_ASC_ENV = { ASC_KEY_ID: 'TESTKEY', ASC_ISSUER_ID: 'test-issuer', ASC_PRIVATE_KEY: ascKey }

// Runs a script (node, or bash whose node calls get the stub through
// NODE_OPTIONS) with fetch stubbed (see fetch-stub.mjs) and only the given
// environment, so real credentials in the shell never reach it. HOME is a
// fresh directory; setup(home) can fill it, inspect(home) look at it after.
// Returns the exit code, the output and every request the script made.
export function runWithFetchStub(script, args, { routes, env = {}, setup, inspect }) {
  const dir = mkdtempSync(join(tmpdir(), 'byoky-script-test-'))
  try {
    const home = join(dir, 'home')
    mkdirSync(home)
    setup?.(home)
    const routesFile = join(dir, 'routes.json')
    const log = join(dir, 'calls.log')
    writeFileSync(routesFile, JSON.stringify(routes))
    const [cmd, cmdArgs] = script.endsWith('.sh')
      ? ['bash', [join(SCRIPTS, script), ...args]]
      : [process.execPath, ['--import', STUB, join(SCRIPTS, script), ...args]]
    const res = spawnSync(cmd, cmdArgs, {
      env: {
        PATH: process.env.PATH,
        HOME: home,
        // The scripts read nothing from the checkout's .env / .env.local.
        BYOKY_ENV_FILES: '0',
        FETCH_STUB_ROUTES: routesFile,
        FETCH_STUB_LOG: log,
        ...(script.endsWith('.sh') ? { NODE_OPTIONS: `--import=${STUB}` } : {}),
        ...env,
      },
      encoding: 'utf8',
      timeout: 30_000,
    })
    const calls = existsSync(log)
      ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : []
    inspect?.(home)
    return { code: res.status, out: res.stdout + res.stderr, calls }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export const writes = (calls) => calls.filter((c) => c.method !== 'GET')

// A throwaway Google Play service account for upload-google-play.mjs, which
// signs its JWT with the key and asks token_uri for a token.
let playKey
export function writePlayServiceAccount(path) {
  playKey ??= generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' })
  writeFileSync(path, JSON.stringify({
    client_email: 'release@example.iam.gserviceaccount.com',
    private_key: playKey,
    token_uri: 'https://oauth2.googleapis.com/token',
  }))
  return path
}

// The Android Publisher API as upload-google-play.mjs uses it, with edit E1.
// `track` is the reply to reading the production track, `bundles` the reply
// to the bundle upload.
const PLAY_API = 'androidpublisher/v3/applications/com\\.byoky\\.app'
export function playRoutes({ track = { body: { track: 'production', releases: [] } }, bundles = { body: { versionCode: 31 } } } = {}) {
  return [
    { method: 'POST', url: '^https://oauth2\\.googleapis\\.com/token$', body: { access_token: 'play-token' } },
    { method: 'POST', url: `${PLAY_API}/edits$`, body: { id: 'E1' } },
    { url: `${PLAY_API}/edits/E1/tracks/production$`, ...track },
    { method: 'DELETE', url: `${PLAY_API}/edits/E1$`, status: 204 },
    { method: 'POST', url: `upload/${PLAY_API}/edits/E1/bundles`, ...bundles },
    { method: 'PUT', url: `${PLAY_API}/edits/E1/tracks/production$`, body: {} },
    { method: 'POST', url: `${PLAY_API}/edits/E1:commit$`, body: { id: 'E1' } },
  ]
}
export const onTrack = (...versionCodes) => ({ body: { track: 'production', releases: [{ name: 'r', status: 'completed', versionCodes }] } })
// What Play answers a bundle whose version code it has seen.
export const PLAY_VERSION_CODE_USED = {
  status: 403,
  body: { error: { code: 403, message: 'APK specifies a version code that has already been used.', status: 'PERMISSION_DENIED' } },
}
export const editDeleted = (calls) => calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/edits/E1'))
