#!/usr/bin/env node

// Upload an AAB to Google Play via the Android Publisher API.
//
// Requires:
//   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON — path to service account JSON key file
//     (must have "Release manager" or "Admin" role in Google Play Console)
//
// Usage:
//   node scripts/upload-google-play.mjs <path-to-aab> [track] [release-notes-file]
//   node scripts/upload-google-play.mjs --track-has <versionCode> [track]
//
//   track: "production" (default), "internal", "alpha" or "beta"
//   release-notes-file: optional path to a text file with release notes
//
// Exit codes: 0 done; 1 failed; 4 Google Play has this version code already
// and refuses the bundle (it went up before). An edit that isn't committed
// is deleted.
//
// --track-has only reads: 0 when a release on the track lists the version
// code, whatever its state (a completed release stays on the track while
// Google reviews it, before the store page shows it), 5 when none does,
// 1 when the track couldn't be read. release.sh retry asks it before
// uploading again.
//
// With STORE_IMAGES_DIR set (e.g. marketing/composites/1.1.1), a second edit
// replaces the en-US listing images from its play/ folder: phone-*.png
// screenshots, feature-graphic-*.png and icon-*.png.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createSign } from 'node:crypto'

const PACKAGE_NAME = 'com.byoky.app'

const args = process.argv.slice(2)
const lookup = args[0] === '--track-has'
if (lookup) args.shift()
const [aabPath, track = 'production', notesFile] = lookup ? [undefined, args[1]] : args
const versionCode = lookup ? args[0] : undefined
if (lookup ? !versionCode : !aabPath) {
  console.error('Usage: upload-google-play.mjs <aab-path> [track] [release-notes-file]')
  console.error('       upload-google-play.mjs --track-has <versionCode> [track]')
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

// Play refuses a bundle whose version code it has seen before.
class VersionCodeUsed extends Error {}

async function createEdit(headers) {
  const editRes = await fetch(`${API}/edits`, { method: 'POST', headers })
  if (!editRes.ok) throw new Error(`Create edit failed: ${editRes.status} ${await editRes.text()}`)
  return (await editRes.json()).id
}

// An edit left open blocks nothing, but piles up in the account.
async function deleteEdit(headers, editId) {
  await fetch(`${API}/edits/${editId}`, { method: 'DELETE', headers }).catch(() => {})
}

async function trackHas(versionCode) {
  const headers = { Authorization: `Bearer ${await getAccessToken()}` }
  const editId = await createEdit(headers)
  try {
    const res = await fetch(`${API}/edits/${editId}/tracks/${track}`, { headers })
    if (!res.ok) throw new Error(`Reading the ${track} track failed: ${res.status} ${await res.text()}`)
    const release = ((await res.json()).releases ?? [])
      .find((r) => (r.versionCodes ?? []).map(String).includes(String(versionCode)))
    if (release) {
      console.log(`  versionCode ${versionCode} is on the ${track} track (release ${release.name ?? '?'}, ${release.status})`)
      return 0
    }
    console.log(`  versionCode ${versionCode} isn't on the ${track} track`)
    return 5
  } finally {
    await deleteEdit(headers, editId)
  }
}

async function main() {
  if (lookup) {
    process.exitCode = await trackHas(versionCode)
    return
  }
  console.log(`Uploading ${aabPath} to Google Play (${track} track)...`)

  const token = await getAccessToken()
  const headers = { Authorization: `Bearer ${token}` }

  // 1. Create edit
  const editId = await createEdit(headers)
  console.log(`  Edit created: ${editId}`)
  try {
    await uploadBundle(headers, editId)
  } catch (err) {
    await deleteEdit(headers, editId)
    throw err
  }

  // 5. Listing images, in an edit of their own: a rejected image must not
  // hold back the release, and a half-replaced set is never committed.
  const imagesDir = process.env.STORE_IMAGES_DIR && join(process.env.STORE_IMAGES_DIR, 'play')
  if (imagesDir && existsSync(imagesDir)) {
    try {
      await uploadListingImages(headers, imagesDir)
    } catch (err) {
      console.error(`  WARN: listing images not updated: ${err.message}`)
    }
  }
}

// Steps 2-4 in edit editId; a failure leaves it uncommitted.
async function uploadBundle(headers, editId) {
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
  if (!uploadRes.ok) {
    const text = await uploadRes.text()
    const Err = /version code[^"]*already been used/i.test(text) ? VersionCodeUsed : Error
    throw new Err(`Upload failed: ${uploadRes.status} ${text}`)
  }
  const bundle = await uploadRes.json()
  console.log(`  Bundle uploaded: versionCode ${bundle.versionCode}`)

  // 3. Assign to track (with release notes if provided)
  const release = {
    versionCodes: [bundle.versionCode],
    status: 'completed',
  }

  if (notesFile && existsSync(notesFile)) {
    const notes = readFileSync(notesFile, 'utf8').slice(0, 500)
    release.releaseNotes = [{ language: 'en-US', text: notes }]
    console.log(`  Release notes attached (${notes.length} chars)`)
  }

  const trackRes = await fetch(`${API}/edits/${editId}/tracks/${track}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ track, releases: [release] }),
  })
  if (!trackRes.ok) throw new Error(`Track assign failed: ${trackRes.status} ${await trackRes.text()}`)
  console.log(`  Assigned to ${track} track`)

  // 4. Commit edit
  const commitRes = await fetch(`${API}/edits/${editId}:commit`, { method: 'POST', headers })
  if (!commitRes.ok) throw new Error(`Commit failed: ${commitRes.status} ${await commitRes.text()}`)
  console.log(`  Edit committed — upload complete`)
}

async function uploadListingImages(headers, imagesDir) {
  const editRes = await fetch(`${API}/edits`, { method: 'POST', headers })
  if (!editRes.ok) throw new Error(`Create edit failed: ${editRes.status} ${await editRes.text()}`)
  const editId = (await editRes.json()).id
  try {
    const files = readdirSync(imagesDir).filter((f) => f.endsWith('.png')).sort()
    const groups = {
      phoneScreenshots: files.filter((f) => f.startsWith('phone-')),
      featureGraphic: files.filter((f) => f.startsWith('feature-graphic')),
      icon: files.filter((f) => f.startsWith('icon-')),
    }
    for (const [imageType, names] of Object.entries(groups)) {
      if (names.length === 0) continue
      const listing = `${API}/edits/${editId}/listings/en-US/${imageType}`
      const del = await fetch(listing, { method: 'DELETE', headers })
      if (!del.ok) throw new Error(`Clearing ${imageType} failed: ${del.status} ${await del.text()}`)
      for (const name of names) {
        const up = await fetch(
          `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE_NAME}/edits/${editId}/listings/en-US/${imageType}?uploadType=media`,
          { method: 'POST', headers: { ...headers, 'Content-Type': 'image/png' }, body: readFileSync(join(imagesDir, name)) },
        )
        if (!up.ok) throw new Error(`Uploading ${name} failed: ${up.status} ${await up.text()}`)
      }
      console.log(`  Listing ${imageType}: ${names.length} image(s)`)
    }
    const commitRes = await fetch(`${API}/edits/${editId}:commit`, { method: 'POST', headers })
    if (!commitRes.ok) throw new Error(`Commit failed: ${commitRes.status} ${await commitRes.text()}`)
    console.log('  Listing images committed')
  } catch (err) {
    await fetch(`${API}/edits/${editId}`, { method: 'DELETE', headers }).catch(() => {})
    throw err
  }
}

main().catch(err => {
  console.error(`Google Play ${lookup ? 'track lookup' : 'upload'} failed: ${err.message}`)
  process.exit(err instanceof VersionCodeUsed ? 4 : 1)
})
