/**
 * Proxied bodies cross message ports and native messaging as JSON strings.
 * Text goes as it is; anything else (audio from a TTS endpoint, images) as
 * base64 with `chunkEncoding: 'base64'`, since decoding it as UTF-8 would
 * replace every invalid byte with U+FFFD.
 */

/**
 * Whether a response with this content type is text. The SDK decides the
 * same way for request bodies (sdk/src/proxy-fetch.ts); no content type
 * counts as text, as before. Moves into @byoky/core with F023.
 */
export function isTextContentType(contentType: string | undefined): boolean {
  if (!contentType) return true;
  const lower = contentType.toLowerCase();
  return lower.startsWith('text/')
    || lower.includes('json')
    || lower.includes('xml')
    || lower.includes('urlencoded')
    || lower.includes('javascript');
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Native messages to the bridge stay under 1 MiB: 768 KiB of bytes is 1 MiB of base64. */
export const MAX_BINARY_CHUNK_BYTES = 768 * 1024;
