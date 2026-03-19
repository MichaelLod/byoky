/**
 * Installs/uninstalls the native messaging host manifest for each browser.
 *
 * Usage:
 *   byoky-bridge install    — register with Chrome, Firefox, and Safari
 *   byoky-bridge uninstall  — remove registrations
 *   byoky-bridge status     — check if registered
 */

import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { execSync } from 'node:child_process';

const HOST_NAME = 'com.byoky.bridge';

function getHostPath(): string {
  // Find the actual host binary
  try {
    return execSync('which byoky-bridge', { encoding: 'utf-8' }).trim();
  } catch {
    // Fallback: assume it's in the same directory as this file
    return resolve(dirname(new URL(import.meta.url).pathname), '../bin/byoky-bridge.js');
  }
}

function buildManifest(hostPath: string, browserType: 'chrome' | 'firefox'): object {
  const base = {
    name: HOST_NAME,
    description: 'Byoky Bridge — routes setup token requests through Claude Code CLI',
    path: hostPath,
    type: 'stdio',
  };

  if (browserType === 'chrome') {
    return {
      ...base,
      allowed_origins: [
        // Chrome uses extension IDs — we allow all since the ID varies per install
        'chrome-extension://*/',
      ],
    };
  }

  // Firefox uses extension IDs from the manifest
  return {
    ...base,
    allowed_extensions: ['byoky@byoky.com'],
  };
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

  if (os === 'win32') {
    const appData = process.env.LOCALAPPDATA || `${home}/AppData/Local`;
    return [
      {
        browser: 'Chrome',
        path: `${appData}/Google/Chrome/User Data/NativeMessagingHosts/${HOST_NAME}.json`,
        type: 'chrome',
      },
      {
        browser: 'Firefox',
        path: `${appData}/Mozilla/NativeMessagingHosts/${HOST_NAME}.json`,
        type: 'firefox',
      },
    ];
  }

  return [];
}

export function install(): void {
  const hostPath = getHostPath();
  const locations = getManifestLocations();

  if (locations.length === 0) {
    console.error('Unsupported platform');
    process.exit(1);
  }

  let installed = 0;

  for (const loc of locations) {
    try {
      const manifest = buildManifest(hostPath, loc.type);
      mkdirSync(dirname(loc.path), { recursive: true });
      writeFileSync(loc.path, JSON.stringify(manifest, null, 2));
      console.log(`  Registered with ${loc.browser}`);
      installed++;
    } catch {
      // Browser not installed, skip
    }
  }

  if (installed > 0) {
    console.log(`\nByoky Bridge installed for ${installed} browser(s).`);
    console.log('Restart your browser for changes to take effect.');
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
  const locations = getManifestLocations();

  for (const loc of locations) {
    const exists = existsSync(loc.path);
    const icon = exists ? '\u2713' : '\u2717';
    console.log(`  ${icon} ${loc.browser}: ${exists ? 'registered' : 'not registered'}`);
  }
}
