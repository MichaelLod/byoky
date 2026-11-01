/**
 * Native messaging host registration, shared by `byoky-bridge install` and
 * the OpenClaw plugin so both write the same manifests to the same places.
 *
 * No env lookups or child_process here: the OpenClaw plugin bundles this
 * file, and OpenClaw's install-time scanner blocks plugins that mix those
 * with network calls. Callers pass the home directory and platform in.
 */

import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const HOST_NAME = 'com.byoky.bridge';

// Chrome Web Store build — the only Chrome extension allowed by default.
export const PUBLISHED_EXTENSION_ID = 'igjohldpldlahcjmefdhlnbcpldlgmon';
// Derived from the `key` pinned in packages/extension/wxt.config.ts (WXT dev
// and unpacked builds from this repo). The key is public, so any unpacked
// extension can claim this ID; it is only allowed with `install --dev`.
export const UNPACKED_EXTENSION_ID = 'idlmdfkobnkdakcpiihighchdbbmbpep';
export const FIREFOX_EXTENSION_ID = 'byoky@byoky.com';

/** The wrapper script written next to each manifest. */
const WRAPPER_NAME = 'byoky-bridge-host';

export interface ManifestOptions {
  /** Allow this Chrome extension ID instead of the Web Store build. */
  extensionId?: string;
  /** Also allow the unpacked development build. */
  dev?: boolean;
}

export function buildManifest(
  hostPath: string,
  browserType: 'chrome' | 'firefox',
  opts: ManifestOptions = {},
): object {
  const base = {
    name: HOST_NAME,
    description: 'Byoky Bridge — native messaging host',
    path: hostPath,
    type: 'stdio',
  };

  if (browserType === 'chrome') {
    const ids = [opts.extensionId ?? PUBLISHED_EXTENSION_ID];
    if (opts.dev) ids.push(UNPACKED_EXTENSION_ID);
    return {
      ...base,
      allowed_origins: ids.map((id) => `chrome-extension://${id}/`),
    };
  }

  // Firefox uses extension IDs from the manifest
  return {
    ...base,
    allowed_extensions: [FIREFOX_EXTENSION_ID],
  };
}

export interface ManifestLocation {
  browser: string;
  /** Where the browser looks for the host manifest (per user). */
  path: string;
  /** The browser's own data directories; one exists once it has run. */
  profileDirs: string[];
  type: 'chrome' | 'firefox';
}

/**
 * Per-user manifest locations on macOS and Linux. Edge and Vivaldi install
 * extensions from the Chrome Web Store too, but each reads its own
 * directory. Windows needs registry keys instead, so it gets none.
 */
export function getManifestLocations(home: string, os: string): ManifestLocation[] {
  const file = `${HOST_NAME}.json`;
  const chromium = (browser: string, dataDir: string): ManifestLocation => ({
    browser,
    path: `${dataDir}/NativeMessagingHosts/${file}`,
    profileDirs: [dataDir],
    type: 'chrome',
  });

  if (os === 'darwin') {
    const support = `${home}/Library/Application Support`;
    return [
      chromium('Chrome', `${support}/Google/Chrome`),
      chromium('Chromium', `${support}/Chromium`),
      chromium('Brave', `${support}/BraveSoftware/Brave-Browser`),
      chromium('Edge', `${support}/Microsoft Edge`),
      chromium('Vivaldi', `${support}/Vivaldi`),
      {
        browser: 'Firefox',
        path: `${support}/Mozilla/NativeMessagingHosts/${file}`,
        profileDirs: [`${support}/Firefox`],
        type: 'firefox',
      },
    ];
  }

  if (os === 'linux') {
    const config = `${home}/.config`;
    return [
      chromium('Chrome', `${config}/google-chrome`),
      chromium('Chromium', `${config}/chromium`),
      chromium('Brave', `${config}/BraveSoftware/Brave-Browser`),
      chromium('Edge', `${config}/microsoft-edge`),
      chromium('Vivaldi', `${config}/vivaldi`),
      {
        browser: 'Firefox',
        path: `${home}/.mozilla/native-messaging-hosts/${file}`,
        // Ubuntu's snap build keeps its profile under ~/snap/firefox.
        profileDirs: [`${home}/.mozilla`, `${home}/snap/firefox`],
        type: 'firefox',
      },
    ];
  }

  return [];
}

function isInstalled(loc: ManifestLocation): boolean {
  return loc.profileDirs.some((dir) => existsSync(dir));
}

/**
 * Create a native messaging wrapper script that uses the absolute node path.
 * Chrome/Brave launch native hosts with a minimal PATH that doesn't include
 * nvm/fnm/volta/etc, so `#!/usr/bin/env node` often fails.
 *
 * Instead of inheriting the user's PATH (which risks injection), we construct
 * a minimal PATH from the known node binary directory.
 */
export function createNativeWrapper(hostPath: string, manifestDir: string): string {
  const nodePath = process.execPath;
  const wrapperPath = resolve(manifestDir, WRAPPER_NAME);
  const nodeDir = dirname(nodePath);
  const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const script = [
    '#!/bin/bash',
    `export PATH=${quote(`${nodeDir}:/usr/local/bin:/usr/bin:/bin`)}`,
    `exec ${quote(nodePath)} ${quote(hostPath)} host "$@"`,
    '',
  ].join('\n');
  writeFileSync(wrapperPath, script);
  chmodSync(wrapperPath, 0o755);
  return wrapperPath;
}

export interface RegisterResult {
  browsers: string[];
  unsupported?: boolean;
}

export interface RegistrationStatus {
  registered: string[];
  missing: string[];
}

/**
 * Writes the manifest, and a wrapper that runs `hostPath`, for every
 * installed browser. Returns the browsers registered.
 */
export function registerHostAt(
  home: string,
  os: string,
  hostPath: string,
  opts: ManifestOptions = {},
): RegisterResult {
  const locations = getManifestLocations(home, os);
  if (locations.length === 0) return { browsers: [], unsupported: true };

  const browsers: string[] = [];
  for (const loc of locations) {
    // Creating the directories of a browser that isn't there would make it
    // look installed, and report it registered.
    if (!isInstalled(loc)) continue;
    try {
      const manifestDir = dirname(loc.path);
      mkdirSync(manifestDir, { recursive: true });
      const wrapperPath = createNativeWrapper(hostPath, manifestDir);
      const manifest = buildManifest(wrapperPath, loc.type, opts);
      writeFileSync(loc.path, JSON.stringify(manifest, null, 2));
      browsers.push(loc.browser);
    } catch {
      // Unwritable: skip this browser.
    }
  }
  return { browsers };
}

/** Which installed browsers have the host registered. */
export function getRegistrationStatusAt(home: string, os: string): RegistrationStatus {
  const registered: string[] = [];
  const missing: string[] = [];
  for (const loc of getManifestLocations(home, os)) {
    if (!isInstalled(loc)) continue;
    (existsSync(loc.path) ? registered : missing).push(loc.browser);
  }
  return { registered, missing };
}

/** Removes the manifests and their wrapper scripts; returns the browsers cleaned. */
export function unregisterHostAt(home: string, os: string): string[] {
  const removed: string[] = [];
  for (const loc of getManifestLocations(home, os)) {
    let any = false;
    for (const file of [loc.path, resolve(dirname(loc.path), WRAPPER_NAME)]) {
      try {
        if (existsSync(file)) {
          unlinkSync(file);
          any = true;
        }
      } catch {
        // Skip
      }
    }
    if (any) removed.push(loc.browser);
  }
  return removed;
}
