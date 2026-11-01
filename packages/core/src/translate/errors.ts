import type { IRError } from './ir.js';

/**
 * Error types across dialects. A translated error keeps its HTTP status,
 * and its type is put in the app's dialect, read from that status first
 * (an SDK raises by status, an app may branch on the type), then from the
 * upstream's own type when the status isn't known (a mid-stream error).
 *
 * Sources, checked 2026-11-01:
 *  - Anthropic: platform.claude.com/docs/en/api/errors ("HTTP errors").
 *  - OpenAI: developers.openai.com/api/docs/guides/error-codes
 *    (invalid_request_error for a 400, rate_limit_error for a 429,
 *    service_unavailable_error for a 503, insufficient_quota for billing);
 *    a 401 answers invalid_request_error (live) and a 500 server_error.
 *  - Gemini: google.rpc canonical codes and their HTTP statuses
 *    (google.aip.dev/193), as in ai.google.dev/gemini-api/docs/troubleshooting.
 */

const ANTHROPIC_TYPE_STATUS: Record<string, number> = {
  invalid_request_error: 400,
  authentication_error: 401,
  billing_error: 402,
  permission_error: 403,
  not_found_error: 404,
  conflict_error: 409,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  timeout_error: 504,
  overloaded_error: 529,
};

const OPENAI_TYPE_STATUS: Record<string, number> = {
  invalid_request_error: 400,
  insufficient_quota: 429,
  rate_limit_error: 429,
  server_error: 500,
  service_unavailable_error: 503,
};

const GEMINI_STATUS_HTTP: Record<string, number> = {
  INVALID_ARGUMENT: 400,
  FAILED_PRECONDITION: 400,
  OUT_OF_RANGE: 400,
  UNAUTHENTICATED: 401,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  ABORTED: 409,
  ALREADY_EXISTS: 409,
  RESOURCE_EXHAUSTED: 429,
  CANCELLED: 499,
  UNKNOWN: 500,
  INTERNAL: 500,
  DATA_LOSS: 500,
  UNIMPLEMENTED: 501,
  UNAVAILABLE: 503,
  DEADLINE_EXCEEDED: 504,
};

const GEMINI_HTTP_STATUS: Record<number, string> = {
  400: 'INVALID_ARGUMENT',
  401: 'UNAUTHENTICATED',
  403: 'PERMISSION_DENIED',
  404: 'NOT_FOUND',
  409: 'ABORTED',
  429: 'RESOURCE_EXHAUSTED',
  499: 'CANCELLED',
  500: 'INTERNAL',
  501: 'UNIMPLEMENTED',
  503: 'UNAVAILABLE',
  504: 'DEADLINE_EXCEEDED',
  // Anthropic's "overloaded".
  529: 'UNAVAILABLE',
};

const own = (table: object, key: string) => Object.prototype.hasOwnProperty.call(table, key);

/** An HTTP error status, or undefined for anything else. */
function httpErrorStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599 ? value : undefined;
}

/**
 * The HTTP status of an error: the one it came with, else the one its type
 * stands for in any dialect, else undefined.
 */
export function errorStatus(error: IRError): number | undefined {
  const status = httpErrorStatus(error.status);
  if (status !== undefined) return status;
  const type = error.type;
  if (own(ANTHROPIC_TYPE_STATUS, type)) return ANTHROPIC_TYPE_STATUS[type];
  if (own(OPENAI_TYPE_STATUS, type)) return OPENAI_TYPE_STATUS[type];
  if (own(GEMINI_STATUS_HTTP, type)) return GEMINI_STATUS_HTTP[type];
  return undefined;
}

/** `error.type` for an Anthropic app. */
export function anthropicErrorType(error: IRError): string {
  const status = errorStatus(error);
  switch (status) {
    case undefined:
      return 'api_error';
    case 400: return 'invalid_request_error';
    case 401: return 'authentication_error';
    case 402: return 'billing_error';
    case 403: return 'permission_error';
    case 404: return 'not_found_error';
    case 409: return 'conflict_error';
    case 413: return 'request_too_large';
    case 429: return 'rate_limit_error';
    case 504: return 'timeout_error';
    // A provider out of capacity (Gemini's UNAVAILABLE, OpenAI's
    // server_is_overloaded) is what overloaded_error describes.
    case 503:
    case 529: return 'overloaded_error';
    default:
      // "invalid_request_error ... may also be used for other 4XX status codes".
      return status < 500 ? 'invalid_request_error' : 'api_error';
  }
}

/** `error.type` for an OpenAI app. */
export function openaiErrorType(error: IRError): string {
  const status = errorStatus(error);
  if (status === undefined) return 'server_error';
  if (status === 429) return 'rate_limit_error';
  if (status === 503 || status === 529) return 'service_unavailable_error';
  return status < 500 ? 'invalid_request_error' : 'server_error';
}

/**
 * `error.code` for an OpenAI app: OpenAI's codes are names
 * (invalid_api_key, rate_limit_exceeded, ...), so a bare number (Gemini's
 * HTTP status) is left out.
 */
export function openaiErrorCode(error: IRError): string | null {
  return error.code && !/^\d+$/.test(error.code) ? error.code : null;
}

/** `error.code` (the HTTP status) and `error.status` for a Gemini app. */
export function geminiError(error: IRError): { code: number; status: string } {
  const status = errorStatus(error) ?? 500;
  return {
    code: status,
    status: GEMINI_HTTP_STATUS[status] ?? (status < 500 ? 'INVALID_ARGUMENT' : 'INTERNAL'),
  };
}
