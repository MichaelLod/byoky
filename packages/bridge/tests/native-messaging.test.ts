import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMessageReader, type OversizedMessage } from '../src/native-messaging.js';

function frame(msg: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(msg));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(body.length);
  return Buffer.concat([length, body]);
}

beforeEach(() => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

describe('native messaging reader', () => {
  it('delivers every message when several arrive in one chunk', () => {
    const got: unknown[] = [];
    const read = createMessageReader((m) => got.push(m), 20 * 1024 * 1024);
    read(Buffer.concat(Array.from({ length: 15 }, (_, i) => frame({ type: 'ping', i }))));
    expect(got).toHaveLength(15);
    expect(got[14]).toEqual({ type: 'ping', i: 14 });
  });

  it('reassembles a message split across chunks, header included', () => {
    const got: unknown[] = [];
    const read = createMessageReader((m) => got.push(m), 20 * 1024 * 1024);
    const big = frame({ type: 'proxy', pad: 'x'.repeat(200_000) });
    read(big.subarray(0, 3));
    read(big.subarray(3, 100_000));
    expect(got).toHaveLength(0);
    read(big.subarray(100_000));
    expect(got).toEqual([{ type: 'proxy', pad: 'x'.repeat(200_000) }]);
  });

  it('skips an oversized message and keeps reading', () => {
    const got: unknown[] = [];
    const read = createMessageReader((m) => got.push(m), 1000);
    const oversized = frame({ pad: 'x'.repeat(5000) });
    read(Buffer.concat([oversized.subarray(0, 2000)]));
    read(Buffer.concat([oversized.subarray(2000), frame({ type: 'ping' })]));
    expect(got).toEqual([{ type: 'ping' }]);
  });

  // F038: an oversized request was dropped with a line on stderr only, so
  // the extension waited for its reply until the app gave up.
  it('reports an oversized message\'s type and request id, its start split across reads', () => {
    const got: unknown[] = [];
    const oversized: OversizedMessage[] = [];
    const read = createMessageReader((m) => got.push(m), 1000, (m) => oversized.push(m));
    const big = frame({ type: 'proxy', requestId: 'req-1', url: 'https://api.anthropic.com/v1/messages', body: 'x'.repeat(5000) });
    read(big.subarray(0, 20));
    expect(oversized).toEqual([]);
    read(big.subarray(20, 3000));
    read(Buffer.concat([big.subarray(3000), frame({ type: 'ping' })]));
    expect(oversized).toEqual([{ bytes: big.length - 4, type: 'proxy', requestId: 'req-1' }]);
    expect(got).toEqual([{ type: 'ping' }]);
  });

  it('reports an oversized message that arrived whole', () => {
    const oversized: OversizedMessage[] = [];
    const read = createMessageReader(() => {}, 1000, (m) => oversized.push(m));
    read(frame({ type: 'proxy_direct_fetch', requestId: 'req-2', body: 'x'.repeat(5000) }));
    expect(oversized).toMatchObject([{ type: 'proxy_direct_fetch', requestId: 'req-2' }]);
  });

  it('ignores a message that is not JSON', () => {
    const got: unknown[] = [];
    const read = createMessageReader((m) => got.push(m), 20 * 1024 * 1024);
    const junk = Buffer.from('not json');
    const length = Buffer.alloc(4);
    length.writeUInt32LE(junk.length);
    read(Buffer.concat([length, junk, frame({ type: 'ping' })]));
    expect(got).toEqual([{ type: 'ping' }]);
  });
});
