import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getModel } from '../../core/src/models.js';

// The scaffolder copies templates verbatim, so a retired model id here breaks
// every new app on its first request. The core registry is the list of model
// ids the project keeps current.

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

interface ModelUse {
  template: string;
  file: string;
  model: string;
  /** Request-body source from the model id to the end of its object literal, without line comments. */
  body: string;
}

// `model: '<id>'` in a request body, or the model segment of a Gemini URL.
const MODEL_PATTERNS = [
  /\bmodel:\s*'([^']+)'/g,
  /\/models\/([^/:'"`]+):(?:generateContent|streamGenerateContent)/g,
];

function findModelUses(): ModelUse[] {
  const uses: ModelUse[] = [];
  for (const file of listFiles(templatesDir)) {
    const source = readFileSync(file, 'utf-8');
    const rel = relative(templatesDir, file);
    for (const pattern of MODEL_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const start = match.index ?? 0;
        const end = source.indexOf('})', start);
        uses.push({
          template: rel.split(sep)[0],
          file: rel,
          model: match[1],
          body: source
            .slice(start, end === -1 ? undefined : end)
            .replace(/^\s*\/\/.*$/gm, ''),
        });
      }
    }
  }
  return uses;
}

const uses = findModelUses();

describe('template model ids', () => {
  it('finds the model ids in every template', () => {
    const templates = readdirSync(templatesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) {
      expect(uses.some((u) => u.template === template), template).toBe(true);
    }
  });

  it('sends only models that are in the core model registry', () => {
    const unknown = uses
      .filter((u) => !getModel(u.model))
      .map((u) => `${u.file}: ${u.model}`);
    expect(unknown).toEqual([]);
  });

  it('sends only models a new account can call', () => {
    // A deprecated model stops working at its shutdown date, and Google
    // serves the Gemini 2.5 models only to projects that used them before
    // (ai.google.dev/gemini-api/docs/models, checked 2026-11-01).
    const closed = uses
      .filter((u) => getModel(u.model)?.deprecated || /^gemini-2\.5-/.test(u.model))
      .map((u) => `${u.file}: ${u.model}`);
    expect(closed).toEqual([]);
  });

  it('caps OpenAI reasoning models with max_completion_tokens, not max_tokens', () => {
    const openai = uses.filter((u) => {
      const m = getModel(u.model);
      return m?.family === 'openai' && m.capabilities.reasoning;
    });
    expect(openai.length).toBeGreaterThan(0);
    for (const use of openai) {
      expect(use.body, use.file).not.toMatch(/\bmax_tokens\b/);
      expect(use.body, use.file).toMatch(/\bmax_completion_tokens\b/);
    }
  });

  it('leaves Gemini thinking models room to answer', () => {
    // Thinking tokens count against maxOutputTokens; a small cap can use it
    // all up before the model writes any reply text.
    const gemini = uses.filter((u) => {
      const m = getModel(u.model);
      return m?.family === 'gemini' && m.capabilities.reasoning;
    });
    expect(gemini.length).toBeGreaterThan(0);
    for (const use of gemini) {
      const cap = use.body.match(/\bmaxOutputTokens:\s*(\d+)/);
      if (cap) expect(Number(cap[1]), use.file).toBeGreaterThanOrEqual(1024);
    }
  });
});
