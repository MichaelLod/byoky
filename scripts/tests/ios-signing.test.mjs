import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { runWithFetchStub, writes, FAKE_ASC_ENV, SCRIPTS } from './helpers.mjs'

const ASC = 'https://api\\.appstoreconnect\\.apple\\.com/v1'
const PROFILES = [
  ['Byoky iOS App Store', 'mobileprovision'],
  ['Byoky iOS Safari Extension App Store', 'mobileprovision'],
  ['Byoky macOS App Store', 'provisionprofile'],
  ['Byoky macOS Safari Extension App Store', 'provisionprofile'],
]

// Two valid distribution certificates: A (this Mac's, older) and B (newer,
// another Mac's). The keychain identity hash is the SHA-1 of the DER bytes.
const der = { A: Buffer.from('certificate A'), B: Buffer.from('certificate B') }
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex').toUpperCase()
const cert = (id, expires) => ({
  id,
  attributes: { name: `Apple Distribution ${id}`, serialNumber: `S${id}`, expirationDate: expires, certificateContent: der[id].toString('base64') },
})
const profile = (name, certId, uuid) => ({
  id: `P-${uuid}`,
  attributes: { name, profileState: 'ACTIVE', uuid, expirationDate: '2027-10-24T00:00:00Z', profileContent: Buffer.from('p').toString('base64') },
  relationships: { certificates: { data: [{ type: 'certificates', id: certId }] } },
})

function routes(profiles) {
  return [
    { url: `${ASC}/certificates\\?`, body: { data: [cert('A', '2027-10-24T00:00:00Z'), cert('B', '2027-12-01T00:00:00Z')] } },
    { url: `${ASC}/bundleIds\\?`, body: { data: [
      { id: 'BID1', attributes: { identifier: 'com.byoky.app' } },
      { id: 'BID2', attributes: { identifier: 'com.byoky.app.extension' } },
    ] } },
    { url: `${ASC}/profiles\\?`, body: { data: profiles } },
    { method: 'DELETE', url: `${ASC}/profiles/`, status: 204 },
    { method: 'POST', url: `${ASC}/profiles$`, body: { data: profile('new', 'A', 'NEWUUID') } },
  ]
}

const allForA = PROFILES.map(([name], i) => profile(name, 'A', `UUID${i}`))
const installAll = (home) => {
  const dir = join(home, 'Library/Developer/Xcode/UserData/Provisioning Profiles')
  mkdirSync(dir, { recursive: true })
  PROFILES.forEach(([, ext], i) => writeFileSync(join(dir, `UUID${i}.${ext}`), 'p'))
}

test('profiles --check passes when every profile is there for this Mac\'s certificate, and only reads', () => {
  const r = runWithFetchStub('ios-signing.mjs', ['profiles', '--check', sha1(der.A)], { routes: routes(allForA), env: FAKE_ASC_ENV, setup: installAll })
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(writes(r.calls), [])
})

test('profiles --check reports what a real run would replace, and changes nothing', () => {
  // The macOS profile is bound to B: the newest certificate, but not this Mac's.
  const mixed = allForA.map((p, i) => (i === 2 ? profile(p.attributes.name, 'B', 'UUID2') : p))
  const r = runWithFetchStub('ios-signing.mjs', ['profiles', '--check', sha1(der.A)], {
    routes: routes(mixed),
    env: FAKE_ASC_ENV,
    setup: installAll,
    inspect: (home) => assert.equal(readdirSync(join(home, 'Library/Developer/Xcode/UserData/Provisioning Profiles')).length, 4),
  })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /missing: profile "Byoky macOS App Store" for this certificate; it would replace the one for Apple Distribution B/)
  assert.deepEqual(writes(r.calls), [])
})

test('profiles are made for the certificate whose key is in the keychain, not the newest one', () => {
  const onlyB = allForA.map((p, i) => (i === 0 ? profile(p.attributes.name, 'B', 'UUIDB') : p))
  const r = runWithFetchStub('ios-signing.mjs', ['profiles', sha1(der.A)], { routes: routes(onlyB), env: FAKE_ASC_ENV })
  assert.equal(r.code, 0, r.out)
  const created = writes(r.calls).filter((c) => c.method === 'POST')
  assert.equal(created.length, 1, r.out)
  assert.equal(JSON.parse(created[0].body).data.relationships.certificates.data[0].id, 'A')
  assert.match(r.out, /WARNING: deleting profile "Byoky iOS App Store", which is bound to the valid certificate Apple Distribution B/)
})

test('no certificate matching the keychain fails before changing anything', () => {
  const r = runWithFetchStub('ios-signing.mjs', ['profiles', 'DEADBEEF'], { routes: routes([]), env: FAKE_ASC_ENV })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /No valid Apple Distribution certificate of the team matches the identity in the signing keychain \(DEADBEEF\)/)
  assert.deepEqual(writes(r.calls), [])
})

test('ios-signing.sh --check on a Mac without the signing setup writes nothing and fails', () => {
  const envLocal = join(SCRIPTS, '..', '.env.local')
  const hadEnvLocal = existsSync(envLocal)
  const r = runWithFetchStub('ios-signing.sh', ['--check'], {
    routes: routes([]),
    env: FAKE_ASC_ENV,
    inspect: (home) => assert.deepEqual(readdirSync(home), [], 'HOME should stay empty'),
  })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /missing: the App Store Connect key file/)
  assert.match(r.out, /missing: the signing keychain/)
  assert.deepEqual(writes(r.calls), [])
  assert.equal(existsSync(envLocal), hadEnvLocal)
})
