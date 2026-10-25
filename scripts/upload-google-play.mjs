#!/usr/bin/env node

// Upload an AAB to Google Play via the Android Publisher API.
//
// Requires:
//   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON — path to service account JSON key file
//     (must have "Release manager" or "Admin" role in Google Play Console)
//
// Usage:
//   node scripts/upload-google-play.mjs <path-to-aab> [track] [release-notes-file]
//
//   track: "internal" (default), "alpha", "beta", or "production"
//   release-notes-file: optional path to a text file with release notes
//
// With STORE_IMAGES_DIR set (e.g. marketing/composites/1.1.1), a second edit
// replaces the en-US listing images from its play/ folder: phone-*.png
// screenshots, feature-graphic-*.png and icon-*.png.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createSign } from 'node:crypto'

const PACKAGE_NAME = 'com.byoky.app'

const [aabPath, track = 'production', notesFile] = process.argv.slice(2)
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
  console.error(`Google Play upload failed: ${err.message}`)
  process.exit(1)
})
