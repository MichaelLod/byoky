import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { getProvider, getProviderIds } from '../../core/src/providers';
import { getListModelsEndpoint, getStaticModelsList } from '../../core/src/list-models';

const LOCAL = ['ollama', 'lm_studio'];

describe('provider claims on byoky.com', () => {
  it('the homepage marquee lists exactly the providers a wallet can add', () => {
    const source = readFileSync(resolve(__dirname, '../app/components/ProviderMarquee.tsx'), 'utf8');
    const ids = [...source.matchAll(/\{ id: '([a-z_]+)'/g)].map((m) => m[1]);
    expect([...ids].sort()).toEqual([...getProviderIds()].sort());
  });

  it('the /docs model discovery table names the endpoint each provider really calls', () => {
    const docs = readFileSync(resolve(__dirname, '../app/docs/page.tsx'), 'utf8');
    const section = docs.slice(docs.indexOf('function ListModels()'), docs.indexOf('function Errors()'));
    const rows = [...section.matchAll(/<tr><td>(.*?)<\/td><td>(.*?)<\/td>/g)];
    const documented = new Map<string, string>();
    for (const [, ids, endpoint] of rows) {
      const path = /<code>(.*?)<\/code>/.exec(endpoint)?.[1] ?? 'none';
      for (const [, id] of ids.matchAll(/<code>([a-z_]+)<\/code>/g)) documented.set(id, path);
    }
    for (const id of getProviderIds()) {
      const endpoint = getListModelsEndpoint(id);
      if (!endpoint) {
        expect(getStaticModelsList(id).length, `${id} has neither endpoint nor static list`).toBeGreaterThan(0);
        expect(documented.get(id) ?? 'none', id).toBe('none');
        continue;
      }
      const basePath = new URL(getProvider(id)!.baseUrl).pathname.replace(/\/$/, '');
      const real = basePath + endpoint.path;
      const doc = documented.get(id);
      expect(doc, `${id} missing from the table`).toBeDefined();
      // `?api-version=...` is abbreviated in the docs.
      expect(real.startsWith(doc!.replace(/\.\.\.$/, '')), `${id}: docs ${doc}, real ${real}`).toBe(true);
    }
  });

  it('"13 cloud providers plus Ollama and LM Studio" matches the registry', () => {
    const ids = getProviderIds();
    for (const id of LOCAL) expect(ids).toContain(id);
    expect(ids.filter((id) => !LOCAL.includes(id))).toHaveLength(13);
  });
});
