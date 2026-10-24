/**
 * Minimal, fail-closed stand-in for the WHATWG `URL` class.
 *
 * Why this exists: the mobile bundle runs in JS engines without Web APIs.
 * Android's JavaScriptSandbox is a bare V8 isolate (no `URL`, `TextEncoder`,
 * `atob`, `fetch`, ...). Core uses `new URL()` to decide which host a
 * credential may be sent to (`resolveProviderBaseUrl`, `validateProxyUrl`)
 * and to match chat endpoints; every caller wraps it in try/catch, so without
 * a `URL` global those checks silently deny and cross-provider routing
 * breaks. `mobile-entry.ts` installs this class only when the host has no
 * `URL` at all, so a native or host-provided implementation always wins.
 *
 * Scope: absolute `http:` / `https:` URLs only, read-only, no `base`
 * argument, no `searchParams`. Fields match WHATWG `URL` for every input this
 * class accepts.
 *
 * Fail-closed: the results drive security decisions, so anything WHATWG
 * would normalise, re-encode, or interpret in a surprising way throws a
 * TypeError instead of being reproduced. A throw means "deny" in every
 * caller. Rejected outright:
 *   - any whitespace, control or non-ASCII character (WHATWG strips or
 *     re-encodes these), backslashes (WHATWG treats them as `/`), and
 *     characters it would percent-encode: " < > ` { } ^ |
 *   - malformed percent-escapes anywhere; a `'` in the query
 *   - schemes other than http/https, and a missing `//` after the scheme
 *   - more than one `@`, an empty username, userinfo characters outside
 *     RFC 3986 unreserved / a few sub-delims, more than one `:` in userinfo
 *   - an empty host; host characters outside [a-z0-9.-] (so no
 *     percent-encoding, `_`, or Unicode); empty labels (incl. a trailing
 *     dot); labels starting/ending with `-`; punycode (`xn--`) labels
 *   - hosts that WHATWG would read as an IPv4 number unless they are a
 *     canonical dotted quad (no `0x7f.1`, `0177.0.0.1`, `2130706433`)
 *   - IPv6 literals with embedded IPv4, zone ids, or invalid groups
 *   - ports that are empty, have leading zeros, are 0, or exceed 65535
 *   - `.` / `..` path segments, including percent-encoded forms (`%2e`)
 *
 * The parser deliberately uses ECMAScript built-ins only, so it runs in any
 * engine the bundle runs in.
 */

const DEFAULT_PORTS: Readonly<Record<string, string>> = { 'http:': '80', 'https:': '443' };

const SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):/;
// Characters WHATWG percent-encodes in some component (path, query,
// fragment or userinfo). Refusing them keeps every component byte-identical
// to what WHATWG would produce.
const ENCODE_SET_RE = /["<>`{}^|]/;
const BAD_PERCENT_RE = /%(?![0-9A-Fa-f]{2})/;
const USERINFO_RE = /^[A-Za-z0-9\-._~!$&'()*+,%]*$/;
const HOST_CHARS_RE = /^[a-z0-9.-]+$/;
// WHATWG's "ends in a number" test: such a host is parsed as IPv4, with
// octal, hex and short forms. We only accept the canonical dotted quad.
const NUMERIC_LABEL_RE = /^(?:0x[0-9a-f]*|[0-9]+)$/;
const IPV4_OCTET_RE = /^(?:0|[1-9][0-9]{0,2})$/;
const PORT_RE = /^[1-9][0-9]{0,4}$/;
const DOT_SEGMENT_RE = /^(?:\.|%2e){1,2}$/i;
const IPV6_CHARS_RE = /^[0-9A-Fa-f:]+$/;
const IPV6_GROUP_RE = /^[0-9A-Fa-f]{1,4}$/;

function invalid(reason: string): never {
  // Never echo the input: Gemini keys travel in the query string.
  throw new TypeError(`Invalid URL: ${reason}`);
}

interface ParsedUrl {
  protocol: string;
  username: string;
  password: string;
  hostname: string;
  port: string;
  pathname: string;
  query: string | null;
  fragment: string | null;
}

function parsePort(raw: string, protocol: string): string {
  if (!PORT_RE.test(raw) || Number(raw) > 65535) invalid('bad port');
  return raw === DEFAULT_PORTS[protocol] ? '' : raw;
}

function parseIPv6(s: string): number[] {
  if (!IPV6_CHARS_RE.test(s)) invalid('unsupported IPv6 literal');
  const groups = (part: string): number[] => {
    if (part === '') return [];
    return part.split(':').map((g) => {
      if (!IPV6_GROUP_RE.test(g)) invalid('bad IPv6 group');
      return parseInt(g, 16);
    });
  };
  const dbl = s.indexOf('::');
  if (dbl === -1) {
    const pieces = groups(s);
    if (pieces.length !== 8) invalid('bad IPv6 length');
    return pieces;
  }
  if (s.indexOf('::', dbl + 1) !== -1) invalid('multiple :: in IPv6');
  const head = groups(s.slice(0, dbl));
  const tail = groups(s.slice(dbl + 2));
  // `::` must stand for at least one zero group.
  if (head.length + tail.length > 7) invalid('bad IPv6 length');
  const zeros: number[] = [];
  for (let i = head.length + tail.length; i < 8; i++) zeros.push(0);
  return [...head, ...zeros, ...tail];
}

/** WHATWG IPv6 serializer: lower-case hex, first longest zero run (≥2) as `::`. */
function serializeIPv6(pieces: number[]): string {
  let compress = -1;
  let bestLen = 1;
  for (let i = 0; i < 8; ) {
    if (pieces[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && pieces[j] === 0) j++;
    if (j - i > bestLen) {
      bestLen = j - i;
      compress = i;
    }
    i = j;
  }
  let out = '';
  let ignore0 = false;
  for (let i = 0; i < 8; i++) {
    if (ignore0 && pieces[i] === 0) continue;
    ignore0 = false;
    if (i === compress) {
      out += i === 0 ? '::' : ':';
      ignore0 = true;
      continue;
    }
    out += pieces[i].toString(16);
    if (i !== 7) out += ':';
  }
  return out;
}

function parseDomainOrIPv4(raw: string): string {
  if (raw === '') invalid('empty host');
  const host = raw.toLowerCase();
  if (!HOST_CHARS_RE.test(host)) invalid('unsupported character in host');
  const labels = host.split('.');
  for (const label of labels) {
    if (label === '') invalid('empty host label');
    if (label.length > 63) invalid('host label too long');
    if (label.startsWith('-') || label.endsWith('-')) invalid('hyphen at host label edge');
    if (label.startsWith('xn--')) invalid('punycode host label');
  }
  if (NUMERIC_LABEL_RE.test(labels[labels.length - 1])) {
    const canonical =
      labels.length === 4 && labels.every((l) => IPV4_OCTET_RE.test(l) && Number(l) <= 255);
    if (!canonical) invalid('non-canonical IPv4 host');
  }
  return host;
}

function parse(input: string): ParsedUrl {
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c <= 0x20 || c >= 0x7f) invalid('whitespace, control or non-ASCII character');
  }
  if (input.includes('\\')) invalid('backslash');
  if (ENCODE_SET_RE.test(input)) invalid('character that would be percent-encoded');
  if (BAD_PERCENT_RE.test(input)) invalid('malformed percent-escape');

  const scheme = SCHEME_RE.exec(input);
  if (!scheme) invalid('missing scheme');
  const protocol = `${scheme[1].toLowerCase()}:`;
  if (protocol !== 'http:' && protocol !== 'https:') invalid('unsupported scheme');
  let rest = input.slice(scheme[0].length);
  if (!rest.startsWith('//')) invalid('missing // after scheme');
  rest = rest.slice(2);

  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  let tail = authorityEnd === -1 ? '' : rest.slice(authorityEnd);

  let username = '';
  let password = '';
  let hostPort = authority;
  const at = authority.indexOf('@');
  if (at !== -1) {
    if (authority.indexOf('@', at + 1) !== -1) invalid('multiple @ in authority');
    const userinfo = authority.slice(0, at);
    hostPort = authority.slice(at + 1);
    const colon = userinfo.indexOf(':');
    username = colon === -1 ? userinfo : userinfo.slice(0, colon);
    password = colon === -1 ? '' : userinfo.slice(colon + 1);
    if (username === '') invalid('empty username');
    if (!USERINFO_RE.test(username) || !USERINFO_RE.test(password)) {
      invalid('unsupported character in userinfo');
    }
  }

  let hostname: string;
  let port = '';
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']');
    if (close === -1) invalid('unterminated IPv6 literal');
    hostname = `[${serializeIPv6(parseIPv6(hostPort.slice(1, close)))}]`;
    const after = hostPort.slice(close + 1);
    if (after !== '') {
      if (!after.startsWith(':')) invalid('unexpected text after IPv6 literal');
      port = parsePort(after.slice(1), protocol);
    }
  } else {
    const colon = hostPort.indexOf(':');
    if (colon !== -1) port = parsePort(hostPort.slice(colon + 1), protocol);
    hostname = parseDomainOrIPv4(colon === -1 ? hostPort : hostPort.slice(0, colon));
  }

  let fragment: string | null = null;
  const hashAt = tail.indexOf('#');
  if (hashAt !== -1) {
    fragment = tail.slice(hashAt + 1);
    tail = tail.slice(0, hashAt);
  }
  let query: string | null = null;
  const queryAt = tail.indexOf('?');
  if (queryAt !== -1) {
    query = tail.slice(queryAt + 1);
    tail = tail.slice(0, queryAt);
  }
  // WHATWG percent-encodes `'` in the query of special URLs.
  if (query !== null && query.includes("'")) invalid("' in query");

  const pathname = tail === '' ? '/' : tail;
  for (const segment of pathname.split('/')) {
    if (DOT_SEGMENT_RE.test(segment)) invalid('dot segment in path');
  }

  return { protocol, username, password, hostname, port, pathname, query, fragment };
}

export class FallbackURL {
  readonly href: string;
  readonly origin: string;
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly host: string;
  readonly hostname: string;
  readonly port: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;

  constructor(input: string | FallbackURL, base?: string | FallbackURL) {
    if (base !== undefined) invalid('base URLs are not supported');
    const p = parse(String(input));
    this.protocol = p.protocol;
    this.username = p.username;
    this.password = p.password;
    this.hostname = p.hostname;
    this.port = p.port;
    this.host = p.port ? `${p.hostname}:${p.port}` : p.hostname;
    this.pathname = p.pathname;
    this.search = p.query ? `?${p.query}` : '';
    this.hash = p.fragment ? `#${p.fragment}` : '';
    this.origin = `${p.protocol}//${this.host}`;
    const userinfo =
      p.username || p.password ? `${p.username}${p.password ? `:${p.password}` : ''}@` : '';
    this.href =
      `${p.protocol}//${userinfo}${this.host}${p.pathname}` +
      (p.query !== null ? `?${p.query}` : '') +
      (p.fragment !== null ? `#${p.fragment}` : '');
    Object.freeze(this);
  }

  static canParse(input: string, base?: string): boolean {
    try {
      new FallbackURL(input, base);
      return true;
    } catch {
      return false;
    }
  }

  toString(): string {
    return this.href;
  }

  toJSON(): string {
    return this.href;
  }
}

/**
 * Install {@link FallbackURL} as `URL` on `target` (default `globalThis`)
 * when, and only when, the host has no `URL` at all. Returns true if the
 * fallback was installed. An existing implementation, e.g. the iOS app's
 * Foundation-backed shim or a browser's native URL, is never replaced.
 */
export function installURLFallback(target: object = globalThis): boolean {
  if (typeof (target as { URL?: unknown }).URL !== 'undefined') return false;
  Object.defineProperty(target, 'URL', {
    value: FallbackURL,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  return true;
}
