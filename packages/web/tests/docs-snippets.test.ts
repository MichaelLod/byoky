import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// The code developers copy from the READMEs, /docs, /demo and the landing
// page. These checks keep the snippets runnable.
const ROOT = resolve(__dirname, '../../..');
const SNIPPET_FILES = [
  'README.md',
  'packages/sdk/README.md',
  'packages/web/app/docs/page.tsx',
  'packages/web/app/demo/components/CodeExample.tsx',
];

function read(file: string): string {
  return readFileSync(resolve(ROOT, file), 'utf8');
}

/** Each `new Anthropic({ ... })` / `new OpenAI({ ... })` options literal, with its offset. */
function clientConstructions(text: string): { index: number; options: string }[] {
  const found: { index: number; options: string }[] = [];
  const re = /new (?:Anthropic|OpenAI)\(\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    }
    found.push({ index: m.index, options: text.slice(start, i - 1) });
  }
  return found;
}

describe('docs snippets', () => {
  it('pass dangerouslyAllowBrowser wherever a provider SDK runs in the page', () => {
    const missing: string[] = [];
    for (const file of SNIPPET_FILES) {
      const text = read(file);
      for (const { index, options } of clientConstructions(text)) {
        if (!options.includes('createFetch')) continue;
        // connectMock() examples run in Node, where the SDKs have no browser guard.
        if (text.slice(Math.max(0, index - 400), index).includes('connectMock(')) continue;
        if (!options.includes('dangerouslyAllowBrowser: true')) {
          missing.push(`${file}:${text.slice(0, index).split('\n').length}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('pass dangerouslyAllowBrowser in the landing page snippet', () => {
    const page = read('packages/web/app/page.tsx');
    const block = page.slice(page.indexOf('function CodeBlock()'), page.indexOf('function Security()'));
    expect(block).toContain('createFetch');
    expect(block).toContain('dangerouslyAllowBrowser');
  });

  it('use no retired Claude model IDs', () => {
    // Retired on 2026-06-15; requests to them fail with not_found_error.
    const retired = ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'];
    const hits: string[] = [];
    for (const file of SNIPPET_FILES) {
      const text = read(file);
      for (const id of retired) if (text.includes(id)) hits.push(`${file}: ${id}`);
    }
    expect(hits).toEqual([]);
  });
});
