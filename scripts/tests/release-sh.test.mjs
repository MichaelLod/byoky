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
import { pathToFileURL } from 'node:url'
import { SCRIPTS, FAKE_ASC_ENV, writePlayServiceAccount, playRoutes, onTrack, PLAY_VERSION_CODE_USED, editDeleted } from './helpers.mjs'

// A whole run bumps with BSD sed and PlistBuddy, like release.sh on a Mac.
const MAC_ONLY = { skip: process.platform !== 'darwin' && 'release.sh past the bump needs macOS (BSD sed, PlistBuddy)' }

const NOT_PENDING = { localVersion: '1.1.1', results: [{ id: 'chrome', version: '1.1.1', pending: false }] }
const CWS_CLI = join(SCRIPTS, '..', 'node_modules', 'chrome-webstore-upload-cli', 'source', 'cli.js')
const CHROME_UPLOAD = /^npx chrome-webstore-upload --source dist\/byoky-chrome-v1\.1\.2-store\.zip --extension-id extid$/m

function write(path, text, mode) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
  if (mode) chmodSync(path, mode)
}

const plist = (version, build) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${build}</string>
</dict></plist>
`

// A repo at `version` laid out like byoky (the files release.sh bumps,
// stub scripts), pushed to its origin and tagged. Tools are shims that log
// to CALLS: pnpm (STUB_PNPM_FAIL="<args>" fails that call), npx
// (STUB_NPX_EXIT; for chrome-webstore-upload also the OAuth environment it
// got, and STUB_NPX_REAL=1 runs the workspace's real CLI with fetch stubbed),
// npm (`npm view` answers for STUB_NPM_PUBLISHED: "all" or
// package names), gh (STUB_GH_RELEASE_MISSING=1: no release yet), xcrun,
// xcodebuild (an export leaves an .ipa, or a .pkg for the macOS archive).
// The submit-appstore.mjs stub exits STUB_ASC_<IOS|MAC_OS>_QUICK for retry's
// first look (ASC_BUILD_WAIT_MIN=0) and STUB_ASC_<platform>_WAIT otherwise.
// `real` names scripts copied from scripts/ instead of stubbed; run them
// with run(args, env, routes) to give them a stubbed fetch (fetch-stub.mjs).
function sandbox({ version = '1.1.1', versionCode = 30, android = false, real = [] } = {}) {
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

  const pkg = (dir, name) => write(join(work, dir, 'package.json'), JSON.stringify({ name, version }, null, 2) + '\n')
  pkg('.', 'byoky')
  for (const [dir, name] of [['packages/core', '@byoky/core'], ['packages/sdk', '@byoky/sdk'], ['packages/extension', '@byoky/extension'],
    ['packages/bridge', '@byoky/bridge'], ['packages/web', '@byoky/web'], ['packages/openclaw-plugin', '@byoky/openclaw-plugin'],
    ['packages/create-byoky-app', 'create-byoky-app']]) pkg(dir, name)
  write(join(work, 'packages/android/app/build.gradle.kts'),
    `android {\n    defaultConfig {\n        versionCode = ${versionCode}\n        versionName = "${version}"\n    }\n}\n`)
  if (android) write(join(work, 'packages/android/gradlew'), '#!/bin/sh\necho "gradlew $*" >> "$CALLS"\n', 0o755)
  for (const f of ['packages/ios/Byoky/App/Info.plist', 'packages/ios/SafariExtension/Info.plist',
    'packages/ios/macOS/Info.plist', 'packages/ios/macOS/SafariExtension-macOS-Info.plist']) write(join(work, f), plist(version, versionCode))
  write(join(work, 'packages/ios/Scripts/copy-wxt-output.sh'), '#!/bin/sh\necho "copy-wxt-output.sh" >> "$CALLS"\n', 0o755)
  for (const out of ['chrome-mv3', 'firefox-mv2', 'safari-mv2']) {
    write(join(work, 'packages/extension/.output', out, 'manifest.json'), JSON.stringify({ version }) + '\n')
  }
  for (const f of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'README.md']) write(join(work, f), '\n')
  write(join(work, '.gitignore'), 'node_modules/\ndist/\n.output/\nbuild/\n.env\n.env.local\n')
  mkdirSync(join(work, 'scripts/tests'), { recursive: true })
  copyFileSync(join(SCRIPTS, 'release.sh'), join(work, 'scripts/release.sh'))
  chmodSync(join(work, 'scripts/release.sh'), 0o755)
  const logArgs = (name) => `#!/bin/sh\necho "${name} $*" >> "$CALLS"\n`
  write(join(work, 'scripts/store-status.mjs'), `import { appendFileSync } from 'node:fs'
appendFileSync(process.env.CALLS, ['store-status.mjs', ...process.argv.slice(2)].join(' ') + '\\n')
console.log(process.env.STUB_STATUS_JSON ?? '{"results":[]}'); process.exitCode = Number(process.env.STUB_STATUS_CODE ?? 0)
`)
  write(join(work, 'scripts/submit-appstore.mjs'), `import { appendFileSync } from 'node:fs'
const [version, platform] = process.argv.slice(2)
const wait = process.env.ASC_BUILD_WAIT_MIN
appendFileSync(process.env.CALLS, \`submit-appstore.mjs \${version} \${platform} wait=\${wait}\\n\`)
process.exitCode = Number(process.env[\`STUB_ASC_\${platform}_\${wait === '0' ? 'QUICK' : 'WAIT'}\`] ?? 0)
`)
  for (const name of ['ios-unit-tests.sh', ...real]) copyFileSync(join(SCRIPTS, name), join(work, 'scripts', name))
  write(join(work, 'scripts/ios-signing.sh'), logArgs('ios-signing.sh') + 'exit "${STUB_SIGNING_EXIT:-0}"\n')
  write(join(work, 'scripts/sync-mobile-bundle.sh'), logArgs('sync-mobile-bundle.sh'))
  write(join(work, 'scripts/scan-openclaw-plugin.mjs'), '')
  write(join(work, 'scripts/release-notes.mjs'), "console.log('notes')\n")
  write(join(work, 'scripts/generate-versions.mjs'), '')
  write(join(work, 'scripts/tests/ok.test.mjs'), "import { test } from 'node:test'\ntest('ok', () => {})\n")
  git('add', '-A')
  git('commit', '-q', '-m', `v${version}`)
  git('tag', `v${version}`)
  git('push', '-q', 'origin', 'main', '--tags')

  write(join(bin, 'xcodebuild'), logArgs('xcodebuild') + `prev=; archive=; out=
for a in "$@"; do
  [ "$prev" = -archivePath ] && archive="$a"
  [ "$prev" = -exportPath ] && out="$a"
  prev="$a"
done
case "$*" in *-exportArchive*)
  mkdir -p "$out"
  case "$archive" in *macOS*) echo pkg > "$out/Byoky.pkg" ;; *) echo ipa > "$out/Byoky.ipa" ;; esac ;;
esac
`, 0o755)
  write(join(bin, 'pnpm'), logArgs('pnpm') + '[ "$*" = "${STUB_PNPM_FAIL:-}" ] && exit 1\nexit 0\n', 0o755)
  write(join(bin, 'xcrun'), logArgs('xcrun') + `case "$*" in
  "simctl list runtimes -j") echo '{"runtimes":[{"identifier":"rt.iOS-27-0","platform":"iOS","isAvailable":true,"version":"27.0","supportedDeviceTypes":[{"identifier":"dt.iPhone","productFamily":"iPhone"}]}]}' ;;
  "simctl create"*) echo UDID-1 ;;
esac
`, 0o755)
  write(join(bin, 'npx'), logArgs('npx') + `if [ "$1" = chrome-webstore-upload ]; then
  echo "npx-env PUBLISHER_ID=\${PUBLISHER_ID:-} CLIENT_ID=\${CLIENT_ID:-} CLIENT_SECRET=\${CLIENT_SECRET:+set} REFRESH_TOKEN=\${REFRESH_TOKEN:+set}" >> "$CALLS"
  [ -n "\${STUB_NPX_REAL:-}" ] && shift && exec node "${CWS_CLI}" "$@"
fi
exit "\${STUB_NPX_EXIT:-0}"
`, 0o755)
  write(join(bin, 'npm'), `#!/bin/sh
if [ "$1" = view ]; then
  name="\${2%@*}"; ver="\${2##*@}"
  case " \${STUB_NPM_PUBLISHED:-} " in *" all "*|*" $name "*) echo "$ver" ;; esac
  exit 0
fi
echo "npm $*" >> "$CALLS"
`, 0o755)
  write(join(bin, 'gh'), logArgs('gh') + '[ "$1 $2" = "release view" ] && [ -n "${STUB_GH_RELEASE_MISSING:-}" ] && exit 1\nexit 0\n', 0o755)

  const fetchLog = join(base, 'fetch.log')
  const run = (args, env = {}, routes) => {
    const fetchEnv = {}
    if (routes) {
      writeFileSync(join(base, 'routes.json'), JSON.stringify(routes))
      Object.assign(fetchEnv, {
        NODE_OPTIONS: `--import=${pathToFileURL(join(SCRIPTS, 'tests', 'fetch-stub.mjs')).href}`,
        FETCH_STUB_ROUTES: join(base, 'routes.json'),
        FETCH_STUB_LOG: fetchLog,
      })
    }
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
        ...fetchEnv,
        ...env,
      },
    })
    const log = existsSync(calls) ? readFileSync(calls, 'utf8') : ''
    const fetches = existsSync(fetchLog)
      ? readFileSync(fetchLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : []
    rmSync(calls, { force: true })
    rmSync(fetchLog, { force: true })
    return { code: res.status, out: res.stdout + res.stderr, calls: log, fetches }
  }
  const origin = (...args) => execFileSync('git', ['-C', join(base, 'origin.git'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return { base, work, git, origin, run, cleanup: () => rmSync(base, { recursive: true, force: true }) }
}

// --- retry ---

function released(t, opts = {}) {
  const s = sandbox({ version: '1.1.2', versionCode: 31, ...opts })
  t.after(s.cleanup)
  write(join(s.work, 'dist/byoky-chrome-v1.1.2.zip'), 'keyed')
  write(join(s.work, 'dist/byoky-chrome-v1.1.2-store.zip'), 'store')
  const run = s.run
  s.run = (args, env = {}, routes) => run(args, { STUB_NPM_PUBLISHED: 'all', ...env }, routes)
  return s
}

test('retry uploads the Chrome store zip, not the keyed sideload zip', (t) => {
  const s = released(t)
  const r = s.run(['retry'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.calls, CHROME_UPLOAD)
  assert.doesNotMatch(r.calls, /byoky-chrome-v1\.1\.2\.zip/)
  assert.match(r.out, /Retried 1 store/)
})

// Google supported Web Store API v1.1 until 15 Oct 2026.
const CWS_V2 = 'https://chromewebstore.googleapis.com/upload/v2/publishers/29fa2c41-d315-4dfb-a14c-8919348cb737/items/extid'
const cwsRoutes = (upload) => [
  { method: 'POST', url: '^https://www\\.googleapis\\.com/oauth2/v4/token$', body: { access_token: 'token' } },
  { method: 'POST', url: ':upload$', ...upload },
  { method: 'POST', url: ':publish$', body: { state: 'PENDING_REVIEW' } },
]

test('the Chrome upload goes through Web Store API v2 under the publisher, with the OAuth values off the command line', (t) => {
  const s = released(t)
  const r = s.run(['retry'], { STUB_NPX_REAL: '1' }, cwsRoutes({ body: { uploadState: 'SUCCEEDED', crxVersion: '1.1.2' } }))
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(r.fetches.map((c) => `${c.method} ${c.url}`), [
    'POST https://www.googleapis.com/oauth2/v4/token',
    `POST ${CWS_V2}:upload`,
    `POST ${CWS_V2.replace('/upload/v2/', '/v2/')}:publish`,
  ])
  assert.match(r.fetches[0].body, /"client_id":"client".*"refresh_token":"refresh".*"client_secret":"secret"/)
  // Upload, then submit for review and publish once approved (no command).
  assert.match(r.calls, CHROME_UPLOAD)
  assert.match(r.calls, /^npx-env PUBLISHER_ID=29fa2c41-d315-4dfb-a14c-8919348cb737 CLIENT_ID=client CLIENT_SECRET=set REFRESH_TOKEN=set$/m)
  assert.doesNotMatch(r.calls, /--client|--refresh|--auto-publish| secret\b| refresh\b/)
  assert.match(r.out, /Chrome Web Store: uploaded, publishes after review/)

  const refused = s.run(['retry'], { STUB_NPX_REAL: '1' },
    cwsRoutes({ status: 400, body: { error: { code: 400, message: 'The version of the uploaded package is not larger than the published one.' } } }))
  assert.equal(refused.code, 1, refused.out)
  assert.match(refused.out, /not larger than the published one/)
  assert.match(refused.out, /Chrome Web Store: FAILED/)
  assert.ok(!refused.fetches.some((c) => c.url.endsWith(':publish')))
})

test('retry leaves a Chrome submission in review alone', (t) => {
  const s = released(t)
  const status = { results: [{ id: 'chrome', version: '1.1.1', pending: true, pendingVersion: '1.1.2', pendingState: 'PENDING_REVIEW' }] }
  const r = s.run(['retry'], { STUB_STATUS_JSON: JSON.stringify(status), STUB_STATUS_CODE: '3' })
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.calls, /chrome-webstore-upload/)
  assert.match(r.out, /v1\.1\.2 is PENDING_REVIEW; skipped/)

  const forced = s.run(['retry', '--allow-pending'], { STUB_STATUS_JSON: JSON.stringify(status), STUB_STATUS_CODE: '3' })
  assert.match(forced.calls, CHROME_UPLOAD)
})

test('retry leaves a store whose review state is unknown alone, and fails the run', (t) => {
  const s = released(t)
  const status = { results: [{ id: 'chrome', version: '1.1.1', pending: false, unknown: true, unknownReason: 'fetchStatus: HTTP 500' }] }
  const r = s.run(['retry'], { STUB_STATUS_JSON: JSON.stringify(status), STUB_STATUS_CODE: '3' })
  assert.equal(r.code, 1, r.out)
  assert.doesNotMatch(r.calls, /chrome-webstore-upload/)
  assert.match(r.out, /Chrome Web Store: NOT UPLOADED: its review state is unknown \(fetchStatus: HTTP 500\)/)

  const forced = s.run(['retry', '--allow-pending'], { STUB_STATUS_JSON: JSON.stringify(status), STUB_STATUS_CODE: '3' })
  assert.equal(forced.code, 0, forced.out)
  assert.match(forced.calls, CHROME_UPLOAD)
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

// --- store reviews ---

test('a pending review or an unreadable review state (store-status exit 3) stops the release unless --allow-pending', (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  const r = s.run(['1.1.2', '--dry'], { STUB_STATUS_CODE: '3' })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /Error: a review is pending, or a store's review state couldn't be read \(above\)/)
  assert.doesNotMatch(r.calls, /pnpm install/)

  const allowed = s.run(['1.1.2', '--dry', '--allow-pending'], { STUB_STATUS_CODE: '3' })
  assert.equal(allowed.code, 0, allowed.out)
  assert.match(allowed.out, /WARN: a review is pending, or a store's review state is unknown \(above\); --allow-pending releases anyway/)
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

  rmSync(join(s.work, 'packages/core/src'), { recursive: true })
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
  // The typecheck needs the bridge's dist (the OpenClaw plugin imports its types).
  const order = ['pnpm install --frozen-lockfile', 'pnpm build:core', 'pnpm build:sdk', 'pnpm --filter @byoky/bridge build',
    'pnpm --filter @byoky/extension exec wxt prepare', 'pnpm typecheck', 'pnpm test',
    'gradlew :app:testDebugUnitTest', 'xcrun simctl create byoky-release-tests-']
  let at = -1
  for (const step of order) {
    const i = r.calls.indexOf(step, at + 1)
    assert.ok(i > at, `${step} missing or out of order:\n${r.calls}`)
    at = i
  }
  // scripts/ios-unit-tests.sh: boots the simulator before the tests.
  assert.match(r.calls, /xcrun simctl bootstatus UDID-1 -b\nxcodebuild test -project packages\/ios\/Byoky\.xcodeproj -scheme Byoky -only-testing:ByokyTests -destination id=UDID-1 .*CODE_SIGN_IDENTITY=- /)
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

// --- a whole run, and picking up after a failure ---

const unzipList = (zip) => execFileSync('unzip', ['-l', zip], { encoding: 'utf8' })

test('a release from main bumps, commits, pushes main and the tag together, and reports each store', MAC_ONLY, (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  // A zip left by an earlier, failed run must not keep its old files.
  mkdirSync(join(s.base, 'stale'))
  write(join(s.base, 'stale/old-chunk.js'), 'old')
  mkdirSync(join(s.work, 'dist'))
  execFileSync('zip', ['-qj', join(s.work, 'dist/byoky-chrome-v1.1.2.zip'), join(s.base, 'stale/old-chunk.js')])

  // Files .gitignore leaves out never reach the public source zip.
  write(join(s.work, 'packages/extension/.env.local'), 'SECRET=from-env-local\n')
  write(join(s.work, 'packages/core/node_modules/dep/index.js'), 'dep')
  write(join(s.work, 'packages/sdk/dist/index.js'), 'built')

  const r = s.run(['1.1.2', '--yes', '--skip-mobile'], { STUB_GH_RELEASE_MISSING: '1' })
  assert.equal(r.code, 0, r.out)
  assert.equal(s.origin('log', '-1', '--format=%s', 'main').trim(), 'Bump to v1.1.2 (native 1.1.2/31)')
  assert.equal(s.origin('rev-parse', 'v1.1.2^{commit}'), s.origin('rev-parse', 'main'))
  assert.equal((r.calls.match(/^pnpm publish --access public --no-git-checks$/gm) ?? []).length, 5, r.calls)
  assert.match(r.calls, /^gh release create v1\.1\.2 .*--verify-tag/m)
  assert.match(r.out, /Chrome Web Store: uploaded, publishes after review/)
  assert.match(r.out, /Firefox Add-ons: skipped \(credentials not configured\)/)
  assert.doesNotMatch(unzipList(join(s.work, 'dist/byoky-chrome-v1.1.2.zip')), /old-chunk\.js/)
  const source = unzipList(join(s.work, 'dist/byoky-source-v1.1.2.zip'))
  assert.match(source, /tsconfig\.base\.json[\s\S]*BUILD-FIREFOX\.md/)
  assert.match(source, /packages\/core\/package\.json/)
  assert.doesNotMatch(source, /\.env\.local|node_modules|packages\/sdk\/dist|\.output/)
  const note = execFileSync('unzip', ['-p', join(s.work, 'dist/byoky-source-v1.1.2.zip'), 'BUILD-FIREFOX.md'], { encoding: 'utf8' })
  assert.ok(note.includes(`built with Node.js ${process.versions.node}.`), note)
})

test("BUILD-FIREFOX.md asks AMO's reviewers for the Node.js that package.json's engines require", () => {
  const note = readFileSync(join(SCRIPTS, 'release.sh'), 'utf8').match(/Requirements: Node\.js (\d+) or newer/)
  assert.ok(note, 'amo_build_note names no Node.js version')
  const { engines } = JSON.parse(readFileSync(join(SCRIPTS, '..', 'package.json'), 'utf8'))
  assert.equal(`>=${note[1]}`, engines.node)
})

test('--allow-branch pushes the release commit to main', MAC_ONLY, (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  s.git('checkout', '-q', '-b', 'release/1.1.2')
  const r = s.run(['1.1.2', '--yes', '--skip-mobile', '--allow-branch'])
  assert.equal(r.code, 0, r.out)
  assert.equal(s.origin('log', '-1', '--format=%s', 'main').trim(), 'Bump to v1.1.2 (native 1.1.2/31)')
  assert.throws(() => s.origin('rev-parse', '--verify', 'refs/heads/release/1.1.2'))
})

test('npm packages already published are skipped', MAC_ONLY, (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  const r = s.run(['1.1.2', '--yes', '--skip-mobile'], { STUB_NPM_PUBLISHED: '@byoky/core @byoky/sdk' })
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /@byoky\/core@1\.1\.2 is already on npm/)
  assert.equal((r.calls.match(/^pnpm publish /gm) ?? []).length, 3, r.calls)
})

test('a failure after the bump says how to undo it, and the next run explains the bumped tree', MAC_ONLY, (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  const r = s.run(['1.1.2', '--yes', '--skip-mobile'], { STUB_PNPM_FAIL: 'build' })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /The release stopped after the version bump\. Nothing was committed or published\./)
  assert.match(r.out, /git checkout -- package\.json packages\/core\/package\.json /)

  const again = s.run(['1.1.2', '--yes', '--skip-mobile'])
  assert.equal(again.code, 1, again.out)
  assert.match(again.out, /package\.json has 1\.1\.2 but the last commit 1\.1\.1: an earlier run bumped the tree and stopped before committing/)
})

test('a failed npm publish after the push points to retry', MAC_ONLY, (t) => {
  const s = sandbox()
  t.after(s.cleanup)
  const r = s.run(['1.1.2', '--yes', '--skip-mobile'], { STUB_PNPM_FAIL: 'publish --access public --no-git-checks' })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /v1\.1\.2 is tagged on origin, but npm, the stores or the GitHub release didn't all get it\.\nFinish with: \.\/scripts\/release\.sh retry/)
})

test('retry publishes missing npm packages from a clean checkout of the tag, and creates a missing GitHub release', (t) => {
  const s = released(t)
  const r = s.run(['retry'], { STUB_NPM_PUBLISHED: '@byoky/core', STUB_GH_RELEASE_MISSING: '1' })
  assert.equal(r.code, 0, r.out)
  assert.match(r.calls, /^pnpm build$/m)
  assert.equal((r.calls.match(/^pnpm publish /gm) ?? []).length, 4, r.calls)
  assert.match(r.calls, /^gh release create v1\.1\.2 .*--verify-tag/m)

  // Not on the tag: nothing is published from a different commit.
  s.git('commit', '-q', '--allow-empty', '-m', 'after the release')
  const off = s.run(['retry'], { STUB_NPM_PUBLISHED: '@byoky/core' })
  assert.equal(off.code, 1, off.out)
  assert.doesNotMatch(off.calls, /pnpm publish/)
  assert.match(off.out, /npm: NOT PUBLISHED: run retry again from a clean checkout of v1\.1\.2/)
})

test('pre-flight wants the Android upload keystore when the AAB goes to Google Play', (t) => {
  const s = sandbox({ android: true })
  t.after(s.cleanup)
  const r = s.run(['1.1.2', '--dry', '--skip-native-tests'], { GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: '/dev/null' })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /ERROR: packages\/android\/keystore\.properties is missing/)
})

// --- 1.1.2 to every store but the Mac, while macOS 1.1.0 waits for review ---

const ASC_API = 'https://api\\.appstoreconnect\\.apple\\.com/v1'
const ascVersion = (id, versionString, state) => ({ id, attributes: { versionString, appVersionState: state, appStoreState: state } })
const touchesMac = (c) => /VMAC|MAC_OS/.test(`${c.url} ${c.body ?? ''}`)
const ascWrites = (fetches) => fetches.filter((c) => c.method !== 'GET' && c.url.includes('appstoreconnect'))

// The stores as the real store-status.mjs and submit-appstore.mjs see them
// that day: macOS 1.1.0 waits for review, everything else is live at 1.1.1.
function storesWithMacInReview({ chromeState } = {}) {
  return [
    { url: 'registry\\.npmjs\\.org', body: { version: '1.1.1' } },
    { url: 'clients2\\.google\\.com', body: '<gupdate><app><updatecheck status="ok" version="1.1.1"/></app></gupdate>' },
    { method: 'POST', url: 'googleapis\\.com/oauth2/v4/token', body: { access_token: 'token' } },
    { url: ':fetchStatus', body: chromeState ? { submittedItemRevisionStatus: { state: chromeState, distributionChannels: [{ crxVersion: '1.1.1' }] } } : {} },
    { url: 'play\\.google\\.com', body: '<html>[[["1.1.1"]]</html>' },
    { url: `${ASC_API}/apps\\?filter`, body: { data: [{ id: 'APP1' }] } },
    { url: `${ASC_API}/apps/APP1/appStoreVersions\\?filter\\[platform\\]=IOS`, body: { data: [ascVersion('V111', '1.1.1', 'READY_FOR_DISTRIBUTION')] } },
    { url: `${ASC_API}/apps/APP1/appStoreVersions\\?filter\\[platform\\]=MAC_OS`, body: { data: [ascVersion('VMAC110', '1.1.0', 'WAITING_FOR_REVIEW')] } },
    { url: `${ASC_API}/builds\\?`, body: { data: [{ id: 'B1', attributes: { version: '31', processingState: 'VALID' } }] } },
    { method: 'POST', url: `${ASC_API}/appStoreVersions$`, body: { data: ascVersion('VNEW', '1.1.2', 'PREPARE_FOR_SUBMISSION') } },
    { url: `${ASC_API}/appStoreVersions/[^/]+/appStoreVersionLocalizations`, body: { data: [{ id: 'LOC1', attributes: { locale: 'en-US' } }] } },
    { method: 'PATCH', url: `${ASC_API}/appStoreVersionLocalizations/LOC1`, body: { data: {} } },
    { method: 'PATCH', url: `${ASC_API}/appStoreVersions/[^/]+/relationships/build`, status: 204 },
    { method: 'POST', url: `${ASC_API}/appStoreVersionSubmissions`, status: 201, body: { data: {} } },
  ]
}
const ASC_ENV = { ...FAKE_ASC_ENV, ASC_BUILD_WAIT_MIN: '0', ASC_BUILD_POLL_SEC: '0' }

function assertIosSubmitted(r) {
  assert.match(r.calls, /^xcrun altool --upload-app --file dist\/byoky-ios-v1\.1\.2\.ipa --type ios /m)
  const w = ascWrites(r.fetches)
  assert.ok(w.some((c) => c.url.endsWith('/v1/appStoreVersions') && /"platform":"IOS"/.test(c.body)), JSON.stringify(w, null, 1))
  assert.ok(w.some((c) => c.url.endsWith('/v1/appStoreVersionSubmissions')), JSON.stringify(w, null, 1))
  assert.match(r.out, /App Store \(iOS\): submitted for review/)
}

test('--hold-macos ships everything but the Mac app while macOS 1.1.0 is in review, and never touches it', MAC_ONLY, (t) => {
  const s = sandbox({ real: ['store-status.mjs', 'submit-appstore.mjs'] })
  t.after(s.cleanup)
  assert.match(s.run([]).out, /--hold-macos {11}Ship everything but the Mac app/)
  const args = ['1.1.2', '--yes', '--skip-native-tests']

  // Without it, the macOS review stops the release before anything happens.
  const stopped = s.run(args, ASC_ENV, storesWithMacInReview())
  assert.equal(stopped.code, 1, stopped.out)
  assert.match(stopped.out, /App Store \(macOS\) v1\.1\.0 WAITING_FOR_REVIEW/)
  assert.doesNotMatch(stopped.calls, /pnpm install/)

  // It holds back only the Mac app: a Chrome review still stops the release.
  const chrome = s.run([...args, '--hold-macos'], ASC_ENV, storesWithMacInReview({ chromeState: 'PENDING_REVIEW' }))
  assert.equal(chrome.code, 1, chrome.out)
  assert.match(chrome.out, /App Store \(macOS\) v1\.1\.0 WAITING_FOR_REVIEW {2}\[ignored: not counted\]/)
  assert.doesNotMatch(chrome.calls, /pnpm install/)

  const r = s.run([...args, '--hold-macos'], ASC_ENV, storesWithMacInReview())
  assert.equal(r.code, 0, r.out)
  assert.match(r.calls, /^xcodebuild archive .*-scheme Byoky \(macOS\) /m)
  assert.ok(existsSync(join(s.work, 'dist/byoky-macos-v1.1.2.pkg')), 'the Mac build is kept for retry')
  assert.doesNotMatch(r.calls, /altool --upload-app --file dist\/byoky-macos/)
  assertIosSubmitted(r)
  assert.deepEqual(ascWrites(r.fetches).filter(touchesMac), [])
  // submit-appstore.mjs never even looked at macOS (store-status asks with limit=10).
  assert.ok(!r.fetches.some((c) => c.url.includes('filter[platform]=MAC_OS&limit=50')))
  assert.match(r.out, /App Store \(macOS\): HELD \(--hold-macos\): dist\/byoky-macos-v1\.1\.2\.pkg not uploaded/)
})

test('xcodebuild and Gradle never see the variables .env and .env.local set', MAC_ONLY, (t) => {
  const s = sandbox({ android: true, real: ['store-status.mjs', 'submit-appstore.mjs'] })
  t.after(s.cleanup)
  // xcodebuild keeps its whole environment in DerivedData's build records.
  write(join(s.work, '.env'), 'BYOKY_PROBE_ENV=from-env\n')
  write(join(s.work, '.env.local'), 'export BYOKY_PROBE_LOCAL=from-local\n')
  const probe = (tool) => `echo "env-seen ${tool} [\${BYOKY_PROBE_ENV:-}\${BYOKY_PROBE_LOCAL:-}]" >> "$CALLS"\n`
  for (const shim of [join(s.base, 'bin/xcodebuild'), join(s.work, 'packages/android/gradlew')]) {
    const [shebang, ...rest] = readFileSync(shim, 'utf8').split('\n')
    write(shim, [shebang, probe(shim.endsWith('gradlew') ? 'gradlew' : 'xcodebuild'), ...rest].join('\n'), 0o755)
  }
  // The AAB a real bundleRelease leaves behind.
  write(join(s.work, 'packages/android/gradlew'), readFileSync(join(s.work, 'packages/android/gradlew'), 'utf8') +
    'case "$*" in *bundleRelease*) mkdir -p app/build/outputs/bundle/release && echo aab > app/build/outputs/bundle/release/app-release.aab ;; esac\n', 0o755)
  const r = s.run(['1.1.2', '--yes', '--hold-macos', '--allow-dirty'], ASC_ENV, storesWithMacInReview())
  assert.equal(r.code, 0, r.out)
  for (const step of [/^gradlew :app:testDebugUnitTest/m, /^xcodebuild test /m, /^gradlew bundleRelease/m,
    /^xcodebuild archive .*-scheme Byoky /m, /^xcodebuild -exportArchive /m]) assert.match(r.calls, step)
  const seen = r.calls.split('\n').filter((l) => l.startsWith('env-seen '))
  assert.ok(seen.length >= 6, r.calls)
  assert.deepEqual(seen.filter((l) => !l.endsWith(' []')), [])
})

test('--allow-pending uploads the Mac build, but no write reaches the macOS 1.1.0 in review, and iOS goes to review', MAC_ONLY, (t) => {
  const s = sandbox({ real: ['store-status.mjs', 'submit-appstore.mjs'] })
  t.after(s.cleanup)
  const r = s.run(['1.1.2', '--yes', '--skip-native-tests', '--allow-pending'], ASC_ENV, storesWithMacInReview())
  assert.equal(r.code, 0, r.out)
  assert.match(r.calls, /^xcrun altool --upload-app --file dist\/byoky-macos-v1\.1\.2\.pkg --type macos /m)
  assertIosSubmitted(r)
  assert.deepEqual(ascWrites(r.fetches).filter(touchesMac), [])
  assert.match(r.out, /App Store \(macOS\): PENDING: another version is in review/)
})

// --- retry and App Store builds ---

const RETRY_ASC = { ASC_KEY_ID: 'TESTKEY', ASC_ISSUER_ID: 'test-issuer' }

test('retry waits for a build it uploaded already instead of uploading it again', (t) => {
  const s = released(t)
  write(join(s.work, 'dist/byoky-ios-v1.1.2.ipa'), 'ipa')
  // App Store Connect doesn't list the build yet; macOS 1.1.0 is in review.
  const env = { ...RETRY_ASC, STUB_ASC_IOS_QUICK: '3', STUB_ASC_MAC_OS_QUICK: '4' }

  const first = s.run(['retry'], env)
  assert.equal(first.code, 0, first.out)
  assert.match(first.calls, /^xcrun altool --upload-app --file dist\/byoky-ios-v1\.1\.2\.ipa --type ios /m)

  // Minutes later it still isn't listed: wait for it; a second upload of the
  // same build number would be refused.
  const again = s.run(['retry'], env)
  assert.equal(again.code, 0, again.out)
  assert.doesNotMatch(again.calls, /altool --upload-app/)
  assert.match(again.calls, /submit-appstore\.mjs 1\.1\.2 IOS wait=0\nsubmit-appstore\.mjs 1\.1\.2 IOS wait=40\n/)
  assert.match(again.out, /App Store \(iOS\): submitted for review/)

  // Still nothing after the wait: say so and fail, without uploading again.
  const lost = s.run(['retry'], { ...env, STUB_ASC_IOS_WAIT: '3' })
  assert.equal(lost.code, 1, lost.out)
  assert.doesNotMatch(lost.calls, /altool --upload-app/)
  assert.match(lost.out, /App Store \(iOS\): NO BUILD in App Store Connect, although dist\/byoky-ios-v1\.1\.2\.ipa was uploaded/)

  // A different file under the same name (a rebuild) is uploaded.
  write(join(s.work, 'dist/byoky-ios-v1.1.2.ipa'), 'rebuilt ipa')
  const rebuilt = s.run(['retry'], env)
  assert.match(rebuilt.calls, /^xcrun altool --upload-app --file dist\/byoky-ios-v1\.1\.2\.ipa /m)
})

test('retry: a macOS version in review blocks the Mac upload, and --hold-macos leaves macOS out', (t) => {
  const s = released(t)
  write(join(s.work, 'dist/byoky-ios-v1.1.2.ipa'), 'ipa')
  write(join(s.work, 'dist/byoky-macos-v1.1.2.pkg'), 'pkg')
  const env = { ...RETRY_ASC, STUB_ASC_MAC_OS_QUICK: '4' }

  const blocked = s.run(['retry'], env)
  assert.equal(blocked.code, 0, blocked.out)
  assert.match(blocked.calls, /submit-appstore\.mjs 1\.1\.2 MAC_OS wait=0\n/)
  assert.doesNotMatch(blocked.calls, /altool --upload-app --file dist\/byoky-macos/)
  assert.match(blocked.out, /App Store \(macOS\): PENDING: another version is in review/)

  const held = s.run(['retry', '--hold-macos'], env)
  assert.equal(held.code, 0, held.out)
  assert.doesNotMatch(held.calls, /MAC_OS|byoky-macos/)
  assert.match(held.out, /App Store \(macOS\): held \(--hold-macos\)/)
  assert.match(held.calls, /submit-appstore\.mjs 1\.1\.2 IOS wait=0\n/)
})

// --- retry and Google Play ---

// v1.1.2 (versionCode 31) released; Chrome has it, Google Play's store page
// still shows 1.1.1. play(args, { track, bundles }) runs retry with the real
// upload-google-play.mjs against the Android Publisher API (playRoutes).
function playReleased(t) {
  const s = released(t, { real: ['upload-google-play.mjs'] })
  write(join(s.work, 'dist/byoky-android-v1.1.2.aab'), 'aab')
  const env = {
    GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: writePlayServiceAccount(join(s.base, 'play.json')),
    STUB_STATUS_JSON: JSON.stringify({ results: [{ id: 'chrome', version: '1.1.2', pending: false }] }),
  }
  const page = { url: 'play\\.google\\.com/store/apps', body: '<html>[[["1.1.1"]]</html>' }
  s.play = (args, opts) => s.run(args, env, [page, ...playRoutes(opts)])
  return s
}
const bundleUploads = (r) => r.fetches.filter((c) => c.url.includes('/bundles'))

test('retry leaves a Play update on the production track alone while Google reviews it', (t) => {
  const s = playReleased(t)
  // The release uploaded versionCode 31; Play would refuse it again.
  const r = s.play(['retry'], { track: onTrack('31'), bundles: PLAY_VERSION_CODE_USED })
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(bundleUploads(r), [])
  assert.ok(editDeleted(r.fetches))
  assert.match(r.out, /Google Play: v1\.1\.2 \(versionCode 31\) is on the production track already, in review or live; nothing to upload/)
  assert.match(r.out, /Nothing retried/)
})

test('retry uploads to Google Play when the production track lacks the version code', (t) => {
  const s = playReleased(t)
  const r = s.play(['retry'], { track: onTrack('30') })
  assert.equal(r.code, 0, r.out)
  assert.equal(bundleUploads(r).length, 1)
  assert.match(r.out, /Google Play: uploaded to the production track/)
  assert.match(r.out, /Retried 1 store/)
})

test("retry leaves Google Play alone when the production track can't be read, unless --allow-pending", (t) => {
  const s = playReleased(t)
  const unreadable = { track: { status: 500, body: { error: { message: 'backend error' } } }, bundles: PLAY_VERSION_CODE_USED }
  const r = s.play(['retry'], unreadable)
  assert.equal(r.code, 1, r.out)
  assert.deepEqual(bundleUploads(r), [])
  assert.match(r.out, /Google Play: NOT UPLOADED: its review state is unknown \(the production track couldn't be read\)/)

  // Forced, the upload finds the version code taken: it went up before.
  const forced = s.play(['retry', '--allow-pending'], unreadable)
  assert.equal(forced.code, 0, forced.out)
  assert.equal(bundleUploads(forced).length, 1)
  assert.match(forced.out, /Google Play: versionCode 31 went up before \(Google Play refuses it again\); nothing uploaded/)
  assert.doesNotMatch(forced.out, /FAILED/)
})
