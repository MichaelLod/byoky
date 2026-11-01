import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getManifestLocations,
  getRegistrationStatusAt,
  registerHostAt,
  unregisterHostAt,
  PUBLISHED_EXTENSION_ID,
} from '../src/native-manifest.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'byoky-home-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const browserNames = (os: string) => getManifestLocations(home, os).map((l) => l.browser);
const location = (os: string, browser: string) => getManifestLocations(home, os).find((l) => l.browser === browser)!;

describe('manifest locations', () => {
  it('include Brave, Edge and Vivaldi on Linux, in their own directories', () => {
    expect(browserNames('linux')).toEqual(['Chrome', 'Chromium', 'Brave', 'Edge', 'Vivaldi', 'Firefox']);
    expect(location('linux', 'Brave').path)
      .toBe(`${home}/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.byoky.bridge.json`);
    expect(location('linux', 'Edge').path).toBe(`${home}/.config/microsoft-edge/NativeMessagingHosts/com.byoky.bridge.json`);
    expect(location('linux', 'Firefox').path).toBe(`${home}/.mozilla/native-messaging-hosts/com.byoky.bridge.json`);
  });

  it('cover the same browsers on macOS', () => {
    expect(browserNames('darwin')).toEqual(['Chrome', 'Chromium', 'Brave', 'Edge', 'Vivaldi', 'Firefox']);
    expect(location('darwin', 'Vivaldi').path)
      .toBe(`${home}/Library/Application Support/Vivaldi/NativeMessagingHosts/com.byoky.bridge.json`);
  });

  it('are empty on Windows', () => {
    expect(getManifestLocations(home, 'win32')).toEqual([]);
  });
});

describe('registerHostAt', () => {
  it('registers no browser in an empty home and creates nothing', () => {
    expect(registerHostAt(home, 'linux', '/opt/bridge.js')).toEqual({ browsers: [] });
    expect(existsSync(join(home, '.config'))).toBe(false);
  });

  it('reports Windows as unsupported', () => {
    expect(registerHostAt(home, 'win32', '/opt/bridge.js')).toEqual({ browsers: [], unsupported: true });
  });

  it('registers only the browser that is installed', () => {
    mkdirSync(join(home, '.config/BraveSoftware/Brave-Browser'), { recursive: true });
    expect(registerHostAt(home, 'linux', '/opt/bridge.js')).toEqual({ browsers: ['Brave'] });

    const brave = location('linux', 'Brave');
    const manifest = JSON.parse(readFileSync(brave.path, 'utf8'));
    expect(manifest.allowed_origins).toEqual([`chrome-extension://${PUBLISHED_EXTENSION_ID}/`]);
    expect(manifest.path).toBe(join(home, '.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/byoky-bridge-host'));
    expect(statSync(manifest.path).mode & 0o111).not.toBe(0);
    expect(existsSync(join(home, '.config/google-chrome'))).toBe(false);
  });

  it('writes a wrapper that survives quotes and spaces in the path', () => {
    mkdirSync(join(home, '.config/chromium'), { recursive: true });
    const hostDir = join(home, "it's a dir");
    mkdirSync(hostDir);
    const hostPath = join(hostDir, 'host.mjs');
    writeFileSync(hostPath, 'console.log(JSON.stringify(process.argv.slice(2)));\n');
    registerHostAt(home, 'linux', hostPath);

    const wrapper = JSON.parse(readFileSync(location('linux', 'Chromium').path, 'utf8')).path;
    const out = execFileSync(wrapper, ['chrome-extension://x/'], { encoding: 'utf8' });
    expect(JSON.parse(out)).toEqual(['host', 'chrome-extension://x/']);
  });
});

describe('status and uninstall', () => {
  it('lists only installed browsers', () => {
    mkdirSync(join(home, '.config/BraveSoftware/Brave-Browser'), { recursive: true });
    registerHostAt(home, 'linux', '/opt/bridge.js');
    mkdirSync(join(home, '.config/google-chrome'), { recursive: true });
    expect(getRegistrationStatusAt(home, 'linux')).toEqual({ registered: ['Brave'], missing: ['Chrome'] });
  });

  it('removes the manifests and the wrapper scripts', () => {
    mkdirSync(join(home, '.config/BraveSoftware/Brave-Browser'), { recursive: true });
    mkdirSync(join(home, '.mozilla'), { recursive: true });
    registerHostAt(home, 'linux', '/opt/bridge.js');
    const dirs = ['Brave', 'Firefox'].map((b) => location('linux', b).path.replace(/[^/]+$/, ''));

    expect(unregisterHostAt(home, 'linux')).toEqual(['Brave', 'Firefox']);
    for (const dir of dirs) {
      expect(existsSync(join(dir, 'com.byoky.bridge.json'))).toBe(false);
      expect(existsSync(join(dir, 'byoky-bridge-host'))).toBe(false);
    }
    expect(getRegistrationStatusAt(home, 'linux')).toEqual({ registered: [], missing: ['Brave', 'Firefox'] });
  });
});
