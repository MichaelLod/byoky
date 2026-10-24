import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { FallbackURL, installURLFallback } from '../src/translate/url-fallback.js';
import { PROVIDERS } from '../src/providers.js';
import { resolveProviderBaseUrl, validateProxyUrl } from '../src/proxy-utils.js';
import { rewriteProxyUrl, isChatCompletionsEndpoint } from '../src/translate/index.js';
import { anthropicAdapter } from '../src/translate/adapters/anthropic.js';
import { openaiAdapter } from '../src/translate/adapters/openai.js';
import { geminiAdapter } from '../src/translate/adapters/gemini.js';
import { cohereAdapter } from '../src/translate/adapters/cohere.js';

const FIELDS = [
  'href', 'origin', 'protocol', 'username', 'password',
  'host', 'hostname', 'port', 'pathname', 'search', 'hash',
] as const;

function fields(u: URL | FallbackURL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of FIELDS) out[f] = u[f];
  out.toString = u.toString();
  out.toJSON = u.toJSON();
  return out;
}

function tryFallback(input: string): FallbackURL | Error {
  try {
    return new FallbackURL(input);
  } catch (e) {
    return e as Error;
  }
}

function tryWhatwg(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

/**
 * The fail-closed contract: the fallback either throws a TypeError, or
 * WHATWG parses the same input and every field is identical.
 */
function expectThrowsOrMatchesWhatwg(input: string): 'threw' | 'matched' {
  const fb = tryFallback(input);
  if (fb instanceof Error) {
    expect(fb, JSON.stringify(input)).toBeInstanceOf(TypeError);
    return 'threw';
  }
  const real = tryWhatwg(input);
  expect(real, `fallback accepted ${JSON.stringify(input)} but WHATWG rejects it`).not.toBeNull();
  expect(fields(fb), JSON.stringify(input)).toEqual(fields(real!));
  return 'matched';
}

/** Run `fn` with the global URL removed and the fallback installed. Synchronous only. */
function withFallbackGlobal<T>(fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const saved = Object.getOwnPropertyDescriptor(g, 'URL');
  expect(saved).toBeDefined();
  delete g.URL;
  try {
    expect(typeof g.URL).toBe('undefined');
    expect(installURLFallback()).toBe(true);
    expect(g.URL).toBe(FallbackURL);
    return fn();
  } finally {
    delete g.URL;
    Object.defineProperty(g, 'URL', saved!);
  }
}

// ─── Corpora ─────────────────────────────────────────────────────────────

const NORMAL_URLS = [
  'https://api.anthropic.com',
  'https://api.anthropic.com/',
  'https://api.anthropic.com/v1/messages',
  'https://api.anthropic.com/v1/messages?beta=true',
  'https://api.openai.com/v1/chat/completions',
  'https://api.openai.com/v1/models',
  'https://api.openai.com/v1/embeddings',
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=AIzaSyTEST-123_abc',
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=AIzaSyTEST',
  'https://generativelanguage.googleapis.com/v1beta/models/tuned%2Fmodel:generateContent',
  'https://generativelanguage.googleapis.com/v1/models?key=test&pageSize=50',
  'https://myres.openai.azure.com',
  'https://myres.openai.azure.com/',
  'https://myres.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21',
  'https://my-res-01.openai.azure.com:8443/openai/deployments/gpt-4o-mini/chat/completions?api-version=2025-01-01-preview',
  'https://api.groq.com/openai/v1/chat/completions',
  'https://api.fireworks.ai/inference/v1/chat/completions',
  'https://openrouter.ai/api/v1/chat/completions',
  'https://api.cohere.com/v2/chat',
  'https://api.perplexity.ai/chat/completions',
  'https://api.x.ai/v1/chat/completions',
  'http://localhost:11434',
  'http://localhost:11434/',
  'http://localhost:11434/v1/chat/completions',
  'http://localhost:11434/api/tags',
  'http://localhost:1234/v1/models',
  'http://127.0.0.1:1234/v1/chat/completions',
  'http://127.0.0.1/',
  'http://[::1]:8080/v1/chat/completions',
  'http://[::1]/',
  'http://[::1]:11434',
  'http://[0:0:0:0:0:0:0:1]:11434/api/chat',
  'http://[2001:DB8::1]:8080/x',
  'http://[2001:db8:0:0:1:0:0:1]/',
  'http://[1:0:0:2:0:0:0:3]/',
  'http://[1::]/',
  'http://[::]/',
  'HTTPS://API.OpenAI.COM/V1/Chat/Completions',
  'https://api.openai.com:443/v1/chat/completions',
  'http://localhost:80/',
  'http://localhost:443/',
  'https://api.openai.com/v1/chat/completions#frag',
  'https://api.openai.com/v1/chat/completions?',
  'https://api.openai.com/v1/chat/completions#',
  'https://api.openai.com?x=1',
  'https://api.openai.com#x',
  'https://user:pass@myres.openai.azure.com/',
  'https://user@myres.openai.azure.com/',
  'https://api.openai.com//v1//chat',
  'https://api.openai.com/v1/a%2Fb',
  'https://api.openai.com/v1/.well-known/x',
  'https://api.openai.com/v1/..x/y',
  'https://api.openai.com/v1/@evil.com',
  'https://api.openai.com/v1?redirect=https://evil.com/@x',
];

const HOSTILE_URLS = [
  // userinfo / authority confusion
  'https://evil.com\\@api.openai.com/',
  'https://api.openai.com\\@evil.com/',
  'https://api.openai.com@evil.com/',
  'https://api.openai.com:443@evil.com/',
  'https://api.openai.com:pw@evil.com/',
  'https://a@b@evil.com/',
  'https://@api.openai.com/',
  'https://:pw@api.openai.com/',
  'https://u:p:q@api.openai.com/',
  'https://u;x@api.openai.com/',
  'https://api.openai.com.evil.com/',
  'http://evil.com#@api.openai.com/',
  'http://evil.com?@api.openai.com/',
  'http://evil.com/\\api.openai.com/',
  // whitespace / control characters
  'https://api.openai.com\t.evil.com/',
  'https://api.openai.com\n/v1',
  'https://api.openai.com\r\n/v1',
  '\thttps://api.openai.com/',
  ' https://api.openai.com/',
  'https://api.openai.com/ ',
  'https://api.openai.com /',
  'https://api.openai.com/v1/\u0000',
  'https://api.openai.com/v1/\u007f',
  'https://api.openai.com/ ',
  // dot segments (plain and percent-encoded)
  'https://api.openai.com/v1/../admin',
  'https://api.openai.com/v1/./x',
  'https://api.openai.com/v1/%2e%2e/admin',
  'https://api.openai.com/v1/%2E%2E/admin',
  'https://api.openai.com/v1/.%2e/admin',
  'https://api.openai.com/v1/%2e./admin',
  'https://api.openai.com/v1/%2e/admin',
  'https://api.openai.com/..',
  // percent-encoding / unicode in the host
  'https://%61pi.openai.com/',
  'https://api%2eopenai.com/',
  'https://api.openai.com%2f@evil.com/',
  'https://аpi.openai.com/',
  'https://xn--pi-7ld.openai.com/',
  'https://ａｐｉ.openai.com/',
  'https://api.openai.com。evil.com/',
  'https://api.openai.com​/',
  'https://api_openai.com/',
  'https://api.openai.com./',
  'https://api..openai.com/',
  'https://.api.openai.com/',
  'https://-api.openai.com/',
  'https://api-.openai.com/',
  // schemes and slashes
  'javascript:alert(1)',
  'javascript://api.openai.com/%0aalert(1)',
  'data:text/html,<script>alert(1)</script>',
  'file:///etc/passwd',
  'ftp://api.openai.com/',
  'ws://api.openai.com/',
  'blob:https://api.openai.com/x',
  'https:api.openai.com/',
  'https:/api.openai.com/',
  'https:///api.openai.com/',
  'https:////api.openai.com/',
  '//api.openai.com/',
  'api.openai.com/v1',
  '',
  'https://',
  'https://:443/',
  'https:',
  // ports
  'https://api.openai.com:/',
  'https://api.openai.com:0/',
  'https://api.openai.com:65535/',
  'https://api.openai.com:65536/',
  'https://api.openai.com:99999/',
  'https://api.openai.com:0443/',
  'https://api.openai.com:44a/',
  'https://api.openai.com:443:443/',
  'https://api.openai.com:-1/',
  'https://api.openai.com:+443/',
  // IPv4 number forms
  'http://0x7f.0.0.1/',
  'http://0x7f.1/',
  'http://0177.0.0.1/',
  'http://2130706433/',
  'http://127.1/',
  'http://127.0.0.01/',
  'http://256.0.0.1/',
  'http://1.2.3.4.5/',
  'http://127.0.0.1.evil.com/',
  'http://0x/',
  // IPv6
  'http://[::1/',
  'http://[::1]x/',
  'http://[::1]]/',
  'http://[[::1]]/',
  'http://[::ffff:127.0.0.1]/',
  'http://[fe80::1%25eth0]/',
  'http://[1:2:3:4:5:6:7:8:9]/',
  'http://[1:2:3:4:5:6:7:8::]/',
  'http://[1::2::3]/',
  'http://[:::1]/',
  'http://[:1::]/',
  'http://[12345::1]/',
  'http://[g::1]/',
  'http://[]/',
  'http://::1/',
  // characters WHATWG would percent-encode
  'https://api.openai.com/v1/<script>',
  'https://api.openai.com/v1/"x"',
  'https://api.openai.com/v1/{x}',
  'https://api.openai.com/v1/`x`',
  'https://api.openai.com/v1/a^b',
  'https://api.openai.com/v1/a|b',
  "https://api.openai.com/?q='x'",
  "https://api.openai.com/it's",
  'https://api.openai.com/%zz',
  'https://api.openai.com/%2',
  'https://api.openai.com/café',
  // case games
  'HTTPS://API.OPENAI.COM/',
  'hTtP://LocalHost:11434/v1/chat/completions',
];

// Inputs the design explicitly rejects (stronger than "throws or matches").
const MUST_THROW = HOSTILE_URLS.filter((u) => ![
  'https://api.openai.com@evil.com/',
  'https://api.openai.com:443@evil.com/',
  'https://api.openai.com:pw@evil.com/',
  'https://api.openai.com.evil.com/',
  'http://evil.com#@api.openai.com/',
  'http://evil.com?@api.openai.com/',
  'https://api.openai.com:65535/',
  "https://api.openai.com/it's",
  'http://127.0.0.1.evil.com/',
  'https://api.openai.com%2f@evil.com/',
  'HTTPS://API.OPENAI.COM/',
  'hTtP://LocalHost:11434/v1/chat/completions',
].includes(u));

// ─── FallbackURL parsing ─────────────────────────────────────────────────

describe('FallbackURL: normal provider URLs', () => {
  it.each(NORMAL_URLS)('matches WHATWG URL field-for-field: %s', (input) => {
    const fb = tryFallback(input);
    expect(fb, `fallback rejected ${input}: ${(fb as Error).message}`).toBeInstanceOf(FallbackURL);
    expect(fields(fb as FallbackURL)).toEqual(fields(new URL(input)));
  });

  it('lower-cases scheme and host but keeps path case', () => {
    const u = new FallbackURL('HTTPS://API.OpenAI.COM/V1/Chat');
    expect(u.protocol).toBe('https:');
    expect(u.hostname).toBe('api.openai.com');
    expect(u.pathname).toBe('/V1/Chat');
  });

  it('treats default ports as empty and keeps others', () => {
    expect(new FallbackURL('https://a.example:443/').port).toBe('');
    expect(new FallbackURL('http://a.example:80/').port).toBe('');
    expect(new FallbackURL('http://a.example:443/').port).toBe('443');
    expect(new FallbackURL('https://a.example:80/').port).toBe('80');
    expect(new FallbackURL('http://localhost:11434/').host).toBe('localhost:11434');
  });

  it('keeps brackets on IPv6 hostnames and canonicalises them like WHATWG', () => {
    const u = new FallbackURL('http://[0:0:0:0:0:0:0:1]:11434/x');
    expect(u.hostname).toBe('[::1]');
    expect(u.host).toBe('[::1]:11434');
    expect(u.origin).toBe('http://[::1]:11434');
  });

  it('is immutable', () => {
    const u = new FallbackURL('https://api.openai.com/v1/chat/completions');
    expect(Object.isFrozen(u)).toBe(true);
    expect(() => {
      (u as unknown as { hostname: string }).hostname = 'evil.com';
    }).toThrow(TypeError);
    expect(u.hostname).toBe('api.openai.com');
  });

  it('rejects a base argument instead of resolving relative URLs', () => {
    expect(() => new FallbackURL('/v1/messages', 'https://api.anthropic.com')).toThrow(TypeError);
    expect(() => new FallbackURL('https://api.anthropic.com/', 'https://x.example')).toThrow(TypeError);
  });

  it('canParse mirrors the constructor', () => {
    expect(FallbackURL.canParse('https://api.openai.com/')).toBe(true);
    expect(FallbackURL.canParse('https://evil.com\\@api.openai.com/')).toBe(false);
  });

  it('never echoes the input in error messages (Gemini keys live in the query)', () => {
    try {
      new FallbackURL('https://generativelanguage.googleapis.com/v1/x?key=AIzaSECRET&q=<x>');
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain('AIzaSECRET');
    }
  });
});

describe('FallbackURL: hostile inputs', () => {
  it.each(HOSTILE_URLS)('throws or parses identically to WHATWG: %j', (input) => {
    expectThrowsOrMatchesWhatwg(input);
  });

  it.each(MUST_THROW)('rejects %j', (input) => {
    expect(() => new FallbackURL(input)).toThrow(TypeError);
  });

  it('resolves the userinfo trick to the real host, like WHATWG', () => {
    const u = new FallbackURL('https://api.openai.com@evil.com/');
    expect(u.hostname).toBe('evil.com');
    expect(u.username).toBe('api.openai.com');
    expect(u.origin).toBe('https://evil.com');
  });

  it('differential fuzz: never accepts something WHATWG rejects or parses differently', () => {
    // Deterministic PRNG so failures reproduce.
    let seed = 0x2f6e2b1;
    const rand = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    // Valid pieces are repeated so a good share of inputs parse and get
    // compared field-by-field, not just rejected.
    const many = <T>(n: number, xs: T[]): T[] => Array.from({ length: n }, () => xs).flat();
    const schemes = [...many(6, ['https://', 'http://']), 'HTTPS://', 'hTtP://',
      'https:', 'https:/', 'https:///', 'javascript:', 'ftp://', ''];
    const userinfo = [...many(16, ['']), 'u@', 'u:p@', 'user:pa%20ss@', "u'(x)*!$&+,~@", 'x%40y@',
      'api.openai.com@', '@', ':@', ':p@', 'a@b@', 'u;p@', 'u:p:q@', 'u=x@', 'u[x]@'];
    const hosts = [
      ...many(4, ['api.openai.com', 'API.OpenAI.com', 'localhost', '127.0.0.1', '[::1]', 'my-res.openai.azure.com']),
      '[0:0::1]', '[2001:DB8:0:0:1::1]', '[1:0:0:2:0:0:0:3]', '[::]', '10.0.0.255', '1.2.3.evil',
      '127.1', '0x7f.1', '2130706433', '0177.0.0.1', '256.1.1.1', '1.2.3.4.5', '[::ffff:1.2.3.4]',
      '[1:2:3:4:5:6:7:8:9]', '[::1', '[fe80::1%25en0]', 'a..b', 'a.b.', '-a.b', 'a-.b', 'xn--p1ai',
      '%61.com', 'a_b.com', 'аpi.com', '',
    ];
    const ports = [...many(6, ['']), ':443', ':80', ':8080', ':11434', ':65535',
      ':', ':0', ':0443', ':65536', ':1a', ':-1'];
    const segs = [...many(3, ['/v1', '/chat', '/completions', '/messages', '/models/g:generateContent']),
      '/', '//', '/a%2fb', '/@x', '/~!$&()*+,;=:@', "/it's", '/[x]', '/..x', '/.well-known',
      '/.', '/..', '/%2e', '/.%2E', '/%2e%2e', '/\\x', '/a b', '/a\tb', '/<x>', '/x^y', '/a|b',
      '/%zz', '/%2', '/é', '/{x}', '/`x`', '/"x"'];
    const queries = [...many(6, ['']), '?', '?a=1', '?key=AIza_x-1&alt=sse', '?api-version=2024-10-21',
      '?a=b?c', '?@evil.com', '?a=%20', '?x=[1]', "?q='x'", '?a=<b>', '?a b'];
    const frags = [...many(6, ['']), '#', '#f', '#a#b', '#@evil.com', '#/x', "#it's", '#a?b', '#<x>'];
    let accepted = 0;
    const N = 50000;
    for (let i = 0; i < N; i++) {
      let s = pick(schemes) + pick(userinfo) + pick(hosts) + pick(ports);
      const n = Math.floor(rand() * 4);
      for (let k = 0; k < n; k++) s += pick(segs);
      s += pick(queries) + pick(frags);
      if (rand() < 0.1) {
        // Splice in a random printable or tricky character.
        const tricky = ['\\', '\t', '\n', ' ', '%', '@', ':', '[', ']', '#', '?', '\u0000', 'é', '"'];
        const at = Math.floor(rand() * (s.length + 1));
        s = s.slice(0, at) + pick(tricky) + s.slice(at);
      }
      if (expectThrowsOrMatchesWhatwg(s) === 'matched') accepted++;
    }
    // Guard against a vacuous run where everything throws.
    expect(accepted).toBeGreaterThan(N * 0.05);
  });
});

describe('installURLFallback', () => {
  it('never replaces an existing URL implementation', () => {
    const Marker = function URL() {};
    const host = { URL: Marker };
    expect(installURLFallback(host)).toBe(false);
    expect(host.URL).toBe(Marker);
    expect(installURLFallback(globalThis)).toBe(false);
    expect(globalThis.URL).not.toBe(FallbackURL);
  });

  it('installs on a host without URL, non-enumerable like a real global', () => {
    const host: Record<string, unknown> = {};
    expect(installURLFallback(host)).toBe(true);
    expect(host.URL).toBe(FallbackURL);
    expect(Object.keys(host)).not.toContain('URL');
    // Idempotent: a second call sees the installed fallback.
    expect(installURLFallback(host)).toBe(false);
  });
});

// ─── Core callers: real URL vs. fallback ─────────────────────────────────

type Case = readonly [string, ...unknown[]];

const VALIDATE_NORMAL: Array<[string, string, string?]> = [
  ['anthropic', 'https://api.anthropic.com/v1/messages'],
  ['anthropic', 'https://api.anthropic.com/v1/messages?beta=true'],
  ['openai', 'https://api.openai.com/v1/chat/completions'],
  ['openai', 'https://api.openai.com/v1/embeddings'],
  ['gemini', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=AIzaTEST'],
  ['gemini', 'https://generativelanguage.googleapis.com/v1/models?key=test'],
  ['cohere', 'https://api.cohere.com/v2/chat'],
  ['groq', 'https://api.groq.com/openai/v1/chat/completions'],
  ['openrouter', 'https://openrouter.ai/api/v1/chat/completions'],
  ['anthropic', 'https://evil.com/steal-key'],
  ['anthropic', 'https://api.anthropic.com.evil.com/v1/messages'],
  ['anthropic', 'http://api.anthropic.com/v1/messages'],
  ['anthropic', 'https://api.anthropic.com:8443/v1/messages'],
  ['anthropic', 'https://api.anthropic.com:443/v1/messages'],
  ['anthropic', 'HTTPS://API.ANTHROPIC.COM/v1/messages'],
  ['anthropic', 'not-a-url'],
  ['nonexistent', 'https://api.example.com/'],
  ['anthropic', 'https://evil.example/v1/messages', 'https://evil.example'],
  ['anthropic', 'https://api.anthropic.com/v1/messages', 'https://evil.example'],
  ['azure_openai', 'https://myres.openai.azure.com/openai/deployments/x/chat/completions?api-version=2024-10-21', 'https://myres.openai.azure.com'],
  ['azure_openai', 'https://myres.openai.azure.com/v1/chat/completions', 'https://myres.openai.azure.com/'],
  ['azure_openai', 'https://myres.openai.azure.com:8443/v1/chat/completions', 'https://myres.openai.azure.com:8443'],
  ['azure_openai', 'https://myres.openai.azure.com/v1/chat/completions', 'https://myres.openai.azure.com:8443'],
  ['azure_openai', 'https://myres.openai.azure.com/x'],
  ['azure_openai', 'https://evil.example/x', 'https://myres.openai.azure.com'],
  ['azure_openai', 'http://myres.openai.azure.com/x', 'http://myres.openai.azure.com'],
  ['azure_openai', 'https://myres.openai.azure.com/x', 'https://u:p@myres.openai.azure.com'],
  ['azure_openai', 'https://myres.openai.azure.com/x', 'https://myres.openai.azure.com?x=1'],
  ['azure_openai', 'https://myres.openai.azure.com/x', 'https://myres.openai.azure.com#f'],
  ['ollama', 'http://localhost:11434/v1/chat/completions', 'http://localhost:11434'],
  ['ollama', 'http://127.0.0.1:11434/api/chat', 'http://127.0.0.1:11434'],
  ['ollama', 'http://[::1]:11434/v1/chat/completions', 'http://[::1]:11434'],
  ['ollama', 'http://localhost:11434/v1/chat/completions', 'http://127.0.0.1:11434'],
  ['ollama', 'http://192.168.1.5:11434/v1/chat/completions', 'http://192.168.1.5:11434'],
  ['ollama', 'https://ollama.example.com/v1/chat/completions', 'https://ollama.example.com'],
  ['lm_studio', 'http://localhost:1234/v1/chat/completions', 'http://localhost:1234'],
  ['lm_studio', 'http://127.0.0.1:1234/v1/models', 'http://127.0.0.1:1234'],
  ['lm_studio', 'http://evil.example:1234/v1/chat/completions', 'http://evil.example:1234'],
];

const VALIDATE_HOSTILE: Array<[string, string, string?]> = [
  ['openai', 'https://api.openai.com\\@evil.com/v1/chat/completions'],
  ['openai', 'https://evil.com\\@api.openai.com/v1/chat/completions'],
  ['openai', 'https://api.openai.com@evil.com/v1/chat/completions'],
  ['openai', 'https://user@api.openai.com/v1/chat/completions'],
  ['openai', 'https://api.openai.com\t/v1/chat/completions'],
  ['openai', ' https://api.openai.com/v1/chat/completions'],
  ['openai', 'https:api.openai.com/v1/chat/completions'],
  ['openai', 'https:///api.openai.com/v1/chat/completions'],
  ['openai', 'https://api.openai.com./v1/chat/completions'],
  ['openai', 'https://API.OPENAI.COM:0443/v1/chat/completions'],
  ['openai', 'https://api.openai.com/v1/%2e%2e/files'],
  ['openai', 'https://аpi.openai.com/v1/chat/completions'],
  ['openai', 'javascript:alert(1)'],
  ['ollama', 'http://0x7f.1:11434/v1/chat/completions', 'http://0x7f.1:11434'],
  ['ollama', 'http://2130706433:11434/v1/chat/completions', 'http://2130706433:11434'],
  ['ollama', 'http://localhost:11434/v1/chat/completions', 'http://localhost:11434\t'],
  ['ollama', 'http://[0:0:0:0:0:0:0:1]:11434/v1/chat/completions', 'http://[::1]:11434'],
  ['ollama', 'http://[::ffff:127.0.0.1]:11434/v1/chat/completions', 'http://[::ffff:127.0.0.1]:11434'],
  ['azure_openai', 'https://myres.openai.azure.com/x', 'https://evil.com\\@myres.openai.azure.com'],
  ['azure_openai', 'https://evil.com/x', 'https://evil.com\\@myres.openai.azure.com'],
  ['azure_openai', 'https://myres.openai.azure.com/x', 'https://myres.openai.azure.com\n'],
  ['azure_openai', 'https://myres.openai.azure.com/x', 'https:myres.openai.azure.com'],
  ['azure_openai', 'https://myres.openai.azure.com/x', 'https://@myres.openai.azure.com'],
  ['azure_openai', 'https://myres.openai.azure.com/x', 'https://myres.openai.azure.com:/'],
];

const OVERRIDES = [
  undefined,
  '',
  'https://evil.example',
  'https://myres.openai.azure.com',
  'https://myres.openai.azure.com/',
  'https://myres.openai.azure.com:8443',
  'HTTPS://MyRes.OpenAI.Azure.com',
  'http://myres.openai.azure.com',
  'https://u:p@myres.openai.azure.com',
  'https://myres.openai.azure.com?x=1',
  'https://myres.openai.azure.com#f',
  'http://localhost:11434',
  'http://127.0.0.1:1234',
  'http://[::1]:11434',
  'http://192.168.1.5:11434',
  'not a url',
];

const REWRITE_HOSTILE_OVERRIDES = [
  'https://evil.com\\@myres.openai.azure.com',
  'https://myres.openai.azure.com\t',
  ' https://myres.openai.azure.com',
  'https:myres.openai.azure.com',
  'https:///myres.openai.azure.com',
  'https://@myres.openai.azure.com',
  'https://myres.openai.azure.com:',
  'https://myres.openai.azure.com:0443',
  'https://myres.openai.azure.com./',
  'https://myrés.openai.azure.com',
  'http://0x7f.1:11434',
];

const CHAT_URLS = [
  ...NORMAL_URLS,
  'https://api.anthropic.com/proxy/v1/messages',
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:embedContent',
  'https://generativelanguage.googleapis.com/v1beta/models/a/b:generateContent',
  'https://api.cohere.com/v2/embed',
  'not a url',
  '/v1/messages',
];

const ADAPTERS = [anthropicAdapter, openaiAdapter, geminiAdapter, cohereAdapter];
const FAMILIES = ['anthropic', 'openai', 'gemini', 'cohere'] as const;

function validateResults(cases: Array<[string, string, string?]>): Case[] {
  return cases.map(([p, url, base]) => [`${p} ${url} ${base ?? ''}`, validateProxyUrl(p, url, base)] as const);
}

function resolveResults(overrides: Array<string | undefined>): Case[] {
  const out: Case[] = [];
  for (const id of Object.keys(PROVIDERS)) {
    for (const o of overrides) out.push([`${id} ${o}`, resolveProviderBaseUrl(id, o)]);
  }
  return out;
}

function rewriteResults(overrides: Array<string | undefined>): Case[] {
  const out: Case[] = [];
  for (const id of Object.keys(PROVIDERS)) {
    for (const o of overrides) {
      for (const stream of [false, true]) {
        out.push([`${id} ${o} ${stream}`, rewriteProxyUrl(id, 'gemini-2.5-flash', stream, o)]);
      }
    }
  }
  return out;
}

function matchResults(urls: string[]): Case[] {
  const out: Case[] = [];
  for (const url of urls) {
    for (const a of ADAPTERS) out.push([`${a.family} ${url}`, a.matchesChatEndpoint(url)]);
    for (const f of FAMILIES) out.push([`isChat ${f} ${url}`, isChatCompletionsEndpoint(f, url)]);
  }
  return out;
}

/** Fallback may deny where WHATWG allows, never the reverse. */
function expectSameOrDenied(real: Case[], fallback: Case[], deny: unknown) {
  expect(fallback.map((c) => c[0])).toEqual(real.map((c) => c[0]));
  for (let i = 0; i < real.length; i++) {
    const [label, r] = real[i];
    const f = fallback[i][1];
    if (f !== r) expect(f, `fallback allowed something WHATWG did not: ${label}`).toBe(deny);
  }
}

describe('core URL callers with the global URL removed and the fallback installed', () => {
  it('sanity: the corpora exercise both allow and deny outcomes', () => {
    const v = validateResults(VALIDATE_NORMAL).map((c) => c[1]);
    expect(v).toContain(true);
    expect(v).toContain(false);
    const r = rewriteResults(OVERRIDES).map((c) => c[1]);
    expect(r).toContain('https://myres.openai.azure.com/v1/chat/completions');
    expect(r).toContain(null);
  });

  it('validateProxyUrl: identical results for normal inputs', () => {
    const real = validateResults(VALIDATE_NORMAL);
    expect(withFallbackGlobal(() => validateResults(VALIDATE_NORMAL))).toEqual(real);
  });

  it('validateProxyUrl: hostile inputs are denied or agree with WHATWG, never more permissive', () => {
    const real = validateResults(VALIDATE_HOSTILE);
    const fb = withFallbackGlobal(() => validateResults(VALIDATE_HOSTILE));
    expectSameOrDenied(real, fb, false);
  });

  it('resolveProviderBaseUrl: identical results for every provider and normal override', () => {
    const real = resolveResults(OVERRIDES);
    expect(withFallbackGlobal(() => resolveResults(OVERRIDES))).toEqual(real);
  });

  it('rewriteProxyUrl: identical results for every provider, override and stream flag', () => {
    const real = rewriteResults(OVERRIDES);
    expect(withFallbackGlobal(() => rewriteResults(OVERRIDES))).toEqual(real);
  });

  it('rewriteProxyUrl: hostile overrides are refused or agree with WHATWG', () => {
    const real = rewriteResults(REWRITE_HOSTILE_OVERRIDES);
    const fb = withFallbackGlobal(() => rewriteResults(REWRITE_HOSTILE_OVERRIDES));
    expectSameOrDenied(real, fb, null);
  });

  it('rewriteProxyUrl: Azure override works and fixed hosts ignore overrides under the fallback', () => {
    withFallbackGlobal(() => {
      expect(rewriteProxyUrl('azure_openai', 'gpt-4o', false, 'https://x.openai.azure.com'))
        .toBe('https://x.openai.azure.com/v1/chat/completions');
      expect(rewriteProxyUrl('azure_openai', 'gpt-4o', false, 'http://x.openai.azure.com')).toBeNull();
      expect(rewriteProxyUrl('anthropic', 'claude-sonnet-4-6', false, 'https://evil.example'))
        .toBe('https://api.anthropic.com/v1/messages');
    });
  });

  it('matchesChatEndpoint / isChatCompletionsEndpoint: identical results for normal URLs', () => {
    const real = matchResults(CHAT_URLS);
    expect(real.filter((c) => c[1] === true).length).toBeGreaterThan(10);
    expect(withFallbackGlobal(() => matchResults(CHAT_URLS))).toEqual(real);
  });

  it('matchesChatEndpoint: hostile URLs never match where WHATWG would not', () => {
    const real = matchResults(HOSTILE_URLS);
    const fb = withFallbackGlobal(() => matchResults(HOSTILE_URLS));
    expectSameOrDenied(real, fb, false);
  });
});

// ─── Shipped bundle in a bare V8 context ─────────────────────────────────

// The Android asset is what actually ships (synced from dist/mobile.js by
// scripts/sync-mobile-bundle.sh). A fresh vm context has only ECMAScript
// built-ins, like Android's JavaScriptSandbox: no URL, TextEncoder, atob, ...
const SHIPPED_BUNDLE = resolve(__dirname, '../../android/app/src/main/assets/mobile.js');

interface Bridge {
  urlImpl: string;
  rewriteProxyUrl(p: string, m: string, s: boolean, o?: string): string | null;
  isChatEndpoint(p: string, url: string): boolean;
}

describe.skipIf(!existsSync(SHIPPED_BUNDLE))('shipped mobile bundle in a context without Web APIs', () => {
  const source = existsSync(SHIPPED_BUNDLE) ? readFileSync(SHIPPED_BUNDLE, 'utf8') : '';

  function load(globals: Record<string, unknown>): { ctx: vm.Context; bridge: Bridge } {
    const ctx = vm.createContext(globals);
    expect(vm.runInContext("typeof TextEncoder + typeof atob + typeof structuredClone", ctx))
      .toBe('undefinedundefinedundefined');
    vm.runInContext(source, ctx);
    return { ctx, bridge: (ctx as unknown as { BYOKY_TRANSLATE: Bridge }).BYOKY_TRANSLATE };
  }

  it('installs the fallback when URL is missing and routes like core does on Node', () => {
    const { ctx, bridge } = load({});
    expect(bridge.urlImpl).toBe('fallback');
    expect(vm.runInContext('typeof URL', ctx)).toBe('function');

    for (const o of OVERRIDES) {
      for (const id of ['azure_openai', 'anthropic', 'openai', 'gemini', 'cohere', 'groq']) {
        // The bridge maps '' to "no override", as native callers pass ''.
        expect(bridge.rewriteProxyUrl(id, 'gemini-2.5-flash', true, o ?? ''), `${id} ${o}`)
          .toBe(rewriteProxyUrl(id, 'gemini-2.5-flash', true, o || undefined));
      }
    }
    const probes: Array<[string, string, boolean]> = [
      ['anthropic', 'https://api.anthropic.com/v1/messages', true],
      ['openai', 'https://api.openai.com/v1/chat/completions', true],
      ['openai', 'https://api.openai.com/v1/embeddings', false],
      ['gemini', 'https://generativelanguage.googleapis.com/v1beta/models/g:streamGenerateContent?alt=sse', true],
      ['cohere', 'https://api.cohere.com/v2/chat', true],
      ['not-a-provider', 'https://api.cohere.com/v2/chat', false],
      ['openai', 'https://api.openai.com\\@evil.com/v1/chat/completions', false],
    ];
    for (const [p, url, expected] of probes) expect(bridge.isChatEndpoint(p, url), `${p} ${url}`).toBe(expected);
  });

  it('keeps a host-provided URL (e.g. the iOS shim) untouched', () => {
    function HostURL(this: Record<string, string>, input: string) {
      const u = new URL(input);
      this.protocol = u.protocol;
      this.hostname = u.hostname;
      this.pathname = u.pathname;
      this.username = u.username;
      this.password = u.password;
      this.search = u.search;
      this.hash = u.hash;
      this.origin = u.origin;
    }
    const { ctx, bridge } = load({ URL: HostURL });
    expect(bridge.urlImpl).toBe('native');
    expect(vm.runInContext('URL', ctx)).toBe(HostURL);
    expect(bridge.rewriteProxyUrl('azure_openai', 'gpt-4o', false, 'https://x.openai.azure.com'))
      .toBe('https://x.openai.azure.com/v1/chat/completions');
  });
});
