/**
 * Live test env loader.
 *
 * Reads `.env.local` at repo root and populates `process.env` with any
 * KEY=VALUE entries it finds, without overwriting variables that are
 * already set in the shell.
 *
 * This file runs once before any live test executes, so live tests can
 * read API keys via `process.env.OPENAI_API_KEY` etc. The file is
 * intentionally dependency-free — no dotenv import — so live tests don't
 * pull a new package into the dev dependencies just for this.
 *
 * `.env.local` is gitignored.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  const path = resolve(process.cwd(), '.env.local');
  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    // Strip a single matching pair of surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
} catch {
  // .env.local missing is fine — tests will simply skip via skipIf().
}
