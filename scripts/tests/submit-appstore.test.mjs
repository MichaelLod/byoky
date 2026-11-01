import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWithFetchStub, writes, FAKE_ASC_ENV } from './helpers.mjs'

const V = '1.1.2'
const ASC = 'https://api\\.appstoreconnect\\.apple\\.com/v1'

const version = (id, versionString, state) => ({ id, attributes: { versionString, appVersionState: state, appStoreState: state } })
const build = (state) => ({ id: 'B1', attributes: { version: '31', processingState: state } })

// App Store Connect as the script sees it. `builds` is the sequence of
// answers to the builds query (polling takes the next one each time).
function asc({ versions = [], builds = [[]], v1Submit = 201, reviewSubmissions = [] }) {
  return [
    { url: `${ASC}/apps\\?filter`, body: { data: [{ id: 'APP1' }] } },
    { url: `${ASC}/apps/APP1/appStoreVersions`, body: { data: versions } },
    { url: `${ASC}/builds\\?`, sequence: builds.map((data) => ({ body: { data } })) },
    { method: 'POST', url: `${ASC}/appStoreVersions$`, body: { data: version('VNEW', V, 'PREPARE_FOR_SUBMISSION') } },
    { method: 'PATCH', url: `${ASC}/appStoreVersions/[^/]+$`, body: { data: version('VOLD', V, 'PREPARE_FOR_SUBMISSION') } },
    { url: `${ASC}/appStoreVersions/[^/]+/appStoreVersionLocalizations`, body: { data: [{ id: 'LOC1', attributes: { locale: 'en-US', keywords: 'x' } }] } },
    { method: 'PATCH', url: `${ASC}/appStoreVersionLocalizations/LOC1`, body: { data: {} } },
    { method: 'PATCH', url: `${ASC}/appStoreVersions/[^/]+/relationships/build`, status: 204 },
    v1Submit === 201
      ? { method: 'POST', url: `${ASC}/appStoreVersionSubmissions`, status: 201, body: { data: {} } }
      : { method: 'POST', url: `${ASC}/appStoreVersionSubmissions`, status: v1Submit, body: { errors: [{ detail: 'v1 refused' }] } },
    { url: `${ASC}/reviewSubmissions\\?`, body: { data: reviewSubmissions } },
    { method: 'POST', url: `${ASC}/reviewSubmissions$`, body: { data: { id: 'RSNEW', attributes: { state: 'READY_FOR_REVIEW' } } } },
    { method: 'POST', url: `${ASC}/reviewSubmissionItems`, status: 201, body: { data: {} } },
    { method: 'PATCH', url: `${ASC}/reviewSubmissions/[^/]+$`, body: { data: {} } },
  ]
}

function submit(routes, env = {}) {
  return runWithFetchStub('submit-appstore.mjs', [V, 'IOS'], {
    routes,
    env: { ...FAKE_ASC_ENV, ASC_BUILD_POLL_SEC: '0', ASC_BUILD_WAIT_MIN: '0', ...env },
  })
}

test('no build in App Store Connect exits 3 and changes nothing', () => {
  const r = submit(asc({ builds: [[]] }))
  assert.equal(r.code, 3, r.out)
  assert.deepEqual(writes(r.calls), [])
})

test('a build still processing at the deadline exits 2 and changes nothing', () => {
  const r = submit(asc({ builds: [[build('PROCESSING')]] }), { ASC_BUILD_WAIT_MIN: '0.0005' })
  assert.equal(r.code, 2, r.out)
  assert.deepEqual(writes(r.calls), [])
})

test('a failed build exits 1', () => {
  const r = submit(asc({ builds: [[build('FAILED')]] }))
  assert.equal(r.code, 1, r.out)
  assert.deepEqual(writes(r.calls), [])
})

test('waits for the build to process, then creates the version and submits it', () => {
  const r = submit(asc({ builds: [[], [build('PROCESSING')], [build('VALID')]] }), { ASC_BUILD_WAIT_MIN: '1' })
  assert.equal(r.code, 0, r.out)
  assert.equal(r.calls.filter((c) => c.url.includes('/builds?')).length, 3)
  const w = writes(r.calls).map((c) => `${c.method} ${new URL(c.url).pathname}`)
  assert.ok(w.includes('POST /v1/appStoreVersions'), w.join('\n'))
  assert.ok(w.includes('PATCH /v1/appStoreVersions/VNEW/relationships/build'), w.join('\n'))
  assert.ok(w.includes('POST /v1/appStoreVersionSubmissions'), w.join('\n'))
})

test('a rejected version is reused and its open submission resubmitted', () => {
  const r = submit(asc({
    versions: [version('VREJ', V, 'REJECTED'), version('V111', '1.1.1', 'READY_FOR_DISTRIBUTION')],
    builds: [[build('VALID')]],
    v1Submit: 409,
    reviewSubmissions: [{
      id: 'RS1',
      attributes: { state: 'UNRESOLVED_ISSUES' },
      relationships: { appStoreVersionForReview: { data: { type: 'appStoreVersions', id: 'VREJ' } } },
    }],
  }))
  assert.equal(r.code, 0, r.out)
  const w = writes(r.calls).map((c) => `${c.method} ${new URL(c.url).pathname}`)
  assert.ok(!w.includes('POST /v1/appStoreVersions'), `created a second version:\n${w.join('\n')}`)
  assert.ok(w.includes('PATCH /v1/appStoreVersions/VREJ/relationships/build'), w.join('\n'))
  assert.ok(!w.includes('POST /v1/reviewSubmissionItems'), w.join('\n'))
  assert.ok(w.includes('PATCH /v1/reviewSubmissions/RS1'), w.join('\n'))
  const query = r.calls.find((c) => c.url.includes('/reviewSubmissions?')).url
  assert.match(decodeURIComponent(query), /filter\[state\]=READY_FOR_REVIEW,UNRESOLVED_ISSUES/)
})

test('both submission APIs failing exits 1', () => {
  const routes = asc({ builds: [[build('VALID')]], v1Submit: 409 })
    .map((r) => (r.method === 'PATCH' && r.url.endsWith('/reviewSubmissions/[^/]+$')
      ? { ...r, status: 409, body: { errors: [{ detail: 'v2 refused' }] } }
      : r))
  const r = submit(routes)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /v1 refused/)
  assert.match(r.out, /v2 refused/)
})

test('another version in review blocks this one: exit 4, nothing changed', () => {
  const r = submit(asc({ versions: [version('V110', '1.1.0', 'WAITING_FOR_REVIEW')], builds: [[build('VALID')]] }))
  assert.equal(r.code, 4, r.out)
  assert.match(r.out, /v1\.1\.0 is WAITING_FOR_REVIEW/)
  assert.deepEqual(writes(r.calls), [])
})

test('this version already in review exits 0 without touching it', () => {
  const r = submit(asc({ versions: [version('V112', V, 'WAITING_FOR_REVIEW')] }))
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(writes(r.calls), [])
})

test('falls back to appStoreState when appVersionState is missing', () => {
  const old = { id: 'VREJ', attributes: { versionString: V, appStoreState: 'METADATA_REJECTED' } }
  const r = submit(asc({ versions: [old], builds: [[build('VALID')]] }))
  assert.equal(r.code, 0, r.out)
  const w = writes(r.calls).map((c) => `${c.method} ${new URL(c.url).pathname}`)
  assert.ok(!w.includes('POST /v1/appStoreVersions'), w.join('\n'))
  assert.ok(w.includes('PATCH /v1/appStoreVersions/VREJ/relationships/build'), w.join('\n'))
})
