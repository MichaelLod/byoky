/**
 * Native messaging framing: each message is a 4-byte little-endian length
 * followed by that many bytes of UTF-8 JSON.
 */

/**
 * Returns a stdin 'data' handler that hands each complete message to
 * `onMessage` as soon as it arrives. Chunks are only joined once a whole
 * frame is buffered, so a large message isn't re-copied on every read.
 * Frames over `maxBytes` are skipped without being buffered and unparseable
 * ones are ignored; neither stops the stream.
 */
export function createMessageReader(
  onMessage: (msg: unknown) => void,
  maxBytes: number,
): (chunk: Buffer) => void {
  let chunks: Buffer[] = [];
  let buffered = 0;
  let frameLength = -1; // body length of the current frame; -1 = waiting for its header
  let discard = 0; // bytes still to skip of an oversized frame

  function take(length: number): Buffer {
    const all = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, buffered);
    chunks = length < all.length ? [all.subarray(length)] : [];
    buffered -= length;
    return all.subarray(0, length);
  }

  return (chunk: Buffer) => {
    if (discard > 0) {
      const skipped = Math.min(discard, chunk.length);
      discard -= skipped;
      chunk = chunk.subarray(skipped);
      if (chunk.length === 0) return;
    }
    chunks.push(chunk);
    buffered += chunk.length;

    for (;;) {
      if (frameLength < 0) {
        if (buffered < 4) return;
        frameLength = take(4).readUInt32LE(0);
        if (frameLength > maxBytes) {
          process.stderr.write(`byoky-bridge: dropped a ${frameLength}-byte message (max ${maxBytes})\n`);
          const skipped = Math.min(frameLength, buffered);
          take(skipped);
          discard = frameLength - skipped;
          frameLength = -1;
          if (discard > 0) return;
          continue;
        }
      }
      if (buffered < frameLength) return;
      const body = take(frameLength);
      frameLength = -1;
      let msg: unknown;
      try {
        msg = JSON.parse(body.toString('utf-8'));
      } catch (e) {
        process.stderr.write(`byoky-bridge: ignored invalid message: ${(e as Error).message}\n`);
        continue;
      }
      onMessage(msg);
    }
  };
}
