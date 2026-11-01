import { describe, it, expect } from 'vitest';
import { translateRequest, getAdapter } from '../../src/translate/index.js';
import type { TranslationContext } from '../../src/translate/types.js';
import type { ModelFamily } from '../../src/models.js';

/**
 * Documents (PDFs, text) and images returned inside tool results: kept or
 * refused explicitly, never silently dropped.
 */

const DST_MODEL: Record<ModelFamily, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5.4',
  gemini: 'gemini-2.5-pro',
  cohere: 'command-a-03-2025',
};

function ctx(src: ModelFamily, dst: ModelFamily): TranslationContext {
  return { srcFamily: src, dstFamily: dst, srcModel: 'src-model', dstModel: DST_MODEL[dst], isStreaming: false, requestId: 'r1' };
}

const PDF_B64 = 'JVBERi0xLjQK';
const PNG_B64 = 'iVBORw0KGgo=';

const anthropicBody = (content: unknown[]) =>
  JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 100, messages: [{ role: 'user', content }] });

const pdfDoc = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF_B64 }, title: 'contract.pdf' };
const urlDoc = { type: 'document', source: { type: 'url', url: 'https://example.com/a.pdf' } };
const textDoc = { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'Plain notes.' } };

describe('Anthropic documents', () => {
  it('round-trip through the Anthropic adapter, including inside a tool result', () => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [
        { role: 'user', content: [pdfDoc, urlDoc, textDoc, { type: 'text', text: 'Summarize.' }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'fetch', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [pdfDoc] }] },
      ],
    });
    const a = getAdapter('anthropic');
    const out = JSON.parse(a.serializeRequest(ctx('anthropic', 'anthropic'), a.parseRequest(body))) as {
      messages: Array<{ content: unknown }>;
    };
    expect(out.messages[0].content).toEqual([pdfDoc, urlDoc, textDoc, { type: 'text', text: 'Summarize.' }]);
    expect(out.messages[2].content).toEqual([{ type: 'tool_result', tool_use_id: 't1', content: [pdfDoc] }]);
  });

  it('anthropic → gemini sends a PDF inline, a URL document as fileData and text as text', () => {
    const out = JSON.parse(
      translateRequest(ctx('anthropic', 'gemini'), anthropicBody([pdfDoc, urlDoc, textDoc, { type: 'text', text: 'Summarize this contract.' }])),
    );
    expect(out.contents[0].parts).toEqual([
      { inlineData: { mimeType: 'application/pdf', data: PDF_B64 } },
      { fileData: { mimeType: 'application/pdf', fileUri: 'https://example.com/a.pdf' } },
      { text: 'Plain notes.' },
      { text: 'Summarize this contract.' },
    ]);
  });

  it('anthropic → openai sends a PDF as a file part', () => {
    const out = JSON.parse(translateRequest(ctx('anthropic', 'openai'), anthropicBody([pdfDoc, { type: 'text', text: 'Summarize.' }])));
    expect(out.messages[0].content).toEqual([
      { type: 'file', file: { filename: 'contract.pdf', file_data: `data:application/pdf;base64,${PDF_B64}` } },
      { type: 'text', text: 'Summarize.' },
    ]);
  });

  it('anthropic → openai refuses a document by URL', () => {
    expect(() => translateRequest(ctx('anthropic', 'openai'), anthropicBody([urlDoc]))).toThrow(/by URL/);
  });

  it('anthropic → cohere refuses a PDF and keeps a text document', () => {
    expect(() => translateRequest(ctx('anthropic', 'cohere'), anthropicBody([pdfDoc]))).toThrow(/binary documents/);
    const out = JSON.parse(translateRequest(ctx('anthropic', 'cohere'), anthropicBody([textDoc, { type: 'text', text: 'Q' }])));
    expect(out.messages[0]).toEqual({ role: 'user', content: 'Plain notes.\nQ' });
  });
});

describe('images returned by tools', () => {
  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 100,
    messages: [
      { role: 'user', content: 'Take a screenshot.' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'screenshot', input: {} }] },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_B64 } }],
          },
        ],
      },
    ],
  });

  it('anthropic → openai: the tool message notes it, the image follows in a user message', () => {
    const out = JSON.parse(translateRequest(ctx('anthropic', 'openai'), body)) as {
      messages: Array<{ role: string; content: unknown; tool_call_id?: string }>;
    };
    const roles = out.messages.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'tool', 'user']);
    expect(out.messages[2].content).toMatch(/attachments/);
    expect(out.messages[3].content).toEqual([
      { type: 'text', text: 'Attachments from tool call t1:' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_B64}` } },
    ]);
  });

  it('anthropic → cohere: the image follows in a user message', () => {
    const out = JSON.parse(translateRequest(ctx('anthropic', 'cohere'), body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(out.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    expect(JSON.stringify(out.messages[3].content)).toContain(PNG_B64);
  });

  it('anthropic → gemini: the image goes next to the functionResponse', () => {
    const out = JSON.parse(translateRequest(ctx('anthropic', 'gemini'), body));
    expect(out.contents[2].parts).toEqual([
      { functionResponse: { id: 't1', name: 'screenshot', response: { result: '' } } },
      { inlineData: { mimeType: 'image/png', data: PNG_B64 } },
    ]);
  });

  it('keeps the tool text alongside the image', () => {
    const withText = body.replace(
      '"content":[{"type":"image"',
      '"content":[{"type":"text","text":"Saved."},{"type":"image"',
    );
    const out = JSON.parse(translateRequest(ctx('anthropic', 'openai'), withText)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(out.messages[2]).toEqual({ role: 'tool', tool_call_id: 't1', content: 'Saved.' });
  });
});

describe('documents from Gemini and OpenAI apps', () => {
  it('gemini: inline PDF data becomes a document, images stay images', () => {
    const ir = getAdapter('gemini').parseRequest(
      JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: 'application/pdf', data: PDF_B64 } },
              { inlineData: { mimeType: 'image/png', data: PNG_B64 } },
              { fileData: { mimeType: 'application/pdf', fileUri: 'https://example.com/a.pdf' } },
              { fileData: { fileUri: 'https://example.com/cat.jpg' } },
            ],
          },
        ],
      }),
    );
    expect(ir.messages[0].content).toEqual([
      { type: 'document', source: { kind: 'base64', mediaType: 'application/pdf', data: PDF_B64 } },
      { type: 'image', source: { kind: 'base64', mediaType: 'image/png', data: PNG_B64 } },
      { type: 'document', source: { kind: 'url', url: 'https://example.com/a.pdf', mediaType: 'application/pdf' } },
      { type: 'image', source: { kind: 'url', url: 'https://example.com/cat.jpg' } },
    ]);
  });

  it('gemini → anthropic sends an inline PDF as a document', () => {
    const out = JSON.parse(
      translateRequest(
        ctx('gemini', 'anthropic'),
        JSON.stringify({ contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'application/pdf', data: PDF_B64 } }] }] }),
      ),
    );
    expect(out.messages[0].content).toEqual([
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF_B64 } },
    ]);
  });

  it('gemini → anthropic refuses inline audio instead of sending it as an image', () => {
    expect(() =>
      translateRequest(
        ctx('gemini', 'anthropic'),
        JSON.stringify({ contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/mp3', data: 'AAAA' } }] }] }),
      ),
    ).toThrow(/PDF and plain-text documents only/);
  });

  it('openai → anthropic sends a file part as a document', () => {
    const out = JSON.parse(
      translateRequest(
        ctx('openai', 'anthropic'),
        JSON.stringify({
          model: 'gpt-5.5',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'file', file: { filename: 'a.pdf', file_data: `data:application/pdf;base64,${PDF_B64}` } },
                { type: 'text', text: 'Summarize.' },
              ],
            },
          ],
        }),
      ),
    );
    expect(out.messages[0].content).toEqual([
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF_B64 }, title: 'a.pdf' },
      { type: 'text', text: 'Summarize.' },
    ]);
  });
});
