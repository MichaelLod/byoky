import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseGeneratedFiles,
  parseDescription,
  parseMiniappHtml,
  generateApp,
} from '../app/dev/generator';

/* ─── parseGeneratedFiles ───────────────────────── */

describe('parseGeneratedFiles', () => {
  it('parses a single file', () => {
    const input = '<file path="package.json">\n{"name": "test"}\n</file>';
    const result = parseGeneratedFiles(input);
    expect(result).toEqual({ 'package.json': '{"name": "test"}' });
  });

  it('parses multiple files', () => {
    const input = [
      '<file path="package.json">',
      '{"name": "test"}',
      '</file>',
      '',
      '<file path="src/app/page.tsx">',
      "export default function Page() { return <div>Hello</div>; }",
      '</file>',
    ].join('\n');
    const result = parseGeneratedFiles(input);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['package.json']).toBe('{"name": "test"}');
    expect(result['src/app/page.tsx']).toContain('Hello');
  });

  it('returns empty object for no matches', () => {
    expect(parseGeneratedFiles('no files here')).toEqual({});
    expect(parseGeneratedFiles('')).toEqual({});
  });
});

/* ─── parseDescription ──────────────────────────── */

describe('parseDescription', () => {
  it('extracts description from tags', () => {
    const input = '<description>A chat application.</description>';
    expect(parseDescription(input)).toBe('A chat application.');
  });

  it('trims whitespace', () => {
    const input = '<description>  spaced out  </description>';
    expect(parseDescription(input)).toBe('spaced out');
  });

  it('returns default when no description tag', () => {
    expect(parseDescription('no description here')).toBe('Generated application');
    expect(parseDescription('')).toBe('Generated application');
  });
});

/* ─── parseMiniappHtml ──────────────────────────── */

describe('parseMiniappHtml', () => {
  it('extracts miniapp HTML from tags', () => {
    const input = '<miniapp>\n<!DOCTYPE html><html></html>\n</miniapp>';
    expect(parseMiniappHtml(input)).toBe('<!DOCTYPE html><html></html>');
  });

  it('returns null when no miniapp tag', () => {
    expect(parseMiniappHtml('no miniapp here')).toBeNull();
    expect(parseMiniappHtml('')).toBeNull();
  });
});

/* ─── generateApp ────────────────────────────────── */

describe('generateApp', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  function mockStreamResponse(text: string): Response {
    const encoder = new TextEncoder();
    const chunks = [
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`,
      'data: [DONE]\n\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  }

  it('calls the Anthropic API with correct params', async () => {
    const responseText = '<description>Test app</description>\n<miniapp>\n<!DOCTYPE html><html><body>hello</body></html>\n</miniapp>';
    mockFetch.mockResolvedValue(mockStreamResponse(responseText));

    await generateApp(mockFetch as typeof fetch, 'Build a chat miniapp');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body);
    expect(body.model).toBe('claude-sonnet-4-20250514');
    expect(body.max_tokens).toBe(12000);
    expect(body.stream).toBe(true);
    expect(body.system).toBeUndefined();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toContain('Build a chat miniapp');
    expect(body.messages[0].content).toContain('User request:');
  });

  it('returns parsed html and description', async () => {
    const responseText = '<description>A chat miniapp</description>\n<miniapp>\n<!DOCTYPE html><html><body>chat</body></html>\n</miniapp>';
    mockFetch.mockResolvedValue(mockStreamResponse(responseText));

    const result = await generateApp(mockFetch as typeof fetch, 'Build a chat miniapp');

    expect(result.description).toBe('A chat miniapp');
    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).toContain('chat');
  });

  it('includes previous messages for iteration', async () => {
    const responseText = '<description>Updated</description>\n<miniapp>\n<!DOCTYPE html><html><body>blue</body></html>\n</miniapp>';
    mockFetch.mockResolvedValue(mockStreamResponse(responseText));

    await generateApp(mockFetch as typeof fetch, 'Make it blue', [
      { role: 'user', content: 'Build a chat miniapp' },
      { role: 'assistant', content: 'Here is your miniapp...' },
    ]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0].content).toBe('Build a chat miniapp');
    expect(body.messages[1].content).toBe('Here is your miniapp...');
    expect(body.messages[2].content).toBe('Make it blue');
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValue(new Response('Rate limited', { status: 429 }));

    await expect(generateApp(mockFetch as typeof fetch, 'test')).rejects.toThrow('API request failed (429)');
  });

  it('throws when no miniapp HTML in response', async () => {
    const responseText = 'Here is some text but no miniapp tags';
    mockFetch.mockResolvedValue(mockStreamResponse(responseText));

    await expect(generateApp(mockFetch as typeof fetch, 'test')).rejects.toThrow('No miniapp HTML found');
  });

  it('handles multiple SSE chunks', async () => {
    const encoder = new TextEncoder();
    const part1 = '<description>Test</description>\n<miniapp>\n<!DOCTYPE html><html><body>con';
    const part2 = 'tent here</body></html>\n</miniapp>';
    const chunks = [
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: part1 } })}\n\n`,
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: part2 } })}\n\n`,
      'data: [DONE]\n\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    mockFetch.mockResolvedValue(new Response(stream, { status: 200 }));

    const result = await generateApp(mockFetch as typeof fetch, 'test');
    expect(result.html).toContain('content here');
  });

  it('handles non-streaming response (no body reader)', async () => {
    const json = {
      content: [{ text: '<description>Test</description>\n<miniapp>\n<!DOCTYPE html><html></html>\n</miniapp>' }],
    };
    const res = new Response(JSON.stringify(json), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    Object.defineProperty(res, 'body', { value: null });
    mockFetch.mockResolvedValue(res);

    const result = await generateApp(mockFetch as typeof fetch, 'test');
    expect(result.html).toContain('<!DOCTYPE html>');
  });
});
