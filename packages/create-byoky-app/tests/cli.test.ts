import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Runs the CLI as a child process, laid out like the published package
// (dist/index.js next to templates/ and package.json). The source is
// transpiled here so the test needs no build step and runs on every Node
// the package supports (engines: >=22), not only those that strip types.

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgVersion: string = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')).version;
let root: string;
let cli: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'create-byoky-app-test-'));
  const { outputText } = ts.transpileModule(readFileSync(join(pkgDir, 'src', 'index.ts'), 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  mkdirSync(join(root, 'dist'));
  cli = join(root, 'dist', 'index.js');
  writeFileSync(cli, outputText);
  copyFileSync(join(pkgDir, 'package.json'), join(root, 'package.json'));
  cpSync(join(pkgDir, 'templates'), join(root, 'templates'), { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args: string[], input = '') {
  const cwd = mkdtempSync(join(root, 'cwd-'));
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    input,
    encoding: 'utf-8',
    timeout: 15_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, cwd, created: readdirSync(cwd) };
}

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf-8'));

describe('create-byoky-app CLI', () => {
  it('creates the project from piped answers', () => {
    const r = run([], 'piped-app\n2\n');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.created).toEqual(['piped-app']);
    const app = join(r.cwd, 'piped-app');
    expect(readJson(join(app, 'package.json')).name).toBe('piped-app');
    expect(existsSync(join(app, 'src', 'main.ts'))).toBe(true);
  });

  it('accepts a template id as the piped answer', () => {
    const r = run(['id-app'], 'backend-relay\n');
    expect(r.status).toBe(0);
    expect(existsSync(join(r.cwd, 'id-app', 'server', 'index.ts'))).toBe(true);
  });

  it('fails when input ends before the template is chosen', () => {
    const r = run([], 'half-app\n');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Input ended before a template choice was given');
    expect(r.created).toEqual([]);
  });

  it('fails when stdin is closed with no answers', () => {
    const r = run([], '');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Input ended before a project name was given');
    expect(r.created).toEqual([]);
  });

  it.each(['--help', '-h'])('%s prints usage and creates nothing', (flag) => {
    const r = run([flag], '2\n');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Usage: create-byoky-app [project-name] [options]');
    expect(r.stdout).toContain('--template');
    expect(r.created).toEqual([]);
  });

  it.each(['--version', '-v'])('%s prints the version and creates nothing', (flag) => {
    const r = run([flag], '2\n');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(pkgVersion);
    expect(r.created).toEqual([]);
  });

  it.each([['-x'], ['my-app', '--force']])('rejects the unknown option in %j', (...args) => {
    const r = run(args, 'my-app\n2\n');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Unknown option "(-x|--force)"/);
    expect(r.stderr).toContain('Usage:');
    expect(r.created).toEqual([]);
  });

  it.each([
    ['chat', 'src/app/page.tsx'],
    ['multi-provider', 'src/main.ts'],
    ['backend-relay', 'server/index.ts'],
  ])('creates %s from flags alone, with a .gitignore', (template, file) => {
    const r = run(['flag-app', '--template', template]);
    expect(r.status).toBe(0);
    const app = join(r.cwd, 'flag-app');
    expect(existsSync(join(app, file))).toBe(true);
    expect(readFileSync(join(app, '.gitignore'), 'utf-8')).toMatch(/^node_modules\/$/m);
    expect(existsSync(join(app, 'gitignore'))).toBe(false);
  });

  it.each([['-t', 'chat'], ['--template=chat']])('reads the template from %j', (...flags) => {
    const r = run(['short-app', ...flags]);
    expect(r.status).toBe(0);
    expect(existsSync(join(r.cwd, 'short-app', 'next.config.ts'))).toBe(true);
  });

  it('asks only for the name when --template is given', () => {
    const r = run(['--template', 'multi-provider'], 'named-app\n');
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('Choose a template');
    expect(existsSync(join(r.cwd, 'named-app', 'vite.config.ts'))).toBe(true);
  });

  it.each([
    [['my-app', '--template', 'nope'], 'Unknown template "nope"'],
    [['my-app', '--template'], '--template needs a template name'],
    [['my-app', 'other-app'], 'Unexpected argument "other-app"'],
  ])('rejects %j', (args, message) => {
    const r = run(args, '2\n');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(message);
    expect(r.created).toEqual([]);
  });

  it.each(['MyApp', '.hidden', '_private', 'a/b', 'x'.repeat(215)])('rejects the project name %s', (name) => {
    const r = run([name, '--template', 'chat']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Project name must be lowercase');
    expect(r.created).toEqual([]);
  });

  it('accepts npm-style names with dots and underscores', () => {
    const r = run(['my.app_2', '--template', 'chat']);
    expect(r.status).toBe(0);
    expect(readJson(join(r.cwd, 'my.app_2', 'package.json')).name).toBe('my.app_2');
  });
});
