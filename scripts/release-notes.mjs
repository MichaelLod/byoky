#!/usr/bin/env node

// Generate structured release notes from git log between two tags/refs.
//
// Usage:
//   node scripts/release-notes.mjs <from-ref> <to-ref> <new-version> <native-version> <native-code>
//   node scripts/release-notes.mjs --store <from-ref> <to-ref>
//
// --store: Plain-text "What's New" for App Store / Google Play (max 500 chars, no markdown)
// Default: Markdown release notes for GitHub.

import { execFileSync } from 'node:child_process'

const storeMode = process.argv[2] === '--store'
const args = storeMode ? process.argv.slice(3) : process.argv.slice(2)
const [fromRef, toRef, version, nativeVersion, nativeCode] = args

if (!fromRef || !toRef || (!storeMode && !version)) {
  console.error('Usage: release-notes.mjs [--store] <from-ref> <to-ref> [version] [native-version] [native-code]')
  process.exit(1)
}

const log = execFileSync('git', ['log', `${fromRef}..${toRef}`, '--pretty=format:%s', '--no-merges'], {
  encoding: 'utf8',
}).trim()

if (!log) {
  console.log(`## v${version}\n\nNo changes since ${fromRef}.`)
  process.exit(0)
}

const lines = log.split('\n').map(l => l.trim()).filter(Boolean)

// Categorize commits by conventional-commit prefix
const categories = {
  feat: { title: 'Features', items: [] },
  fix: { title: 'Bug Fixes', items: [] },
  refactor: { title: 'Refactors', items: [] },
  perf: { title: 'Performance', items: [] },
  test: { title: 'Tests', items: [] },
  docs: { title: 'Documentation', items: [] },
  chore: { title: 'Chores', items: [] },
  ci: { title: 'CI/CD', items: [] },
  other: { title: 'Other', items: [] },
}

for (const line of lines) {
  // Match: type(scope): message  OR  type: message
  const match = line.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/)
  if (match) {
    const [, type, scope, message] = match
    const cat = categories[type] || categories.other
    cat.items.push(scope ? `**${scope}**: ${message}` : message)
  } else {
    categories.other.items.push(line)
  }
}

// --- Store mode: plain-text "What's New" (max 500 chars) ---
if (storeMode) {
  const feats = categories.feat.items.map(i => i.replace(/\*\*([^*]+)\*\*:\s*/g, ''))
  const fixes = categories.fix.items.map(i => i.replace(/\*\*([^*]+)\*\*:\s*/g, ''))
  const lines = []
  if (feats.length) lines.push(...feats.map(f => `- ${f}`))
  if (fixes.length) lines.push(...fixes.map(f => `- Fixed: ${f}`))
  if (!lines.length) lines.push('Bug fixes and improvements.')
  // Trim to 500 chars (App Store limit)
  let text = lines.join('\n')
  if (text.length > 500) text = text.slice(0, 497) + '...'
  console.log(text)
  process.exit(0)
}

// Build markdown
const parts = [`## v${version}\n`]

// Version matrix
parts.push('### Versions')
parts.push('')
parts.push('| Platform | Version |')
parts.push('|----------|---------|')
parts.push(`| npm packages | \`${version}\` |`)
parts.push(`| Chrome / Firefox / Safari extension | \`${version}\` |`)
if (nativeVersion && nativeCode) {
  parts.push(`| iOS / macOS | \`${nativeVersion}\` (${nativeCode}) |`)
  parts.push(`| Android | \`${nativeVersion}\` (${nativeCode}) |`)
}
parts.push('')

// Changelog sections
for (const [, cat] of Object.entries(categories)) {
  if (cat.items.length === 0) continue
  parts.push(`### ${cat.title}`)
  parts.push('')
  for (const item of cat.items) {
    parts.push(`- ${item}`)
  }
  parts.push('')
}

// Install/update instructions
parts.push('### Install / Update')
parts.push('')
parts.push('```bash')
parts.push(`npm install @byoky/sdk@${version}`)
parts.push('```')
parts.push('')
parts.push('- **Chrome**: auto-updated via Chrome Web Store')
parts.push('- **Firefox**: submitted for review on AMO')
parts.push('- **Safari (macOS)**: submitted to Mac App Store')
parts.push('- **iOS**: submitted to App Store')
parts.push('- **Android**: submitted to Google Play')

console.log(parts.join('\n'))
