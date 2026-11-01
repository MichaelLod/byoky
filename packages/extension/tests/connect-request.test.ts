import { describe, it, expect } from 'vitest';
import { MAX_REQUESTED_PROVIDERS, isProviderIdList, parseProviderRequirements } from '../lib/connect-request';

describe('connect request validation', () => {
  it('normalizes a well-formed provider list', () => {
    expect(parseProviderRequirements(undefined)).toEqual([]);
    expect(parseProviderRequirements(null)).toEqual([]);
    expect(parseProviderRequirements([])).toEqual([]);
    expect(parseProviderRequirements([{ id: 'anthropic', required: true }, { id: 'openai' }, { id: 'lm_studio', required: false }]))
      .toEqual([{ id: 'anthropic', required: true }, { id: 'openai', required: false }, { id: 'lm_studio', required: false }]);
    // Duplicates merge, required if any copy is.
    expect(parseProviderRequirements([{ id: 'openai' }, { id: 'openai', required: true }])).toEqual([{ id: 'openai', required: true }]);
    // Extra fields are dropped.
    expect(parseProviderRequirements([{ id: 'openai', name: '<b>x</b>' }])).toEqual([{ id: 'openai', required: false }]);
  });

  it('refuses anything the popup or the trust state could choke on', () => {
    const bad: unknown[] = [
      'abc', 42, {}, { length: 1, 0: { id: 'openai' } },
      [null], ['openai'], [[]], [{}], [{ id: {} }], [{ id: 123 }], [{ id: '' }], [{ id: 'Open AI' }],
      [{ id: '-x' }], [{ id: 'a'.repeat(65) }], [{ id: 'openai', required: 'yes' }],
      Array.from({ length: MAX_REQUESTED_PROVIDERS + 1 }, (_, i) => ({ id: `p${i}` })),
    ];
    for (const raw of bad) expect(parseProviderRequirements(raw), JSON.stringify(raw)).toBeNull();
  });

  it('checks a trusted site\'s provider list', () => {
    expect(isProviderIdList(['anthropic', 'openai'])).toBe(true);
    expect(isProviderIdList([])).toBe(true);
    expect(isProviderIdList([123])).toBe(false);
    expect(isProviderIdList(['ok', {}])).toBe(false);
    expect(isProviderIdList('anthropic')).toBe(false);
  });
});
