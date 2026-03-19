/**
 * Translates between Anthropic Messages API format and Claude Code pipe output.
 * Makes setup token responses look identical to API key responses so devs
 * don't need to handle any differences.
 */

import { runClaude, type ClaudeRequest, type ClaudeStreamEvent } from './claude-runner.js';

export interface AnthropicRequest {
  model: string;
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
  max_tokens: number;
  system?: string | Array<{ type: string; text: string }>;
  stream?: boolean;
}

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{ type: 'text'; text: string }>;
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence';
  usage: { input_tokens: number; output_tokens: number };
}

export interface ProxyResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  isStream: boolean;
  streamChunks?: string[];
}

export async function translateRequest(
  request: AnthropicRequest,
  setupToken: string,
): Promise<ProxyResult> {
  // Normalize messages to simple strings
  const messages = request.messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === 'string'
        ? m.content
        : m.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n'),
  }));

  // Normalize system prompt
  let system: string | undefined;
  if (typeof request.system === 'string') {
    system = request.system;
  } else if (Array.isArray(request.system)) {
    system = request.system.map((s) => s.text).join('\n');
  }

  const claudeRequest: ClaudeRequest = {
    model: request.model,
    messages,
    max_tokens: request.max_tokens,
    system,
  };

  const { process: proc, output } = runClaude(claudeRequest, setupToken);

  // Collect the full response
  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  const streamChunks: string[] = [];

  try {
    for await (const event of output) {
      if (event.type === 'assistant' && event.content) {
        fullText += event.content;

        if (request.stream) {
          streamChunks.push(
            buildStreamChunk(event.content, request.model),
          );
        }
      }

      if (event.type === 'result') {
        if (event.result && !fullText) {
          fullText = event.result;
        }
        if (event.tokens) {
          inputTokens = event.tokens.input;
          outputTokens = event.tokens.output;
        }
      }
    }
  } catch {
    // Process may have errored
  }

  // Wait for process to exit
  await new Promise<void>((resolve) => {
    proc.on('close', () => resolve());
    // If already exited
    if (proc.exitCode !== null) resolve();
  });

  if (!fullText && proc.exitCode !== 0) {
    return {
      status: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'error',
        error: {
          type: 'api_error',
          message: 'Claude Code process failed. Is Claude Code installed and is the setup token valid?',
        },
      }),
      isStream: false,
    };
  }

  const responseId = `msg_byoky_${Date.now().toString(36)}`;

  if (request.stream) {
    // Add the final message_stop event
    streamChunks.push(
      buildStreamMessageStart(responseId, request.model),
    );
    streamChunks.push(
      buildStreamContentDelta(fullText),
    );
    streamChunks.push(
      buildStreamMessageDelta(inputTokens, outputTokens),
    );
    streamChunks.push('event: message_stop\ndata: {"type":"message_stop"}\n\n');

    return {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      },
      body: streamChunks.join(''),
      isStream: true,
      streamChunks,
    };
  }

  const response: AnthropicResponse = {
    id: responseId,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: fullText }],
    model: request.model,
    stop_reason: 'end_turn',
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };

  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(response),
    isStream: false,
  };
}

function buildStreamChunk(text: string, _model: string): string {
  const data = {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  };
  return `event: content_block_delta\ndata: ${JSON.stringify(data)}\n\n`;
}

function buildStreamMessageStart(id: string, model: string): string {
  const data = {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  };
  return `event: message_start\ndata: ${JSON.stringify(data)}\n\n`;
}

function buildStreamContentDelta(text: string): string {
  const start = {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  };
  const delta = {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  };
  const stop = {
    type: 'content_block_stop',
    index: 0,
  };
  return (
    `event: content_block_start\ndata: ${JSON.stringify(start)}\n\n` +
    `event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n` +
    `event: content_block_stop\ndata: ${JSON.stringify(stop)}\n\n`
  );
}

function buildStreamMessageDelta(
  inputTokens: number,
  outputTokens: number,
): string {
  const data = {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
  return `event: message_delta\ndata: ${JSON.stringify(data)}\n\n`;
}
