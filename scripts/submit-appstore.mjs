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

import { createSign, createHash } from 'node:crypto'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const [version, platform, notesFile] = process.argv.slice(2)

// The App Store keywords live in docs/store-listing.md, in the code block
// after "**Keywords**" (shared by iOS and macOS). Set on every submission so
// the listing follows the doc.
function storeKeywords() {
  const doc = new URL('../docs/store-listing.md', import.meta.url)
  if (!existsSync(doc)) return undefined
  const match = readFileSync(doc, 'utf8').match(/\*\*Keywords\*\*[^\n]*\n+```\n([^\n]+)\n```/)
  return match?.[1].trim().slice(0, 100)
}
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

// With STORE_IMAGES_DIR set (e.g. marketing/composites/1.1.1), the version's
// en-US screenshots are replaced by the set's ios/ or mac/ PNGs. File name
// prefixes pick the display type. Sets for display types the new images
// don't cover but that would still be shown (the old 6.5" iPhone set) are
// removed, so no device keeps showing old screenshots.
const SCREENSHOT_TYPES = {
  IOS: [
    { prefix: 'iphone-', type: 'APP_IPHONE_67', replaces: ['APP_IPHONE_65', 'APP_IPHONE_61', 'APP_IPHONE_58', 'APP_IPHONE_55'] },
    { prefix: 'ipad-', type: 'APP_IPAD_PRO_3GEN_129', replaces: [] },
  ],
  MAC_OS: [{ prefix: '', type: 'APP_DESKTOP', replaces: [] }],
}

async function uploadScreenshots(versionId) {
  const dir = process.env.STORE_IMAGES_DIR && join(process.env.STORE_IMAGES_DIR, platform === 'IOS' ? 'ios' : 'mac')
  if (!dir || !existsSync(dir)) return
  const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort()
  const locs = await api(`/appStoreVersions/${versionId}/appStoreVersionLocalizations`)
  const loc = locs.data?.find((l) => l.attributes.locale.startsWith('en'))
  if (!loc) throw new Error('No en localization for screenshots')
  const sets = (await api(`/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=50`)).data ?? []

  for (const { prefix, type, replaces } of SCREENSHOT_TYPES[platform]) {
    const names = files.filter((f) => f.startsWith(prefix))
    if (names.length === 0) continue
    for (const set of sets.filter((x) => x.attributes.screenshotDisplayType === type || replaces.includes(x.attributes.screenshotDisplayType))) {
      await api(`/appScreenshotSets/${set.id}`, { method: 'DELETE' })
    }
    const set = (await api('/appScreenshotSets', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'appScreenshotSets',
          attributes: { screenshotDisplayType: type },
          relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: loc.id } } },
        },
      }),
    })).data
    for (const name of names) {
      const path = join(dir, name)
      const bytes = readFileSync(path)
      const shot = (await api('/appScreenshots', {
        method: 'POST',
        body: JSON.stringify({
          data: {
            type: 'appScreenshots',
            attributes: { fileName: name, fileSize: statSync(path).size },
            relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } },
          },
        }),
      })).data
      for (const op of shot.attributes.uploadOperations) {
        const res = await fetch(op.url, {
          method: op.method,
          headers: Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value])),
          body: bytes.subarray(op.offset, op.offset + op.length),
        })
        if (!res.ok) throw new Error(`Screenshot upload ${name} failed: ${res.status}`)
      }
      await api(`/appScreenshots/${shot.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          data: {
            type: 'appScreenshots',
            id: shot.id,
            attributes: { uploaded: true, sourceFileChecksum: createHash('md5').update(bytes).digest('hex') },
          },
        }),
      })
    }
    console.log(`  Screenshots ${type}: ${names.length}`)
  }

  // Apple processes uploads asynchronously; a submission with screenshots
  // still processing is refused, so wait for them.
  for (let i = 0; i < 40; i++) {
    const current = (await api(`/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?include=appScreenshots&limit=50`)).included ?? []
    const states = current.map((x) => x.attributes.assetDeliveryState?.state)
    if (states.includes('FAILED')) throw new Error('A screenshot failed processing')
    if (states.every((st) => st === 'COMPLETE')) return
    await new Promise((r) => setTimeout(r, 3000))
  }
  console.log('  Screenshots still processing; the submission may need a retry')
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
  const versionsData = await api(`/apps/${appId}/appStoreVersions?filter[platform]=${platform}&limit=50`)
  const editableStates = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED']
  let ver = versionsData.data?.find(v => editableStates.includes(v.attributes.appStoreState))

  // App Store Connect allows one editable version per platform; an older one
  // that never went out (macOS sat at "1.0" for months) blocks creating a new
  // one, so rename it instead.
  if (ver && ver.attributes.versionString !== version) {
    console.log(`  Renaming editable version ${ver.attributes.versionString} to ${version}...`)
    ver = (await api(`/appStoreVersions/${ver.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ data: { type: 'appStoreVersions', id: ver.id, attributes: { versionString: version } } }),
    })).data
  }

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

  // 3. Keywords from docs/store-listing.md
  const keywords = storeKeywords()
  if (keywords) {
    const locs = await api(`/appStoreVersions/${ver.id}/appStoreVersionLocalizations`)
    const loc = locs.data?.find(l => l.attributes.locale.startsWith('en'))
    if (loc && loc.attributes.keywords !== keywords) {
      await api(`/appStoreVersionLocalizations/${loc.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: { keywords } },
        }),
      })
      console.log(`  Keywords set: ${keywords}`)
    }
  }

  // 4. Screenshots, when a store image set is given
  await uploadScreenshots(ver.id)

  // 5. Set release notes if provided
  if (notesFile && existsSync(notesFile)) {
    const notes = readFileSync(notesFile, 'utf8').slice(0, 4000)
    const locData = await api(`/appStoreVersions/${ver.id}/appStoreVersionLocalizations`)
    let enLoc = locData.data?.find(l => l.attributes.locale.startsWith('en'))
    let notesSet = true

    if (enLoc) {
      try {
        await api(`/appStoreVersionLocalizations/${enLoc.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            data: { type: 'appStoreVersionLocalizations', id: enLoc.id, attributes: { whatsNew: notes } },
          }),
        })
      } catch (e) {
        // An app's first version on a platform has no "What's New" (409).
        if (!e.message.startsWith('409')) throw e
        notesSet = false
        console.log(`  No release notes for a first version`)
      }
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
    if (notesSet) console.log(`  Release notes set (${notes.length} chars)`)
  }

  // 6. Find the latest processed build of this version for this platform.
  // Without the version filter a build still processing would lose to the
  // previous version's build, which App Store Connect refuses to attach.
  console.log(`  Looking for ${label} build...`)
  const buildsData = await api(
    `/builds?filter[app]=${appId}&filter[processingState]=VALID` +
    `&filter[preReleaseVersion.platform]=${platform}` +
    `&filter[preReleaseVersion.version]=${version}` +
    `&sort=-uploadedDate&limit=1&fields[builds]=version,uploadedDate,processingState`
  )
  const build = buildsData.data?.[0]

  if (!build) {
    console.log(`  No processed ${label} build found yet — build may still be processing.`)
    console.log(`  Check App Store Connect and manually select the build, or re-run this script later.`)
    return
  }
  console.log(`  Build: ${build.id} (v${build.attributes.version})`)

  // 7. Select build for this version
  await api(`/appStoreVersions/${ver.id}/relationships/build`, {
    method: 'PATCH',
    body: JSON.stringify({ data: { type: 'builds', id: build.id } }),
  })
  console.log(`  Build selected`)

  // 8. Submit for review
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
    // App Store Connect v1 submission endpoint may be deprecated in favor of v2.
    // The newer flow is: open a review submission, add the version to it as an
    // item, then mark the submission as submitted.
    try {
      const open = await api(
        `/reviewSubmissions?filter[app]=${appId}&filter[platform]=${platform}&filter[state]=READY_FOR_REVIEW&limit=1`
      )
      const submission = open.data?.[0] ?? (await api('/reviewSubmissions', {
        method: 'POST',
        body: JSON.stringify({
          data: {
            type: 'reviewSubmissions',
            attributes: { platform },
            relationships: { app: { data: { type: 'apps', id: appId } } },
          },
        }),
      })).data
      await api('/reviewSubmissionItems', {
        method: 'POST',
        body: JSON.stringify({
          data: {
            type: 'reviewSubmissionItems',
            relationships: {
              reviewSubmission: { data: { type: 'reviewSubmissions', id: submission.id } },
              appStoreVersion: { data: { type: 'appStoreVersions', id: ver.id } },
            },
          },
        }),
      })
      await api(`/reviewSubmissions/${submission.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          data: { type: 'reviewSubmissions', id: submission.id, attributes: { submitted: true } },
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
