// scripts/ios-unit-tests.sh with shims for xcrun and xcodebuild that log
// their arguments instead of touching a simulator.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SCRIPTS } from './helpers.mjs'

// xcodebuild's `test` prints STUB_TEST_OUTPUT and exits STUB_TEST_EXIT;
// `test-without-building` exits STUB_RERUN_EXIT.
function run(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'byoky-ios-tests-'))
  try {
    const bin = join(dir, 'bin')
    const calls = join(dir, 'calls.log')
    mkdirSync(bin)
    writeFileSync(join(bin, 'xcrun'), `#!/bin/sh
echo "xcrun $*" >> "$CALLS"
case "$*" in
  "simctl list runtimes -j") echo '{"runtimes":[{"identifier":"rt.iOS-26-0","platform":"iOS","isAvailable":true,"version":"26.0","supportedDeviceTypes":[{"identifier":"dt.iPhone","productFamily":"iPhone"}]},{"identifier":"rt.iOS-27-0","platform":"iOS","isAvailable":true,"version":"27.0","supportedDeviceTypes":[{"identifier":"dt.iPad","productFamily":"iPad"},{"identifier":"dt.iPhone-17","productFamily":"iPhone"}]}]}' ;;
  "simctl create"*) echo UDID-1 ;;
esac
`, { mode: 0o755 })
    writeFileSync(join(bin, 'xcodebuild'), `#!/bin/sh
echo "xcodebuild $*" >> "$CALLS"
case "$1" in
  test) [ -n "\${STUB_TEST_OUTPUT:-}" ] && echo "$STUB_TEST_OUTPUT" >&2; exit "\${STUB_TEST_EXIT:-0}" ;;
  test-without-building) exit "\${STUB_RERUN_EXIT:-0}" ;;
esac
`, { mode: 0o755 })
    const res = spawnSync('bash', [join(SCRIPTS, 'ios-unit-tests.sh'), join(dir, 'dd'), ...(env.ARGS ?? [])], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, CALLS: calls, ...env },
    })
    return { code: res.status, out: res.stdout + res.stderr, calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '' }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const LAUNCH_FAILURE = 'IDELaunchReport: Launching ByokyTests Finished with error: Simulator device failed to launch com.byoky.app.'

test('boots its own simulator (newest runtime, an iPhone) and waits for it before the tests, then deletes it', () => {
  const r = run({ SIM_NAME: 'byoky-test-sim' })
  assert.equal(r.code, 0, r.out)
  const lines = r.calls.trim().split('\n')
  assert.deepEqual(lines.slice(0, 3), [
    'xcrun simctl list runtimes -j',
    'xcrun simctl create byoky-test-sim dt.iPhone-17 rt.iOS-27-0',
    'xcrun simctl bootstatus UDID-1 -b',
  ])
  assert.match(lines[3], /^xcodebuild test -project packages\/ios\/Byoky\.xcodeproj -scheme Byoky -only-testing:ByokyTests -destination id=UDID-1 -derivedDataPath \S+\/dd CODE_SIGN_IDENTITY=- /)
  assert.equal(lines.at(-1), 'xcrun simctl delete UDID-1')
  assert.doesNotMatch(r.calls, /test-without-building/)
})

test('a launch failure on the simulator runs the tests once more without building', () => {
  const r = run({ STUB_TEST_OUTPUT: LAUNCH_FAILURE, STUB_TEST_EXIT: '65', ARGS: ['--quiet'] })
  assert.equal(r.code, 0, r.out)
  assert.match(r.calls, /^xcodebuild test -project .* -quiet\nxcodebuild test-without-building -project .*-destination id=UDID-1 .* -quiet\n/m)
  assert.match(r.calls, /xcrun simctl delete UDID-1\n$/)

  const twice = run({ STUB_TEST_OUTPUT: LAUNCH_FAILURE, STUB_TEST_EXIT: '65', STUB_RERUN_EXIT: '65' })
  assert.notEqual(twice.code, 0, twice.out)
  assert.equal((twice.calls.match(/^xcodebuild /gm) ?? []).length, 2)
  assert.match(twice.calls, /xcrun simctl delete UDID-1\n$/)
})

test('any other failure fails without a second run', () => {
  const r = run({ STUB_TEST_OUTPUT: 'Testing failed: ProxyPolicyTests.testVectors() failed', STUB_TEST_EXIT: '65' })
  assert.equal(r.code, 1, r.out)
  assert.doesNotMatch(r.calls, /test-without-building/)
  assert.match(r.calls, /xcrun simctl delete UDID-1\n$/)
})
