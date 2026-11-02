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

const TEMPLATES = ['chat', 'multi-provider', 'backend-relay'];

interface TemplatePackage {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const readPackage = (template: string): TemplatePackage =>
  JSON.parse(read(`${template}/package.json.tpl`).replaceAll('{{PROJECT_NAME}}', 'app').replaceAll('{{SDK_VERSION}}', '1.0.0'));

const major = (range: string) => Number(/\d+/.exec(range)?.[0]);

describe('template dependencies', () => {
  // Next checks for these before it typechecks. Outside CI it installs a
  // missing one and rewrites the app's package.json; with CI set (GitHub
  // Actions, Vercel) the build fails instead. @types/node used to arrive
  // through @anthropic-ai/sdk 0.x, which 1.x no longer depends on.
  it('chat lists every package Next needs to typecheck', () => {
    const dev = readPackage('chat').devDependencies ?? {};
    for (const name of ['typescript', '@types/react', '@types/react-dom', '@types/node']) {
      expect(dev, name).toHaveProperty([name]);
    }
  });

  it.each(TEMPLATES)('%s pins type definitions to the major of the package they describe', (template) => {
    const pkg = readPackage(template);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, range] of Object.entries(pkg.devDependencies ?? {})) {
      const described = name.startsWith('@types/') ? name.slice('@types/'.length) : undefined;
      if (!described || !deps[described]) continue;
      expect(major(range), `${name} ${range} for ${described} ${deps[described]}`).toBe(major(deps[described]));
    }
  });
});

describe('template error output', () => {
  // Sample code people copy: anything put into innerHTML goes through
  // escapeHtml, error messages included.
  it.each(['multi-provider/src/main.ts.tpl', 'backend-relay/client/main.ts.tpl'])(
    '%s escapes every error message it renders as HTML',
    (file) => {
      const source = read(file);
      const messages = [...source.matchAll(/\berr\.message\b/g)];
      expect(messages.length).toBeGreaterThan(0);
      for (const m of messages) {
        const before = source.slice(Math.max(0, m.index - 'escapeHtml('.length), m.index);
        expect(before, source.slice(Math.max(0, m.index - 60), m.index + 20)).toBe('escapeHtml(');
      }
    },
  );
});
