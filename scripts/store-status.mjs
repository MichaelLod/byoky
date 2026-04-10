#!/usr/bin/env node

// Check store status for all platforms
// Usage: node scripts/store-status.mjs

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Load .env and .env.local
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
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

const ANDROID_PACKAGE = 'com.byoky.app'
const IOS_BUNDLE_ID = 'com.byoky.app'
const MACOS_BUNDLE_ID = 'com.byoky.app' // same bundle ID, different platform

async function chromeWebStoreStatus() {
  const { CHROME_EXTENSION_ID } = process.env
  if (!CHROME_EXTENSION_ID) {
    return { platform: 'Chrome', status: 'not configured' }
  }

  try {
    // Use the public CRX update check endpoint — no auth needed, returns the actual live published version.
    // The Web Store API (projection=DRAFT) only exposes draft/pipeline state, not what's live on the store.
    const res = await fetch(
      `https://clients2.google.com/service/update2/crx?response=updatecheck&acceptformat=crx3&prodversion=130.0&x=id%3D${CHROME_EXTENSION_ID}%26v%3D0.0.0%26uc`
    )
    const xml = await res.text()
    // Parse version and status from XML: <updatecheck status="ok" version="0.4.18" .../>
    // Scope to <updatecheck to avoid matching the XML declaration (e.g. version="1.0")
    const versionMatch = xml.match(/<updatecheck[^>]+version="([^"]+)"/)
    const statusMatch = xml.match(/<updatecheck[^>]+status="([^"]+)"/)
    const version = versionMatch?.[1]
    const status = statusMatch?.[1] // 'ok' = extension is live and available
    return {
      platform: 'Chrome',
      version,
      status: status || 'unknown',
    }
  } catch (e) {
    return { platform: 'Chrome', status: 'error', error: e.message }
  }
}

async function amoStatus() {
  const { AMO_API_KEY, AMO_API_SECRET } = process.env
  if (!AMO_API_KEY || !AMO_API_SECRET) {
    return { platform: 'Firefox', status: 'not configured' }
  }

  try {
    const res = await fetch(
      'https://addons.mozilla.org/api/v5/addons/addon/byoky%40byoky.com/versions/?page_size=1',
      { headers: { Authorization: `JWT ${await generateAmoJwt()}` } }
    )
    const data = await res.json()
    const v = data.results?.[0]
    if (!v) return { platform: 'Firefox', status: 'no versions' }
    return {
      platform: 'Firefox',
      version: v.version,
      status: v.file?.status || 'unknown',
    }
  } catch (e) {
    return { platform: 'Firefox', status: 'error', error: e.message }
  }
}

async function safariStatus() {
  // Safari extension is bundled with the macOS app
  // Check Mac App Store for the macOS version
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=byoky&entity=macSoftware&country=us&limit=5`
    )
    const data = await res.json()
    const app = data.results?.find(r => r.bundleId === MACOS_BUNDLE_ID)
    if (!app) {
      return { platform: 'Safari (macOS)', status: 'not published' }
    }
    return {
      platform: 'Safari (macOS)',
      version: app.version,
      status: 'published',
    }
  } catch (e) {
    return { platform: 'Safari (macOS)', status: 'error', error: e.message }
  }
}

async function googlePlayStatus() {
  try {
    const res = await fetch(
      `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}&hl=en`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    if (!res.ok) {
      return { platform: 'Google Play', status: res.status === 404 ? 'not published' : `HTTP ${res.status}` }
    }
    const html = await res.text()
    const versionMatch = html.match(/\[\[\["(\d+\.\d+\.\d+)"\]\]/)
      || html.match(/Current Version.*?>([\d.]+)</)
    const version = versionMatch?.[1] || 'unknown'
    return { platform: 'Google Play', version, status: 'published' }
  } catch (e) {
    return { platform: 'Google Play', status: 'error', error: e.message }
  }
}

async function appStoreStatus() {
  // iOS app — use App Store Connect API if credentials are available,
  // because the public iTunes lookup API only returns the live/published version
  // and will NOT reflect versions that are pending review or in processing.
  const { ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY } = process.env

  if (ASC_ISSUER_ID && ASC_KEY_ID && ASC_PRIVATE_KEY) {
    try {
      // Generate App Store Connect JWT
      const { createSign } = await import('node:crypto')
      const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' })).toString('base64url')
      const now = Math.floor(Date.now() / 1000)
      const payload = Buffer.from(JSON.stringify({
        iss: ASC_ISSUER_ID,
        iat: now,
        exp: now + 1200,
        aud: 'appstoreconnect-v1',
      })).toString('base64url')
      const sigInput = `${header}.${payload}`
      const sign = createSign('SHA256')
      sign.update(sigInput)
      const privateKey = ASC_PRIVATE_KEY.replace(/\\n/g, '\n')
      const sig = sign.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }, 'base64url')
      const jwt = `${sigInput}.${sig}`

      // Find app by bundle ID
      const appRes = await fetch(
        `https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=${IOS_BUNDLE_ID}&fields[apps]=bundleId,name`,
        { headers: { Authorization: `Bearer ${jwt}` } }
      )
      const appData = await appRes.json()
      const appId = appData.data?.[0]?.id
      if (!appId) return { platform: 'App Store (iOS)', status: 'not found in ASC' }

      // Get latest app store versions (includes pending/in-review)
      const versionsRes = await fetch(
        `https://api.appstoreconnect.apple.com/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=5`,
        { headers: { Authorization: `Bearer ${jwt}` } }
      )
      const versionsData = await versionsRes.json()
      const versions = versionsData.data || []
      if (versions.length === 0) return { platform: 'App Store (iOS)', status: 'no versions' }

      // Report all non-superseded versions to surface pending ones
      const relevant = versions.filter(v => v.attributes.appStoreState !== 'REPLACED_WITH_NEW_VERSION').slice(0, 3)
      const summary = relevant.map(v => `v${v.attributes.versionString} (${v.attributes.appStoreState})`).join(', ')
      const latestState = relevant[0]?.attributes.appStoreState || 'unknown'
      const latestVersion = relevant[0]?.attributes.versionString
      return {
        platform: 'App Store (iOS)',
        version: latestVersion,
        status: latestState,
        statusDetail: relevant.length > 1 ? summary : undefined,
      }
    } catch (e) {
      return { platform: 'App Store (iOS)', status: 'error', error: e.message }
    }
  }

  // Fallback: public iTunes lookup — WARNING: only shows live versions, pending submissions are invisible
  try {
    const res = await fetch(
      `https://itunes.apple.com/lookup?bundleId=${IOS_BUNDLE_ID}&country=us`
    )
    const data = await res.json()
    if (data.resultCount === 0) {
      return { platform: 'App Store (iOS)', status: 'not published' }
    }
    const app = data.results[0]
    return {
      platform: 'App Store (iOS)',
      version: app.version,
      // Explicitly flag that this is the live version only — pending submissions won't appear here
      status: 'published (live only — set ASC_ISSUER_ID/ASC_KEY_ID/ASC_PRIVATE_KEY to see pending)',
    }
  } catch (e) {
    return { platform: 'App Store (iOS)', status: 'error', error: e.message }
  }
}

const NPM_PACKAGES = [
  '@byoky/core',
  '@byoky/sdk',
  '@byoky/bridge',
  '@byoky/relay',
  '@byoky/openclaw-plugin',
  'create-byoky-app',
]

async function npmStatuses() {
  const results = await Promise.all(
    NPM_PACKAGES.map(async (name) => {
      try {
        const res = await fetch(`https://registry.npmjs.org/${name}/latest`)
        if (!res.ok) {
          return { platform: `npm ${name}`, status: 'not published' }
        }
        const data = await res.json()
        return { platform: `npm ${name}`, version: data.version, status: 'published' }
      } catch (e) {
        return { platform: `npm ${name}`, status: 'error', error: e.message }
      }
    })
  )
  return results
}

async function generateAmoJwt() {
  const { AMO_API_KEY, AMO_API_SECRET } = process.env
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: AMO_API_KEY,
    jti: Math.random().toString(36),
    iat: now,
    exp: now + 60,
  })).toString('base64url')
  const { createHmac } = await import('node:crypto')
  const sig = createHmac('sha256', AMO_API_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${sig}`
}

// --- Main ---
const localVersion = (await import('node:fs')).readFileSync('package.json', 'utf8')
const pkg = JSON.parse(localVersion)
console.log(`Local version: ${pkg.version}\n`)

const results = [
  ...(await npmStatuses()),
  ...(await Promise.all([
    chromeWebStoreStatus(),
    amoStatus(),
    safariStatus(),
    appStoreStatus(),
    googlePlayStatus(),
  ])),
]

const COL = 28
for (const r of results) {
  const parts = [r.platform.padEnd(COL)]
  if (r.version) parts.push(`v${r.version}`)
  parts.push(r.status)
  if (r.statusDetail) parts.push(`(${r.statusDetail})`)
  if (r.error) parts.push(`— ${r.error}`)
  console.log(parts.join('  '))
}
