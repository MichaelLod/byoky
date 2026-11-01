// Replaces fetch for the release-script tests: `node --import <this file>`.
//
// FETCH_STUB_ROUTES: a JSON file with an array of routes,
//   { "method": "GET", "url": "<regex>", "status": 200, "body": {...} }
//   or, for polling, "sequence": [{ "status": ..., "body": ... }, ...]: each
//   call takes the next entry and the last one repeats.
//   "networkError": "<message>" makes fetch reject, as on a dropped connection.
// The first route whose method and URL regex match answers. Unmatched
// requests get a 500, so a test sees them in the log and in the exit code.
// FETCH_STUB_LOG: every request is appended there as a JSON line.

import { readFileSync, appendFileSync } from 'node:fs'

const routes = JSON.parse(readFileSync(process.env.FETCH_STUB_ROUTES, 'utf8'))
const calls = new Map()

globalThis.fetch = async (input, init = {}) => {
  const url = String(input)
  const method = (init.method ?? 'GET').toUpperCase()
  const body = typeof init.body === 'string' ? init.body : undefined
  if (process.env.FETCH_STUB_LOG) {
    appendFileSync(process.env.FETCH_STUB_LOG, JSON.stringify({ method, url, body }) + '\n')
  }
  const index = routes.findIndex((r) => (r.method ?? 'GET') === method && new RegExp(r.url).test(url))
  if (index < 0) {
    return new Response(JSON.stringify({ errors: [{ detail: `unmatched ${method} ${url}` }] }), { status: 500 })
  }
  const route = routes[index]
  let reply = route
  if (route.sequence) {
    const n = calls.get(index) ?? 0
    calls.set(index, n + 1)
    reply = route.sequence[Math.min(n, route.sequence.length - 1)]
  }
  if (reply.networkError) throw new TypeError(reply.networkError)
  const status = reply.status ?? 200
  const text = reply.body === undefined ? '' : typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)
  return new Response(status === 204 ? null : text, { status })
}
