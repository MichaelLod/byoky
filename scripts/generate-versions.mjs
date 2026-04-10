#!/usr/bin/env node

// Generate packages/web/public/versions.json with current platform versions.
// Called by the release pipeline and `pnpm release:retry`.
//
// Output: { platforms: [...], generatedAt: ISO string }

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHmac, createSign } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Load .env / .env.local
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1)
    if (!process.env[key]) process.env[key] = val
  }
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const localVersion = pkg.version

// Read native version from Android gradle
const gradle = readFileSync(resolve(root, 'packages/android/app/build.gradle.kts'), 'utf8')
const nativeVersion = gradle.match(/versionName = "([^"]+)"/)?.[1] || localVersion

async function fetchSafe(url, opts) {
  try {
    return await fetch(url, opts)
  } catch {
    return null
  }
}

async function getChromeVersion() {
  const id = process.env.CHROME_EXTENSION_ID
  if (!id) return { platform: 'Chrome', version: null, status: 'unknown' }
  const res = await fetchSafe(
    `https://clients2.google.com/service/update2/crx?response=updatecheck&acceptformat=crx3&prodversion=130.0&x=id%3D${id}%26v%3D0.0.0%26uc`
  )
  if (!res) return { platform: 'Chrome', version: null, status: 'unknown' }
  const xml = await res.text()
  const version = xml.match(/<updatecheck[^>]+version="([^"]+)"/)?.[1]
  return { platform: 'Chrome', version: version || null, status: version ? 'live' : 'unknown' }
}

async function getFirefoxVersion() {
  const { AMO_API_KEY, AMO_API_SECRET } = process.env
  if (!AMO_API_KEY || !AMO_API_SECRET) return { platform: 'Firefox', version: null, status: 'unknown' }
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const p = Buffer.from(JSON.stringify({ iss: AMO_API_KEY, jti: Math.random().toString(36), iat: now, exp: now + 60 })).toString('base64url')
  const s = createHmac('sha256', AMO_API_SECRET).update(`${h}.${p}`).digest('base64url')
  const res = await fetchSafe(
    'https://addons.mozilla.org/api/v5/addons/addon/byoky%40byoky.com/versions/?page_size=1',
    { headers: { Authorization: `JWT ${h}.${p}.${s}` } }
  )
  if (!res) return { platform: 'Firefox', version: null, status: 'unknown' }
  const data = await res.json()
  const v = data.results?.[0]
  return { platform: 'Firefox', version: v?.version || null, status: v?.file?.status === 'public' ? 'live' : 'pending' }
}

async function getIOSVersion() {
  const { ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY } = process.env
  if (!ASC_ISSUER_ID || !ASC_KEY_ID || !ASC_PRIVATE_KEY) {
    // Fallback: public iTunes lookup
    const res = await fetchSafe('https://itunes.apple.com/lookup?bundleId=com.byoky.app&country=us')
    if (!res) return { platform: 'iOS', version: null, status: 'unknown' }
    const data = await res.json()
    const app = data.results?.[0]
    return { platform: 'iOS', version: app?.version || null, status: app ? 'live' : 'unknown' }
  }
  // ASC API
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })).toString('base64url')
  const sign = createSign('SHA256')
  sign.update(`${header}.${payload}`)
  const pk = ASC_PRIVATE_KEY.replace(/\\n/g, '\n')
  const sig = sign.sign({ key: pk, dsaEncoding: 'ieee-p1363' }, 'base64url')
  const jwt = `${header}.${payload}.${sig}`
  const h = { Authorization: `Bearer ${jwt}` }

  const appRes = await fetchSafe('https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=com.byoky.app&fields[apps]=bundleId', { headers: h })
  if (!appRes) return { platform: 'iOS', version: null, status: 'unknown' }
  const appData = await appRes.json()
  const appId = appData.data?.[0]?.id
  if (!appId) return { platform: 'iOS', version: null, status: 'unknown' }

  const vRes = await fetchSafe(`https://api.appstoreconnect.apple.com/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=3`, { headers: h })
  if (!vRes) return { platform: 'iOS', version: null, status: 'unknown' }
  const vData = await vRes.json()
  const versions = vData.data || []
  const live = versions.find(v => v.attributes.appStoreState === 'READY_FOR_SALE')
  const pending = versions.find(v => ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'PREPARE_FOR_SUBMISSION'].includes(v.attributes.appStoreState))

  return {
    platform: 'iOS',
    version: live?.attributes.versionString || null,
    status: live ? 'live' : 'unknown',
    pending: pending ? pending.attributes.versionString : undefined,
  }
}

async function getAndroidVersion() {
  const res = await fetchSafe(
    'https://play.google.com/store/apps/details?id=com.byoky.app&hl=en',
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  )
  if (!res || !res.ok) return { platform: 'Android', version: null, status: 'unknown' }
  const html = await res.text()
  const version = (html.match(/\[\[\["(\d+\.\d+\.\d+)"\]\]/) || html.match(/Current Version.*?>([\d.]+)</))?.[1]
  return { platform: 'Android', version: version || null, status: version ? 'live' : 'unknown' }
}

async function getNpmVersion() {
  const res = await fetchSafe('https://registry.npmjs.org/@byoky/sdk/latest')
  if (!res || !res.ok) return { platform: 'npm', version: null, status: 'unknown' }
  const data = await res.json()
  return { platform: 'npm', version: data.version || null, status: 'live' }
}

// --- Main ---
const [chrome, firefox, ios, android, npm] = await Promise.all([
  getChromeVersion(),
  getFirefoxVersion(),
  getIOSVersion(),
  getAndroidVersion(),
  getNpmVersion(),
])

// Mark platforms as pending if their version is behind the local version
for (const p of [chrome, firefox]) {
  if (p.version && p.version !== localVersion) {
    p.pending = localVersion
  }
}
for (const p of [ios, android]) {
  if (p.version && p.version !== nativeVersion) {
    p.pending = nativeVersion
  }
}

const output = {
  local: localVersion,
  native: nativeVersion,
  platforms: [chrome, firefox, ios, android, npm],
  generatedAt: new Date().toISOString(),
}

const outPath = resolve(root, 'packages/web/public/versions.json')
writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n')
console.log(`Generated ${outPath}`)
console.log(JSON.stringify(output, null, 2))
