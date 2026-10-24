#!/usr/bin/env node

// App Store Connect API helpers for headless iOS/macOS release signing.
// Called by scripts/ios-signing.sh.
//
// Requires: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY in environment.
//
// Usage:
//   node scripts/ios-signing.mjs cert <certificateType> <csr.pem> <out.cer>
//     Creates a certificate (DEVELOPMENT, DISTRIBUTION, MAC_INSTALLER_DISTRIBUTION).
//   node scripts/ios-signing.mjs profiles
//     Makes sure the App Store profiles below exist with the newest valid
//     Apple Distribution certificate, and installs them for xcodebuild.

import { createSign } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
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

async function ensureProfiles() {
  const certs = (await api('/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=50')).data
    .filter((c) => new Date(c.attributes.expirationDate) > new Date())
    .sort((a, b) => b.attributes.expirationDate.localeCompare(a.attributes.expirationDate))
  if (!certs.length) throw new Error('No valid Apple Distribution certificate; run scripts/ios-signing.sh')
  const certId = certs[0].id

  const identifiers = [...new Set(PROFILES.map((p) => p[2]))].join(',')
  const bundleIds = Object.fromEntries(
    (await api(`/v1/bundleIds?limit=200&filter[identifier]=${identifiers}`)).data.map((b) => [b.attributes.identifier, b.id]),
  )
  const existing = (await api('/v1/profiles?limit=200&include=certificates')).data

  const dir = `${homedir()}/Library/Developer/Xcode/UserData/Provisioning Profiles`
  mkdirSync(dir, { recursive: true })
  for (const [name, profileType, identifier, ext] of PROFILES) {
    let profile = existing.find((p) =>
      p.attributes.name === name &&
      p.attributes.profileState === 'ACTIVE' &&
      p.relationships?.certificates?.data?.some((c) => c.id === certId))
    if (!profile) {
      // A stale profile with the same name (old certificate) would make the
      // name ambiguous for ExportOptions; remove it first.
      for (const old of existing.filter((p) => p.attributes.name === name)) {
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
}

const [cmd, ...args] = process.argv.slice(2)
try {
  if (cmd === 'cert' && args.length === 3) await createCert(...args)
  else if (cmd === 'profiles') await ensureProfiles()
  else {
    console.error('Usage: ios-signing.mjs cert <type> <csr.pem> <out.cer> | profiles')
    process.exit(1)
  }
} catch (err) {
  console.error(`Error: ${err.message}`)
  process.exit(1)
}
