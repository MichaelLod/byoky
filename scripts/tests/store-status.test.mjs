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

function stores({ ios = [ascVersion('1.1.1', 'READY_FOR_DISTRIBUTION')], mac = [ascVersion('1.1.0', 'READY_FOR_DISTRIBUTION')], amo, cws = {} } = {}) {
  return [
    { url: 'registry\\.npmjs\\.org', body: { version: '1.1.1' } },
    { url: 'clients2\\.google\\.com', body: '<?xml version="1.0"?><gupdate><app><updatecheck status="ok" version="1.1.1"/></app></gupdate>' },
    { method: 'POST', url: 'googleapis\\.com/oauth2/v4/token', body: { access_token: 'token' } },
    { url: 'chromewebstore\\.googleapis\\.com/v2/publishers/[^/]+/items/extid:fetchStatus', body: cws },
    {
      url: 'addons\\.mozilla\\.org/api/v5/addons/addon/byoky%40byoky\\.com/versions/',
      body: { results: amo ?? [{ version: '1.1.1', file: { status: 'public' } }] },
    },
    { url: 'api\\.appstoreconnect\\.apple\\.com/v1/apps\\?', body: { data: [{ id: 'APP1' }] } },
    { url: 'appStoreVersions\\?filter\\[platform\\]=IOS', body: { data: ios } },
    { url: 'appStoreVersions\\?filter\\[platform\\]=MAC_OS', body: { data: mac } },
    { url: 'play\\.google\\.com', body: '<html>[[["1.1.1"]]</html>' },
  ]
}

function status(routes) {
  const r = runWithFetchStub('store-status.mjs', ['--json'], { routes, env: ENV })
  const json = r.code === 0 || r.code === 3 ? JSON.parse(r.out) : undefined
  const byId = Object.fromEntries((json?.results ?? []).map((x) => [x.id, x]))
  return { ...r, byId }
}

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
