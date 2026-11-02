import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
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

  it('pass connect() options that type-check, and `required` may be left out', () => {
    // Every `.connect({ ... })` options literal in the docs, checked against
    // the real ConnectRequest type the way a strict TypeScript app would.
    const literals: string[] = [];
    for (const file of SNIPPET_FILES) {
      const text = read(file);
      const re = /\.connect\(\{/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const start = m.index + m[0].length - 1;
        let depth = 0;
        let i = start;
        do {
          if (text[i] === '{') depth++;
          else if (text[i] === '}') depth--;
          i++;
        } while (depth > 0 && i < text.length);
        const literal = text.slice(start, i);
        if (!literal.includes('...')) literals.push(literal); // skip `providers: [...]` placeholders
      }
    }
    expect(literals.length).toBeGreaterThan(10);

    const source = [
      `import type { ConnectRequest } from '${resolve(ROOT, 'packages/core/src/types')}';`,
      `type Options = ConnectRequest & { modal?: boolean | { container?: HTMLElement; theme?: Record<string, string> } };`,
      // An app that doesn't mark anything required.
      `export const minimal: Options = { providers: [{ id: 'anthropic' }] };`,
      ...literals.map((l, i) => `export const s${i}: Options = ${l};`),
    ].join('\n');
    const fileName = resolve(__dirname, '__docs_snippets__.ts');
    const options: ts.CompilerOptions = {
      strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [],
    };
    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, version, ...rest) =>
      name === fileName ? ts.createSourceFile(name, source, version) : getSourceFile(name, version, ...rest);
    const fileExists = host.fileExists.bind(host);
    host.fileExists = (name) => name === fileName || fileExists(name);
    const program = ts.createProgram([fileName], options, host);
    const errors = ts.getPreEmitDiagnostics(program, program.getSourceFile(fileName))
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(errors).toEqual([]);
  }, 30_000);

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

  it('catch relay rejections inside the async connection listener', () => {
    // handleConnection() and relay fetches reject when the browser never says
    // hello or closes the tab mid-request. EventEmitter drops the promise an
    // async listener returns, so without a try the rejection ends Node.
    const unguarded: string[] = [];
    let listeners = 0;
    for (const file of SNIPPET_FILES) {
      const text = read(file);
      const re = /\.on\('connection',\s*async\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const call = text.indexOf('handleConnection(', m.index);
        if (call === -1) continue;
        listeners++;
        if (!/\btry\s*\{/.test(text.slice(m.index, call))) {
          unguarded.push(`${file}:${text.slice(0, m.index).split('\n').length}`);
        }
      }
    }
    expect(listeners).toBeGreaterThanOrEqual(4);
    expect(unguarded).toEqual([]);
  });

  it('turn files into base64 without spreading the bytes into fromCharCode', () => {
    // fromCharCode(...bytes) passes one argument per byte and overflows the
    // stack from about 125 KB, so any real photo throws a RangeError.
    const hits: string[] = [];
    for (const file of [...SNIPPET_FILES, 'packages/web/app/page.tsx']) {
      const text = read(file);
      const re = /fromCharCode\(\s*\.\.\./g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) hits.push(`${file}:${text.slice(0, m.index).split('\n').length}`);
    }
    expect(hits).toEqual([]);
  });
});
