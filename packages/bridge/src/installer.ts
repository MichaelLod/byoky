/**
 * Installs/uninstalls the native messaging host manifest for each browser.
 *
 * Usage:
 *   byoky-bridge install    — register with Chrome, Chromium, Brave, and Firefox
 *   byoky-bridge uninstall  — remove registrations
 *   byoky-bridge status     — check if registered
 *
 * macOS and Linux only. Windows needs a registry key per browser and a
 * non-bash wrapper, so `install` reports it as unsupported for now.
 */

import { writeFileSync, mkdirSync, unlinkSync, existsSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { execFileSync } from 'node:child_process';
import { HOST_NAME, buildManifest, type ManifestOptions } from './native-manifest.js';

function getHostPath(): string {
  try {
    return execFileSync('/usr/bin/which', ['byoky-bridge'], { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return resolve(dirname(new URL(import.meta.url).pathname), '../bin/byoky-bridge.js');
  }
}

/**
 * Create a native messaging wrapper script that uses the absolute node path.
 * Chrome/Brave launch native hosts with a minimal PATH that doesn't include
 * nvm/fnm/volta/etc, so `#!/usr/bin/env node` often fails.
 *
 * Instead of inheriting the user's PATH (which risks injection), we construct
 * a minimal PATH from the known node binary directory.
 */
function createNativeWrapper(hostPath: string, manifestDir: string): string {
  const nodePath = process.execPath;
  const wrapperPath = resolve(manifestDir, 'byoky-bridge-host');
  const nodeDir = dirname(nodePath);
  const safePath = `${nodeDir}:/usr/local/bin:/usr/bin:/bin`;
  const script = [
    '#!/bin/bash',
    `export PATH='${safePath}'`,
    `exec '${nodePath.replace(/'/g, "'\\''")}' '${hostPath.replace(/'/g, "'\\''")}' host "$@"`,
    '',
  ].join('\n');
  writeFileSync(wrapperPath, script);
  chmodSync(wrapperPath, 0o755);
  return wrapperPath;
}

interface ManifestLocation {
  browser: string;
  path: string;
  type: 'chrome' | 'firefox';
}

function getManifestLocations(): ManifestLocation[] {
  const home = homedir();
  const os = platform();

  if (os === 'darwin') {
    return [
      {
        browser: 'Chrome',
        path: `${home}/Library/Application Support/Google/Chrome/NativeMessagingHosts/${HOST_NAME}.json`,
        type: 'chrome',
      },
      {
        browser: 'Chromium',
        path: `${home}/Library/Application Support/Chromium/NativeMessagingHosts/${HOST_NAME}.json`,
        type: 'chrome',
      },
      {
        browser: 'Brave',
        path: `${home}/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/${HOST_NAME}.json`,
        type: 'chrome',
      },
      {
        browser: 'Firefox',
        path: `${home}/Library/Application Support/Mozilla/NativeMessagingHosts/${HOST_NAME}.json`,
        type: 'firefox',
      },
    ];
  }

  if (os === 'linux') {
    return [
      {
        browser: 'Chrome',
        path: `${home}/.config/google-chrome/NativeMessagingHosts/${HOST_NAME}.json`,
        type: 'chrome',
      },
      {
        browser: 'Chromium',
        path: `${home}/.config/chromium/NativeMessagingHosts/${HOST_NAME}.json`,
        type: 'chrome',
      },
      {
        browser: 'Firefox',
        path: `${home}/.mozilla/native-messaging-hosts/${HOST_NAME}.json`,
        type: 'firefox',
      },
    ];
  }

  return [];
}

export interface RegisterResult {
  browsers: string[];
  unsupported?: boolean;
}

export interface RegistrationStatus {
  registered: string[];
  missing: string[];
}

/** Programmatic install — returns registered browser names, no stdout. */
export function registerHost(opts: ManifestOptions = {}): RegisterResult {
  const locations = getManifestLocations();
  if (locations.length === 0) return { browsers: [], unsupported: true };

  const hostPath = getHostPath();
  const browsers: string[] = [];

  for (const loc of locations) {
    try {
      const manifestDir = dirname(loc.path);
      mkdirSync(manifestDir, { recursive: true });
      const wrapperPath = createNativeWrapper(hostPath, manifestDir);
      const manifest = buildManifest(wrapperPath, loc.type, opts);
      writeFileSync(loc.path, JSON.stringify(manifest, null, 2));
      browsers.push(loc.browser);
    } catch {
      // Browser not installed, skip
    }
  }

  return { browsers };
}

/** Programmatic status check — returns which browsers have the host registered. */
export function getRegistrationStatus(): RegistrationStatus {
  const locations = getManifestLocations();
  const registered: string[] = [];
  const missing: string[] = [];
  for (const loc of locations) {
    (existsSync(loc.path) ? registered : missing).push(loc.browser);
  }
  return { registered, missing };
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
    console.error('No supported browsers found.');
  }
}

export function uninstall(): void {
  const locations = getManifestLocations();

  for (const loc of locations) {
    try {
      if (existsSync(loc.path)) {
        unlinkSync(loc.path);
        console.log(`  Removed from ${loc.browser}`);
      }
    } catch {
      // Skip
    }
  }

  console.log('\nByoky Bridge uninstalled.');
}

export function status(): void {
  const { registered, missing } = getRegistrationStatus();
  for (const browser of registered) {
    console.log(`  \u2713 ${browser}: registered`);
  }
  for (const browser of missing) {
    console.log(`  \u2717 ${browser}: not registered`);
  }
}
