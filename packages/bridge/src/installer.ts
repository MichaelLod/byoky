/**
 * Installs/uninstalls the native messaging host manifest for each browser.
 *
 * Usage:
 *   byoky-bridge install    — register with Chrome, Chromium, Brave, Edge, Vivaldi and Firefox
 *   byoky-bridge uninstall  — remove registrations
 *   byoky-bridge status     — check if registered
 *
 * macOS and Linux only. Windows needs a registry key per browser and a
 * non-bash wrapper, so `install` reports it as unsupported for now.
 */

import { dirname, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  getRegistrationStatusAt,
  registerHostAt,
  unregisterHostAt,
  type ManifestOptions,
  type RegisterResult,
  type RegistrationStatus,
} from './native-manifest.js';

export type { RegisterResult, RegistrationStatus } from './native-manifest.js';

function getHostPath(): string {
  try {
    return execFileSync('/usr/bin/which', ['byoky-bridge'], { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return resolve(dirname(new URL(import.meta.url).pathname), '../bin/byoky-bridge.js');
  }
}

/** Programmatic install — returns registered browser names, no stdout. */
export function registerHost(opts: ManifestOptions = {}): RegisterResult {
  return registerHostAt(homedir(), platform(), getHostPath(), opts);
}

/** Programmatic status check — returns which installed browsers have the host registered. */
export function getRegistrationStatus(): RegistrationStatus {
  return getRegistrationStatusAt(homedir(), platform());
}

export function install(opts: ManifestOptions = {}): void {
  const result = registerHost(opts);

  if (result.unsupported) {
    console.error('Byoky Bridge supports macOS and Linux only — Windows isn\'t supported yet.');
    process.exit(1);
  }

  for (const browser of result.browsers) {
    console.log(`  Registered with ${browser}`);
  }

  if (result.browsers.length > 0) {
    console.log(`\nByoky Bridge installed for ${result.browsers.length} browser(s).`);
    console.log('Restart your browser for changes to take effect.');
    if (!opts.dev && !opts.extensionId) {
      console.log('Only the Chrome Web Store extension is allowed. Loaded Byoky unpacked? Re-run with --dev.');
    }
  } else {
    console.error('No supported browser found (Chrome, Chromium, Brave, Edge, Vivaldi or Firefox).');
    console.error('Start your browser once, then run `byoky-bridge install` again.');
  }
}

export function uninstall(): void {
  for (const browser of unregisterHostAt(homedir(), platform())) {
    console.log(`  Removed from ${browser}`);
  }
  console.log('\nByoky Bridge uninstalled.');
}

export function status(): void {
  const { registered, missing } = getRegistrationStatus();
  for (const browser of registered) {
    console.log(`  ✓ ${browser}: registered`);
  }
  for (const browser of missing) {
    console.log(`  ✗ ${browser}: not registered`);
  }
  if (registered.length === 0 && missing.length === 0) {
    console.log('  No supported browser found.');
  }
}
