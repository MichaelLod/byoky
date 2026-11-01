#!/usr/bin/env node
// Runs OpenClaw's own install-time code scanner on the OpenClaw plugin as it
// would be published, and fails on any critical finding.
//
// OpenClaw scans a plugin's files when it is installed and refuses (newer
// versions) or warns loudly about patterns such as process.env next to a
// network call in one file ("env-harvesting") or child_process exec/spawn.
// That has broken installs before (3f777ec), so the release runs this after
// `pnpm build` and before `pnpm publish`, and CI runs it on every change.
//
// Usage: node scripts/scan-openclaw-plugin.mjs [--openclaw <dir>]
//   Needs a built plugin (pnpm --filter @byoky/openclaw-plugin build).
//   --openclaw (or OPENCLAW_DIR) points at another openclaw install, e.g.
//   a newer one than the plugin's devDependency.
//
// Exit codes: 0 clean (warnings are printed), 1 critical findings,
// 2 the scanner or the plugin could not be set up.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_DIR = join(ROOT, 'packages', 'openclaw-plugin');

function fail(message, code = 2) {
  console.error(`::error::scan-openclaw-plugin: ${message}`);
  process.exit(code);
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

// ── The scanner ─────────────────────────────────────────

const openclawDir = (() => {
  const given = argValue('--openclaw') ?? process.env.OPENCLAW_DIR;
  const dir = given ? resolve(given) : join(PLUGIN_DIR, 'node_modules', 'openclaw');
  if (!existsSync(join(dir, 'package.json'))) {
    fail(`openclaw not found at ${dir}. Run pnpm install, or pass --openclaw <dir>.`);
  }
  return realpathSync(dir);
})();
const openclawVersion = JSON.parse(readFileSync(join(openclawDir, 'package.json'), 'utf8')).version;

// The scanner is an internal, hash-named chunk; its exports are minified.
// Find it by name and check the shape of what it returns, so an OpenClaw
// release that moves it fails here instead of passing silently.
async function loadScanner() {
  const distDir = join(openclawDir, 'dist');
  const chunks = existsSync(distDir) ? readdirSync(distDir).filter((f) => /^skill-scanner-.*\.js$/.test(f)) : [];
  if (chunks.length !== 1) {
    fail(`expected one dist/skill-scanner-*.js in openclaw ${openclawVersion}, found ${chunks.length}. The scanner moved; update this script.`);
  }
  const mod = await import(pathToFileURL(join(distDir, chunks[0])).href);
  const fns = Object.values(mod).filter((v) => typeof v === 'function');
  if (fns.length !== 1) {
    fail(`openclaw ${openclawVersion}'s ${chunks[0]} exports ${fns.length} functions, expected 1 (scanDirectoryWithSummary). Update this script.`);
  }
  return fns[0];
}

function checkSummary(summary) {
  const ok = summary && typeof summary === 'object'
    && Number.isInteger(summary.scannedFiles) && Number.isInteger(summary.critical)
    && Number.isInteger(summary.warn) && Array.isArray(summary.findings);
  if (!ok) fail(`openclaw ${openclawVersion}'s scanner returned an unexpected shape. Update this script.`);
  return summary;
}

// ── The plugin as published ─────────────────────────────

if (!existsSync(join(PLUGIN_DIR, 'dist', 'index.js'))) {
  fail('packages/openclaw-plugin/dist/index.js is missing. Build it first: pnpm --filter @byoky/openclaw-plugin build');
}

const staging = mkdtempSync(join(tmpdir(), 'byoky-openclaw-scan-'));
try {
  // `pnpm pack` applies `files` and resolves workspace:* exactly as publish
  // does, so the scan sees the files a user's OpenClaw installs.
  execFileSync('pnpm', ['pack', '--pack-destination', staging], { cwd: PLUGIN_DIR, stdio: ['ignore', 'ignore', 'inherit'] });
  const tarballs = readdirSync(staging).filter((f) => f.endsWith('.tgz'));
  if (tarballs.length !== 1) fail(`pnpm pack produced ${tarballs.length} tarballs`);
  execFileSync('tar', ['-xzf', join(staging, tarballs[0]), '-C', staging]);
  const packageDir = join(staging, 'package');

  // OpenClaw always scans the declared extension entries, wherever they are.
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const includeFiles = (manifest.openclaw?.extensions ?? []).map((entry) => resolve(packageDir, entry));
  if (includeFiles.length === 0) fail('package.json declares no openclaw.extensions');
  for (const file of includeFiles) {
    if (!existsSync(file)) fail(`openclaw.extensions entry ${relative(packageDir, file)} is not in the package`);
  }

  const scan = await loadScanner();
  const summary = checkSummary(await scan(packageDir, { includeFiles }));
  if (summary.scannedFiles === 0) fail('the scanner scanned no files');

  console.log(`OpenClaw ${openclawVersion} install scan of ${manifest.name}@${manifest.version}: ` +
    `${summary.scannedFiles} files, ${summary.critical} critical, ${summary.warn} warn`);
  for (const f of summary.findings) {
    const where = `${relative(packageDir, f.file)}:${f.line}`;
    const line = `${f.severity} ${f.ruleId} ${where}: ${f.message} [${f.evidence}]`;
    if (f.severity === 'critical') console.error(`::error::${line}`);
    else console.log(`  ${line}`);
  }
  if (summary.critical > 0) {
    console.error('OpenClaw would flag this plugin as dangerous at install time. Keep process.env, child_process and eval out of the bundled files.');
    process.exitCode = 1;
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
