#!/usr/bin/env node
// Writes packages/core/tests/vectors/routing.json: core's routing decisions
// (resolveRoute) for a list of wallets, groups and requests, plus the family
// and routing-model tables they depend on. The iOS and Android resolvers are
// hand-written ports of core's; their tests run the same cases:
//
//   packages/core/tests/routing.test.ts               (src, it.each)
//   packages/ios/ByokyTests/RoutingResolverTests.swift (real TranslationEngine)
//   packages/android/.../proxy/RoutingResolverTest.kt  (Families from the tables)
//
// Usage (after `pnpm --filter @byoky/core build`):
//   node scripts/gen-routing-vectors.mjs           rewrite the file
//   node scripts/gen-routing-vectors.mjs --check   verify the committed one (CI)
//
// The expected results come from core, so a change to the routing rules
// shows up as a diff of the file: review it, then fix the mobile ports until
// their tests pass. Add new cases here, not in one platform's tests.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = join(ROOT, 'packages', 'core', 'dist', 'index.js');
const OUT = join(ROOT, 'packages', 'core', 'tests', 'vectors', 'routing.json');

if (!existsSync(CORE)) {
  console.error('packages/core/dist/index.js is missing. Run: pnpm --filter @byoky/core build');
  process.exit(2);
}
const { resolveRoute, familyOf, autoRouteModelFor, PROVIDERS } = await import(pathToFileURL(CORE).href);

// Credentials by id. createdAt is in the past (mobile treats a future one as
// "now") and there is no lastUsedAt: the mobile wallets don't track it, so
// auto-routing orders by family, then newest first, on every platform.
const T = 1760000000000;
const KEYS = {
  a1: { providerId: 'anthropic', createdAt: T + 1 },
  a2: { providerId: 'anthropic', createdAt: T + 2 },
  o1: { providerId: 'openai', createdAt: T + 3 },
  o2: { providerId: 'openai', createdAt: T + 4 },
  g1: { providerId: 'gemini', createdAt: T + 5 },
  c1: { providerId: 'cohere', createdAt: T + 6 },
  r1: { providerId: 'openrouter', createdAt: T + 7 },
  q1: { providerId: 'groq', createdAt: T + 8 },
  d1: { providerId: 'deepseek', createdAt: T + 9 },
  z1: { providerId: 'azure_openai', createdAt: T + 10 },
  l1: { providerId: 'ollama', createdAt: T + 11 },
  m1: { providerId: 'lm_studio', createdAt: T + 12 },
};

/** A group binding `providerId` ('' is the default group, which binds nothing). */
const group = (providerId, opts = {}) => ({ providerId, credentialId: opts.pin ?? null, model: opts.model ?? null });
const DEFAULT = group('');

// [name, requested provider, request model (null: a GET, a multipart upload), group, key ids]
const CASES = [
  // 1. Cross-family translation: a group bound to another family.
  ['cross: the group\'s model', 'openai', 'gpt-5.5', group('anthropic', { model: 'claude-opus-4-1' }), ['a1', 'o1']],
  ['cross: a model-less group uses its provider\'s routing model', 'openai', 'gpt-5.5', group('anthropic'), ['a1']],
  ['cross: a model-less group wins over the app\'s own key', 'anthropic', 'claude-sonnet-4-6', group('gemini'), ['a1', 'g1']],
  ['cross: to cohere without a model', 'openai', 'gpt-5.5', group('cohere'), ['c1']],
  ['cross: to openrouter without a model', 'anthropic', 'claude-sonnet-4-6', group('openrouter'), ['r1']],
  ['cross: the pinned key', 'openai', 'gpt-5.5', group('anthropic', { pin: 'a2', model: 'claude-opus-4-1' }), ['a1', 'a2']],
  ['cross: a stale pin serves nothing', 'openai', 'gpt-5.5', group('anthropic', { pin: 'gone', model: 'claude-opus-4-1' }), ['a1', 'o1']],
  ['cross: a pin to another provider\'s key serves nothing', 'gemini', 'gemini-2.5-flash', group('anthropic', { pin: 'o1', model: 'claude-opus-4-1' }), ['a1', 'o1', 'g1']],
  ['cross: no key for the group\'s provider, the app\'s own key doesn\'t stand in', 'openai', 'gpt-5.5', group('anthropic', { model: 'claude-opus-4-1' }), ['o1']],
  ['cross: no model and no routing default (deepseek)', 'anthropic', 'claude-sonnet-4-6', group('deepseek'), ['a1', 'd1']],
  ['cross: a request without a model is routed too', 'openai', null, group('anthropic', { model: 'claude-opus-4-1' }), ['a1', 'o1']],
  ['cross: to a local server with a model', 'anthropic', 'claude-sonnet-4-6', group('ollama', { model: 'llama3.3' }), ['a1', 'l1']],
  ['cross: to a local server without a model', 'anthropic', 'claude-sonnet-4-6', group('ollama'), ['a1', 'l1']],
  ['cross: to a local server whose key was deleted', 'anthropic', 'claude-sonnet-4-6', group('lm_studio', { model: 'qwen3' }), ['a1']],
  ['cross: a group routes a local server\'s app to the cloud', 'ollama', 'llama3.3', group('anthropic'), ['a1', 'l1']],

  // 2. Same-family swap: a group bound to another provider of the same family.
  ['swap: groq app to an openai group', 'groq', 'llama-3.3-70b-versatile', group('openai'), ['o1']],
  ['swap: with the group\'s model', 'groq', 'llama-3.3-70b-versatile', group('openai', { model: 'gpt-4o' }), ['o1', 'q1']],
  ['swap: openai app to a local server', 'openai', 'gpt-5.5', group('ollama', { model: 'llama3.1' }), ['l1', 'o1']],
  ['swap: openai app to openrouter without a model', 'openai', 'gpt-5.5', group('openrouter'), ['o1', 'r1']],
  ['swap: a pin to another provider\'s key serves nothing', 'openai', 'gpt-5.5', group('azure_openai', { pin: 'q1' }), ['o1', 'q1']],
  ['swap: a stale pin serves nothing', 'openai', 'gpt-5.5', group('groq', { pin: 'gone' }), ['o1', 'q1']],
  ['swap: a local server whose key was deleted', 'openai', 'gpt-5.5', group('ollama', { model: 'llama3.1' }), ['o1']],

  // 3. Direct: no group, the default group, or a group on the requested provider.
  ['direct: no group', 'openai', 'gpt-5.5', null, ['o1', 'a1']],
  ['direct: the default group', 'openai', 'gpt-5.5', DEFAULT, ['o1']],
  ['direct: the first key of the provider', 'anthropic', 'claude-sonnet-4-6', group('anthropic'), ['a1', 'a2']],
  ['direct: the pinned key and model', 'openai', 'gpt-5.5', group('openai', { pin: 'o2', model: 'gpt-4o' }), ['o1', 'o2']],
  ['direct: the group\'s model', 'anthropic', 'claude-sonnet-4-6', group('anthropic', { model: 'claude-opus-4-1' }), ['a1']],
  ['direct: a stale pin serves nothing', 'openai', 'gpt-5.5', group('openai', { pin: 'gone' }), ['o1']],
  ['direct: a pin to another provider\'s key serves nothing', 'openai', 'gpt-5.5', group('openai', { pin: 'a1' }), ['a1', 'o1']],
  ['direct: a group on the provider without its key isn\'t auto-routed', 'openai', 'gpt-5.5', group('openai'), ['a1']],

  // 4. Auto cross-family: no group binding and no key for the provider.
  ['auto: to anthropic', 'openai', 'gpt-5.5', null, ['a1']],
  ['auto: from the default group', 'openai', 'gpt-5.5', DEFAULT, ['a1']],
  ['auto: gemini app to openai', 'gemini', 'gemini-2.5-flash', null, ['o1']],
  ['auto: to cohere', 'openai', 'gpt-5.5', null, ['c1']],
  ['auto: to openrouter', 'anthropic', 'claude-sonnet-4-6', null, ['r1']],
  ['auto: anthropic before openai', 'gemini', 'gemini-2.5-flash', null, ['c1', 'o1', 'a1']],
  ['auto: openai before gemini', 'anthropic', 'claude-sonnet-4-6', null, ['c1', 'g1', 'o1']],
  ['auto: gemini before cohere', 'anthropic', 'claude-sonnet-4-6', null, ['c1', 'g1']],
  ['auto: the newest key of a family', 'openai', 'gpt-5.5', null, ['a1', 'a2']],
  ['auto: providers without a routing model are skipped', 'anthropic', 'claude-sonnet-4-6', null, ['d1', 'q1', 'z1', 'l1', 'm1']],
  ['auto: the next provider with a routing model', 'anthropic', 'claude-sonnet-4-6', null, ['d1', 'q1', 'z1', 'l1', 'o1']],
  ['auto: a request without a model is routed too', 'anthropic', null, null, ['o1']],
  ['auto: never for a group the user set', 'gemini', 'gemini-2.5-flash', group('deepseek'), ['a1', 'd1']],
  ['auto: a request for a local server never goes to a cloud key', 'ollama', 'llama3.3', null, ['a1', 'g1', 'c1']],
  ['auto: nor from the default group', 'lm_studio', 'qwen3', DEFAULT, ['a1', 'g1', 'c1']],
  ['auto: not same-family keys', 'mistral', 'mistral-large-latest', null, ['o1']],
  ['an unknown provider gets nothing', 'nope', 'm', null, ['a1']],
];

function credentials(ids) {
  return ids.map((id) => ({
    id,
    providerId: KEYS[id].providerId,
    label: id,
    authMethod: 'api_key',
    encryptedKey: '',
    createdAt: KEYS[id].createdAt,
  }));
}

function coreGroup(g) {
  if (!g) return undefined;
  return {
    id: g.providerId ? 'g' : 'default',
    name: g.providerId ? 'Group' : 'Default',
    providerId: g.providerId,
    credentialId: g.credentialId ?? undefined,
    model: g.model ?? undefined,
    createdAt: 0,
  };
}

/** Core's decision, in the shape every platform compares against. */
function expected(requested, g, ids) {
  const route = resolveRoute(requested, coreGroup(g), credentials(ids));
  if (!route) return null;
  return {
    credential: route.credential.id,
    translation: route.translation
      ? { dstProviderId: route.translation.dstProviderId, dstModel: route.translation.dstModel }
      : null,
    swap: route.swap ? { dstProviderId: route.swap.dstProviderId, dstModel: route.swap.dstModel ?? null } : null,
    modelOverride: route.modelOverride ?? null,
  };
}

const providers = Object.keys(PROVIDERS).sort();
const tables = Object.fromEntries(providers.map((id) => [id, {
  family: familyOf(id),
  autoRouteModel: autoRouteModelFor(id) ?? null,
}]));

const cases = CASES.map(([name, requested, model, g, ids]) => ({
  name,
  requested,
  model,
  group: g,
  credentials: ids.map((id) => ({ id, providerId: KEYS[id].providerId, createdAt: KEYS[id].createdAt })),
  expect: expected(requested, g, ids),
}));

const names = new Set();
for (const c of cases) {
  if (names.has(c.name)) throw new Error(`Duplicate case name: ${c.name}`);
  names.add(c.name);
}

const about = [
  'Routing decisions (packages/core/src/routing.ts resolveRoute) that every wallet must make the same way.',
  'Generated by scripts/gen-routing-vectors.mjs from core; do not edit by hand. Read by',
  'packages/core/tests/routing.test.ts, packages/ios/ByokyTests/RoutingResolverTests.swift and',
  'packages/android/.../proxy/RoutingResolverTest.kt (whose Families stub is built from \"providers\").',
  '\"providers\": each provider\'s family (core familyOf) and the model routing names for it when',
  'nothing else does (core autoRouteModelFor). A case: the provider the app called, the model its',
  'request names (null: a GET or a multipart upload), the app\'s group (providerId \"\" is the default',
  'group), the wallet\'s keys, and the decision: null for none (PROVIDER_UNAVAILABLE), else the key',
  'and a translation, a same-family swap, or a model override. Routing never depends on the model;',
  'a translation\'s source model is the request\'s, or empty.',
];

const json = [
  '{',
  `  "about": [\n${about.map((line) => `    ${JSON.stringify(line)}`).join(',\n')}\n  ],`,
  `  "providers": {\n${providers.map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(tables[id])}`).join(',\n')}\n  },`,
  `  "cases": [\n${cases.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]`,
  '}',
  '',
].join('\n');

if (process.argv.includes('--check')) {
  const committed = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (committed !== json) {
    console.error('::error file=packages/core/tests/vectors/routing.json::routing.json differs from what core decides. Regenerate: pnpm --filter @byoky/core build && node scripts/gen-routing-vectors.mjs');
    process.exit(1);
  }
  console.log('Routing vectors match core');
} else {
  writeFileSync(OUT, json);
  console.log(`Wrote ${OUT} (${cases.length} cases)`);
}
