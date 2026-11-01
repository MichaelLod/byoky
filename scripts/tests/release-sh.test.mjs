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

// A whole run bumps with BSD sed and PlistBuddy, like release.sh on a Mac.
const MAC_ONLY = { skip: process.platform !== 'darwin' && 'release.sh past the bump needs macOS (BSD sed, PlistBuddy)' }

const NOT_PENDING = { localVersion: '1.1.1', results: [{ id: 'chrome', version: '1.1.1', pending: false }] }

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
// (STUB_NPX_EXIT), npm (`npm view` answers for STUB_NPM_PUBLISHED: "all" or
// package names), gh (STUB_GH_RELEASE_MISSING=1: no release yet), xcrun,
// xcodebuild.
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
  write(join(work, '.gitignore'), 'dist/\nbuild/\n.output/\n')
  mkdirSync(join(work, 'scripts/tests'), { recursive: true })
  copyFileSync(join(SCRIPTS, 'release.sh'), join(work, 'scripts/release.sh'))
  chmodSync(join(work, 'scripts/release.sh'), 0o755)
  const logArgs = (name) => `#!/bin/sh\necho "${name} $*" >> "$CALLS"\n`
  write(join(work, 'scripts/store-status.mjs'),
    "console.log(process.env.STUB_STATUS_JSON ?? '{\"results\":[]}'); process.exitCode = Number(process.env.STUB_STATUS_CODE ?? 0)\n")
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

  write(join(bin, 'xcodebuild'), logArgs('xcodebuild'), 0o755)
  write(join(bin, 'pnpm'), logArgs('pnpm') + '[ "$*" = "${STUB_PNPM_FAIL:-}" ] && exit 1\nexit 0\n', 0o755)
  write(join(bin, 'xcrun'), logArgs('xcrun') + `case "$*" in
  "simctl list runtimes -j") echo '{"runtimes":[{"identifier":"rt.iOS-27-0","platform":"iOS","isAvailable":true,"version":"27.0","supportedDeviceTypes":[{"identifier":"dt.iPhone","productFamily":"iPhone"}]}]}' ;;
  "simctl create"*) echo UDID-1 ;;
esac
`, 0o755)
  write(join(bin, 'npx'), logArgs('npx') + 'exit "${STUB_NPX_EXIT:-0}"\n', 0o755)
  write(join(bin, 'npm'), `#!/bin/sh
if [ "$1" = view ]; then
  name="\${2%@*}"; ver="\${2##*@}"
  case " \${STUB_NPM_PUBLISHED:-} " in *" all "*|*" $name "*) echo "$ver" ;; esac
  exit 0
fi
echo "npm $*" >> "$CALLS"
`, 0o755)
  write(join(bin, 'gh'), logArgs('gh') + '[ "$1 $2" = "release view" ] && [ -n "${STUB_GH_RELEASE_MISSING:-}" ] && exit 1\nexit 0\n', 0o755)

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
  const origin = (...args) => execFileSync('git', ['-C', join(base, 'origin.git'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return { base, work, git, origin, run, cleanup: () => rmSync(base, { recursive: true, force: true }) }
}

// --- retry ---

function released(t) {
  const s = sandbox({ version: '1.1.2', versionCode: 31 })
  t.after(s.cleanup)
  write(join(s.work, 'dist/byoky-chrome-v1.1.2.zip'), 'keyed')
  write(join(s.work, 'dist/byoky-chrome-v1.1.2-store.zip'), 'store')
  const run = s.run
  s.run = (args, env = {}) => run(args, { STUB_NPM_PUBLISHED: 'all', ...env })
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

  const r = s.run(['1.1.2', '--yes', '--skip-mobile'], { STUB_GH_RELEASE_MISSING: '1' })
  assert.equal(r.code, 0, r.out)
  assert.equal(s.origin('log', '-1', '--format=%s', 'main').trim(), 'Bump to v1.1.2 (native 1.1.2/31)')
  assert.equal(s.origin('rev-parse', 'v1.1.2^{commit}'), s.origin('rev-parse', 'main'))
  assert.equal((r.calls.match(/^pnpm publish --access public --no-git-checks$/gm) ?? []).length, 5, r.calls)
  assert.match(r.calls, /^gh release create v1\.1\.2 .*--verify-tag/m)
  assert.match(r.out, /Chrome Web Store: uploaded, publishes after review/)
  assert.match(r.out, /Firefox Add-ons: skipped \(credentials not configured\)/)
  assert.doesNotMatch(unzipList(join(s.work, 'dist/byoky-chrome-v1.1.2.zip')), /old-chunk\.js/)
  assert.match(unzipList(join(s.work, 'dist/byoky-source-v1.1.2.zip')), /tsconfig\.base\.json[\s\S]*BUILD-FIREFOX\.md/)
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
