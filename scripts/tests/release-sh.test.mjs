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
  write(join(work, 'packages/extension/package.json'), '{}\n')
  write(join(work, 'packages/ios/Scripts/copy-wxt-output.sh'), '#!/bin/sh\necho "copy-wxt-output.sh" >> "$CALLS"\n', 0o755)
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

  for (const tool of ['gh', 'xcodebuild']) write(join(bin, tool), logArgs(tool), 0o755)
  // STUB_PNPM_FAIL="test" makes `pnpm test` fail.
  write(join(bin, 'pnpm'), logArgs('pnpm') + '[ "$*" = "${STUB_PNPM_FAIL:-}" ] && exit 1\nexit 0\n', 0o755)
  write(join(bin, 'xcrun'), logArgs('xcrun') + `case "$*" in
  "simctl list runtimes -j") echo '{"runtimes":[{"identifier":"rt.iOS-27-0","platform":"iOS","isAvailable":true,"version":"27.0","supportedDeviceTypes":[{"identifier":"dt.iPhone","productFamily":"iPhone"}]}]}' ;;
  "simctl create"*) echo UDID-1 ;;
esac
`, 0o755)
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

// --- branch, origin and tags ---

test('a branch other than main is an error unless --allow-branch', (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  s.git('checkout', '-q', '-b', 'release/1.1.2')
  const r = s.run(['1.1.2', '--dry', '--yes'])
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /ERROR: On 'release\/1\.1\.2', not main/)

  const allowed = s.run(['1.1.2', '--dry', '--allow-branch'])
  assert.equal(allowed.code, 0, allowed.out)
  assert.match(allowed.out, /WARN: On 'release\/1\.1\.2', not main \(--allow-branch\)/)
})

test('HEAD has to contain origin/main', (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  // Someone else pushed to main; this checkout is one commit behind.
  s.git('commit', '-q', '--allow-empty', '-m', 'elsewhere')
  s.git('push', '-q', 'origin', 'main')
  s.git('reset', '-q', '--hard', 'HEAD~1')
  const r = s.run(['1.1.2', '--dry'])
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /ERROR: HEAD doesn't contain origin\/main/)
})

test('an existing tag for the new version is an error', (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  s.git('tag', 'v1.1.2')
  const r = s.run(['1.1.2', '--dry'])
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /ERROR: Tag v1\.1\.2 already exists/)
})

test('a release tag newer than the tree (its bump missing from HEAD) is an error', (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  // v1.1.2 was released from a branch that never reached main.
  s.git('checkout', '-q', '-b', 'side')
  s.git('commit', '-q', '--allow-empty', '-m', 'Bump to v1.1.2')
  s.git('tag', 'v1.1.2')
  s.git('push', '-q', 'origin', 'v1.1.2')
  s.git('checkout', '-q', 'main')
  const r = s.run(['1.1.3', '--dry'])
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /ERROR: v1\.1\.2 is newer than this tree's 1\.1\.1/)
})

test('the new build number is above the one in the latest tag', (t) => {
  const s = sandbox({ versionCode: 31 })
  t.after(s.cleanup)
  // The tree's versionCode fell behind the tagged release's.
  const gradle = join(s.work, 'packages/android/app/build.gradle.kts')
  writeFileSync(gradle, readFileSync(gradle, 'utf8').replace('versionCode = 31', 'versionCode = 30'))
  s.git('commit', '-q', '-am', 'versionCode back to 30')
  s.git('push', '-q', 'origin', 'main')
  const r = s.run(['1.1.2', '--dry'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /\(code 30 → 32\)/)
})

test('no store credentials is an error unless --skip-store-uploads', (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  const none = { CHROME_EXTENSION_ID: '', CHROME_CLIENT_ID: '' }
  const r = s.run(['1.1.2', '--dry'], none)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /ERROR: No store credentials/)
  assert.equal(s.run(['1.1.2', '--dry', '--skip-store-uploads'], none).code, 0)
})

// --- uncommitted changes ---

test('uncommitted and untracked files are an error unless --allow-dirty', (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  write(join(s.work, 'packages/core/src/new-file.ts'), 'export {}\n')
  const untracked = s.run(['1.1.2', '--dry'])
  assert.equal(untracked.code, 1, untracked.out)
  assert.match(untracked.out, /ERROR: Uncommitted or untracked files would ship/)
  assert.match(untracked.out, /\?\? packages\//)

  rmSync(join(s.work, 'packages/core'), { recursive: true })
  writeFileSync(join(s.work, '.gitignore'), 'dist/\nbuild/\nchanged/\n')
  const modified = s.run(['1.1.2', '--dry'])
  assert.equal(modified.code, 1, modified.out)
  assert.match(modified.out, / M \.gitignore/)

  const allowed = s.run(['1.1.2', '--dry', '--allow-dirty'])
  assert.equal(allowed.code, 0, allowed.out)
  assert.match(allowed.out, /WARN: Uncommitted changes \(--allow-dirty\): they are BUILT AND SHIPPED but NOT committed/)
})

// --- verify ---

test('the tests run before anything is bumped, the native ones included', (t) => {
  const s = sandbox({ android: true })
  t.after(s.cleanup)
  const r = s.run(['1.1.2', '--dry'])
  assert.equal(r.code, 0, r.out)
  const order = ['pnpm install --frozen-lockfile', 'pnpm build:core', 'pnpm build:sdk', 'pnpm typecheck', 'pnpm test',
    'gradlew :app:testDebugUnitTest', 'xcrun simctl create byoky-release-tests-']
  let at = -1
  for (const step of order) {
    const i = r.calls.indexOf(step, at + 1)
    assert.ok(i > at, `${step} missing or out of order:\n${r.calls}`)
    at = i
  }
  assert.match(r.calls, /xcodebuild test -project packages\/ios\/Byoky\.xcodeproj -scheme Byoky -only-testing:ByokyTests -destination id=UDID-1 .*CODE_SIGN_IDENTITY=- /)
  assert.match(r.calls, /xcrun simctl delete UDID-1/)

  const skipped = s.run(['1.1.2', '--dry', '--skip-native-tests'])
  assert.equal(skipped.code, 0, skipped.out)
  assert.doesNotMatch(skipped.calls, /gradlew|xcodebuild test/)
  assert.match(skipped.out, /WARN: --skip-native-tests/)
})

test('a failing test stops the release before the bump', (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  const r = s.run(['1.1.2', '--yes'], { STUB_PNPM_FAIL: 'test' })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /Error: 'pnpm test' failed\. Nothing was bumped or published\./)
  assert.match(readFileSync(join(s.work, 'package.json'), 'utf8'), /"version": "1\.1\.1"/)
})
