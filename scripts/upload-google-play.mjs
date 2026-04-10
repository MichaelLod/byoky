#!/usr/bin/env node

// Upload an AAB to Google Play via the Android Publisher API.
//
// Requires:
//   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON — path to service account JSON key file
//     (must have "Release manager" or "Admin" role in Google Play Console)
//
// Usage:
//   node scripts/upload-google-play.mjs <path-to-aab> [track]
//
//   track: "internal" (default), "alpha", "beta", or "production"

import { readFileSync } from 'node:fs'
import { createSign } from 'node:crypto'

const PACKAGE_NAME = 'com.byoky.app'

const [aabPath, track = 'production'] = process.argv.slice(2)
if (!aabPath) {
  console.error('Usage: upload-google-play.mjs <aab-path> [track]')
  process.exit(1)
}

const keyPath = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
if (!keyPath) {
  console.error('Error: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON not set')
  process.exit(1)
}

const key = JSON.parse(readFileSync(keyPath, 'utf8'))

// --- Generate OAuth2 access token via JWT ---
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  })).toString('base64url')

  const sign = createSign('RSA-SHA256')
  sign.update(`${header}.${payload}`)
  const sig = sign.sign(key.private_key, 'base64url')
  const jwt = `${header}.${payload}.${sig}`

  const res = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return data.access_token
}

const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}`

async function main() {
  console.log(`Uploading ${aabPath} to Google Play (${track} track)...`)

  const token = await getAccessToken()
  const headers = { Authorization: `Bearer ${token}` }

  // 1. Create edit
  const editRes = await fetch(`${API}/edits`, { method: 'POST', headers })
  if (!editRes.ok) throw new Error(`Create edit failed: ${editRes.status} ${await editRes.text()}`)
  const edit = await editRes.json()
  const editId = edit.id
  console.log(`  Edit created: ${editId}`)

  // 2. Upload AAB
  const aab = readFileSync(aabPath)
  const uploadRes = await fetch(
    `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE_NAME}/edits/${editId}/bundles?uploadType=media`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body: aab,
    }
  )
  if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status} ${await uploadRes.text()}`)
  const bundle = await uploadRes.json()
  console.log(`  Bundle uploaded: versionCode ${bundle.versionCode}`)

  // 3. Assign to track
  const trackRes = await fetch(`${API}/edits/${editId}/tracks/${track}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track,
      releases: [{
        versionCodes: [bundle.versionCode],
        status: 'completed',
      }],
    }),
  })
  if (!trackRes.ok) throw new Error(`Track assign failed: ${trackRes.status} ${await trackRes.text()}`)
  console.log(`  Assigned to ${track} track`)

  // 4. Commit edit
  const commitRes = await fetch(`${API}/edits/${editId}:commit`, { method: 'POST', headers })
  if (!commitRes.ok) throw new Error(`Commit failed: ${commitRes.status} ${await commitRes.text()}`)
  console.log(`  Edit committed — upload complete`)
}

main().catch(err => {
  console.error(`Google Play upload failed: ${err.message}`)
  process.exit(1)
})
