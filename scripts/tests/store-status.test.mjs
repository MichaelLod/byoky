import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWithFetchStub, writes, FAKE_ASC_ENV } from './helpers.mjs'
import { isPending, compareVersionsDesc } from '../store-status.mjs'

const ENV = {
  ...FAKE_ASC_ENV,
  CHROME_EXTENSION_ID: 'extid',
  CHROME_CLIENT_ID: 'client',
  CHROME_CLIENT_SECRET: 'secret',
  CHROME_REFRESH_TOKEN: 'refresh',
  AMO_API_KEY: 'amo-key',
  AMO_API_SECRET: 'amo-secret',
}

const ascVersion = (versionString, state) => ({ attributes: { versionString, appVersionState: state, appStoreState: state } })

// `replies` overrides a store's reply by route name (crx, cws, amo, ascApps,
// ascIos, ascMac), e.g. { cws: { status: 500 } } or { crx: { networkError: 'x' } }.
function stores({ ios = [ascVersion('1.1.1', 'READY_FOR_DISTRIBUTION')], mac = [ascVersion('1.1.0', 'READY_FOR_DISTRIBUTION')], amo, cws = {}, replies = {} } = {}) {
  const route = (name, r) => ({ ...r, ...replies[name] })
  return [
    { url: 'registry\\.npmjs\\.org', body: { version: '1.1.1' } },
    route('crx', { url: 'clients2\\.google\\.com', body: '<?xml version="1.0"?><gupdate><app><updatecheck status="ok" version="1.1.1"/></app></gupdate>' }),
    { method: 'POST', url: 'googleapis\\.com/oauth2/v4/token', body: { access_token: 'token' } },
    route('cws', { url: 'chromewebstore\\.googleapis\\.com/v2/publishers/[^/]+/items/extid:fetchStatus', body: cws }),
    route('amo', {
      url: 'addons\\.mozilla\\.org/api/v5/addons/addon/byoky%40byoky\\.com/versions/',
      body: { results: amo ?? [{ version: '1.1.1', file: { status: 'public' } }] },
    }),
    route('ascApps', { url: 'api\\.appstoreconnect\\.apple\\.com/v1/apps\\?', body: { data: [{ id: 'APP1' }] } }),
    route('ascIos', { url: 'appStoreVersions\\?filter\\[platform\\]=IOS', body: { data: ios } }),
    route('ascMac', { url: 'appStoreVersions\\?filter\\[platform\\]=MAC_OS', body: { data: mac } }),
    { url: 'itunes\\.apple\\.com', body: { results: [{ bundleId: 'com.byoky.app', version: '1.1.1' }] } },
    { url: 'play\\.google\\.com', body: '<html>[[["1.1.1"]]</html>' },
  ]
}

function status(routes, { env = ENV, args = [] } = {}) {
  const r = runWithFetchStub('store-status.mjs', ['--json', ...args], { routes, env })
  const json = r.code === 0 || r.code === 3 ? JSON.parse(r.out) : undefined
  const byId = Object.fromEntries((json?.results ?? []).map((x) => [x.id, x]))
  return { ...r, byId }
}

const without = (...keys) => Object.fromEntries(Object.entries(ENV).filter(([k]) => !keys.includes(k)))

test('a macOS version waiting for review counts as pending (exit 3)', () => {
  const r = status(stores({ mac: [ascVersion('1.1.0', 'WAITING_FOR_REVIEW')] }))
  assert.equal(r.code, 3, r.out)
  assert.equal(r.byId['appstore-macos'].pending, true)
  assert.equal(r.byId['appstore-macos'].pendingVersion, '1.1.0')
  assert.equal(r.byId['appstore-ios'].pending, false)
  assert.ok(r.calls.some((c) => c.url.includes('filter[platform]=MAC_OS')))
})

test('a Firefox version awaiting review is seen, and counts as pending', () => {
  const r = status(stores({
    amo: [{ version: '1.1.0', file: { status: 'public' } }, { version: '1.1.1', file: { status: 'unreviewed' } }],
  }))
  assert.equal(r.code, 3, r.out)
  assert.equal(r.byId.firefox.version, '1.1.1')
  assert.equal(r.byId.firefox.pending, true)
  assert.ok(r.calls.some((c) => c.url.includes('filter=all_without_unlisted')))
})

test('a Chrome submission in review counts as pending (CWS API v2 fetchStatus)', () => {
  const r = status(stores({
    cws: { submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '1.1.2' }] } },
  }))
  assert.equal(r.code, 3, r.out)
  assert.equal(r.byId.chrome.version, '1.1.1')
  assert.equal(r.byId.chrome.submittedVersion, '1.1.2')
  assert.equal(r.byId.chrome.pending, true)
})

test('nothing pending exits 0, and the check only reads', () => {
  const r = status(stores())
  assert.equal(r.code, 0, r.out)
  assert.ok(Object.values(r.byId).every((x) => x.pending === false))
  assert.deepEqual(writes(r.calls).map((c) => c.url), ['https://www.googleapis.com/oauth2/v4/token'])
})

// A review state that couldn't be read may hide a review in progress, so
// it holds the release up like a pending one (exit 3, `unknown`).

test('an App Store Connect error counts as an unknown review state (exit 3), not as nothing pending', () => {
  const r = status(stores({ replies: { ascMac: { status: 500, body: { errors: [] } } } }))
  assert.equal(r.code, 3, r.out)
  assert.equal(r.byId['appstore-macos'].pending, false)
  assert.equal(r.byId['appstore-macos'].unknown, true)
  assert.match(r.byId['appstore-macos'].unknownReason, /appStoreVersions: HTTP 500/)
  assert.equal(r.byId['appstore-ios'].unknown, undefined)
})

test('App Store Connect not finding the app is an unknown review state', () => {
  const r = status(stores({ replies: { ascApps: { body: { data: [] } } } }))
  assert.equal(r.code, 3, r.out)
  assert.equal(r.byId['appstore-ios'].unknown, true)
  assert.equal(r.byId['appstore-macos'].unknown, true)
})

test('a failed Chrome fetchStatus counts as an unknown review state', () => {
  const r = status(stores({ replies: { cws: { status: 503 } } }))
  assert.equal(r.code, 3, r.out)
  assert.equal(r.byId.chrome.unknown, true)
  assert.match(r.byId.chrome.unknownReason, /fetchStatus: HTTP 503/)
})

test('a dropped CRX update check still asks the Web Store API for the review state', () => {
  const r = status(stores({
    replies: { crx: { networkError: 'fetch failed' } },
    cws: { submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '1.1.2' }] } },
  }))
  assert.equal(r.code, 3, r.out)
  assert.equal(r.byId.chrome.status, 'error')
  assert.equal(r.byId.chrome.pending, true)
  assert.ok(r.calls.some((c) => c.url.includes(':fetchStatus')))
})

test('an AMO error counts as an unknown review state', () => {
  const r = status(stores({ replies: { amo: { status: 401, body: {} } } }))
  assert.equal(r.code, 3, r.out)
  assert.equal(r.byId.firefox.unknown, true)
  assert.match(r.byId.firefox.unknownReason, /HTTP 401/)
})

test('credentials release.sh uploads with but that can\'t read the review state count as unknown', () => {
  // Chrome: release.sh uploads with CHROME_CLIENT_ID; fetchStatus also needs the refresh token.
  const chrome = status(stores(), { env: without('CHROME_REFRESH_TOKEN') })
  assert.equal(chrome.code, 3, chrome.out)
  assert.equal(chrome.byId.chrome.unknown, true)
  // App Store: altool uploads with the key id and issuer; the API needs the key too.
  const asc = status(stores(), { env: without('ASC_PRIVATE_KEY') })
  assert.equal(asc.code, 3, asc.out)
  assert.equal(asc.byId['appstore-macos'].unknown, true)
  assert.match(asc.byId['appstore-macos'].unknownReason, /ASC_PRIVATE_KEY missing/)
})

test('a store release.sh won\'t upload to (no credentials) doesn\'t hold the release up', () => {
  const r = status(stores(), { env: without('CHROME_CLIENT_ID', 'CHROME_REFRESH_TOKEN', 'ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_PRIVATE_KEY') })
  assert.equal(r.code, 0, r.out)
  assert.ok(Object.values(r.byId).every((x) => !x.unknown && !x.pending), r.out)
})

test('the table says which stores\' review state is unknown', () => {
  const r = runWithFetchStub('store-status.mjs', [], { routes: stores({ replies: { cws: { status: 500 } } }), env: ENV })
  assert.equal(r.code, 3, r.out)
  assert.match(r.out, /Review state UNKNOWN, counted as pending[^\n]*\n {2}Chrome: fetchStatus: HTTP 500/)
})

test('--ignore leaves a store out of the exit code but still reports it', () => {
  const mac = [ascVersion('1.1.0', 'WAITING_FOR_REVIEW')]
  const held = status(stores({ mac }), { args: ['--ignore=appstore-macos'] })
  assert.equal(held.code, 0, held.out)
  assert.equal(held.byId['appstore-macos'].pending, true)
  assert.equal(held.byId['appstore-macos'].ignored, true)

  const table = runWithFetchStub('store-status.mjs', ['--ignore=appstore-macos'], { routes: stores({ mac }), env: ENV })
  assert.equal(table.code, 0, table.out)
  assert.match(table.out, /App Store \(macOS\) v1\.1\.0 WAITING_FOR_REVIEW {2}\[ignored: not counted\]/)

  // Only the ignored store: a pending Chrome review still holds the release.
  const chrome = status(stores({
    mac,
    cws: { submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '1.1.2' }] } },
  }), { args: ['--ignore=appstore-macos'] })
  assert.equal(chrome.code, 3, chrome.out)
})

test('isPending knows each store\'s review states', () => {
  for (const s of ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'READY_FOR_REVIEW', 'PENDING_DEVELOPER_RELEASE', 'PROCESSING_FOR_APP_STORE']) {
    assert.equal(isPending('appstore', s), true, s)
  }
  for (const s of ['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION', 'PREPARE_FOR_SUBMISSION', 'REJECTED', undefined]) {
    assert.equal(isPending('appstore', s), false, String(s))
  }
  assert.equal(isPending('amo', 'unreviewed'), true)
  assert.equal(isPending('amo', 'public'), false)
  assert.equal(isPending('chrome', 'PENDING_REVIEW'), true)
  assert.equal(isPending('chrome', 'PUBLISHED'), false)
})

test('compareVersionsDesc sorts newest first', () => {
  assert.deepEqual(['1.1.0', '1.10.0', '1.2.0', '0.9.13'].sort(compareVersionsDesc), ['1.10.0', '1.2.0', '1.1.0', '0.9.13'])
})
