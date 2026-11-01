/**
 * No file under packages/ may contain a literal bidi embedding, override or
 * isolate control (U+202A-U+202E, U+2066-U+2069). In code they make text
 * display in another order than the compiler reads it (Trojan Source,
 * CVE-2021-42574), and GitHub flags every file that has one. Write them as
 * \u escapes. This guards every package, not only the bridge.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BIDI_CONTROL = /[\u202a-\u202e\u2066-\u2069]/;

/** Tracked and new (not ignored) files under packages/, or null outside a git checkout. */
function sourceFiles(): string[] | null {
  try {
    return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'packages'], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }).split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

function bidiLines(text: string): number[] {
  return text.split('\n').flatMap((line, i) => (BIDI_CONTROL.test(line) ? [i + 1] : []));
}

describe('bidi controls', () => {
  it('the check matches each of them and nothing next to them', () => {
    const controls = [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
    for (const cp of controls) expect(bidiLines(`a${String.fromCodePoint(cp)}b`)).toEqual([1]);
    expect(bidiLines('\u2029\u202f\u2065\u206a ok … — ✓')).toEqual([]);
  });

  const files = sourceFiles();

  it.skipIf(!files)('no file under packages/ contains one literally', () => {
    const found: string[] = [];
    for (const file of files ?? []) {
      let bytes: Buffer;
      try {
        bytes = readFileSync(join(REPO, file));
      } catch {
        continue; // deleted in the work tree, or a directory link
      }
      if (bytes.subarray(0, 8000).includes(0)) continue; // binary
      for (const line of bidiLines(bytes.toString('utf8'))) found.push(`${file}:${line}`);
    }
    expect(files!.length).toBeGreaterThan(100);
    expect(found).toEqual([]);
  });
});
