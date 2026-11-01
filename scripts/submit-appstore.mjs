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
//
// A build takes minutes to process after the upload. The script waits for
// it, checking every ASC_BUILD_POLL_SEC seconds (default 30) for up to
// ASC_BUILD_WAIT_MIN minutes (default 40; 0 checks once). Nothing in App
// Store Connect changes before that build is there.
//
// Exit codes (release.sh reports them per platform):
//   0  submitted, or this version is already in review, approved or live
//   1  failed: an API error, the build failed processing, or App Store
//      Connect refused the submission
//   2  pending: the build is still processing; run it again later
//   3  no build of this version has reached App Store Connect
//   4  pending: another version of this platform is still in review

import { createSign, createHash } from 'node:crypto'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const EXIT = { SUBMITTED: 0, FAILED: 1, PROCESSING: 2, NO_BUILD: 3, BLOCKED: 4 }

// appVersionState replaced appStoreState; read the old one where it's missing.
const stateOf = (v) => v.attributes.appVersionState ?? v.attributes.appStoreState

// The version can still be changed and sent to review. A rejected version
// takes a new build and goes back to review: App Store Connect refuses a
// second version next to it.
const EDITABLE = [
  'PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW', 'DEVELOPER_REJECTED',
  'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY',
]
// With App Review or on its way to the store: another version waits for it.
const IN_REVIEW = [
  'WAITING_FOR_REVIEW', 'IN_REVIEW', 'WAITING_FOR_EXPORT_COMPLIANCE', 'ACCEPTED',
  'PENDING_APPLE_RELEASE', 'PENDING_DEVELOPER_RELEASE',
  'PROCESSING_FOR_DISTRIBUTION', 'PROCESSING_FOR_APP_STORE',
]
// This version needs nothing more.
const DONE = [...IN_REVIEW, 'READY_FOR_DISTRIBUTION', 'READY_FOR_SALE', 'PREORDER_READY_FOR_SALE']

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
const WAIT_MIN = Number(process.env.ASC_BUILD_WAIT_MIN ?? 40)
const POLL_SEC = Number(process.env.ASC_BUILD_POLL_SEC ?? 30)

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

// A token lives 20 minutes, and waiting for a build can take longer: sign a
// new one when the current one is 15 minutes old.
let jwt
let jwtAt = 0
function headers() {
  if (Date.now() - jwtAt > 15 * 60_000) {
    jwt = generateJwt()
    jwtAt = Date.now()
  }
  return { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }
}

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, { headers: headers(), ...opts })
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

// The newest build of this version for this platform. Without the version
// filter a build still processing would lose to the previous version's
// build, which App Store Connect refuses to attach.
async function newestBuild(appId) {
  const buildsData = await api(
    `/builds?filter[app]=${appId}` +
    `&filter[preReleaseVersion.platform]=${platform}` +
    `&filter[preReleaseVersion.version]=${version}` +
    `&sort=-uploadedDate&limit=1&fields[builds]=version,uploadedDate,processingState`
  )
  return buildsData.data?.[0]
}

// Only a VALID build can be attached. Returns it, or the exit code that
// says why there is none.
async function waitForBuild(appId, label) {
  console.log(`  Waiting for the ${label} build of v${version} to process (up to ${WAIT_MIN} min)...`)
  const deadline = Date.now() + WAIT_MIN * 60_000
  for (;;) {
    const build = await newestBuild(appId)
    const state = build?.attributes.processingState
    if (state === 'VALID') return build
    if (state === 'FAILED' || state === 'INVALID') {
      console.log(`  Build ${build.attributes.version} is ${state}; App Store Connect won't take it. Upload a new build.`)
      return EXIT.FAILED
    }
    if (Date.now() >= deadline) {
      if (build) {
        console.log(`  Build ${build.attributes.version} is still ${state}. Submit it later with ./scripts/release.sh retry.`)
        return EXIT.PROCESSING
      }
      console.log(`  No ${label} build of v${version} in App Store Connect. ./scripts/release.sh retry uploads it again.`)
      return EXIT.NO_BUILD
    }
    await new Promise((r) => setTimeout(r, POLL_SEC * 1000))
  }
}

// Review submissions API (the v1 appStoreVersionSubmissions endpoint is
// deprecated): add the version to the open submission and submit it. A
// rejected submission (UNRESOLVED_ISSUES) is resubmitted rather than
// replaced, since App Store Connect keeps one open submission per platform.
const OPEN_SUBMISSION = ['READY_FOR_REVIEW', 'UNRESOLVED_ISSUES']
async function submitForReview(appId, versionId) {
  const open = ((await api(
    `/reviewSubmissions?filter[app]=${appId}&filter[platform]=${platform}` +
    `&filter[state]=${OPEN_SUBMISSION.join(',')}&include=appStoreVersionForReview&limit=10`
  )).data ?? [])
    // The query filters already; checked again so that the other platform's
    // submission, or one already with App Review, is never added to or
    // submitted, whatever the API returns.
    .filter((s) => (s.attributes?.platform ?? platform) === platform &&
      OPEN_SUBMISSION.includes(s.attributes?.state ?? OPEN_SUBMISSION[0]))
  const forThisVersion = (s) => s.relationships?.appStoreVersionForReview?.data?.id === versionId
  let submission = open.find(forThisVersion) ?? open[0]
  if (!submission) {
    submission = (await api('/reviewSubmissions', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'reviewSubmissions',
          attributes: { platform },
          relationships: { app: { data: { type: 'apps', id: appId } } },
        },
      }),
    })).data
  }
  if (!forThisVersion(submission)) {
    await api('/reviewSubmissionItems', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'reviewSubmissionItems',
          relationships: {
            reviewSubmission: { data: { type: 'reviewSubmissions', id: submission.id } },
            appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
          },
        },
      }),
    })
  }
  await api(`/reviewSubmissions/${submission.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      data: { type: 'reviewSubmissions', id: submission.id, attributes: { submitted: true } },
    }),
  })
  console.log(`  Submitted for review${submission.attributes?.state === 'UNRESOLVED_ISSUES' ? ' again' : ''}`)
}

async function main() {
  const label = platform === 'IOS' ? 'iOS' : 'macOS'
  console.log(`Submitting ${label} v${version} for App Store review...`)

  // 1. Find app
  const appData = await api(`/apps?filter[bundleId]=${BUNDLE_ID}&fields[apps]=bundleId,name`)
  const appId = appData.data?.[0]?.id
  if (!appId) throw new Error('App not found')
  console.log(`  App: ${appId}`)

  // 2. Where this platform's versions stand. Nothing is changed until the
  // build is there, so an early exit leaves App Store Connect as it was.
  const versions = (await api(`/apps/${appId}/appStoreVersions?filter[platform]=${platform}&limit=50`)).data ?? []
  const same = versions.find((v) => v.attributes.versionString === version)
  if (same && DONE.includes(stateOf(same))) {
    console.log(`  v${version} is already ${stateOf(same)}; nothing to submit.`)
    return EXIT.SUBMITTED
  }
  if (same && !EDITABLE.includes(stateOf(same))) {
    throw new Error(`v${version} is ${stateOf(same)} in App Store Connect and can't be submitted`)
  }
  const inReview = versions.find((v) => v !== same && IN_REVIEW.includes(stateOf(v)))
  if (inReview) {
    console.log(`  v${inReview.attributes.versionString} is ${stateOf(inReview)}. v${version} can go to review once that's over:`)
    console.log(`  run ./scripts/release.sh retry then.`)
    return EXIT.BLOCKED
  }

  // 3. The build
  const build = await waitForBuild(appId, label)
  if (typeof build === 'number') return build
  console.log(`  Build: ${build.id} (v${build.attributes.version})`)

  // 4. The version: this one if it's editable, else another editable one
  let ver = same ?? versions.find((v) => EDITABLE.includes(stateOf(v)))

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
  console.log(`  Version: ${ver.id} (${stateOf(ver)})`)

  // 5. Keywords from docs/store-listing.md
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

  // 6. Screenshots, when a store image set is given
  await uploadScreenshots(ver.id)

  // 7. Set release notes if provided
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

  // 8. Attach the build
  await api(`/appStoreVersions/${ver.id}/relationships/build`, {
    method: 'PATCH',
    body: JSON.stringify({ data: { type: 'builds', id: build.id } }),
  })
  console.log(`  Build selected`)

  // 9. Submit for review: the v1 endpoint first, then (it's deprecated) the
  // review submissions API. Both refusing is a failure, not a warning.
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
    try {
      await submitForReview(appId, ver.id)
    } catch (e2) {
      throw new Error(`App Store Connect refused the submission (v1: ${e.message}; v2: ${e2.message}). ` +
        'The version and build are ready; submit it in App Store Connect.')
    }
  }
  return EXIT.SUBMITTED
}

main().then((code) => {
  process.exitCode = code
}, (err) => {
  console.error(`App Store submission failed: ${err.message}`)
  process.exitCode = EXIT.FAILED
})
