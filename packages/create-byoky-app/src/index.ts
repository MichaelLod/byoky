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

async function main(): Promise<void> {
  printBanner();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    let projectName = process.argv[2];

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

    console.log(`  \u2713 Created ${projectName}!`);
    console.log();
    console.log('  Next steps:');
    console.log(`    cd ${projectName}`);
    console.log('    npm install');
    console.log('    npm run dev');
    console.log();
    console.log('  Docs: https://byoky.com/dev');
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
