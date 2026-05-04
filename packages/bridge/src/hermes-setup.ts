import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

export interface HermesSetupOptions {
  port?: number;
  model?: string;
  configPath?: string;
}

export interface HermesSetupResult {
  configPath: string;
  backupPath: string | null;
  changes: string[];
  alreadyConfigured: boolean;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export function runHermesSetup(opts: HermesSetupOptions = {}): HermesSetupResult {
  const port = opts.port ?? 19280;
  const baseUrl = `http://127.0.0.1:${port}/anthropic`;
  const configPath = opts.configPath ?? join(homedir(), '.hermes', 'config.yaml');
  const targetModel = opts.model ?? DEFAULT_MODEL;

  if (!existsSync(configPath)) {
    throw new Error(
      `Hermes config not found at ${configPath}.\n` +
      `Install Hermes first:\n` +
      `  curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-setup\n` +
      `Then run \`hermes\` once to seed the config.`
    );
  }

  const original = readFileSync(configPath, 'utf8');
  const changes: string[] = [];
  let updated = original;

  updated = patchModelBlock(updated, targetModel, changes);
  updated = patchCustomProviders(updated, baseUrl, changes);

  if (changes.length === 0) {
    return { configPath, backupPath: null, changes: [], alreadyConfigured: true };
  }

  const backupPath = `${configPath}.bak`;
  copyFileSync(configPath, backupPath);
  writeFileSync(configPath, updated, 'utf8');

  return { configPath, backupPath, changes, alreadyConfigured: false };
}

function patchModelBlock(yaml: string, targetModel: string, changes: string[]): string {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => /^model:\s*$/.test(l));
  if (start < 0) {
    throw new Error('Could not find a `model:` block at the top of config.yaml');
  }
  let end = start + 1;
  while (end < lines.length && (lines[end].startsWith(' ') || lines[end].startsWith('\t') || lines[end].trim() === '')) {
    end++;
  }

  let foundProvider = false;
  let foundDefault = false;
  for (let i = start + 1; i < end; i++) {
    const provM = lines[i].match(/^(\s+)provider:\s*(\S+)(.*)$/);
    if (provM) {
      foundProvider = true;
      if (provM[2] !== 'byoky-anthropic') {
        lines[i] = `${provM[1]}provider: byoky-anthropic${provM[3]}`;
        changes.push(`model.provider: ${provM[2]} → byoky-anthropic`);
      }
      continue;
    }
    const defM = lines[i].match(/^(\s+)default:\s*(\S+)(.*)$/);
    if (defM) {
      foundDefault = true;
      const cur = defM[2];
      if (!cur.startsWith('claude-')) {
        lines[i] = `${defM[1]}default: ${targetModel}${defM[3]}`;
        changes.push(`model.default: ${cur} → ${targetModel}`);
      }
    }
  }

  if (!foundProvider) {
    lines.splice(start + 1, 0, '  provider: byoky-anthropic');
    changes.push('model.provider: (added) byoky-anthropic');
  }
  if (!foundDefault) {
    lines.splice(start + 1, 0, `  default: ${targetModel}`);
    changes.push(`model.default: (added) ${targetModel}`);
  }
  return lines.join('\n');
}

function patchCustomProviders(yaml: string, baseUrl: string, changes: string[]): string {
  const lines = yaml.split('\n');
  const cpStart = lines.findIndex((l) => /^custom_providers:\s*$/.test(l));

  const targetEntry = [
    '- name: byoky-anthropic',
    `  base_url: ${baseUrl}`,
    "  api_key: ''",
    '  api_mode: anthropic_messages',
  ];

  if (cpStart < 0) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push('', 'custom_providers:', ...targetEntry, '');
    changes.push('added custom_providers section with byoky-anthropic entry');
    return lines.join('\n');
  }

  let cpEnd = cpStart + 1;
  while (cpEnd < lines.length) {
    const l = lines[cpEnd];
    if (l.startsWith('- ') || l.startsWith('  ') || l.startsWith('\t') || l.trim() === '') {
      cpEnd++;
    } else {
      break;
    }
  }

  let entryStart = -1;
  for (let i = cpStart + 1; i < cpEnd; i++) {
    if (/^-\s+name:\s*byoky-anthropic\s*$/.test(lines[i])) {
      entryStart = i;
      break;
    }
  }

  if (entryStart < 0) {
    while (cpEnd > cpStart + 1 && lines[cpEnd - 1].trim() === '') cpEnd--;
    lines.splice(cpEnd, 0, ...targetEntry);
    changes.push('added byoky-anthropic to custom_providers');
    return lines.join('\n');
  }

  let entryEnd = entryStart + 1;
  while (entryEnd < lines.length) {
    const l = lines[entryEnd];
    if (l.startsWith('  ') || l.startsWith('\t')) {
      entryEnd++;
    } else {
      break;
    }
  }

  const fields = new Set<string>();
  for (let i = entryStart + 1; i < entryEnd; i++) {
    const m = lines[i].match(/^\s+(base_url|api_key|api_mode):\s*(.*)$/);
    if (!m) continue;
    fields.add(m[1]);
    if (m[1] === 'base_url' && m[2].trim() !== baseUrl) {
      lines[i] = `  base_url: ${baseUrl}`;
      changes.push(`byoky-anthropic.base_url → ${baseUrl}`);
    } else if (m[1] === 'api_mode' && m[2].trim() !== 'anthropic_messages') {
      lines[i] = '  api_mode: anthropic_messages';
      changes.push(`byoky-anthropic.api_mode: ${m[2].trim()} → anthropic_messages`);
    }
  }

  const additions: string[] = [];
  if (!fields.has('base_url')) additions.push(`  base_url: ${baseUrl}`);
  if (!fields.has('api_key')) additions.push("  api_key: ''");
  if (!fields.has('api_mode')) additions.push('  api_mode: anthropic_messages');
  if (additions.length > 0) {
    lines.splice(entryEnd, 0, ...additions);
    changes.push(`byoky-anthropic: added ${additions.length} field(s)`);
  }

  return lines.join('\n');
}
