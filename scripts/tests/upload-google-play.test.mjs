import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWithFetchStub, writes, writePlayServiceAccount, playRoutes, onTrack, PLAY_VERSION_CODE_USED, editDeleted } from './helpers.mjs'

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'byoky-play-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const aab = join(dir, 'app.aab')
  writeFileSync(aab, 'aab')
  const env = { GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: writePlayServiceAccount(join(dir, 'play.json')) }
  const run = (args, opts) => runWithFetchStub('upload-google-play.mjs', args, { routes: playRoutes(opts), env })
  return { aab, run }
}

const committed = (calls) => calls.some((c) => c.url.endsWith('/edits/E1:commit'))

test('an upload assigns the bundle to the track and commits its edit', (t) => {
  const { aab, run } = setup(t)
  const r = run([aab, 'production'])
  assert.equal(r.code, 0, r.out)
  assert.ok(committed(r.calls), r.out)
  assert.ok(r.calls.some((c) => c.method === 'PUT' && /"versionCodes":\[31\],"status":"completed"/.test(c.body)))
  assert.ok(!editDeleted(r.calls))
})

test('a failed upload deletes its edit, and a version code Play has seen exits 4', (t) => {
  const { aab, run } = setup(t)
  const failed = run([aab, 'production'], { bundles: { status: 500, body: { error: { message: 'backend error' } } } })
  assert.equal(failed.code, 1, failed.out)
  assert.ok(editDeleted(failed.calls), failed.out)
  assert.ok(!committed(failed.calls))

  const used = run([aab, 'production'], { bundles: PLAY_VERSION_CODE_USED })
  assert.equal(used.code, 4, used.out)
  assert.match(used.out, /version code that has already been used/)
  assert.ok(editDeleted(used.calls), used.out)
  assert.ok(!committed(used.calls))
})

test('--track-has only reads: 0 when a release on the track lists the version code, 5 when none does, 1 when unreadable', (t) => {
  const { run } = setup(t)
  const listed = run(['--track-has', '31', 'production'], { track: onTrack('30', '31') })
  assert.equal(listed.code, 0, listed.out)
  assert.match(listed.out, /versionCode 31 is on the production track/)

  const missing = run(['--track-has', '31'], { track: onTrack('30') })
  assert.equal(missing.code, 5, missing.out)

  const empty = run(['--track-has', '31'], { track: { body: { track: 'production' } } })
  assert.equal(empty.code, 5, empty.out)

  const unreadable = run(['--track-has', '31'], { track: { status: 500, body: { error: { message: 'backend error' } } } })
  assert.equal(unreadable.code, 1, unreadable.out)

  for (const r of [listed, missing, empty, unreadable]) {
    assert.ok(r.calls.some((c) => c.method === 'GET' && c.url.endsWith('/edits/E1/tracks/production')), r.out)
    // The token request, the edit it reads in, and that edit deleted again.
    assert.deepEqual(writes(r.calls).map((c) => `${c.method} ${c.url.replace(/^.*\/applications\/com\.byoky\.app/, '')}`),
      ['POST https://oauth2.googleapis.com/token', 'POST /edits', 'DELETE /edits/E1'])
  }
})
