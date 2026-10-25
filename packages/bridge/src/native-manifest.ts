/**
 * Native messaging host manifest, shared by `byoky-bridge install` and the
 * OpenClaw plugin so both write the same allow-list.
 *
 * No env lookups or child_process here: the OpenClaw plugin bundles this
 * file, and OpenClaw's install-time scanner blocks plugins that mix those
 * with network calls.
 */

export const HOST_NAME = 'com.byoky.bridge';

// Chrome Web Store build — the only Chrome extension allowed by default.
export const PUBLISHED_EXTENSION_ID = 'igjohldpldlahcjmefdhlnbcpldlgmon';
// Derived from the `key` pinned in packages/extension/wxt.config.ts (WXT dev
// and unpacked builds from this repo). The key is public, so any unpacked
// extension can claim this ID; it is only allowed with `install --dev`.
export const UNPACKED_EXTENSION_ID = 'idlmdfkobnkdakcpiihighchdbbmbpep';
export const FIREFOX_EXTENSION_ID = 'byoky@byoky.com';

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
