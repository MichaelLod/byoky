import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { getProviderIds } from '../../core/src/providers';

const LOCAL = ['ollama', 'lm_studio'];

describe('provider claims on byoky.com', () => {
  it('the homepage marquee lists exactly the providers a wallet can add', () => {
    const source = readFileSync(resolve(__dirname, '../app/components/ProviderMarquee.tsx'), 'utf8');
    const ids = [...source.matchAll(/\{ id: '([a-z_]+)'/g)].map((m) => m[1]);
    expect([...ids].sort()).toEqual([...getProviderIds()].sort());
  });

  it('"13 cloud providers plus Ollama and LM Studio" matches the registry', () => {
    const ids = getProviderIds();
    for (const id of LOCAL) expect(ids).toContain(id);
    expect(ids.filter((id) => !LOCAL.includes(id))).toHaveLength(13);
  });
});
