#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATES = [
  {
    id: 'chat',
    name: 'AI Chat (Next.js)',
    description: 'Multi-provider chat with streaming',
  },
  {
    id: 'multi-provider',
    name: 'Multi-Provider (Vite)',
    description: 'Use multiple AI providers with fallback',
  },
  {
    id: 'backend-relay',
    name: 'Backend Relay (Express)',
    description: 'Server-side LLM calls through user\'s wallet',
  },
] as const;

type TemplateId = (typeof TEMPLATES)[number]['id'];

function printBanner(): void {
  console.log();
  console.log('  \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log('  \u2551   create-byoky-app           \u2551');
  console.log('  \u2551   Build AI apps in minutes   \u2551');
  console.log('  \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d');
  console.log();
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

function isValidProjectName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name) && name.length > 0;
}

function getTemplatesDir(): string {
  // In development (src/index.ts), templates are at ../../templates
  // In production (dist/index.js), templates are at ../templates
  const fromDist = path.resolve(__dirname, '..', 'templates');
  if (fs.existsSync(fromDist)) return fromDist;
  const fromSrc = path.resolve(__dirname, '..', '..', 'templates');
  if (fs.existsSync(fromSrc)) return fromSrc;
  throw new Error('Could not find templates directory');
}

function copyTemplateDir(srcDir: string, destDir: string, projectName: string): void {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destName = entry.name.endsWith('.tpl')
      ? entry.name.slice(0, -4)
      : entry.name;
    const destPath = path.join(destDir, destName);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyTemplateDir(srcPath, destPath, projectName);
    } else {
      let content = fs.readFileSync(srcPath, 'utf-8');
      content = content.replaceAll('{{PROJECT_NAME}}', projectName);
      fs.writeFileSync(destPath, content, 'utf-8');
    }
  }
}

const MARKETPLACE_URL = 'https://api.byoky.com/v1';

interface AppManifest {
  name: string;
  slug: string;
  url: string;
  icon?: string;
  description: string;
  category: string;
  providers: string[];
  author: {
    name: string;
    email: string;
    website?: string;
  };
}

async function initManifest(rl: readline.Interface): Promise<void> {
  const manifestPath = path.resolve(process.cwd(), 'byoky.app.json');

  if (fs.existsSync(manifestPath)) {
    console.log('  byoky.app.json already exists.\n');
    return;
  }

  console.log('  Create a byoky.app.json manifest for marketplace submission.\n');

  const name = await ask(rl, '  App name: ');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const url = await ask(rl, '  App URL (https://...): ');
  const description = await ask(rl, '  Description: ');
  const category = await ask(rl, '  Category (chat/coding/trading/productivity/research/creative/other): ') || 'other';
  const providersRaw = await ask(rl, '  Providers (comma-separated, e.g. anthropic,openai): ');
  const providers = providersRaw.split(',').map((p) => p.trim()).filter(Boolean);
  const icon = await ask(rl, '  Icon URL (https://..., optional): ');
  const authorName = await ask(rl, '  Author name: ');
  const authorEmail = await ask(rl, '  Author email: ');
  const authorWebsite = await ask(rl, '  Author website (optional): ');

  const manifest: AppManifest = {
    name,
    slug,
    url,
    ...(icon ? { icon } : {}),
    description,
    category,
    providers,
    author: {
      name: authorName,
      email: authorEmail,
      ...(authorWebsite ? { website: authorWebsite } : {}),
    },
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log(`\n  \u2713 Created byoky.app.json\n`);
}

async function submitApp(): Promise<void> {
  const manifestPath = path.resolve(process.cwd(), 'byoky.app.json');

  if (!fs.existsSync(manifestPath)) {
    console.error('\n  Error: byoky.app.json not found. Run `create-byoky-app init` first.\n');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as AppManifest;

  console.log(`\n  Submitting "${manifest.name}" to Byoky Marketplace...\n`);

  try {
    const res = await fetch(`${MARKETPLACE_URL}/apps/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
    }

    console.log('  \u2713 Submitted for review! You will be notified when approved.\n');
  } catch (err) {
    console.error(`\n  Error: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

// Preflight mirrors the validation in packages/web/app/api/apps/submit/route.ts.
// Keep these in lockstep \u2014 anything the server rejects, preflight should catch
// locally so devs don't burn a round-trip and an email rejection.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
const VALID_CATEGORIES = ['chat', 'coding', 'trading', 'productivity', 'research', 'creative', 'other'];
const VALID_PROVIDERS = [
  'anthropic', 'openai', 'gemini', 'mistral', 'cohere', 'xai', 'deepseek',
  'perplexity', 'groq', 'together', 'fireworks', 'openrouter', 'azure_openai',
  'ollama', 'lm_studio',
];
const MAX_NAME = 100;
const MAX_DESC = 1000;
const MAX_URL = 2048;
const MAX_AUTHOR_NAME = 100;
const MAX_AUTHOR_EMAIL = 320;

interface CheckResult {
  ok: boolean;
  label: string;
  detail?: string;
}

function pass(label: string, detail?: string): CheckResult {
  return { ok: true, label, detail };
}

function fail(label: string, detail: string): CheckResult {
  return { ok: false, label, detail };
}

function isValidHttpsUrl(s: string): boolean {
  try {
    return new URL(s).protocol === 'https:';
  } catch {
    return false;
  }
}

function isPrivateOrReservedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (h === '::1' || h === '[::1]') return true;
  if (h.startsWith('[fe80:') || h.startsWith('fe80:') || h.startsWith('[fc') || h.startsWith('fc') || h.startsWith('[fd') || h.startsWith('fd')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const a = parseInt(v4[1], 10);
    const b = parseInt(v4[2], 10);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
  }
  return false;
}

function validateManifestShape(m: Partial<AppManifest>): CheckResult[] {
  const checks: CheckResult[] = [];

  if (!m.name || typeof m.name !== 'string') {
    checks.push(fail('name', 'missing'));
  } else if (m.name.length > MAX_NAME) {
    checks.push(fail('name', `must be \u2264 ${MAX_NAME} characters (got ${m.name.length})`));
  } else {
    checks.push(pass('name', m.name));
  }

  if (!m.slug || typeof m.slug !== 'string') {
    checks.push(fail('slug', 'missing'));
  } else if (!SLUG_RE.test(m.slug)) {
    checks.push(fail('slug', 'must be lowercase a-z0-9- (2\u201363 chars), no leading/trailing hyphen'));
  } else {
    checks.push(pass('slug', m.slug));
  }

  if (!m.url || typeof m.url !== 'string') {
    checks.push(fail('url', 'missing'));
  } else if (m.url.length > MAX_URL) {
    checks.push(fail('url', `must be \u2264 ${MAX_URL} characters`));
  } else if (!isValidHttpsUrl(m.url)) {
    checks.push(fail('url', 'must be a valid HTTPS URL'));
  } else {
    checks.push(pass('url', m.url));
  }

  if (m.icon !== undefined) {
    if (typeof m.icon !== 'string' || (m.icon && !isValidHttpsUrl(m.icon))) {
      checks.push(fail('icon', 'must be a valid HTTPS URL when present'));
    } else if (m.icon) {
      checks.push(pass('icon', m.icon));
    }
  }

  if (!m.description || typeof m.description !== 'string') {
    checks.push(fail('description', 'missing'));
  } else if (m.description.length > MAX_DESC) {
    checks.push(fail('description', `must be \u2264 ${MAX_DESC} characters (got ${m.description.length})`));
  } else {
    checks.push(pass('description'));
  }

  if (!m.category || typeof m.category !== 'string') {
    checks.push(fail('category', 'missing'));
  } else if (!VALID_CATEGORIES.includes(m.category)) {
    checks.push(fail('category', `must be one of: ${VALID_CATEGORIES.join(', ')}`));
  } else {
    checks.push(pass('category', m.category));
  }

  if (!Array.isArray(m.providers) || m.providers.length === 0) {
    checks.push(fail('providers', 'must include at least one provider ID'));
  } else {
    const unknown = m.providers.filter((p) => !VALID_PROVIDERS.includes(p));
    if (unknown.length > 0) {
      checks.push(fail('providers', `unknown ID(s): ${unknown.join(', ')}. Known: ${VALID_PROVIDERS.join(', ')}`));
    } else {
      checks.push(pass('providers', m.providers.join(', ')));
    }
  }

  const author = m.author;
  if (!author || typeof author !== 'object') {
    checks.push(fail('author', 'missing'));
  } else {
    if (!author.name || typeof author.name !== 'string') {
      checks.push(fail('author.name', 'missing'));
    } else if (author.name.length > MAX_AUTHOR_NAME) {
      checks.push(fail('author.name', `must be \u2264 ${MAX_AUTHOR_NAME} characters`));
    } else {
      checks.push(pass('author.name', author.name));
    }
    if (!author.email || typeof author.email !== 'string') {
      checks.push(fail('author.email', 'missing'));
    } else if (author.email.length > MAX_AUTHOR_EMAIL) {
      checks.push(fail('author.email', `must be \u2264 ${MAX_AUTHOR_EMAIL} characters`));
    } else {
      checks.push(pass('author.email'));
    }
    if (author.website !== undefined) {
      if (typeof author.website !== 'string' || (author.website && !isValidHttpsUrl(author.website))) {
        checks.push(fail('author.website', 'must be a valid HTTPS URL when present'));
      } else if (author.website) {
        checks.push(pass('author.website', author.website));
      }
    }
  }

  return checks;
}

async function checkIframeEmbeddable(url: string): Promise<CheckResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail('iframe embedding', 'invalid URL');
  }
  if (isPrivateOrReservedHost(parsed.hostname)) {
    return fail('iframe embedding', 'URL must resolve to a public host (no localhost / private ranges)');
  }

  let res: Response;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    let current = parsed.toString();
    let hops = 0;
    for (;;) {
      res = await fetch(current, { method: 'GET', redirect: 'manual', signal: controller.signal });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc || hops >= 5) {
          clearTimeout(t);
          return fail('iframe embedding', 'too many redirects, or redirect missing Location');
        }
        const next = new URL(loc, current);
        if (next.protocol !== 'https:' || isPrivateOrReservedHost(next.hostname)) {
          clearTimeout(t);
          return fail('iframe embedding', 'redirects to a non-public or non-HTTPS host');
        }
        current = next.toString();
        hops++;
        continue;
      }
      break;
    }
    clearTimeout(t);
  } catch {
    return fail('iframe embedding', 'could not reach the URL \u2014 make sure it is publicly accessible');
  }

  const xfo = res.headers.get('x-frame-options')?.toLowerCase().trim();
  if (xfo === 'deny' || xfo === 'sameorigin') {
    return fail('iframe embedding', `X-Frame-Options: ${xfo} blocks iframe embedding (remove the header or set Content-Security-Policy: frame-ancestors *)`);
  }
  const csp = res.headers.get('content-security-policy');
  if (csp) {
    const fa = /frame-ancestors\s+([^;]+)/i.exec(csp)?.[1]?.trim().toLowerCase();
    if (fa) {
      const sources = fa.split(/\s+/);
      if (sources.includes("'none'")) {
        return fail('iframe embedding', "CSP frame-ancestors 'none' blocks embedding");
      }
      const allowsAny = sources.some((s) => s === '*' || s === 'https:' || s.includes('byoky.com') || s.startsWith('chrome-extension:') || s.startsWith('moz-extension:'));
      if (!allowsAny) {
        return fail('iframe embedding', `CSP frame-ancestors (${fa}) does not allow the Byoky extension \u2014 add * or https: or byoky.com`);
      }
    }
  }
  return pass('iframe embedding', `host responded with embed-friendly headers (HTTP ${res.status})`);
}

async function preflight(): Promise<void> {
  const manifestPath = path.resolve(process.cwd(), 'byoky.app.json');

  if (!fs.existsSync(manifestPath)) {
    console.error('\n  Error: byoky.app.json not found in current directory.');
    console.error('  Run `create-byoky-app init` to generate one.\n');
    process.exit(1);
  }

  let manifest: Partial<AppManifest>;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Partial<AppManifest>;
  } catch (err) {
    console.error(`\n  Error: byoky.app.json is not valid JSON: ${(err as Error).message}\n`);
    process.exit(1);
  }

  console.log('\n  Running preflight checks...\n');

  const checks = validateManifestShape(manifest);

  if (typeof manifest.url === 'string' && isValidHttpsUrl(manifest.url)) {
    console.log('    \u2026 fetching app URL to verify iframe embedding\n');
    checks.push(await checkIframeEmbeddable(manifest.url));
  }

  let failed = 0;
  for (const c of checks) {
    const mark = c.ok ? '\u2713' : '\u2717';
    const main = `    ${mark} ${c.label}`;
    const tail = c.detail ? `  \u2014  ${c.detail}` : '';
    console.log(c.ok ? `${main}${tail}` : `${main}${tail}`);
    if (!c.ok) failed++;
  }

  console.log();
  if (failed === 0) {
    console.log('  \u2713 All checks passed. Run `npx create-byoky-app submit` to ship it.\n');
    return;
  }
  console.error(`  \u2717 ${failed} check${failed === 1 ? '' : 's'} failed. Fix the issues above before submitting.\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const command = process.argv[2];

  // Handle subcommands
  if (command === 'init' || command === 'submit' || command === 'preflight') {
    printBanner();
    if (command === 'preflight') {
      await preflight();
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (command === 'init') await initManifest(rl);
      else await submitApp();
    } finally {
      rl.close();
    }
    return;
  }

  printBanner();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    let projectName = command;

    if (!projectName) {
      projectName = await ask(rl, '  Project name: ');
    }

    if (!projectName) {
      console.error('\n  Error: Project name is required.\n');
      process.exit(1);
    }

    if (!isValidProjectName(projectName)) {
      console.error('\n  Error: Project name can only contain letters, numbers, hyphens, and underscores.\n');
      process.exit(1);
    }

    const targetDir = path.resolve(process.cwd(), projectName);

    if (fs.existsSync(targetDir)) {
      console.error(`\n  Error: Directory "${projectName}" already exists.\n`);
      process.exit(1);
    }

    console.log('\n  Choose a template:\n');
    for (let i = 0; i < TEMPLATES.length; i++) {
      const t = TEMPLATES[i];
      console.log(`    ${i + 1}. ${t.name}`);
      console.log(`       ${t.description}\n`);
    }

    const choice = await ask(rl, '  Template (1-3): ');
    const choiceNum = parseInt(choice, 10);

    if (isNaN(choiceNum) || choiceNum < 1 || choiceNum > TEMPLATES.length) {
      console.error('\n  Error: Invalid template choice.\n');
      process.exit(1);
    }

    const template = TEMPLATES[choiceNum - 1];
    const templateId: TemplateId = template.id;

    console.log(`\n  Creating ${projectName} with ${template.name}...\n`);

    const templatesDir = getTemplatesDir();
    const templateDir = path.join(templatesDir, templateId);

    if (!fs.existsSync(templateDir)) {
      console.error(`\n  Error: Template "${templateId}" not found.\n`);
      process.exit(1);
    }

    fs.mkdirSync(targetDir, { recursive: true });

    try {
      copyTemplateDir(templateDir, targetDir, projectName);
    } catch (err) {
      // Clean up on failure
      fs.rmSync(targetDir, { recursive: true, force: true });
      throw err;
    }

    // Generate a starter byoky.app.json manifest. Icon is optional and
    // omitted here — developers fill in an HTTPS URL before submitting.
    const manifest: AppManifest = {
      name: projectName,
      slug: projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      url: `https://${projectName}.example.com`,
      description: `${projectName} — a Byoky-powered app`,
      category: 'other',
      providers: ['anthropic', 'openai'],
      author: { name: '', email: '' },
    };
    fs.writeFileSync(
      path.join(targetDir, 'byoky.app.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      'utf-8',
    );

    console.log(`  \u2713 Created ${projectName}!`);
    console.log();
    console.log('  Next steps:');
    console.log(`    cd ${projectName}`);
    console.log('    npm install');
    console.log('    npm run dev');
    console.log();
    console.log('  When ready to publish:');
    console.log(`    npx create-byoky-app init       # fill in your manifest`);
    console.log(`    npx create-byoky-app preflight  # validate locally`);
    console.log(`    npx create-byoky-app submit     # submit to marketplace`);
    console.log();
    console.log('  Docs: https://byoky.com/docs');
    console.log();
  } catch (err) {
    if (err instanceof Error) {
      console.error(`\n  Error: ${err.message}\n`);
    } else {
      console.error('\n  An unexpected error occurred.\n');
    }
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
