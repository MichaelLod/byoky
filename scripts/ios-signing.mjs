#!/usr/bin/env node

// App Store Connect API helpers for headless iOS/macOS release signing.
// Called by scripts/ios-signing.sh.
//
// Requires: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY in environment.
//
// Usage:
//   node scripts/ios-signing.mjs cert <certificateType> <csr.pem> <out.cer>
//     Creates a certificate (DEVELOPMENT, DISTRIBUTION, MAC_INSTALLER_DISTRIBUTION).
//   node scripts/ios-signing.mjs profiles [--check] <sha1>[,<sha1>...]
//     Makes sure the App Store profiles below exist for the Apple Distribution
//     certificate with one of these SHA-1 fingerprints (the identities in the
//     signing keychain), and installs them for xcodebuild. With --check it only
//     reads: it lists what a real run would create or replace and exits 1 if
//     anything, without creating, deleting or installing a profile.

import { createSign, createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'

const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY } = process.env
if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_PRIVATE_KEY) {
  console.error('Error: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY required')
  process.exit(1)
}

// Names must match packages/ios/ExportOptions*.plist.
const PROFILES = [
  ['Byoky iOS App Store', 'IOS_APP_STORE', 'com.byoky.app', 'mobileprovision'],
  ['Byoky iOS Safari Extension App Store', 'IOS_APP_STORE', 'com.byoky.app.extension', 'mobileprovision'],
  ['Byoky macOS App Store', 'MAC_APP_STORE', 'com.byoky.app', 'provisionprofile'],
  ['Byoky macOS Safari Extension App Store', 'MAC_APP_STORE', 'com.byoky.app.extension', 'provisionprofile'],
]

function generateJwt() {
  const now = Math.floor(Date.now() / 1000)
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = enc({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' }) + '.' +
    enc({ iss: ASC_ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })
  const sign = createSign('SHA256')
  sign.update(unsigned)
  const pk = ASC_PRIVATE_KEY.replace(/\\n/g, '\n')
  return unsigned + '.' + sign.sign({ key: pk, dsaEncoding: 'ieee-p1363' }, 'base64url')
}

const jwt = generateJwt()

async function api(path, opts = {}) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
  })
  const body = await res.json()
  if (!res.ok) {
    const detail = (body.errors ?? []).map((e) => `${e.code}: ${e.detail}`).join(' | ')
    throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status} ${detail}`)
  }
  return body
}

async function createCert(type, csrPath, outPath) {
  const { data } = await api('/v1/certificates', {
    method: 'POST',
    body: JSON.stringify({
      data: { type: 'certificates', attributes: { certificateType: type, csrContent: readFileSync(csrPath, 'utf8') } },
    }),
  })
  writeFileSync(outPath, Buffer.from(data.attributes.certificateContent, 'base64'))
  console.log(`  created ${data.attributes.name} (expires ${data.attributes.expirationDate.slice(0, 10)})`)
}

const fingerprint = (cert) =>
  createHash('sha1').update(Buffer.from(cert.attributes.certificateContent, 'base64')).digest('hex').toUpperCase()
const describe = (cert) =>
  `${cert.attributes.name} (serial ${cert.attributes.serialNumber}, valid until ${cert.attributes.expirationDate.slice(0, 10)})`

async function ensureProfiles({ check, sha1s }) {
  const valid = (await api('/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=50')).data
    .filter((c) => new Date(c.attributes.expirationDate) > new Date())
    .sort((a, b) => b.attributes.expirationDate.localeCompare(a.attributes.expirationDate))
  // The certificate whose private key is in this Mac's signing keychain. The
  // team's newest one can belong to another Mac; profiles made for it would
  // break signing here, and remaking them breaks signing there.
  const cert = valid.find((c) => sha1s.includes(fingerprint(c)))
  if (!cert) {
    throw new Error(
      `No valid Apple Distribution certificate of the team matches the identity in the signing keychain ` +
      `(${sha1s.join(', ') || 'none there'}). Valid ones: ${valid.map(describe).join('; ') || 'none'}. ` +
      'Run scripts/ios-signing.sh on the Mac that holds one of those keys, or delete the stale identity ' +
      'from the signing keychain so the script creates a new certificate.')
  }
  const certId = cert.id
  const otherValid = new Map(valid.filter((c) => c.id !== certId).map((c) => [c.id, c]))
  console.log(`  Apple Distribution certificate: ${describe(cert)}`)

  const identifiers = [...new Set(PROFILES.map((p) => p[2]))].join(',')
  const bundleIds = Object.fromEntries(
    (await api(`/v1/bundleIds?limit=200&filter[identifier]=${identifiers}`)).data.map((b) => [b.attributes.identifier, b.id]),
  )
  const existing = (await api('/v1/profiles?limit=200&include=certificates')).data

  const dir = `${homedir()}/Library/Developer/Xcode/UserData/Provisioning Profiles`
  if (!check) mkdirSync(dir, { recursive: true })
  const missing = []
  for (const [name, profileType, identifier, ext] of PROFILES) {
    let profile = existing.find((p) =>
      p.attributes.name === name &&
      p.attributes.profileState === 'ACTIVE' &&
      p.relationships?.certificates?.data?.some((c) => c.id === certId))
    // A stale profile with the same name would make the name ambiguous for
    // ExportOptions, so a new one replaces it. Bound to another valid
    // certificate, it's probably another Mac's: say so before deleting it.
    const stale = profile ? [] : existing.filter((p) => p.attributes.name === name)
    const othersMac = (p) => (p.relationships?.certificates?.data ?? []).map((c) => otherValid.get(c.id)).filter(Boolean)
    if (check) {
      if (!profile) {
        const replaced = stale.flatMap(othersMac)
        missing.push(`profile "${name}" for this certificate` +
          (replaced.length ? `; it would replace the one for ${replaced.map(describe).join(', ')}` : ''))
      } else if (!existsSync(`${dir}/${profile.attributes.uuid}.${ext}`)) {
        missing.push(`profile "${name}" isn't installed in ${dir}`)
      } else {
        console.log(`  ok ${name} (expires ${profile.attributes.expirationDate.slice(0, 10)})`)
      }
      continue
    }
    if (!profile) {
      for (const old of stale) {
        const bound = othersMac(old)
        if (bound.length) {
          console.log(`  WARNING: deleting profile "${name}", which is bound to the valid certificate ${bound.map(describe).join(', ')}.`)
          console.log('  A Mac that signs with that certificate has to run scripts/ios-signing.sh again.')
        }
        await api(`/v1/profiles/${old.id}`, { method: 'DELETE' }).catch(() => {})
      }
      profile = (await api('/v1/profiles', {
        method: 'POST',
        body: JSON.stringify({
          data: {
            type: 'profiles',
            attributes: { name, profileType },
            relationships: {
              bundleId: { data: { type: 'bundleIds', id: bundleIds[identifier] } },
              certificates: { data: [{ type: 'certificates', id: certId }] },
            },
          },
        }),
      })).data
      console.log(`  created profile ${name}`)
    }
    writeFileSync(`${dir}/${profile.attributes.uuid}.${ext}`, Buffer.from(profile.attributes.profileContent, 'base64'))
    console.log(`  installed ${name} (expires ${profile.attributes.expirationDate.slice(0, 10)})`)
  }
  if (missing.length) {
    for (const m of missing) console.log(`  missing: ${m}`)
    process.exitCode = 1
  }
}

const [cmd, ...args] = process.argv.slice(2)
try {
  const check = args[0] === '--check'
  const sha1s = (check ? args[1] : args[0])?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) ?? []
  if (cmd === 'cert' && args.length === 3) await createCert(...args)
  else if (cmd === 'profiles') await ensureProfiles({ check, sha1s })
  else {
    console.error('Usage: ios-signing.mjs cert <type> <csr.pem> <out.cer> | profiles [--check] <sha1>[,<sha1>...]')
    process.exit(1)
  }
} catch (err) {
  console.error(`Error: ${err.message}`)
  process.exit(1)
}
