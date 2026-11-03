import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { translateRequest, getAdapter } from '../../src/translate/index.js';
import type { TranslationContext } from '../../src/translate/types.js';
import { MODELS, getModel, type ModelEntry, type ModelFamily } from '../../src/models.js';

/**
 * Documents (PDFs, text) and images returned inside tool results: kept,
 * refused explicitly, or (inside a tool result, which the app resends every
 * turn) named in the tool text. Never silently dropped.
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
  // Every OpenAI model in the registry takes images, so a text-only one is
  // added for these tests.
  const TEXT_ONLY = 'text-only-test-model';
  const textOnly: ModelEntry = {
    ...getModel('gpt-5.4')!,
    id: TEXT_ONLY,
    displayName: 'Text-only test model',
    capabilities: { ...getModel('gpt-5.4')!.capabilities, vision: false },
  };
  beforeAll(() => { MODELS.push(textOnly); });
  afterAll(() => { MODELS.splice(MODELS.indexOf(textOnly), 1); });

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

  it('anthropic → cohere (vision model): the image follows in a user message', () => {
    const out = JSON.parse(
      translateRequest({ ...ctx('anthropic', 'cohere'), dstModel: 'command-a-vision-07-2025' }, body),
    ) as { messages: Array<{ role: string; content: unknown }> };
    expect(out.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    expect(JSON.stringify(out.messages[3].content)).toContain(PNG_B64);
  });

  it('anthropic → cohere (command-a-03-2025, text-only): the tool text names the image, none is sent', () => {
    const withText = body.replace(
      '"content":[{"type":"image"',
      '"content":[{"type":"text","text":"Saved."},{"type":"image"',
    );
    const out = JSON.parse(translateRequest(ctx('anthropic', 'cohere'), withText)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(out.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(out.messages[2]).toEqual({
      role: 'tool',
      tool_call_id: 't1',
      content: 'Saved.\n[image omitted: command-a-03-2025 does not accept images]',
    });
    expect(JSON.stringify(out)).not.toContain(PNG_B64);
  });

  it('anthropic → cohere: a Cohere id missing from the registry is judged by name', () => {
    const out = JSON.parse(
      translateRequest({ ...ctx('anthropic', 'cohere'), dstModel: 'command-r-plus-08-2024' }, body),
    ) as { messages: Array<{ role: string; content: unknown }> };
    expect(out.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(out.messages[2].content).toBe('[image omitted: command-r-plus-08-2024 does not accept images]');
  });

  it('anthropic → openai (text-only registry model): the tool text names the image, none is sent', () => {
    const out = JSON.parse(translateRequest({ ...ctx('anthropic', 'openai'), dstModel: TEXT_ONLY }, body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(out.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(out.messages[2].content).toBe(`[image omitted: ${TEXT_ONLY} does not accept images]`);
    expect(JSON.stringify(out)).not.toContain(PNG_B64);
  });

  it('anthropic → openai (gpt-5.4-nano): the image is sent', () => {
    const out = JSON.parse(translateRequest({ ...ctx('anthropic', 'openai'), dstModel: 'gpt-5.4-nano' }, body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(out.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    expect(JSON.stringify(out.messages[3].content)).toContain(PNG_B64);
  });

  it('anthropic → openai (model missing from the registry): the image is sent', () => {
    const out = JSON.parse(translateRequest({ ...ctx('anthropic', 'openai'), dstModel: 'some-host-model' }, body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(out.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    expect(JSON.stringify(out.messages[3].content)).toContain(PNG_B64);
  });

  // R2-02: an id the registry doesn't know takes images by default only on
  // OpenAI and Azure; the other hosts of the dialect answer a 400.
  const toHost = (dstProviderId: string, dstModel: string) =>
    JSON.parse(translateRequest({ ...ctx('anthropic', 'openai'), dstProviderId, dstModel }, body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };

  it('anthropic → openai-dialect host: the image is sent to an unknown OpenAI or Azure model', () => {
    for (const [host, model] of [['openai', 'gpt-6-preview'], ['azure_openai', 'my-deployment']]) {
      const out = toHost(host, model);
      expect(out.messages.map((m) => m.role), host).toEqual(['user', 'assistant', 'tool', 'user']);
      expect(JSON.stringify(out.messages[3].content), host).toContain(PNG_B64);
    }
  });

  it('anthropic → deepseek (deepseek-chat): the tool text names the image, none is sent', () => {
    const out = toHost('deepseek', 'deepseek-chat');
    expect(out.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(out.messages[2].content).toBe('[image omitted: deepseek-chat does not accept images]');
    expect(JSON.stringify(out)).not.toContain(PNG_B64);
  });

  it('anthropic → other openai-dialect hosts: an unknown model gets no image', () => {
    for (const [host, model] of [
      ['groq', 'some-new-groq-model'],
      ['together', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'],
      ['fireworks', 'accounts/fireworks/models/llama-v3p1-8b-instruct'],
      ['mistral', 'mistral-large-latest'],
      ['ollama', 'llama3.1'],
      ['lm_studio', 'qwen'],
      ['openrouter', 'deepseek/deepseek-chat'],
    ]) {
      const out = toHost(host, model);
      expect(out.messages.map((m) => m.role), host).toEqual(['user', 'assistant', 'tool']);
      expect(out.messages[2].content, host).toBe(`[image omitted: ${model} does not accept images]`);
      expect(JSON.stringify(out), host).not.toContain(PNG_B64);
    }
  });

  it('anthropic → openrouter: OpenAI models under their openai/ name use the registry', () => {
    const out = toHost('openrouter', 'openai/gpt-5.5');
    expect(out.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    expect(JSON.stringify(out.messages[3].content)).toContain(PNG_B64);
    expect(toHost('openrouter', `openai/${TEXT_ONLY}`).messages[2].content).toBe(
      `[image omitted: openai/${TEXT_ONLY} does not accept images]`,
    );
  });

  it('anthropic → any host: the registry answer wins over the host default', () => {
    expect(toHost('openai', TEXT_ONLY).messages[2].content).toBe(`[image omitted: ${TEXT_ONLY} does not accept images]`);
    expect(JSON.stringify(toHost('groq', 'gpt-5.5').messages[3].content)).toContain(PNG_B64);
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

describe('documents returned by tools', () => {
  const toolBody = (doc: unknown) =>
    JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [
        { role: 'user', content: 'Read the contract.' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [doc] }] },
      ],
    });

  it('anthropic → openai: a PDF follows in a user message as a file part', () => {
    const out = JSON.parse(translateRequest(ctx('anthropic', 'openai'), toolBody(pdfDoc))) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(out.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    expect(out.messages[3].content).toEqual([
      { type: 'text', text: 'Attachments from tool call t1:' },
      { type: 'file', file: { filename: 'contract.pdf', file_data: `data:application/pdf;base64,${PDF_B64}` } },
    ]);
  });

  it('anthropic → deepseek: a PDF is named in the tool text, no file part is sent (R2-02)', () => {
    const out = JSON.parse(
      translateRequest({ ...ctx('anthropic', 'openai'), dstProviderId: 'deepseek', dstModel: 'deepseek-chat' }, toolBody(pdfDoc)),
    ) as { messages: Array<{ role: string; content: unknown }> };
    expect(out.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(out.messages[2].content).toBe('[document omitted: deepseek-chat does not accept files]');
    expect(JSON.stringify(out)).not.toContain(PDF_B64);
  });

  it('anthropic → openai: a document by URL is named in the tool text instead of failing', () => {
    const out = JSON.parse(translateRequest(ctx('anthropic', 'openai'), toolBody(urlDoc))) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(out.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(out.messages[2].content).toMatch(/document omitted: .*by URL/);
  });

  it('anthropic → cohere: a PDF is named in the tool text instead of failing', () => {
    const out = JSON.parse(translateRequest(ctx('anthropic', 'cohere'), toolBody(pdfDoc))) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(out.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(out.messages[2].content).toMatch(/document omitted: Cohere does not accept PDF/);
    expect(JSON.stringify(out)).not.toContain(PDF_B64);
  });

  it('anthropic → cohere: a text document stays in the tool text', () => {
    const out = JSON.parse(translateRequest(ctx('anthropic', 'cohere'), toolBody(textDoc))) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(out.messages[2].content).toBe('Plain notes.');
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

describe('attachments the parsers cannot carry are refused, never dropped', () => {
  const openaiBody = (content: unknown[]) => JSON.stringify({ model: 'gpt-5.5', messages: [{ role: 'user', content }] });
  const audio = { type: 'input_audio', input_audio: { data: 'UklGRg==', format: 'wav' } };

  it('openai → gemini sends input_audio as inline audio', () => {
    const out = JSON.parse(translateRequest(ctx('openai', 'gemini'), openaiBody([audio, { type: 'text', text: 'transcribe' }])));
    expect(out.contents[0].parts).toEqual([{ inlineData: { mimeType: 'audio/wav', data: 'UklGRg==' } }, { text: 'transcribe' }]);
    const mp3 = JSON.parse(
      translateRequest(ctx('openai', 'gemini'), openaiBody([{ type: 'input_audio', input_audio: { data: 'SUQz', format: 'mp3' } }])),
    );
    expect(mp3.contents[0].parts).toEqual([{ inlineData: { mimeType: 'audio/mpeg', data: 'SUQz' } }]);
  });

  it('openai → anthropic and → cohere refuse input_audio', () => {
    expect(() => translateRequest(ctx('openai', 'anthropic'), openaiBody([audio, { type: 'text', text: 't' }]))).toThrow(
      /PDF and plain-text documents only/,
    );
    expect(() => translateRequest(ctx('openai', 'cohere'), openaiBody([audio, { type: 'text', text: 't' }]))).toThrow(/binary documents/);
  });

  it('gemini → openai sends WAV or MP3 audio as input_audio, and refuses other audio', () => {
    const body = (mimeType: string) =>
      JSON.stringify({ contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: 'AAAA' } }, { text: 'transcribe' }] }] });
    const out = JSON.parse(translateRequest(ctx('gemini', 'openai'), body('audio/wav')));
    expect(out.messages[0].content).toEqual([
      { type: 'input_audio', input_audio: { data: 'AAAA', format: 'wav' } },
      { type: 'text', text: 'transcribe' },
    ]);
    expect(JSON.parse(translateRequest(ctx('gemini', 'openai'), body('audio/mp3'))).messages[0].content[0]).toEqual({
      type: 'input_audio',
      input_audio: { data: 'AAAA', format: 'mp3' },
    });
    expect(() => translateRequest(ctx('gemini', 'openai'), body('audio/ogg'))).toThrow(/WAV and MP3 audio only/);
  });

  it('openai: a file part naming a file_id is refused', () => {
    for (const dst of ['anthropic', 'gemini', 'cohere'] as const) {
      expect(() =>
        translateRequest(ctx('openai', dst), openaiBody([{ type: 'file', file: { file_id: 'file-abc' } }, { type: 'text', text: 'summarize' }])),
      ).toThrow(/file_id/);
    }
  });

  it('openai: an image_url that is no URL or base64 data is refused', () => {
    expect(() =>
      translateRequest(ctx('openai', 'anthropic'), openaiBody([{ type: 'image_url', image_url: { url: 'ftp://x/cat.png' } }])),
    ).toThrow(/image_url/);
  });

  it('anthropic: Files API image and document sources are refused toward OpenAI and Gemini', () => {
    const image = { type: 'image', source: { type: 'file', file_id: 'file_1' } };
    const doc = { type: 'document', source: { type: 'file', file_id: 'file_2' } };
    for (const dst of ['openai', 'gemini'] as const) {
      expect(() => translateRequest(ctx('anthropic', dst), anthropicBody([image, { type: 'text', text: 'what is this' }]))).toThrow(
        /Files API/,
      );
      expect(() => translateRequest(ctx('anthropic', dst), anthropicBody([doc, { type: 'text', text: 'summarize' }]))).toThrow(/Files API/);
    }
  });

  it('anthropic: an unknown or malformed source is refused', () => {
    expect(() =>
      translateRequest(ctx('anthropic', 'openai'), anthropicBody([{ type: 'image', source: { type: 'base64', data: PNG_B64 } }])),
    ).toThrow(/malformed base64 source/);
    expect(() => translateRequest(ctx('anthropic', 'gemini'), anthropicBody([{ type: 'image' }]))).toThrow(/no valid source/);
    expect(() =>
      translateRequest(ctx('anthropic', 'gemini'), anthropicBody([{ type: 'document', source: { type: 'weird' } }])),
    ).toThrow(/source type weird/);
  });

  it('anthropic: a custom-content document of text becomes a text document', () => {
    const doc = { type: 'document', source: { type: 'content', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } };
    const out = JSON.parse(translateRequest(ctx('anthropic', 'gemini'), anthropicBody([doc, { type: 'text', text: 'summarize' }])));
    expect(out.contents[0].parts).toEqual([{ text: 'a\nb' }, { text: 'summarize' }]);
  });
});
