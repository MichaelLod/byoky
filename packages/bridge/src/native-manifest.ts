/**
 * Native messaging host registration, shared by `byoky-bridge install` and
 * the OpenClaw plugin so both write the same manifests to the same places.
 *
 * No env lookups or child_process here: the OpenClaw plugin bundles this
 * file, and OpenClaw's install-time scanner blocks plugins that mix those
 * with network calls. Callers pass the home directory and platform in.
 */

import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, unlinkSync, writeFileSync } from 'node:fs';
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
  /** Registered, but the host it points at can't start: register again. */
  broken: string[];
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

/** Which installed browsers have the host registered, and whether it can start. */
export function getRegistrationStatusAt(home: string, os: string): RegistrationStatus {
  const registered: string[] = [];
  const missing: string[] = [];
  const broken: string[] = [];
  for (const loc of getManifestLocations(home, os)) {
    if (!isInstalled(loc)) continue;
    if (!existsSync(loc.path)) missing.push(loc.browser);
    else (hostCanStart(loc.path) ? registered : broken).push(loc.browser);
  }
  return { registered, missing, broken };
}

/**
 * Whether the wrapper a manifest names runs a node binary and a host script
 * that are there. A host path taken from a package manager's shim (pnpm's
 * `#!/bin/sh` script, Volta's native binary) or from a package that has
 * since been removed leaves the browser unable to start the host.
 */
function hostCanStart(manifestPath: string): boolean {
  let wrapper: unknown;
  try {
    wrapper = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { path?: unknown }).path;
  } catch {
    return false;
  }
  if (typeof wrapper !== 'string' || !existsSync(wrapper)) return false;
  let target: { node: string; host: string } | null;
  try {
    target = wrapperTarget(readFileSync(wrapper, 'utf8'));
  } catch {
    return false;
  }
  // A wrapper this version didn't write: nothing to check it against.
  if (!target) return true;
  return existsSync(target.node) && isNodeScript(target.host);
}

/** The node binary and host script of a wrapper createNativeWrapper wrote (or an older one). */
export function wrapperTarget(script: string): { node: string; host: string } | null {
  const line = script.split('\n').find((l) => l.startsWith('exec '));
  const words = line ? shellWords(line) : [];
  if (words.length < 4 || words[0] !== 'exec' || words[3] !== 'host') return null;
  return { node: words[1], host: words[2] };
}

/** Splits a line of shell into words: single quotes, double quotes, backslashes. */
function shellWords(line: string): string[] {
  const words: string[] = [];
  let word = '';
  let inWord = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" || c === '"') {
      const end = line.indexOf(c, i + 1);
      if (end < 0) return [];
      word += line.slice(i + 1, end);
      i = end;
      inWord = true;
    } else if (c === '\\' && i + 1 < line.length) {
      word += line[++i];
      inWord = true;
    } else if (c === ' ' || c === '\t') {
      if (inWord) words.push(word);
      word = '';
      inWord = false;
    } else {
      word += c;
      inWord = true;
    }
  }
  if (inWord) words.push(word);
  return words;
}

/** A script node can run: not a native binary, and not a script for another interpreter. */
function isNodeScript(path: string): boolean {
  const head = Buffer.alloc(512);
  let length: number;
  try {
    const fd = openSync(path, 'r');
    try {
      length = readSync(fd, head, 0, head.length, 0);
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
  const start = head.subarray(0, length);
  if (start.includes(0)) return false;
  const text = start.toString('utf8');
  return !text.startsWith('#!') || /\bnode\b/.test(text.split('\n')[0]);
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
