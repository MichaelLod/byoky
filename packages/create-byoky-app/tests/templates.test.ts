import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const read = (file: string) => readFileSync(join(templatesDir, file), 'utf-8');

const PROVIDER_HOSTS: Record<string, string> = {
  anthropic: 'api.anthropic.com',
  openai: 'api.openai.com',
  gemini: 'generativelanguage.googleapis.com',
};

describe('backend-relay template', () => {
  it('requests every provider the server has a request branch for', () => {
    const server = read('backend-relay/server/index.ts.tpl');
    const client = read('backend-relay/client/main.ts.tpl');

    const served = Object.keys(PROVIDER_HOSTS).filter((id) => server.includes(PROVIDER_HOSTS[id]));
    const connectCall = client.slice(client.indexOf('byoky.connect('));
    const requested = [...connectCall.slice(0, connectCall.indexOf('});')).matchAll(/id: '([a-z]+)'/g)].map(
      (m) => m[1],
    );

    expect(served).toEqual(['anthropic', 'openai', 'gemini']);
    expect(requested).toEqual(served);
  });
});
