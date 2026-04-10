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

    it('parses a valid relay:vault:offer', () => {
      const msg = parseRelayMessage({
        type: 'relay:vault:offer',
        vaultUrl: 'https://vault.byoky.com',
        appSessionToken: 'eyJhbGciOiJIUzI1NiJ9.test.sig',
      });
      expect(msg).not.toBeNull();
      expect(msg!.type).toBe('relay:vault:offer');
    });

    it('rejects relay:vault:offer missing vaultUrl', () => {
      expect(parseRelayMessage({
        type: 'relay:vault:offer',
        appSessionToken: 'eyJ...',
      })).toBeNull();
    });

    it('rejects relay:vault:offer missing appSessionToken', () => {
      expect(parseRelayMessage({
        type: 'relay:vault:offer',
        vaultUrl: 'https://vault.byoky.com',
      })).toBeNull();
    });

    it('rejects relay:vault:offer with non-string fields', () => {
      expect(parseRelayMessage({
        type: 'relay:vault:offer',
        vaultUrl: 123,
        appSessionToken: 'eyJ...',
      })).toBeNull();
    });

    it('rejects unknown relay subtypes', () => {
      expect(parseRelayMessage({ type: 'relay:unknown', foo: 'bar' })).toBeNull();
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
