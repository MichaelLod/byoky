import { describe, it, expect } from 'vitest';
import { parseRelayMessage, WS_READY_STATE, sendRelayMessage } from '../src/relay.js';
import type { WebSocketLike, RelayMessage } from '../src/relay.js';

describe('relay protocol', () => {
  describe('parseRelayMessage', () => {
    it('parses a valid relay:hello JSON string', () => {
      const msg = parseRelayMessage(JSON.stringify({
        type: 'relay:hello',
        sessionId: 'abc',
        providers: { anthropic: { available: true, authMethod: 'api_key' } },
      }));
      expect(msg).not.toBeNull();
      expect(msg!.type).toBe('relay:hello');
    });

    it('parses a valid relay:request object', () => {
      const msg = parseRelayMessage({
        type: 'relay:request',
        requestId: '123',
        providerId: 'openai',
        url: 'https://api.openai.com/v1/chat',
        method: 'POST',
        headers: {},
      });
      expect(msg).not.toBeNull();
      expect(msg!.type).toBe('relay:request');
    });

    it('returns null for non-relay messages', () => {
      expect(parseRelayMessage(JSON.stringify({ type: 'OTHER_MSG' }))).toBeNull();
      expect(parseRelayMessage('not json')).toBeNull();
      expect(parseRelayMessage(null)).toBeNull();
      expect(parseRelayMessage(undefined)).toBeNull();
      expect(parseRelayMessage(42)).toBeNull();
    });

    it('returns null for objects without type field', () => {
      expect(parseRelayMessage(JSON.stringify({ foo: 'bar' }))).toBeNull();
    });

    it('rejects relay:hello missing sessionId', () => {
      expect(parseRelayMessage({ type: 'relay:hello', providers: {} })).toBeNull();
    });

    it('rejects relay:request missing required fields', () => {
      expect(parseRelayMessage({ type: 'relay:request', requestId: '1' })).toBeNull();
      expect(parseRelayMessage({ type: 'relay:request', requestId: '1', providerId: 'x' })).toBeNull();
      expect(parseRelayMessage({ type: 'relay:request', requestId: '1', providerId: 'x', url: 'u' })).toBeNull();
    });

    it('accepts relay:request with all required fields', () => {
      const msg = parseRelayMessage({
        type: 'relay:request', requestId: '1', providerId: 'x', url: 'u', method: 'POST', headers: {},
      });
      expect(msg).not.toBeNull();
      expect(msg!.type).toBe('relay:request');
    });

    it('rejects relay:response:meta missing status', () => {
      expect(parseRelayMessage({ type: 'relay:response:meta', requestId: '1' })).toBeNull();
    });

    it('rejects relay:response:meta with a malformed status, statusText or headers', () => {
      const base = { type: 'relay:response:meta', requestId: '1', status: 200, statusText: 'OK', headers: {} };
      expect(parseRelayMessage(base)).not.toBeNull();
      expect(parseRelayMessage({ ...base, statusText: undefined, headers: undefined })).not.toBeNull();
      expect(parseRelayMessage({ ...base, status: 200.5 })).toBeNull();
      expect(parseRelayMessage({ ...base, status: '200' })).toBeNull();
      expect(parseRelayMessage({ ...base, statusText: 42 })).toBeNull();
      expect(parseRelayMessage({ ...base, headers: { a: 1 } })).toBeNull();
      expect(parseRelayMessage({ ...base, headers: ['a'] })).toBeNull();
      expect(parseRelayMessage({ ...base, headers: 'a: b' })).toBeNull();
    });

    it('rejects relay:response:error without a well-formed error', () => {
      const base = { type: 'relay:response:error', requestId: '1' };
      expect(parseRelayMessage({ ...base, error: { code: 'PROXY_ERROR', message: 'x' } })).not.toBeNull();
      expect(parseRelayMessage(base)).toBeNull();
      expect(parseRelayMessage({ ...base, error: null })).toBeNull();
      expect(parseRelayMessage({ ...base, error: '' })).toBeNull();
      expect(parseRelayMessage({ ...base, error: { code: 'PROXY_ERROR' } })).toBeNull();
    });

    it('rejects relay:response:chunk missing chunk', () => {
      expect(parseRelayMessage({ type: 'relay:response:chunk', requestId: '1' })).toBeNull();
    });

    it('rejects relay:response:done missing requestId', () => {
      expect(parseRelayMessage({ type: 'relay:response:done' })).toBeNull();
    });

    it('rejects relay:ping missing ts', () => {
      expect(parseRelayMessage({ type: 'relay:ping' })).toBeNull();
    });

    it('rejects relay:pong missing ts', () => {
      expect(parseRelayMessage({ type: 'relay:pong' })).toBeNull();
    });

    it('rejects unknown relay subtypes', () => {
      expect(parseRelayMessage({ type: 'relay:unknown', foo: 'bar' })).toBeNull();
    });

    it('accepts a relay:request body encoding and rejects unknown ones', () => {
      const base = { type: 'relay:request', requestId: '1', providerId: 'x', url: 'u', method: 'POST', headers: {} };
      expect(parseRelayMessage({ ...base, body: 'AAEC', bodyEncoding: 'base64' })).not.toBeNull();
      expect(parseRelayMessage({ ...base, body: '[]', bodyEncoding: 'formdata' })).not.toBeNull();
      expect(parseRelayMessage({ ...base, body: 'x', bodyEncoding: 'gzip' })).toBeNull();
      expect(parseRelayMessage({ ...base, body: { not: 'a string' } })).toBeNull();
    });

    it('accepts a base64 relay:response:chunk and rejects unknown encodings', () => {
      expect(parseRelayMessage({ type: 'relay:response:chunk', requestId: '1', chunk: '//8=', chunkEncoding: 'base64' })).not.toBeNull();
      expect(parseRelayMessage({ type: 'relay:response:chunk', requestId: '1', chunk: 'x', chunkEncoding: 'hex' })).toBeNull();
    });

    it('parses relay:cancel and requires its requestId', () => {
      expect(parseRelayMessage({ type: 'relay:cancel', requestId: '1' })?.type).toBe('relay:cancel');
      expect(parseRelayMessage({ type: 'relay:cancel' })).toBeNull();
    });

    it('rejects the retired pairing and vault message types', () => {
      expect(parseRelayMessage({ type: 'relay:pair:hello', providers: {} })).toBeNull();
      expect(parseRelayMessage({ type: 'relay:pair:ack' })).toBeNull();
      expect(parseRelayMessage({
        type: 'relay:vault:offer',
        vaultUrl: 'https://example.com',
        appSessionToken: 'x.y.z',
      })).toBeNull();
    });
  });

  describe('sendRelayMessage', () => {
    it('sends when WebSocket is OPEN', () => {
      const sent: string[] = [];
      const ws: WebSocketLike = {
        readyState: WS_READY_STATE.OPEN,
        send: (data: string) => sent.push(data),
        close() {},
        onopen: null, onmessage: null, onclose: null, onerror: null,
      };

      const msg: RelayMessage = { type: 'relay:ping', ts: 1000 };
      sendRelayMessage(ws, msg);

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual(msg);
    });

    it('does not send when WebSocket is CLOSED', () => {
      const sent: string[] = [];
      const ws: WebSocketLike = {
        readyState: WS_READY_STATE.CLOSED,
        send: (data: string) => sent.push(data),
        close() {},
        onopen: null, onmessage: null, onclose: null, onerror: null,
      };

      sendRelayMessage(ws, { type: 'relay:ping', ts: 1000 });
      expect(sent).toHaveLength(0);
    });
  });

  describe('WS_READY_STATE', () => {
    it('has correct values', () => {
      expect(WS_READY_STATE.CONNECTING).toBe(0);
      expect(WS_READY_STATE.OPEN).toBe(1);
      expect(WS_READY_STATE.CLOSING).toBe(2);
      expect(WS_READY_STATE.CLOSED).toBe(3);
    });
  });
});
