import { describe, it, expect } from 'vitest';
import { redactText, redactedPromptPreview } from '../src/redact.js';

describe('redactText', () => {
  it('redacts emails', () => {
    expect(redactText('contact jane.doe@acme.com now')).toBe('contact [REDACTED_EMAIL] now');
  });
  it('redacts provider keys and bearer tokens', () => {
    expect(redactText('key sk-ant-abcdefghij1234567890')).toContain('[REDACTED_KEY]');
    expect(redactText('byk_live_abcdefghij1234567890')).toContain('[REDACTED_KEY]');
    expect(redactText('Authorization: Bearer abcdefghijklmnop123456')).toContain('Bearer [REDACTED]');
  });
  it('redacts AWS keys, JWTs, SSNs, cards, phones', () => {
    expect(redactText('AKIAIOSFODNN7EXAMPLE')).toContain('[REDACTED_AWS_KEY]');
    expect(redactText('ssn 123-45-6789')).toContain('[REDACTED_SSN]');
    expect(redactText('card 4111 1111 1111 1111')).toContain('[REDACTED_CARD]');
    expect(redactText('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36')).toContain('[REDACTED_JWT]');
  });
  it('truncates to maxLen', () => {
    const r = redactText('x'.repeat(500), 50)!;
    expect(r.length).toBe(51); // 50 + ellipsis
    expect(r.endsWith('…')).toBe(true);
  });
  it('returns undefined for empty', () => {
    expect(redactText('')).toBeUndefined();
    expect(redactText(undefined)).toBeUndefined();
  });
});

describe('redactedPromptPreview', () => {
  it('takes the last user message, redacted', () => {
    const body = { messages: [{ role: 'system', content: 'be nice' }, { role: 'user', content: 'email me at bob@x.io' }] };
    expect(redactedPromptPreview(body)).toBe('email me at [REDACTED_EMAIL]');
  });
  it('handles array content parts', () => {
    const body = { messages: [{ role: 'user', content: [{ type: 'text', text: 'my key sk-live-abcdefghij1234567890' }] }] };
    expect(redactedPromptPreview(body)).toContain('[REDACTED_KEY]');
  });
  it('never returns raw sensitive content', () => {
    const body = { messages: [{ role: 'user', content: 'ssn 123-45-6789 card 4111111111111111' }] };
    const p = redactedPromptPreview(body)!;
    expect(p).not.toMatch(/123-45-6789/);
    expect(p).not.toMatch(/4111111111111111/);
  });
});
