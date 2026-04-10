#!/usr/bin/env node

// Submit an uploaded build to App Store review via App Store Connect API.
//
// Requires: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY in environment.
//
// Usage:
//   node scripts/submit-appstore.mjs <version> <platform> [release-notes-file]
//
//   version:  e.g. "1.0.13"
//   platform: "IOS" or "MAC_OS"

import { createSign } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'

const [version, platform, notesFile] = process.argv.slice(2)
if (!version || !platform) {
  console.error('Usage: submit-appstore.mjs <version> <platform> [release-notes-file]')
  process.exit(1)
}

const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY } = process.env
if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_PRIVATE_KEY) {
  console.error('Error: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY required')
  process.exit(1)
}

const BUNDLE_ID = 'com.byoky.app'
const API = 'https://api.appstoreconnect.apple.com/v1'

function generateJwt() {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: ASC_ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1',
  })).toString('base64url')
  const sign = createSign('SHA256')
  sign.update(`${header}.${payload}`)
  const pk = ASC_PRIVATE_KEY.replace(/\\n/g, '\n')
  const sig = sign.sign({ key: pk, dsaEncoding: 'ieee-p1363' }, 'base64url')
  return `${header}.${payload}.${sig}`
}

const jwt = generateJwt()
const headers = { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, { headers, ...opts })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const errs = data.errors?.map(e => e.detail).join('; ') || res.statusText
    throw new Error(`${res.status}: ${errs}`)
  }
  return data
}

async function main() {
  const label = platform === 'IOS' ? 'iOS' : 'macOS'
  console.log(`Submitting ${label} v${version} for App Store review...`)

  // 1. Find app
  const appData = await api(`/apps?filter[bundleId]=${BUNDLE_ID}&fields[apps]=bundleId,name`)
  const appId = appData.data?.[0]?.id
  if (!appId) throw new Error('App not found')
  console.log(`  App: ${appId}`)

  // 2. Check for existing version in editable state
  const versionsData = await api(`/apps/${appId}/appStoreVersions?filter[platform]=${platform}&limit=5`)
  const editableStates = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED']
  let ver = versionsData.data?.find(v =>
    editableStates.includes(v.attributes.appStoreState) && v.attributes.versionString === version
  )

  if (!ver) {
    // Create new version
    console.log(`  Creating version ${version}...`)
    const createRes = await api('/appStoreVersions', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'appStoreVersions',
          attributes: { platform, versionString: version },
          relationships: { app: { data: { type: 'apps', id: appId } } },
        },
      }),
    })
    ver = createRes.data
  }
  console.log(`  Version: ${ver.id} (${ver.attributes.appStoreState})`)

  // 3. Set release notes if provided
  if (notesFile && existsSync(notesFile)) {
    const notes = readFileSync(notesFile, 'utf8').slice(0, 4000)
    const locData = await api(`/appStoreVersions/${ver.id}/appStoreVersionLocalizations`)
    let enLoc = locData.data?.find(l => l.attributes.locale.startsWith('en'))

    if (enLoc) {
      await api(`/appStoreVersionLocalizations/${enLoc.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          data: { type: 'appStoreVersionLocalizations', id: enLoc.id, attributes: { whatsNew: notes } },
        }),
      })
    } else {
      await api('/appStoreVersionLocalizations', {
        method: 'POST',
        body: JSON.stringify({
          data: {
            type: 'appStoreVersionLocalizations',
            attributes: { locale: 'en-US', whatsNew: notes },
            relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: ver.id } } },
          },
        }),
      })
    }
    console.log(`  Release notes set (${notes.length} chars)`)
  }

  // 4. Find the latest processed build for this platform
  console.log(`  Looking for ${label} build...`)
  const buildsData = await api(
    `/builds?filter[app]=${appId}&filter[processingState]=VALID` +
    `&filter[preReleaseVersion.platform]=${platform}` +
    `&sort=-uploadedDate&limit=1&fields[builds]=version,uploadedDate,processingState`
  )
  const build = buildsData.data?.[0]

  if (!build) {
    console.log(`  No processed ${label} build found yet — build may still be processing.`)
    console.log(`  Check App Store Connect and manually select the build, or re-run this script later.`)
    return
  }
  console.log(`  Build: ${build.id} (v${build.attributes.version})`)

  // 5. Select build for this version
  await api(`/appStoreVersions/${ver.id}/relationships/build`, {
    method: 'PATCH',
    body: JSON.stringify({ data: { type: 'builds', id: build.id } }),
  })
  console.log(`  Build selected`)

  // 6. Submit for review
  try {
    await api('/appStoreVersionSubmissions', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'appStoreVersionSubmissions',
          relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: ver.id } } },
        },
      }),
    })
    console.log(`  Submitted for review`)
  } catch (e) {
    // App Store Connect v1 submission endpoint may be deprecated in favor of v2
    // Try the newer reviewSubmissions endpoint
    try {
      await api('/reviewSubmissions', {
        method: 'POST',
        body: JSON.stringify({
          data: {
            type: 'reviewSubmissions',
            attributes: { platform },
            relationships: { app: { data: { type: 'apps', id: appId } } },
          },
        }),
      })
      console.log(`  Submitted for review (v2 API)`)
    } catch (e2) {
      console.log(`  WARN: Auto-submit failed — ${e2.message}`)
      console.log(`  The version and build are ready. Submit manually in App Store Connect.`)
    }
  }
}

main().catch(err => {
  console.error(`App Store submission failed: ${err.message}`)
  process.exit(1)
})
