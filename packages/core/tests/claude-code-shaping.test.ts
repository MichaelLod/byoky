/**
 * Setup-token (OAuth) request shaping: what decides whether Anthropic takes a
 * setup-token request as Claude Code, and how it is billed. background.ts
 * and the bridge run these on every setup-token request; the iOS and Android
 * wallets run the same functions from the bundled mobile.js.
 */
import { describe, it, expect } from 'vitest';
import {
  buildHeaders,
  createToolNameSSERewriter,
  injectClaudeCodeSystemPrompt,
  rewriteToolNamesForClaudeCode,
} from '../src/proxy-utils.js';
import shapingVectors from './vectors/claude-code-shaping.json';

const PREFIX = "You are Claude Code, Anthropic's official CLI for Claude.";
const OAUTH_BETAS = [
  'claude-code-20250219',
  'oauth-2025-04-20',
  'fine-grained-tool-streaming-2025-05-14',
  'interleaved-thinking-2025-05-14',
];

function parse(body: string | undefined): Record<string, unknown> {
  expect(body).toBeTypeOf('string');
  return JSON.parse(body!) as Record<string, unknown>;
}

// ── context-1m strip in buildHeaders ─────────────────────

describe('buildHeaders — context-1m-2025-08-07 is never forwarded to Anthropic', () => {
  // context-1m bills every request as long context, and Pro/Max plans and
  // basic API keys answer it with a 400.
  for (const authMethod of ['api_key', 'oauth'] as const) {
    describe(authMethod, () => {
      it('drops it when it is the only beta', () => {
        const h = buildHeaders('anthropic', { 'anthropic-beta': 'context-1m-2025-08-07' }, 'k', authMethod);
        expect(h['anthropic-beta'] ?? '').not.toContain('context-1m');
      });

      it('keeps the other betas next to it', () => {
        const h = buildHeaders(
          'anthropic',
          { 'anthropic-beta': 'prompt-caching-2024-07-31,context-1m-2025-08-07,tools-2024-04-04' },
          'k',
          authMethod,
        );
        const betas = h['anthropic-beta'].split(',');
        expect(betas).not.toContain('context-1m-2025-08-07');
        expect(betas).toContain('prompt-caching-2024-07-31');
        expect(betas).toContain('tools-2024-04-04');
      });

      it('matches it with surrounding whitespace and a mixed-case header name', () => {
        const h = buildHeaders(
          'anthropic',
          { 'Anthropic-Beta': ' context-1m-2025-08-07 , tools-2024-04-04 ' },
          'k',
          authMethod,
        );
        expect(h['anthropic-beta']).not.toContain('context-1m');
        expect(h['anthropic-beta'].split(',')).toContain('tools-2024-04-04');
      });
    });
  }

  it('api_key: deletes the header when nothing else is left', () => {
    const h = buildHeaders('anthropic', { 'anthropic-beta': 'context-1m-2025-08-07' }, 'sk-ant-api03-k', 'api_key');
    expect(h).not.toHaveProperty('anthropic-beta');
    expect(h['x-api-key']).toBe('sk-ant-api03-k');
  });

  it('api_key: deletes the header when it held only separators', () => {
    const h = buildHeaders('anthropic', { 'anthropic-beta': ' , ' }, 'k', 'api_key');
    expect(h).not.toHaveProperty('anthropic-beta');
  });

  it('oauth: only the Claude Code betas remain when context-1m was alone', () => {
    const h = buildHeaders('anthropic', { 'anthropic-beta': 'context-1m-2025-08-07' }, 'sk-ant-oat01-t', 'oauth');
    expect(h['anthropic-beta']).toBe(OAUTH_BETAS.join(','));
  });

  it('oauth: app betas come first, then the Claude Code betas, without duplicates', () => {
    const h = buildHeaders(
      'anthropic',
      { 'anthropic-beta': 'context-1m-2025-08-07,tools-2024-04-04,oauth-2025-04-20' },
      'sk-ant-oat01-t',
      'oauth',
    );
    expect(h['anthropic-beta']).toBe(
      ['tools-2024-04-04', 'oauth-2025-04-20', ...OAUTH_BETAS.filter((b) => b !== 'oauth-2025-04-20')].join(','),
    );
  });

  it('oauth: matches the iOS and Android header vector', () => {
    const h = buildHeaders(
      'anthropic',
      { 'anthropic-beta': 'context-1m-2025-08-07,tools-2024-04-04', 'content-type': 'application/json' },
      'sk-ant-oat01-T',
      'oauth',
    );
    expect(h).toEqual({
      'content-type': 'application/json',
      'anthropic-beta': ['tools-2024-04-04', ...OAUTH_BETAS].join(','),
      authorization: 'Bearer sk-ant-oat01-T',
      'user-agent': 'claude-cli/2.1.316',
      'x-app': 'cli',
      accept: 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
  });
});

// ── injectClaudeCodeSystemPrompt ─────────────────────────

describe('injectClaudeCodeSystemPrompt — prefix mode (Claude Code CLI traffic)', () => {
  it('adds the prefix as the system prompt when there is none', () => {
    const out = parse(injectClaudeCodeSystemPrompt(JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })));
    expect(out.system).toBe(PREFIX);
    expect(out.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('puts the prefix in front of a string system prompt', () => {
    const out = parse(injectClaudeCodeSystemPrompt(JSON.stringify({ system: 'Be terse.', messages: [] })));
    expect(out.system).toBe(`${PREFIX}\n\nBe terse.`);
  });

  it('adds a prefix text block in front of a block-array system prompt', () => {
    const blocks = [{ type: 'text', text: 'A', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'B' }];
    const out = parse(injectClaudeCodeSystemPrompt(JSON.stringify({ system: blocks, messages: [] })));
    expect(out.system).toEqual([{ type: 'text', text: PREFIX }, ...blocks]);
  });

  it('treats an empty string system prompt as missing', () => {
    const out = parse(injectClaudeCodeSystemPrompt(JSON.stringify({ system: '', messages: [] })));
    expect(out.system).toBe(PREFIX);
  });

  it('leaves the messages alone', () => {
    const messages = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }];
    const out = parse(injectClaudeCodeSystemPrompt(JSON.stringify({ system: 'S', messages })));
    expect(out.messages).toEqual(messages);
  });
});

describe('injectClaudeCodeSystemPrompt — relocate mode (third-party frameworks)', () => {
  const relocate = { relocateExisting: true };

  it('keeps only the prefix in system and moves the original into the first user message (string content)', () => {
    const out = parse(injectClaudeCodeSystemPrompt(
      JSON.stringify({ system: 'Framework prompt', messages: [{ role: 'user', content: 'hi' }] }),
      relocate,
    ));
    expect(out.system).toBe(PREFIX);
    expect(out.messages).toEqual([
      { role: 'user', content: '<system_context>\nFramework prompt\n</system_context>\n\nhi' },
    ]);
  });

  it('adds the context as a leading text block for block-array user content', () => {
    const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } };
    const out = parse(injectClaudeCodeSystemPrompt(
      JSON.stringify({ system: 'Sys', messages: [{ role: 'user', content: [{ type: 'text', text: 'look' }, image] }] }),
      relocate,
    ));
    expect(out.system).toBe(PREFIX);
    expect(out.messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: '<system_context>\nSys\n</system_context>\n\n' }, { type: 'text', text: 'look' }, image],
      },
    ]);
  });

  it('joins the text blocks of a block-array system prompt and skips the rest', () => {
    const out = parse(injectClaudeCodeSystemPrompt(
      JSON.stringify({
        system: [{ type: 'text', text: 'A' }, { type: 'image', source: {} }, 'B', { type: 'text', text: '' }],
        messages: [{ role: 'user', content: 'hi' }],
      }),
      relocate,
    ));
    expect((out.messages as Array<{ content: string }>)[0].content).toBe('<system_context>\nA\n\nB\n</system_context>\n\nhi');
  });

  it('only touches the first message, and only when it is a user message', () => {
    const messages = [{ role: 'assistant', content: 'earlier' }, { role: 'user', content: 'hi' }];
    const out = parse(injectClaudeCodeSystemPrompt(JSON.stringify({ system: 'Sys', messages }), relocate));
    expect(out.system).toBe(PREFIX);
    expect(out.messages).toEqual(messages);
  });

  it('sets the bare prefix when there is no system prompt to move', () => {
    const messages = [{ role: 'user', content: 'hi' }];
    const out = parse(injectClaudeCodeSystemPrompt(JSON.stringify({ messages }), relocate));
    expect(out.system).toBe(PREFIX);
    expect(out.messages).toEqual(messages);
  });
});

describe('injectClaudeCodeSystemPrompt — input it cannot shape passes through', () => {
  it.each([
    ['undefined', undefined],
    ['an empty body', ''],
    ['invalid JSON', '{"model":'],
    ['plain text', 'not json'],
  ])('%s', (_label, body) => {
    expect(injectClaudeCodeSystemPrompt(body)).toBe(body);
    expect(injectClaudeCodeSystemPrompt(body, { relocateExisting: true })).toBe(body);
  });
});

// ── rewriteToolNamesForClaudeCode ────────────────────────

describe('rewriteToolNamesForClaudeCode', () => {
  it('renames snake_case, kebab-case and camelCase tools to PascalCase and returns alias → original', () => {
    const body = JSON.stringify({
      tools: [
        { name: 'read_file', input_schema: { type: 'object' } },
        { name: 'web-search', input_schema: { type: 'object' } },
        { name: 'getWeather', input_schema: { type: 'object' } },
        { name: 'Bash', input_schema: { type: 'object' } },
      ],
      messages: [{ role: 'user', content: 'hi' }],
    });
    const { body: out, toolNameMap } = rewriteToolNamesForClaudeCode(body);
    const parsed = parse(out);
    expect((parsed.tools as Array<{ name: string }>).map((t) => t.name)).toEqual(['ReadFile', 'WebSearch', 'GetWeather', 'Bash']);
    expect(toolNameMap).toEqual({ ReadFile: 'read_file', WebSearch: 'web-search', GetWeather: 'getWeather', Bash: 'Bash' });
    // Everything except the names is kept.
    expect((parsed.tools as Array<{ input_schema: unknown }>)[0].input_schema).toEqual({ type: 'object' });
  });

  it('renames past tool_use blocks so the history matches tools[], and leaves tool_result alone', () => {
    const history = [
      { role: 'user', content: 'weather?' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'checking' },
          { type: 'tool_use', id: 't1', name: 'get_weather', input: { city: 'Vienna' } },
          { type: 'tool_use', id: 't2', name: 'unknown_tool', input: {} },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'sunny' }] },
    ];
    const { body: out } = rewriteToolNamesForClaudeCode(JSON.stringify({ tools: [{ name: 'get_weather' }], messages: history }));
    const messages = parse(out).messages as Array<{ content: unknown }>;
    expect(messages[0]).toEqual(history[0]);
    expect(messages[1].content).toEqual([
      { type: 'text', text: 'checking' },
      { type: 'tool_use', id: 't1', name: 'GetWeather', input: { city: 'Vienna' } },
      // Not in tools[], so it has no alias.
      { type: 'tool_use', id: 't2', name: 'unknown_tool', input: {} },
    ]);
    expect(messages[2]).toEqual(history[2]);
  });

  it('renames the tool a forced tool_choice names, so it still matches tools[]', () => {
    const { body: out } = rewriteToolNamesForClaudeCode(JSON.stringify({
      tools: [{ name: 'get_weather' }, { name: 'read_file' }],
      tool_choice: { type: 'tool', name: 'get_weather', disable_parallel_tool_use: true },
      messages: [],
    }));
    expect(parse(out).tool_choice).toEqual({ type: 'tool', name: 'GetWeather', disable_parallel_tool_use: true });
  });

  it.each([
    ['auto', { type: 'auto' }],
    ['any', { type: 'any' }],
    ['none', { type: 'none' }],
    ['a tool that is not in tools[]', { type: 'tool', name: 'other_tool' }],
  ])('leaves tool_choice %s alone', (_label, toolChoice) => {
    const { body: out } = rewriteToolNamesForClaudeCode(JSON.stringify({
      tools: [{ name: 'get_weather' }],
      tool_choice: toolChoice,
      messages: [],
    }));
    expect(parse(out).tool_choice).toEqual(toolChoice);
  });

  it('gives colliding names distinct aliases that map back to each original', () => {
    const { body: out, toolNameMap } = rewriteToolNamesForClaudeCode(JSON.stringify({
      tools: [{ name: 'read_file' }, { name: 'read-file' }, { name: 'ReadFile' }],
      messages: [],
    }));
    const aliases = (parse(out).tools as Array<{ name: string }>).map((t) => t.name);
    expect(new Set(aliases).size).toBe(3);
    for (const alias of aliases) expect(alias).toMatch(/^[A-Z][A-Za-z0-9]*$/);
    expect(aliases.map((a) => toolNameMap[a])).toEqual(['read_file', 'read-file', 'ReadFile']);
  });

  it('maps a duplicated tool name to one alias', () => {
    const { body: out, toolNameMap } = rewriteToolNamesForClaudeCode(JSON.stringify({
      tools: [{ name: 'read_file' }, { name: 'read_file' }],
      messages: [],
    }));
    expect((parse(out).tools as Array<{ name: string }>).map((t) => t.name)).toEqual(['ReadFile', 'ReadFile']);
    expect(toolNameMap).toEqual({ ReadFile: 'read_file' });
  });

  it('is a no-op (same string, empty map) when every tool is already PascalCase', () => {
    const body = JSON.stringify({ tools: [{ name: 'Read' }, { name: 'Bash' }, { name: 'WebFetch2' }], messages: [] });
    expect(rewriteToolNamesForClaudeCode(body)).toEqual({ body, toolNameMap: {} });
  });

  it.each([
    ['undefined', undefined],
    ['invalid JSON', '{"tools":['],
    ['no tools', JSON.stringify({ messages: [] })],
    ['an empty tools array', JSON.stringify({ tools: [], messages: [] })],
    ['tools that is not an array', JSON.stringify({ tools: { name: 'read_file' } })],
  ])('passes %s through with an empty map', (_label, body) => {
    expect(rewriteToolNamesForClaudeCode(body)).toEqual({ body, toolNameMap: {} });
  });
});

// ── createToolNameSSERewriter ────────────────────────────

describe('createToolNameSSERewriter', () => {
  const MAP = { GetWeather: 'get_weather' };
  const toolStart = (name: string) =>
    `event: content_block_start\ndata: ${JSON.stringify({
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'toolu_1', name, input: {} },
    })}\n\n`;
  const textDelta =
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"GetWeather is a tool"}}\n\n';

  it('rewrites the tool name in content_block_start frames back to the original', () => {
    const r = createToolNameSSERewriter(MAP);
    const out = r.process(toolStart('GetWeather')) + r.flush();
    expect(out).toBe(toolStart('get_weather'));
  });

  it('leaves other frames byte-for-byte alone, even when they mention an alias', () => {
    const r = createToolNameSSERewriter(MAP);
    const ping = 'event: ping\ndata: {"type": "ping"}\n\n';
    const otherTool = toolStart('Bash');
    expect(r.process(textDelta + ping + otherTool)).toBe(textDelta + ping + otherTool);
  });

  it('reassembles a frame split across chunks, at every split point', () => {
    const stream = textDelta + toolStart('GetWeather') + textDelta;
    const expected = textDelta + toolStart('get_weather') + textDelta;
    for (let i = 1; i < stream.length; i++) {
      const r = createToolNameSSERewriter(MAP);
      const out = r.process(stream.slice(0, i)) + r.process(stream.slice(i)) + r.flush();
      expect(out, `split at ${i}`).toBe(expected);
    }
  });

  it('holds back an unterminated frame until the next chunk, and flush() returns what is left', () => {
    const r = createToolNameSSERewriter(MAP);
    const tail = 'event: message_stop\ndata: {"type":"message_stop"}';
    expect(r.process(textDelta + tail)).toBe(textDelta);
    expect(r.flush()).toBe(tail);
    expect(r.flush()).toBe('');
  });

  it('passes frames through when the data is not JSON', () => {
    const r = createToolNameSSERewriter(MAP);
    const frame = 'event: content_block_start\ndata: {not json\n\n';
    expect(r.process(frame)).toBe(frame);
  });

  it('is an unbuffered passthrough with an empty map', () => {
    const r = createToolNameSSERewriter({});
    const half = toolStart('GetWeather').slice(0, 30);
    expect(r.process(half)).toBe(half);
    expect(r.flush()).toBe('');
  });
});

// ── End to end, as background.ts uses them ───────────────

describe('setup-token shaping round trip', () => {
  it('renames tools, relocates the framework prompt, and undoes the rename in the stream', () => {
    const request = JSON.stringify({
      model: 'claude-sonnet-4-6',
      system: 'You are OpenClaw.',
      tools: [{ name: 'read_file', input_schema: { type: 'object' } }],
      messages: [{ role: 'user', content: 'open README' }],
    });
    const { body: renamed, toolNameMap } = rewriteToolNamesForClaudeCode(request);
    const shaped = parse(injectClaudeCodeSystemPrompt(renamed, { relocateExisting: Object.keys(toolNameMap).length > 0 }));
    expect(shaped.system).toBe(PREFIX);
    expect(shaped.tools).toEqual([{ name: 'ReadFile', input_schema: { type: 'object' } }]);
    expect(shaped.messages).toEqual([
      { role: 'user', content: '<system_context>\nYou are OpenClaw.\n</system_context>\n\nopen README' },
    ]);

    const r = createToolNameSSERewriter(toolNameMap);
    const frame = `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t","name":"ReadFile","input":{}}}\n\n`;
    const out = r.process(frame.slice(0, 50)) + r.process(frame.slice(50)) + r.flush();
    expect(out).toContain('"name":"read_file"');
    expect(out).not.toContain('ReadFile');
  });
});

// ── Shared vectors (also run by the iOS and Android wallets) ──

describe('vectors/claude-code-shaping.json', () => {
  const { body, headers } = shapingVectors as {
    body: Array<{ name: string; body: string; expected: string; toolNameMap: Record<string, string> }>;
    headers: Array<{ name: string; authMethod: string; apiKey: string; headers: Record<string, string>; expected: Record<string, string> }>;
  };

  function asJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  it.each(body.map((v) => [v.name, v] as const))('body: %s', (_name, v) => {
    // background.ts: relocate only for third-party requests (tools renamed).
    const { body: renamed, toolNameMap } = rewriteToolNamesForClaudeCode(v.body);
    const shaped = injectClaudeCodeSystemPrompt(renamed, { relocateExisting: Object.keys(toolNameMap).length > 0 });
    expect(toolNameMap).toEqual(v.toolNameMap);
    expect(asJson(shaped!)).toEqual(asJson(v.expected));
  });

  it.each(headers.map((v) => [v.name, v] as const))('headers: %s', (_name, v) => {
    expect(buildHeaders('anthropic', v.headers, v.apiKey, v.authMethod)).toEqual(v.expected);
  });
});
