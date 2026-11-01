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
    description: 'Streaming chat (Anthropic SDK)',
  },
  {
    id: 'multi-provider',
    name: 'Multi-Provider (Vite)',
    description: 'Anthropic, OpenAI and Gemini side by side',
  },
  {
    id: 'backend-relay',
    name: 'Backend Relay (Express)',
    description: 'Server-side LLM calls through user\'s wallet',
  },
] as const;

type Template = (typeof TEMPLATES)[number];

const USAGE = `
  Usage: create-byoky-app [project-name] [options]

  Options:
    -t, --template <name>  ${TEMPLATES.map((t) => t.id).join(', ')}
    -h, --help             Show this help
    -v, --version          Show the version

  Example:
    npx create-byoky-app my-app --template chat
`;

function printBanner(): void {
  console.log();
  console.log('  \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log('  \u2551   create-byoky-app           \u2551');
  console.log('  \u2551   Build AI apps in minutes   \u2551');
  console.log('  \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d');
  console.log();
}

function fail(message: string): never {
  console.error(`\n  Error: ${message}\n`);
  process.exit(1);
}

interface CliOptions {
  projectName?: string;
  template?: string;
}

type CliArgs = { kind: 'help' } | { kind: 'version' } | ({ kind: 'run' } & CliOptions);

function parseArgs(argv: readonly string[]): CliArgs {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') return { kind: 'help' };
    if (arg === '-v' || arg === '--version') return { kind: 'version' };
    if (arg === '-t' || arg === '--template' || arg.startsWith('--template=')) {
      const value = arg.startsWith('--template=') ? arg.slice('--template='.length) : argv[++i];
      if (!value || value.startsWith('-')) fail(`--template needs a template name.\n${USAGE}`);
      options.template = value;
    } else if (arg.startsWith('-')) {
      fail(`Unknown option "${arg}".\n${USAGE}`);
    } else if (options.projectName === undefined) {
      options.projectName = arg;
    } else {
      fail(`Unexpected argument "${arg}": give one project name.\n${USAGE}`);
    }
  }
  return { kind: 'run', ...options };
}

/** Looks a template up by id or by its number in the menu. */
function findTemplate(choice: string): Template | undefined {
  if (/^\d+$/.test(choice)) return TEMPLATES[Number(choice) - 1];
  return TEMPLATES.find((t) => t.id === choice);
}

interface Prompter {
  /** Resolves to the trimmed answer, or null once input has ended. */
  ask(question: string): Promise<string | null>;
  close(): void;
}

// readline's question() only sees a line that arrives while that question is
// open. With piped answers every later line was dropped, and when stdin ended
// node exited 0 without creating anything. This queues lines as they arrive
// and reports the end of input, so the caller can fail instead. stdin is only
// opened on the first question.
function createPrompter(): Prompter {
  const lines: string[] = [];
  let waiting: ((line: string | null) => void) | undefined;
  let ended = false;
  let rl: readline.Interface | undefined;

  const open = (): readline.Interface => {
    const iface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    });
    iface.on('line', (line) => {
      const deliver = waiting;
      waiting = undefined;
      if (deliver) deliver(line);
      else lines.push(line);
    });
    iface.on('close', () => {
      ended = true;
      const deliver = waiting;
      waiting = undefined;
      deliver?.(null);
    });
    rl = iface;
    return iface;
  };

  return {
    ask(question) {
      const iface = rl ?? open();
      if (ended) {
        process.stdout.write(question);
      } else {
        iface.setPrompt(question);
        iface.prompt();
      }
      return new Promise((resolve) => {
        const answer = (line: string | null): void => {
          // Typed answers are echoed by the terminal; piped ones are not.
          if (line !== null && !process.stdin.isTTY) process.stdout.write(`${line}\n`);
          resolve(line === null ? null : line.trim());
        };
        const queued = lines.shift();
        if (queued !== undefined) answer(queued);
        else if (ended) answer(null);
        else waiting = answer;
      });
    },
    close() {
      rl?.close();
    },
  };
}

// The project name becomes the package name, so it follows npm's main rules:
// lowercase, at most 214 characters, starting with a letter or digit. That
// also keeps it from reading as an option or a path.
function isValidProjectName(name: string): boolean {
  return name.length <= 214 && /^[a-z0-9][a-z0-9._-]*$/.test(name);
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

// @byoky/sdk is released in lockstep with this package, so new projects depend
// on the SDK version matching the scaffolder that created them.
function getSdkVersion(): string {
  const pkgPath = path.resolve(__dirname, '..', 'package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
}

const SDK_VERSION = getSdkVersion();

function copyTemplateDir(srcDir: string, destDir: string, projectName: string): void {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const baseName = entry.name.endsWith('.tpl')
      ? entry.name.slice(0, -4)
      : entry.name;
    // npm does not publish files named .gitignore, so templates ship it as "gitignore".
    const destName = baseName === 'gitignore' ? '.gitignore' : baseName;
    const destPath = path.join(destDir, destName);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyTemplateDir(srcPath, destPath, projectName);
    } else {
      let content = fs.readFileSync(srcPath, 'utf-8');
      content = content.replaceAll('{{PROJECT_NAME}}', projectName);
      content = content.replaceAll('{{SDK_VERSION}}', SDK_VERSION);
      fs.writeFileSync(destPath, content, 'utf-8');
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.kind === 'help') {
    console.log(USAGE);
    return;
  }
  if (args.kind === 'version') {
    console.log(SDK_VERSION);
    return;
  }

  const presetTemplate = args.template === undefined ? undefined : findTemplate(args.template);
  if (args.template !== undefined && !presetTemplate) {
    fail(`Unknown template "${args.template}". Choose one of: ${TEMPLATES.map((t) => t.id).join(', ')}.`);
  }

  printBanner();

  const prompter = createPrompter();
  const ask = async (question: string, what: string): Promise<string> => {
    const answer = await prompter.ask(question);
    if (answer === null) {
      fail(
        `Input ended before ${what} was given.\n` +
          '  To run without prompts: npx create-byoky-app my-app --template chat',
      );
    }
    return answer;
  };

  try {
    const projectName = args.projectName ?? (await ask('  Project name: ', 'a project name'));

    if (!projectName) {
      fail('Project name is required.');
    }

    if (!isValidProjectName(projectName)) {
      fail(
        'Project name must be lowercase letters, numbers, ".", "-" or "_", ' +
          'start with a letter or number, and be at most 214 characters.',
      );
    }

    const targetDir = path.resolve(process.cwd(), projectName);

    if (fs.existsSync(targetDir)) {
      fail(`Directory "${projectName}" already exists.`);
    }

    let template = presetTemplate;
    if (!template) {
      console.log('\n  Choose a template:\n');
      for (let i = 0; i < TEMPLATES.length; i++) {
        const t = TEMPLATES[i];
        console.log(`    ${i + 1}. ${t.name}`);
        console.log(`       ${t.description}\n`);
      }

      template = findTemplate(await ask(`  Template (1-${TEMPLATES.length}): `, 'a template choice'));
      if (!template) {
        fail('Invalid template choice.');
      }
    }
    const templateId = template.id;

    console.log(`\n  Creating ${projectName} with ${template.name}...\n`);

    const templatesDir = getTemplatesDir();
    const templateDir = path.join(templatesDir, templateId);

    if (!fs.existsSync(templateDir)) {
      fail(`Template "${templateId}" not found.`);
    }

    fs.mkdirSync(targetDir, { recursive: true });

    try {
      copyTemplateDir(templateDir, targetDir, projectName);
    } catch (err) {
      // Clean up on failure
      fs.rmSync(targetDir, { recursive: true, force: true });
      throw err;
    }

    console.log(`  \u2713 Created ${projectName}!`);
    console.log();
    console.log('  Next steps:');
    console.log(`    cd ${projectName}`);
    console.log('    npm install');
    console.log('    npm run dev');
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
    prompter.close();
  }
}

main();
