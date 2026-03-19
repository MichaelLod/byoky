/**
 * Spawns and manages Claude Code CLI processes.
 * Uses `claude -p --output-format stream-json` to pipe requests through
 * Claude Code's own authentication, which accepts setup tokens.
 */

import { spawn, type ChildProcess } from 'node:child_process';

export interface ClaudeRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  system?: string;
}

export interface ClaudeStreamEvent {
  type: string;
  content?: string;
  result?: string;
  cost_usd?: number;
  duration_ms?: number;
  tokens?: { input: number; output: number };
}

export function runClaude(
  request: ClaudeRequest,
  setupToken: string,
): { process: ChildProcess; output: AsyncIterable<ClaudeStreamEvent> } {
  // Build the prompt from messages
  // claude -p accepts a single prompt string — we format the conversation
  const prompt = formatMessagesAsPrompt(request);

  const args = ['-p', '--output-format', 'stream-json'];

  if (request.max_tokens) {
    args.push('--max-tokens', String(request.max_tokens));
  }

  if (request.model) {
    args.push('--model', request.model);
  }

  const proc = spawn('claude', args, {
    env: {
      ...process.env,
      ANTHROPIC_AUTH_TOKEN: setupToken,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Write the prompt to stdin
  proc.stdin.write(prompt);
  proc.stdin.end();

  const output = streamEvents(proc);

  return { process: proc, output };
}

function formatMessagesAsPrompt(request: ClaudeRequest): string {
  const parts: string[] = [];

  if (request.system) {
    parts.push(`[System: ${request.system}]`);
  }

  for (const msg of request.messages) {
    if (msg.role === 'user') {
      parts.push(msg.content);
    } else if (msg.role === 'assistant') {
      parts.push(`[Previous assistant response: ${msg.content}]`);
    }
  }

  // The last user message is the main prompt
  return parts.join('\n\n');
}

async function* streamEvents(
  proc: ChildProcess,
): AsyncIterable<ClaudeStreamEvent> {
  if (!proc.stdout) return;

  let buffer = '';

  for await (const chunk of proc.stdout) {
    buffer += chunk.toString();

    // Stream JSON outputs one JSON object per line
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        yield JSON.parse(trimmed) as ClaudeStreamEvent;
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Handle remaining buffer
  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer.trim()) as ClaudeStreamEvent;
    } catch {
      // Skip
    }
  }
}
