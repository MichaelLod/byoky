#!/usr/bin/env node

// Check store status for all platforms.
// Usage: node scripts/store-status.mjs [--json] [--ignore=<id>[,<id>...]]
//
// Exits 3 when a store has a review pending (isPending() decides), so
// release.sh can stop before an upload replaces that submission and
// restarts its review. A store release.sh uploads to (its credentials are
// set) whose review state couldn't be read counts the same: its result has
// `unknown: true` and the reason in `unknownReason`. The check only reads.
//
// --json prints the results for scripts. --ignore reports the given stores
// (result ids, e.g. appstore-macos) as usual but leaves them out of the exit
// code; release.sh --hold-macos uses it.

import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHmac, createSign } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Load .env and .env.local (not with BYOKY_ENV_FILES=0: the script tests
// set that, so a checkout's real credentials can't change their outcome).
function loadEnv() {
  if (process.env.BYOKY_ENV_FILES === '0') return
  for (const f of ['.env', '.env.local']) {
    const p = resolve(root, f)
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq < 0) continue
      const key = trimmed.slice(0, eq)
      let val = trimmed.slice(eq + 1)
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1)
      if (!process.env[key]) process.env[key] = val
    }
  }
}

const ANDROID_PACKAGE = 'com.byoky.app'
const APPLE_BUNDLE_ID = 'com.byoky.app' // iOS and macOS share it
const AMO_ADDON = 'byoky%40byoky.com'
// The first UUID in the Chrome developer dashboard URL.
const CHROME_PUBLISHER_ID = '29fa2c41-d315-4dfb-a14c-8919348cb737'

// States in which a store still has a submission to review or release.
// Uploading then replaces that submission and restarts its review, and
// App Store Connect refuses a new version until it's through.
export const PENDING_STATES = {
  // appVersionState and the older appStoreState names for the same steps
  appstore: [
    'WAITING_FOR_REVIEW', 'IN_REVIEW', 'READY_FOR_REVIEW', 'WAITING_FOR_EXPORT_COMPLIANCE',
    'ACCEPTED', 'PENDING_APPLE_RELEASE', 'PENDING_DEVELOPER_RELEASE',
    'PROCESSING_FOR_DISTRIBUTION', 'PROCESSING_FOR_APP_STORE',
  ],
  // AMO file status: public, unreviewed or disabled
  amo: ['unreviewed'],
  // CWS API v2 ItemState: STAGED = approved, waiting to be published
  chrome: ['PENDING_REVIEW', 'STAGED'],
}

export function isPending(store, state) {
  return state != null && (PENDING_STATES[store] ?? []).includes(String(state))
}

// The review state of a store the release uploads to couldn't be read.
// release.sh treats that like a pending review: it can't rule one out.
function unknownState(result, reason) {
  return { ...result, unknown: true, unknownReason: reason, statusDetail: `pending state unknown: ${reason}` }
}

// Pending reviews and unknown review states hold a release up (exit 3),
// except in the stores passed to --ignore.
export function blocking(results, ignore = []) {
  return results.filter((r) => (r.pending || r.unknown) && !ignore.includes(r.id))
}

// Newest first, by x.y.z.
export function compareVersionsDesc(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (d) return d
  }
  return 0
}

async function googleAccessToken() {
  const { CHROME_CLIENT_ID, CHROME_CLIENT_SECRET, CHROME_REFRESH_TOKEN } = process.env
  const res = await fetch('https://www.googleapis.com/oauth2/v4/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CHROME_CLIENT_ID,
      client_secret: CHROME_CLIENT_SECRET,
      refresh_token: CHROME_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`token: HTTP ${res.status} ${data.error ?? ''}`.trim())
  return data.access_token
}

async function chromeWebStoreStatus() {
  const { CHROME_EXTENSION_ID, CHROME_CLIENT_ID, CHROME_REFRESH_TOKEN } = process.env
  let result = { id: 'chrome', platform: 'Chrome', pending: false }
  if (!CHROME_EXTENSION_ID) return { ...result, status: 'not configured' }

  try {
    // Use the public CRX update check endpoint — no auth needed, returns the actual live published version.
    // Scope to <updatecheck to avoid matching the XML declaration (e.g. version="1.0")
    const res = await fetch(
      `https://clients2.google.com/service/update2/crx?response=updatecheck&acceptformat=crx3&prodversion=130.0&x=id%3D${CHROME_EXTENSION_ID}%26v%3D0.0.0%26uc`
    )
    const xml = await res.text()
    result.version = xml.match(/<updatecheck[^>]+version="([^"]+)"/)?.[1]
    result.status = xml.match(/<updatecheck[^>]+status="([^"]+)"/)?.[1] || 'unknown' // 'ok' = live
  } catch (e) {
    // Only the live version is missing; the review state comes from the API.
    result = { ...result, status: 'error', error: e.message }
  }

  // A submission in review is only visible through the Web Store API (v2).
  // release.sh uploads whenever CHROME_CLIENT_ID is set.
  if (!CHROME_CLIENT_ID || !CHROME_REFRESH_TOKEN) {
    return CHROME_CLIENT_ID
      ? unknownState(result, 'CHROME_REFRESH_TOKEN missing')
      : { ...result, statusDetail: 'pending state unknown: no API credentials' }
  }
  try {
    const token = await googleAccessToken()
    const res = await fetch(
      `https://chromewebstore.googleapis.com/v2/publishers/${process.env.CHROME_PUBLISHER_ID || CHROME_PUBLISHER_ID}/items/${CHROME_EXTENSION_ID}:fetchStatus`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) throw new Error(`fetchStatus: HTTP ${res.status}`)
    const submitted = (await res.json()).submittedItemRevisionStatus
    if (submitted?.state) {
      result.submittedState = submitted.state
      result.submittedVersion = submitted.distributionChannels?.[0]?.crxVersion
      result.statusDetail = `submitted v${result.submittedVersion ?? '?'} ${submitted.state}`
      result.pending = isPending('chrome', submitted.state)
      if (result.pending) {
        result.pendingVersion = result.submittedVersion
        result.pendingState = submitted.state
      }
    }
  } catch (e) {
    return unknownState(result, e.message)
  }
  return result
}

async function amoStatus() {
  const { AMO_API_KEY, AMO_API_SECRET } = process.env
  const result = { id: 'firefox', platform: 'Firefox', pending: false }
  if (!AMO_API_KEY || !AMO_API_SECRET) return { ...result, status: 'not configured' }

  try {
    // Without the filter the API lists approved versions only, and a
    // version awaiting review would stay invisible.
    const res = await fetch(
      `https://addons.mozilla.org/api/v5/addons/addon/${AMO_ADDON}/versions/?filter=all_without_unlisted&page_size=10`,
      { headers: { Authorization: `JWT ${generateAmoJwt()}` } }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const versions = ((await res.json()).results ?? [])
      .slice()
      .sort((a, b) => compareVersionsDesc(a.version, b.version))
    const newest = versions[0]
    if (!newest) return { ...result, status: 'no versions' }
    const status = String(newest.file?.status ?? 'unknown')
    const live = versions.find((v) => v.file?.status === 'public')
    return {
      ...result,
      version: newest.version,
      status,
      statusDetail: live && live.version !== newest.version ? `live v${live.version}` : undefined,
      pending: isPending('amo', status),
      pendingVersion: isPending('amo', status) ? newest.version : undefined,
      pendingState: isPending('amo', status) ? status : undefined,
    }
  } catch (e) {
    return unknownState({ ...result, status: 'error', error: e.message }, e.message)
  }
}

async function googlePlayStatus() {
  try {
    const res = await fetch(
      `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}&hl=en`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    if (!res.ok) {
      return { id: 'play', platform: 'Google Play', pending: false, status: res.status === 404 ? 'not published' : `HTTP ${res.status}` }
    }
    const html = await res.text()
    const versionMatch = html.match(/\[\[\["(\d+\.\d+\.\d+)"\]\]/)
      || html.match(/Current Version.*?>([\d.]+)</)
    const version = versionMatch?.[1] || 'unknown'
    return { id: 'play', platform: 'Google Play', pending: false, version, status: 'published' }
  } catch (e) {
    return { id: 'play', platform: 'Google Play', pending: false, status: 'error', error: e.message }
  }
}

let ascSession
function appStoreConnect() {
  ascSession ??= (async () => {
    const { ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY } = process.env
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' })).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const payload = Buffer.from(JSON.stringify({
      iss: ASC_ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1',
    })).toString('base64url')
    const sign = createSign('SHA256')
    sign.update(`${header}.${payload}`)
    const sig = sign.sign({ key: ASC_PRIVATE_KEY.replace(/\\n/g, '\n'), dsaEncoding: 'ieee-p1363' }, 'base64url')
    const auth = { headers: { Authorization: `Bearer ${header}.${payload}.${sig}` } }
    const appRes = await fetch(
      `https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=${APPLE_BUNDLE_ID}&fields[apps]=bundleId,name`,
      auth
    )
    if (!appRes.ok) throw new Error(`apps: HTTP ${appRes.status}`)
    return { auth, appId: (await appRes.json()).data?.[0]?.id }
  })()
  return ascSession
}

// iOS and macOS through App Store Connect, which also sees versions waiting
// for or in review. The public iTunes API (the fallback without
// credentials) shows only what's live.
async function appStoreStatus(platform) {
  const id = platform === 'IOS' ? 'appstore-ios' : 'appstore-macos'
  const label = platform === 'IOS' ? 'App Store (iOS)' : 'App Store (macOS)'
  const result = { id, platform: label, pending: false }
  const { ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY } = process.env

  if (ASC_ISSUER_ID && ASC_KEY_ID && ASC_PRIVATE_KEY) {
    try {
      const { auth, appId } = await appStoreConnect()
      if (!appId) return unknownState({ ...result, status: 'not found in ASC' }, `no app ${APPLE_BUNDLE_ID} in App Store Connect`)
      const res = await fetch(
        `https://api.appstoreconnect.apple.com/v1/apps/${appId}/appStoreVersions?filter[platform]=${platform}&limit=10`,
        auth
      )
      if (!res.ok) throw new Error(`appStoreVersions: HTTP ${res.status}`)
      const stateOf = (v) => v.attributes.appVersionState ?? v.attributes.appStoreState
      const relevant = ((await res.json()).data ?? [])
        // Skip versions a newer one replaced, in either state field.
        .filter((v) => ![stateOf(v), v.attributes.appStoreState].includes('REPLACED_WITH_NEW_VERSION'))
        .slice(0, 3)
      if (relevant.length === 0) return { ...result, status: 'no versions' }
      const pending = relevant.find((v) => isPending('appstore', stateOf(v)))
      return {
        ...result,
        version: relevant[0].attributes.versionString,
        status: stateOf(relevant[0]),
        statusDetail: relevant.length > 1
          ? relevant.map((v) => `v${v.attributes.versionString} ${stateOf(v)}`).join(', ')
          : undefined,
        pending: Boolean(pending),
        pendingVersion: pending?.attributes.versionString,
        pendingState: pending && stateOf(pending),
      }
    } catch (e) {
      return unknownState({ ...result, status: 'error', error: e.message }, e.message)
    }
  }

  let live
  try {
    const url = platform === 'IOS'
      ? `https://itunes.apple.com/lookup?bundleId=${APPLE_BUNDLE_ID}&country=us`
      : 'https://itunes.apple.com/search?term=byoky&entity=macSoftware&country=us&limit=5'
    const data = await (await fetch(url)).json()
    const app = data.results?.find((r) => r.bundleId === APPLE_BUNDLE_ID)
    live = app
      ? { ...result, version: app.version, status: 'published', statusDetail: 'live only; pending state unknown without ASC credentials' }
      : { ...result, status: 'not published', statusDetail: 'pending state unknown: no ASC credentials' }
  } catch (e) {
    live = { ...result, status: 'error', error: e.message }
  }
  // release.sh uploads with just ASC_KEY_ID and ASC_ISSUER_ID (altool reads
  // the key file); reading the review state takes the key itself as well.
  return ASC_KEY_ID && ASC_ISSUER_ID ? unknownState(live, 'ASC_PRIVATE_KEY missing') : live
}

const NPM_PACKAGES = [
  '@byoky/core',
  '@byoky/sdk',
  '@byoky/bridge',
  '@byoky/openclaw-plugin',
  'create-byoky-app',
]

async function npmStatuses() {
  return Promise.all(
    NPM_PACKAGES.map(async (name) => {
      const base = { id: `npm:${name}`, platform: `npm ${name}`, pending: false }
      try {
        const res = await fetch(`https://registry.npmjs.org/${name}/latest`)
        if (!res.ok) return { ...base, status: 'not published' }
        const data = await res.json()
        return { ...base, version: data.version, status: 'published' }
      } catch (e) {
        return { ...base, status: 'error', error: e.message }
      }
    })
  )
}

function generateAmoJwt() {
  const { AMO_API_KEY, AMO_API_SECRET } = process.env
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: AMO_API_KEY,
    jti: Math.random().toString(36),
    iat: now,
    exp: now + 60,
  })).toString('base64url')
  const sig = createHmac('sha256', AMO_API_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${sig}`
}

async function main() {
  loadEnv()
  const json = process.argv.includes('--json')
  const ignore = process.argv
    .filter((a) => a.startsWith('--ignore='))
    .flatMap((a) => a.slice('--ignore='.length).split(','))
    .filter(Boolean)
  const localVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version

  const results = [
    ...(await npmStatuses()),
    ...(await Promise.all([
      chromeWebStoreStatus(),
      amoStatus(),
      appStoreStatus('IOS'),
      appStoreStatus('MAC_OS'),
      googlePlayStatus(),
    ])),
  ]
  for (const r of results) if (ignore.includes(r.id)) r.ignored = true
  const pending = results.filter((r) => r.pending)
  const unknown = results.filter((r) => r.unknown)

  if (json) {
    console.log(JSON.stringify({ localVersion, results }, null, 2))
  } else {
    console.log(`Local version: ${localVersion}\n`)
    const COL = 28
    for (const r of results) {
      const parts = [r.platform.padEnd(COL)]
      if (r.version) parts.push(`v${r.version}`)
      if (r.status) parts.push(r.status)
      if (r.statusDetail) parts.push(`(${r.statusDetail})`)
      if (r.error) parts.push(`— ${r.error}`)
      console.log(parts.join('  '))
    }
    const held = (r) => (r.ignored ? '  [ignored: not counted]' : '')
    if (pending.length) {
      console.log('\nPending review (an upload now would replace the submission and restart its review):')
      for (const r of pending) console.log(`  ${r.platform} v${r.pendingVersion ?? '?'} ${r.pendingState ?? ''}${held(r)}`)
    }
    if (unknown.length) {
      console.log('\nReview state UNKNOWN, counted as pending (a review may be under way that an upload would restart):')
      for (const r of unknown) console.log(`  ${r.platform}: ${r.unknownReason}${held(r)}`)
    }
  }
  if (blocking(results, ignore).length) process.exitCode = 3
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await main()
}
