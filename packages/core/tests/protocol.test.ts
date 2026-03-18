import { describe, it, expect } from 'vitest';
import {
  createMessage,
  createConnectRequest,
  createConnectResponse,
  createErrorMessage,
  isByokyMessage,
  BYOKY_PROVIDER_KEY,
} from '../src/protocol.js';

describe('createMessage', () => {
  it('creates a message with correct type and payload', () => {
    const msg = createMessage('BYOKY_CONNECT_REQUEST', { test: true });

    expect(msg.type).toBe('BYOKY_CONNECT_REQUEST');
    expect(msg.payload).toEqual({ test: true });
    expect(msg.id).toBeDefined();
    expect(typeof msg.id).toBe('string');
    expect(msg.id.length).toBeGreaterThan(0);
  });

  it('generates unique ids', () => {
    const a = createMessage('BYOKY_ERROR', null);
    const b = createMessage('BYOKY_ERROR', null);
    expect(a.id).not.toBe(b.id);
  });

  it('includes requestId when provided', () => {
    const msg = createMessage('BYOKY_CONNECT_RESPONSE', {}, 'req-123');
    expect(msg.requestId).toBe('req-123');
  });

  it('omits requestId when not provided', () => {
    const msg = createMessage('BYOKY_ERROR', {});
    expect(msg.requestId).toBeUndefined();
  });
});

describe('createConnectRequest', () => {
  it('creates a connect request message', () => {
    const msg = createConnectRequest({
      providers: [{ id: 'anthropic', required: true }],
    });

    expect(msg.type).toBe('BYOKY_CONNECT_REQUEST');
    expect(msg.payload).toEqual({
      providers: [{ id: 'anthropic', required: true }],
    });
  });

  it('handles empty request', () => {
    const msg = createConnectRequest({});
    expect(msg.type).toBe('BYOKY_CONNECT_REQUEST');
    expect(msg.payload).toEqual({});
  });
});

describe('createConnectResponse', () => {
  it('creates a connect response with requestId', () => {
    const msg = createConnectResponse(
      {
        sessionKey: 'byk_test',
        proxyUrl: 'extension-proxy',
        providers: {
          anthropic: { available: true, authMethod: 'api_key' },
        },
      },
      'req-456',
    );

    expect(msg.type).toBe('BYOKY_CONNECT_RESPONSE');
    expect(msg.requestId).toBe('req-456');
    expect((msg.payload as { sessionKey: string }).sessionKey).toBe('byk_test');
  });
});

describe('createErrorMessage', () => {
  it('creates an error message', () => {
    const msg = createErrorMessage('USER_REJECTED', 'Denied', 'req-789');

    expect(msg.type).toBe('BYOKY_ERROR');
    expect(msg.requestId).toBe('req-789');
    expect(msg.payload).toEqual({
      code: 'USER_REJECTED',
      message: 'Denied',
    });
  });
});

describe('isByokyMessage', () => {
  it('returns true for valid messages', () => {
    const msg = createMessage('BYOKY_CONNECT_REQUEST', {});
    expect(isByokyMessage(msg)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isByokyMessage(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isByokyMessage(undefined)).toBe(false);
  });

  it('returns false for strings', () => {
    expect(isByokyMessage('hello')).toBe(false);
  });

  it('returns false for non-byoky objects', () => {
    expect(isByokyMessage({ type: 'OTHER_MESSAGE' })).toBe(false);
  });

  it('returns false for objects without type', () => {
    expect(isByokyMessage({ id: '123', payload: {} })).toBe(false);
  });

  it('returns true for any BYOKY_ prefixed type', () => {
    expect(
      isByokyMessage({ type: 'BYOKY_PROXY_REQUEST', id: '1', payload: {} }),
    ).toBe(true);
  });
});

describe('BYOKY_PROVIDER_KEY', () => {
  it('is defined as __byoky__', () => {
    expect(BYOKY_PROVIDER_KEY).toBe('__byoky__');
  });
});
