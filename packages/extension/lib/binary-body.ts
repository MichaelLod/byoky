/**
 * Proxied bodies cross message ports and native messaging as JSON strings.
 * Text goes as it is; anything else (audio from a TTS endpoint, images) as
 * base64 with `chunkEncoding: 'base64'`, since decoding it as UTF-8 would
 * replace every invalid byte with U+FFFD.
 */

// Which content types count as text is core's isTextContentType, shared
// with the SDK, the bridge and the mobile wallets.

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Native messages to the bridge stay under 1 MiB: 768 KiB of bytes is 1 MiB of base64. */
export const MAX_BINARY_CHUNK_BYTES = 768 * 1024;
