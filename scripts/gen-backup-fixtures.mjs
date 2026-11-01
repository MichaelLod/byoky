#!/usr/bin/env node
// Writes the `.byoky` backup fixtures the mobile tests import, with the real
// @byoky/core encrypt() (Node WebCrypto: PBKDF2-SHA256 600k, AES-256-GCM)
// in the payload shape of packages/extension/lib/vault-file.ts, so the iOS
// and Android importers are tested against what the extension writes:
//
//   packages/ios/ByokyTests/BackupFixture.swift
//   packages/android/app/src/test/resources/backup/extension-v2.byoky
//
// Usage (after `pnpm --filter @byoky/core build`):
//   node scripts/gen-backup-fixtures.mjs           rewrite both fixtures
//   node scripts/gen-backup-fixtures.mjs --check   verify the committed ones
//
// Encryption is randomized (salt, IV), so a rewrite changes every byte even
// when nothing else did; rewrite only when the payloads below change, e.g.
// after a format change in vault-file.ts. --check decrypts the committed
// files and compares them with the payloads here (CI runs it).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = join(ROOT, 'packages', 'core', 'dist', 'index.js');
const IOS_FIXTURE = join(ROOT, 'packages', 'ios', 'ByokyTests', 'BackupFixture.swift');
const ANDROID_FIXTURE = join(ROOT, 'packages', 'android', 'app', 'src', 'test', 'resources', 'backup', 'extension-v2.byoky');

// Secrets are written in the clear here and encrypted on the way out, as
// vault-file.ts exportVaultFile does: `secrets` maps each encrypted* field
// to its plaintext ('' stays '' for keyless local providers).
//
// iOS: the extension's export shape, plus an unknown provider, a refresh
// token and the legacy `gifts` / `giftedCredentials` arrays that 1.0 wrote.
const IOS = {
  password: 'Fixture-Export-Pass-2026!',
  core: { password: 'core-pass', plaintext: 'hello from @byoky/core' },
  payload: {
    version: 2,
    exportedAt: 1760000000100,
    credentials: [
      { id: 'c-anthropic', providerId: 'anthropic', label: 'Anthropic work', authMethod: 'api_key', createdAt: 1760000000000, lastUsedAt: 1760000000005, secrets: { encryptedKey: 'sk-ant-api03-FIXTURE-ánthropic-ключ' } },
      { id: 'c-openai', providerId: 'openai', label: 'OpenAI', authMethod: 'api_key', createdAt: 1760000000001, secrets: { encryptedKey: 'sk-proj-FIXTURE-openai' } },
      { id: 'c-azure', providerId: 'azure_openai', label: 'Azure (Contoso)', authMethod: 'api_key', createdAt: 1760000000002, baseUrl: 'https://contoso.openai.azure.com', secrets: { encryptedKey: 'azure-FIXTURE-key' } },
      { id: 'c-ollama', providerId: 'ollama', label: 'Ollama', authMethod: 'api_key', createdAt: 1760000000003, baseUrl: 'http://localhost:11434', secrets: { encryptedKey: '' } },
      { id: 'c-oauth', providerId: 'anthropic', label: 'Claude Max', authMethod: 'oauth', createdAt: 1760000000004, expiresAt: 4102444800000, secrets: { encryptedAccessToken: 'sk-ant-oat01-FIXTURE-setup-token', encryptedRefreshToken: 'rt-FIXTURE' } },
      { id: 'c-unknown', providerId: 'replicate', label: 'Old provider', authMethod: 'api_key', createdAt: 1760000000006, secrets: { encryptedKey: 'r8-FIXTURE' } },
    ],
    gifts: [{ id: 'g1' }],
    giftedCredentials: [],
  },
};

// Android: a non-ASCII password (pins the UTF-8 PBKDF2 input), a UTF-8
// label, LAN local servers, a refreshable OAuth login and a retired provider.
const ANDROID = {
  password: 'Fixture-Pässwort-2026!',
  payload: {
    version: 2,
    exportedAt: 1761000100000,
    credentials: [
      { id: 'c1', providerId: 'anthropic', label: 'Anthropic main', authMethod: 'api_key', createdAt: 1761000000001, lastUsedAt: 1761000009999, secrets: { encryptedKey: 'sk-ant-api03-FIXTURE-anthropic-key-0001' } },
      { id: 'c2', providerId: 'openai', label: 'OpenAI · Ünïcode ✓', authMethod: 'api_key', createdAt: 1761000000002, secrets: { encryptedKey: 'sk-proj-FIXTURE-openai-key-0002' } },
      { id: 'c3', providerId: 'lm_studio', label: 'LM Studio desk', authMethod: 'api_key', createdAt: 1761000000003, baseUrl: 'http://192.168.1.20:1234', secrets: { encryptedKey: 'lm-FIXTURE-key-0003' } },
      { id: 'c4', providerId: 'ollama', label: 'Ollama keyless', authMethod: 'api_key', createdAt: 1761000000004, baseUrl: 'http://10.0.0.5:11434', secrets: { encryptedKey: '' } },
      { id: 'c5', providerId: 'anthropic', label: 'Claude setup token', authMethod: 'oauth', createdAt: 1761000000005, secrets: { encryptedAccessToken: 'sk-ant-oat01-FIXTURE-setup-token-0005' } },
      { id: 'c6', providerId: 'gemini', label: 'Gemini OAuth login', authMethod: 'oauth', createdAt: 1761000000006, expiresAt: 1761003600000, secrets: { encryptedAccessToken: 'ya29.FIXTURE-access-0006', encryptedRefreshToken: '1//FIXTURE-refresh-0006' } },
      { id: 'c7', providerId: 'replicate', label: 'Retired provider', authMethod: 'api_key', createdAt: 1761000000007, secrets: { encryptedKey: 'r8_FIXTURE-0007' } },
    ],
    gifts: [{ id: 'g1', providerId: 'anthropic', authToken: 'legacy' }],
    giftedCredentials: [{ id: 'gc1', giftId: 'g9', providerId: 'openai', authToken: 'legacy' }],
  },
};

if (!existsSync(CORE)) {
  console.error('packages/core/dist/index.js is missing. Run: pnpm --filter @byoky/core build');
  process.exit(2);
}
const { encrypt, decrypt } = await import(pathToFileURL(CORE).href);

async function encryptPayload({ payload, password }) {
  const credentials = [];
  for (const { secrets, ...meta } of payload.credentials) {
    const cred = { ...meta };
    for (const [field, plain] of Object.entries(secrets)) {
      cred[field] = plain === '' ? '' : await encrypt(plain, password);
    }
    credentials.push(cred);
  }
  return encrypt(JSON.stringify({ ...payload, credentials }), password);
}

/** The payload as written here, from a committed file. */
async function decryptPayload(file, password) {
  const payload = JSON.parse(await decrypt(file.trim(), password));
  const credentials = [];
  for (const cred of payload.credentials) {
    const meta = {};
    const secrets = {};
    for (const [key, value] of Object.entries(cred)) {
      if (key.startsWith('encrypted')) secrets[key] = value === '' ? '' : await decrypt(value, password);
      else meta[key] = value;
    }
    credentials.push({ ...meta, secrets });
  }
  return { ...payload, credentials };
}

function swiftString(value) {
  return JSON.stringify(value); // base64 and the ASCII passwords need no Swift-specific escaping
}

function iosSwift(fileContents, coreCiphertext) {
  return [
    '// Generated by scripts/gen-backup-fixtures.mjs from packages/core/dist (real',
    '// @byoky/core encrypt, Node WebCrypto), mirroring packages/extension/lib/vault-file.ts',
    '// exportVaultFile. Do not edit by hand; change the script and regenerate instead.',
    'enum BackupFixture {',
    `    static let password = ${swiftString(IOS.password)}`,
    `    static let fileContents = ${swiftString(fileContents)}`,
    '',
    `    static let coreCiphertext = ${swiftString(coreCiphertext)}`,
    `    static let corePassword = ${swiftString(IOS.core.password)}`,
    `    static let corePlaintext = ${swiftString(IOS.core.plaintext)}`,
    '}',
    '',
  ].join('\n');
}

function swiftConstant(source, name) {
  const match = new RegExp(`static let ${name} = "([^"]*)"`).exec(source);
  if (!match) throw new Error(`BackupFixture.swift has no ${name}`);
  return match[1];
}

if (process.argv.includes('--check')) {
  const problems = [];
  const swift = readFileSync(IOS_FIXTURE, 'utf8');
  if (swiftConstant(swift, 'password') !== IOS.password) problems.push('iOS password differs');
  if (!isDeepStrictEqual(await decryptPayload(swiftConstant(swift, 'fileContents'), IOS.password), IOS.payload)) {
    problems.push('iOS fileContents does not decrypt to the payload in this script');
  }
  if (await decrypt(swiftConstant(swift, 'coreCiphertext'), IOS.core.password) !== IOS.core.plaintext) {
    problems.push('iOS coreCiphertext does not decrypt to corePlaintext');
  }
  if (!isDeepStrictEqual(await decryptPayload(readFileSync(ANDROID_FIXTURE, 'utf8'), ANDROID.password), ANDROID.payload)) {
    problems.push('Android extension-v2.byoky does not decrypt to the payload in this script');
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`::error::${p}. Regenerate: node scripts/gen-backup-fixtures.mjs`);
    process.exit(1);
  }
  console.log('Backup fixtures match scripts/gen-backup-fixtures.mjs');
} else {
  writeFileSync(IOS_FIXTURE, iosSwift(await encryptPayload(IOS), await encrypt(IOS.core.plaintext, IOS.core.password)));
  writeFileSync(ANDROID_FIXTURE, await encryptPayload(ANDROID));
  console.log(`Wrote ${IOS_FIXTURE}\nWrote ${ANDROID_FIXTURE}`);
}
