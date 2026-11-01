// release.sh in a throwaway repo: a local bare "origin", stub scripts for
// the store checks and shims for pnpm, npx, gh and the Xcode tools that log
// their arguments instead of doing anything. Nothing here touches the
// network, the real repo or a store.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SCRIPTS } from './helpers.mjs'

const NOT_PENDING = { localVersion: '1.1.1', results: [{ id: 'chrome', version: '1.1.1', pending: false }] }

function write(path, text, mode) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
  if (mode) chmodSync(path, mode)
}

// A repo at `version` with release.sh, pushed to its origin and tagged.
function sandbox({ version = '1.1.1', versionCode = 30, android = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'byoky-release-sh-'))
  const work = join(base, 'work')
  const bin = join(base, 'bin')
  const calls = join(base, 'calls.log')
  const git = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', join(base, 'origin.git')])
  mkdirSync(work)
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'tag.gpgsign', 'false')
  git('remote', 'add', 'origin', join(base, 'origin.git'))

  write(join(work, 'package.json'), JSON.stringify({ name: 'byoky', version }, null, 2) + '\n')
  write(join(work, 'packages/android/app/build.gradle.kts'),
    `android {\n    defaultConfig {\n        versionCode = ${versionCode}\n        versionName = "${version}"\n    }\n}\n`)
  if (android) write(join(work, 'packages/android/gradlew'), '#!/bin/sh\necho "gradlew $*" >> "$CALLS"\n', 0o755)
  write(join(work, '.gitignore'), 'dist/\nbuild/\n')
  mkdirSync(join(work, 'scripts/tests'), { recursive: true })
  copyFileSync(join(SCRIPTS, 'release.sh'), join(work, 'scripts/release.sh'))
  chmodSync(join(work, 'scripts/release.sh'), 0o755)
  const logArgs = (name) => `#!/bin/sh\necho "${name} $*" >> "$CALLS"\n`
  write(join(work, 'scripts/store-status.mjs'),
    "console.log(process.env.STUB_STATUS_JSON ?? '{\"results\":[]}'); process.exitCode = Number(process.env.STUB_STATUS_CODE ?? 0)\n")
  write(join(work, 'scripts/ios-signing.sh'), logArgs('ios-signing.sh') + 'exit "${STUB_SIGNING_EXIT:-0}"\n')
  write(join(work, 'scripts/scan-openclaw-plugin.mjs'), '')
  write(join(work, 'scripts/release-notes.mjs'), "console.log('notes')\n")
  write(join(work, 'scripts/generate-versions.mjs'), '')
  write(join(work, 'scripts/tests/ok.test.mjs'), "import { test } from 'node:test'\ntest('ok', () => {})\n")
  git('add', '-A')
  git('commit', '-q', '-m', `v${version}`)
  git('tag', `v${version}`)
  git('push', '-q', 'origin', 'main', '--tags')

  for (const tool of ['pnpm', 'gh', 'xcodebuild', 'xcrun']) write(join(bin, tool), logArgs(tool), 0o755)
  write(join(bin, 'npx'), logArgs('npx') + 'exit "${STUB_NPX_EXIT:-0}"\n', 0o755)

  const run = (args, env = {}) => {
    const res = spawnSync('bash', [join(work, 'scripts/release.sh'), ...args], {
      cwd: work,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: base,
        CALLS: calls,
        STUB_STATUS_JSON: JSON.stringify(NOT_PENDING),
        CHROME_EXTENSION_ID: 'extid',
        CHROME_CLIENT_ID: 'client',
        CHROME_CLIENT_SECRET: 'secret',
        CHROME_REFRESH_TOKEN: 'refresh',
        ...env,
      },
    })
    const log = existsSync(calls) ? readFileSync(calls, 'utf8') : ''
    rmSync(calls, { force: true })
    return { code: res.status, out: res.stdout + res.stderr, calls: log }
  }
  return { base, work, git, run, cleanup: () => rmSync(base, { recursive: true, force: true }) }
}

// --- retry ---

function released(t) {
  const s = sandbox({ version: '1.1.2', versionCode: 31 })
  t.after(s.cleanup)
  write(join(s.work, 'dist/byoky-chrome-v1.1.2.zip'), 'keyed')
  write(join(s.work, 'dist/byoky-chrome-v1.1.2-store.zip'), 'store')
  return s
}

test('retry uploads the Chrome store zip, not the keyed sideload zip', (t) => {
  const s = released(t)
  const r = s.run(['retry'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.calls, /npx chrome-webstore-upload upload --source dist\/byoky-chrome-v1\.1\.2-store\.zip /)
  assert.doesNotMatch(r.calls, /byoky-chrome-v1\.1\.2\.zip/)
  assert.match(r.out, /Retried 1 store/)
})

test('retry leaves a Chrome submission in review alone', (t) => {
  const s = released(t)
  const status = { results: [{ id: 'chrome', version: '1.1.1', pending: true, pendingVersion: '1.1.2', pendingState: 'PENDING_REVIEW' }] }
  const r = s.run(['retry'], { STUB_STATUS_JSON: JSON.stringify(status), STUB_STATUS_CODE: '3' })
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.calls, /chrome-webstore-upload/)
  assert.match(r.out, /v1\.1\.2 is PENDING_REVIEW; skipped/)

  const forced = s.run(['retry', '--allow-pending'], { STUB_STATUS_JSON: JSON.stringify(status), STUB_STATUS_CODE: '3' })
  assert.match(forced.calls, /chrome-webstore-upload upload --source dist\/byoky-chrome-v1\.1\.2-store\.zip/)
})

test('a failed retry upload is not counted and fails the run', (t) => {
  const s = released(t)
  const r = s.run(['retry'], { STUB_NPX_EXIT: '1' })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /Nothing retried/)
  assert.match(r.out, /Chrome Web Store: FAILED/)
})

// --- dry run ---

test('--dry only checks signing (ios-signing.sh --check), and a failed check is a warning', (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  const ok = s.run(['1.1.2', '--dry'])
  assert.equal(ok.code, 0, ok.out)
  assert.match(ok.calls, /^ios-signing\.sh --check$/m)
  assert.match(ok.out, /DRY RUN/)

  const notReady = s.run(['1.1.2', '--dry'], { STUB_SIGNING_EXIT: '1' })
  assert.equal(notReady.code, 0, notReady.out)
  assert.match(notReady.out, /WARN: iOS\/macOS signing isn't ready/)

  // A real run prepares signing (and may create certificates): no --check.
  const real = s.run(['1.1.2'], { STUB_SIGNING_EXIT: '1' })
  assert.equal(real.code, 1, real.out)
  assert.match(real.calls, /^ios-signing\.sh $/m)
})
