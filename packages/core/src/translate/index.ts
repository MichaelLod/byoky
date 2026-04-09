/**
 * Public API for the byoky translation layer.
 *
 * Activated when a group routes a request to a provider in a different family
 * than the SDK called. Translates the request body, response body, and SSE
 * event stream so the calling app sees its native dialect throughout.
 *
 * Scope: Anthropic Messages ↔ OpenAI Chat Completions only. Other family
 * pairs (gemini, cohere, etc.) are not supported and shouldTranslate will
 * return false for them.
 */

export * from './types.js';
export * from './families.js';
export * from './anthropic-to-openai.js';
export * from './openai-to-anthropic.js';
export * from './responses.js';
export * from './anthropic-to-openai-stream.js';
export * from './openai-to-anthropic-stream.js';
