/**
 * Native messaging framing: each message is a 4-byte little-endian length
 * followed by that many bytes of UTF-8 JSON.
 */

/** What could be read of a message too large to take. */
export interface OversizedMessage {
  /** Its size in bytes. */
  bytes: number;
  /** Its `type` and `requestId`, if they were among its first bytes. */
  type?: string;
  requestId?: string;
}

// The extension's messages start {"type":…,"requestId":…: enough to answer one.
const OVERSIZED_HEAD_BYTES = 512;

function readHead(head: Buffer, bytes: number): OversizedMessage {
  const text = head.toString('utf8');
  const field = (name: string) => text.match(new RegExp(`"${name}":"([^"\\\\]{1,200})"`))?.[1];
  return { bytes, type: field('type'), requestId: field('requestId') };
}

/**
 * Returns a stdin 'data' handler that hands each complete message to
 * `onMessage` as soon as it arrives. Chunks are only joined once a whole
 * frame is buffered, so a large message isn't re-copied on every read.
 * Frames over `maxBytes` are skipped without being buffered (`onOversized`
 * hears of each, so the sender can be answered) and unparseable ones are
 * ignored; neither stops the stream.
 */
export function createMessageReader(
  onMessage: (msg: unknown) => void,
  maxBytes: number,
  onOversized: (msg: OversizedMessage) => void = () => {},
): (chunk: Buffer) => void {
  let chunks: Buffer[] = [];
  let buffered = 0;
  let frameLength = -1; // body length of the current frame; -1 = waiting for its header
  let discard = 0; // bytes still to skip of an oversized frame
  // The start of the oversized frame being skipped, until it is reported.
  let head: { parts: Buffer[]; length: number; bytes: number } | null = null;

  function keepHead(part: Buffer) {
    if (!head) return;
    const want = Math.min(part.length, OVERSIZED_HEAD_BYTES - head.length);
    if (want > 0) {
      head.parts.push(Buffer.from(part.subarray(0, want)));
      head.length += want;
    }
    if (head.length >= OVERSIZED_HEAD_BYTES || discard === 0) {
      const { parts, bytes } = head;
      head = null;
      onOversized(readHead(Buffer.concat(parts), bytes));
    }
  }

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
      keepHead(chunk.subarray(0, skipped));
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
          head = { parts: [], length: 0, bytes: frameLength };
          discard = frameLength - skipped;
          keepHead(take(skipped));
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
