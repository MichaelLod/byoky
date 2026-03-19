/**
 * Spawns and manages Claude Code CLI processes.
 * Uses `claude -p --output-format stream-json` to pipe requests through
 * Claude Code's own authentication, which accepts setup tokens.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';

export interface ClaudeRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  system?: string;
}

export interface ClaudeStreamEvent {
  type: string;
  result?: string;
  message?: {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function runClaude(
  request: ClaudeRequest,
  setupToken: string,
): { process: ChildProcess; output: AsyncIterable<ClaudeStreamEvent> } {
  // Build the prompt from messages
  // claude -p accepts a single prompt string — we format the conversation
  const prompt = formatMessagesAsPrompt(request);

  const args = ['-p', '--output-format', 'stream-json', '--verbose'];

  // Resolve the absolute path to `claude` since native messaging hosts
  // run with a minimal PATH that may not include homebrew/nvm/etc.
  let claudePath = 'claude';
  try {
    claudePath = execSync('which claude', { encoding: 'utf-8', env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` } }).trim();
  } catch { /* fallback to bare name */ }

  const proc = spawn(claudePath, args, {
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
