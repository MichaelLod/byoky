# Byoky Enterprise Control Plane

> The control layer for AI spend — identity, budgets, policy, observability and
> settlement for every AI request a company makes, across every provider, on
> every surface. "Okta + Ramp for AI access."

This document describes the enterprise control plane built on top of the Byoky
BYOK wallet: the **vault gateway**, the **console**, and the supporting engine
(LiteLLM), observability (Laminar/OTLP), hot-path state (Redis) and
system-of-record (Postgres).

---

## 1. What it does

Every AI request flows through the Byoky **gateway** (`/v1`), which:

1. **Authenticates** an app/agent/employee via a Byoky-issued key (`byk_live_…`)
   — never a raw provider key.
2. **Enforces policy** (model allow/deny, auto-stop on spend spike, loop detect).
3. **Enforces budgets** ($ caps per team / app / agent / member; block at cap).
4. **Optimizes** (cross-provider cheaper-equivalent routing + response cache).
5. **Unwraps the org's provider key** via KMS envelope encryption and forwards
   to the provider through LiteLLM.
6. **Meters** everything — cost, tokens, latency, verdict, attribution — into a
   durable ledger (Postgres) and an OTLP trace (Laminar), and updates spend
   counters (Redis).

Around that, the **console** gives admins observability, budget/policy editors,
member + key management, a self-serve **access catalog** (employees request AI
access → approval → a scoped key with a budget), billing rollups and an audit
log.

---

## 2. Architecture

```
  Admin / Employee (browser)         packages/console (Next.js, app.byoky.com)
  ──────────────────────────►  OIDC / invite login · observability · budgets ·
                               policies · keys · self-serve access · billing · audit
                                          │  console API (bearer console token)
                                          ▼
  Spenders (apps/agents/employees)  ┌──────────────────────────────────────────┐
   OpenAI SDK / Anthropic SDK /     │  VAULT (Hono/TS, :3100)  — FRONT DOOR      │
   LangChain / @byoky/sdk / curl    │   identity: orgs·teams·members·agents      │
        │  base_url = …/v1          │   auth: OIDC + byk_ keys + console tokens  │
        │  Authorization: byk_…     │   ┌──── /v1 gateway: prepare()→runForward()┐│
        ▼                           │   │ 1 resolve byk key → identity + scope   ││
   POST /v1/chat/completions (OpenAI)│   │ 2 policy → verdict{allow|alert|block}  ││──► LiteLLM ──► providers
   POST /v1/messages     (Anthropic)│   │ 3 budget (Redis) → block@cap 402       ││    (100+, translation,
                                    │   │ 4 optimize: cheaper-equiv + cache      ││     retries/fallback/cache)
   ┌──────────┐  spend/rate/cache   │   │ 5 KMS-unwrap org key → forward         ││
   │  Redis   │◄────────────────────┤   │ 6 meter → ledger + outbox + OTLP span  ││
   └──────────┘                     │   └─────────────┬──────────────────────────┘│
                                    └─────────────────┼───────────────────────────┘
                                    ▼ SQL              ▼ durable outbox     ▼ OTLP (GenAI semconv)
                          Postgres (system-of-record)  usage-consumer →     Laminar (self-host)
                          orgs/teams/members/agents,    request_log +        ClickHouse traces,
                          org_credentials (KMS-wrapped), (ClickHouse OLAP)   search, dashboards
                          budgets, policies, keys,
                          access_*, billing_rollups, audit_log, notifications
                          AWS/local KMS ⇄ per-org DEK
```

The consumer **wallet + relay** (extension/iOS/Android) remains as the
bottoms-up, keys-never-leave-device wedge and the client-side fail-open path.

---

## 3. Components

| Component | Package / infra | Role |
|---|---|---|
| **Vault** | `packages/vault` (Hono/TS) | Front door + enforcement + ledger. Hosts the `/v1` gateway, `/orgs` identity, `/console` admin API. |
| **Gateway** | `vault/src/routes/gateway.ts` | The `/v1` OpenAI- and Anthropic-compatible ingress. `prepare()` (auth→policy→budget→optimize→KMS) + `runForward()` (stream/buffer + meter). |
| **KMS** | `vault/src/kms.ts` | Per-org DEK envelope encryption of provider keys. `local` (dev) or `aws` provider. In-memory DEK cache. |
| **LiteLLM** | `infra/litellm` | Commodity forwarding engine: 100+ providers, translation, retries/fallback/cache. Stateless, keyless (org key injected per request). Swappable. |
| **Laminar** | `infra/laminar` | Self-hosted OTLP observability (traces, search, dashboards) over ClickHouse. Vault emits vendor-neutral OTLP (GenAI semconv). |
| **Redis** | `infra` / any | Hot-path budget + rate counters (atomic), loop-detection windows, response cache. Optional (fail-open if absent). |
| **Postgres** | shared | System-of-record: identity graph, KMS-wrapped credentials, budgets, policies, keys, access layer, `request_log` ledger, billing rollups, audit, notifications. |
| **Console** | `packages/console` (Next.js) | Role-aware admin + employee self-serve UI. |
| **SDK** | `packages/sdk` | `ByokyGateway` / `createGatewayFetch` — drop-in fetch with client-side **fail-open** bypass. |

---

## 4. How companies connect (all sizes)

1. **Base-URL swap (primary, zero code)** — point any OpenAI-compatible client
   at `…/v1` with a `byk_live_…` key. Works with the OpenAI SDK, LangChain,
   Vercel AI SDK, curl. Anthropic SDK users use `POST /v1/messages`. Gemini
   models route through `/v1/chat/completions` by model id.
2. **`@byoky/sdk`** — `new ByokyGateway({ key, baseUrl, failOpen })`; pass
   `byoky.fetch` to any OpenAI-compatible client. Adds **fail-open**: on a
   gateway outage it retries the provider directly with the app's own key.
3. **Relay + on-device wallet** — the consumer/BYOK wedge (keys never leave the
   device) that lands bottoms-up and converts to org-owned keys + gateway.

Admins connect the org's real provider key **once** in the console
(`POST /orgs/credentials`) → it is KMS-sealed and never exposed again; apps only
ever hold a revocable `byk_` key.

---

## 5. Key API surface

**Identity (`/orgs`)** — `POST /orgs` (bootstrap), `POST /orgs/invites` +
`/invites/accept`, `GET/POST /orgs/teams|agents|members`, `DELETE
/orgs/members/:id` (offboard), `POST /orgs/credentials`, `GET /orgs/audit`,
OIDC `GET /orgs/oidc/start|callback`.

**Console (`/console`, member/RBAC-gated)** — `keys` (mint/list/revoke),
`budgets`, `policies`, `pricing`/`equivalence`, `usage` + `usage/rollup`,
`access/catalog|requests|grants/:id/key|approval-rules`, `access/my`,
`notifications`, `billing` + `billing/run`.

**Gateway (`/v1`)** — `POST /v1/chat/completions` (OpenAI), `POST /v1/messages`
(Anthropic). Auth: `Authorization: Bearer byk_live_…`.

**RBAC roles:** owner, admin, finance, security, member (see `vault/src/rbac.ts`).

---

## 6. Running locally

```bash
# 1. infra
docker compose -f infra/litellm/docker-compose.yml up -d     # LiteLLM (mock models)
docker compose -f infra/laminar/docker-compose.yml up -d     # Laminar + ClickHouse (optional)
docker run -d --name byoky-redis -p 6379:6379 redis:7-alpine # Redis
# Postgres: any local instance; create a db and point DATABASE_URL at it.

# 2. schema (fresh db) — drizzle push creates all tables; the boot migration
#    runner then applies the incremental SQL in packages/vault/migrations.
cd packages/vault && pnpm exec drizzle-kit push

# 3. run the vault
DATABASE_URL=postgres://user@127.0.0.1:5432/byoky \
JWT_SECRET=<32+ chars> VAULT_WRAP_SECRET=<32+ chars> \
REDIS_URL=redis://127.0.0.1:6379 \
LITELLM_BASE_URL=http://127.0.0.1:4000 LITELLM_MASTER_KEY=sk-byoky-internal \
PORT=3111 node dist/server.js        # (after `pnpm build`)

# 4. run the console
cd packages/console && NEXT_PUBLIC_VAULT_URL=http://localhost:3111 pnpm dev

# 5. smoke test the whole control plane
node scripts/smoke-control-plane.mjs   # 28 checks, exit 0 = all pass
```

### Environment reference (vault)
| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (required) |
| `JWT_SECRET` | Signs console + session tokens (≥32 chars, required) |
| `VAULT_WRAP_SECRET` / `KMS_MASTER_KEY` | Local KMS master key (or HKDF source) |
| `KMS_PROVIDER` / `KMS_KEY_ID` | `aws` for AWS KMS (default `local`) |
| `REDIS_URL` | Hot-path counters + cache (optional; fail-open if unset) |
| `LITELLM_BASE_URL` / `LITELLM_MASTER_KEY` | Forwarding engine |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP traces → Laminar/collector (optional) |
| `CLICKHOUSE_URL` / `CLICKHOUSE_USER` / `_PASSWORD` | OLAP fan-out (optional) |
| `PRICING_FEED_URL` | External price feed (falls back to core table) |
| `OIDC_ISSUER` / `_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` | SSO (optional) |
| `SLACK_WEBHOOK_URL` | Notification delivery (optional) |
| `RATE_LIMIT_MAX` | Per-IP requests/min (default 60) |
| `PLATFORM_FEE_PER_SEAT_USD` / `MANAGED_SPEND_BPS` | Billing model (default $20 / 200bps) |

---

## 7. Request lifecycle (gateway)

`prepare(c)` → `{respond}` (block/cache/error) **or** `{ctx}`:
auth (byk key) → key scope → policy verdict → budget pre-check (Redis) →
cheaper-equivalent + cache lookup → KMS-open org credential.
`runForward(c, ctx, {path, usageProvider, injectUsage})`:
forward to LiteLLM → stream SSE or buffer → parse usage (openai|anthropic) →
`finish()` meters: awaited budget increment, rate/cache, ledger row +
durable outbox event + OTLP span. Fail-open: LiteLLM outage → 503
`GATEWAY_DEGRADED` so the SDK bypasses to the provider.

---

## 8. Verified capabilities (smoke test)

`scripts/smoke-control-plane.mjs` asserts 28 behaviours end-to-end: org
bootstrap, KMS-sealed credentials, RBAC, byk keys, OpenAI + Anthropic + Gemini
routing, key scoping, streaming, policy block, budget block@cap, arbitrage,
caching, self-serve access + eligibility + approvals + notifications, budget
visibility, offboarding (instant revoke), observability rollup, billing rollup,
audit log.

Unit tests: `@byoky/core` (pricing, policy), `@byoky/sdk` (gateway fail-open).

---

## 9. Production readiness

**Hardened + verified locally:**
- **DB-enforced tenant isolation (RLS).** All org tables have `FORCE ROW LEVEL
  SECURITY` with a policy keyed on the `byoky.current_org` GUC set per request
  by `runWithOrg()`. The app connects as a **non-superuser** role (`byoky_app`)
  so RLS applies. Cross-org reads *and* writes are blocked at the database even
  if an app-layer `WHERE org_id` is ever missing. (`scripts/test-tenant-isolation.mjs`
  + a DB-level proof.) DDL runs as owner in a deploy step (`RUN_MIGRATIONS=false`).
- **Budget enforcement — concurrency-safe, zero overspend.** Each request
  **atomically reserves** an upper-bound cost estimate (`max_tokens`-bounded, so
  est ≥ actual) against every scoped budget via a single Redis check-and-increment
  Lua script, then **reconciles the reservation down to the real cost** after the
  response. Because the check-and-increment is one atomic op, no two concurrent
  requests can both slip past the cap. A load test (40 concurrent against a $1.00
  cap) confirmed **0 overspend** — the earlier recorded-spend approach allowed
  ~2× overspend under the same load.
- **PII/secret redaction on prompt capture.** Prompt content is stored **only**
  when a scoped budget opts in via `log_prompts`, and even then only a short,
  redacted preview — emails, API keys/tokens, JWTs, AWS keys, SSNs, cards, and
  phone numbers are stripped before truncation (`@byoky/core/redact.ts`, 8 unit
  tests). Verified e2e (`scripts/test-prompt-redaction.mjs`): opt-out →
  `prompt_preview` NULL; opt-in → populated but with no raw secret in the ledger.
- **Redis-outage resilience (fail-open).** ioredis is configured to fast-fail on
  the hot path during an outage (`enableOfflineQueue:false`, `maxRetriesPerRequest:1`)
  so proxied requests degrade to fail-open instead of hanging, while a background
  retry reconnects. A chaos test (kill Redis mid-traffic) confirmed the gateway
  keeps serving (~21ms) and auto-recovers on restart.
- **AWS KMS envelope encryption** exercised against LocalStack — create key →
  wrap the per-org DEK via KMS → roundtrip open → a tampered DEK is rejected.
- **OIDC SSO verified against a real IdP (Dex).** Full authorization-code flow:
  admin invites by email → user logs in at Dex → the vault verifies the id_token
  against Dex's JWKS → **auto-provisions the member with the invited role** (JML
  "joiner", decision #20) → issues a console token → RBAC is enforced for that
  role → a second login resolves the same member by the bound IdP subject (no
  duplicate). Cross-org email collisions return 409 rather than provisioning to
  the wrong tenant. (`infra/dex/`, `scripts/test-oidc-sso.mjs`, 9/0.)
- **Load/throughput** — 1000 requests @ concurrency 64 sustained 311 req/s,
  p99 524ms, 0 5xx (against LiteLLM mocks).
- **Durable-outbox exactly-once under crash.** Usage events flow through a
  Postgres `usage_outbox` drained by a consumer (claim → deliver to ClickHouse →
  mark processed). A chaos test (`scripts/test-outbox-exactly-once.mjs`) injects
  a crash between deliver and mark: the batch is re-delivered on restart
  (at-least-once), but the id-keyed ClickHouse ReplacingMergeTree sink dedups →
  **0 lost, 0 double-counted** (700 deliveries of 500 events → sink = 500,
  every event marked processed exactly once).
- **Fail-fast config validation** (`config.ts`) — refuses to boot on missing
  `DATABASE_URL`, weak `JWT_SECRET`, or bad KMS config; warns on dev-looking
  secrets / missing `TRUST_PROXY` in production.
- **Health/readiness** — `GET /healthz` (liveness), `GET /readyz` (DB + Redis).
- **Graceful shutdown** — SIGTERM/SIGINT stop the listener, flush telemetry,
  close Redis, with an 8s hard cap.
- **Configurable rate limit** (`RATE_LIMIT_MAX`, default 60/min per IP).
- **CI** (`.github/workflows/control-plane.yml`) — typecheck + unit tests, and a
  full e2e job (Postgres + Redis + LiteLLM) running the smoke + isolation suites
  against a real vault under the limited role with RLS on.

**Real-provider integration — verified live.** Requests flowed through the entire
stack to Google Gemini (`gemini-2.5-flash`): `byk_` auth → policy → atomic budget
reservation → **KMS-unseal the real org key** → LiteLLM → Google → usage parsed →
priced → reconciled → ledger. Verified live, not against mocks:
- **Non-stream:** real answer, 17 in / 790 out → computed `cost_usd=$0.00198`,
  4.5s, attributed with verdict `allow`.
- **Streaming:** real SSE (`text/event-stream`), assembled the streamed text,
  first byte ~1.35s, usage parsed from the stream tail and metered (14/34 tok).
- **Budget block:** 6 concurrent requests against a $0.0025 cap → exactly 2
  allowed / 4 blocked with `402 BUDGET_EXCEEDED`; the atomic reservation kept real
  spend under the cap and the blocked calls never reached the provider ($0).
  (Reservation is a *concurrency* guard; sequential calls reconcile to actual, so
  the cap binds on recorded-spend + in-flight estimate — never on stale reserves.)

**Not yet production-ready (needs external resources or further work):**
- Long-duration soak / multi-provider live load (single live call verified;
  throughput/chaos done against LiteLLM mocks).
- Managed AWS KMS + a hosted IdP in production (both proven locally — KMS on
  LocalStack, OIDC on Dex); SAML + SCIM auto-deprovision.
- Org-level *default* `failMode` (per-budget open/closed is done + verified:
  a `failMode:'open'` budget serves past its cap, `closed`/default blocks 402);
  only a global org default is unimplemented.
- Multi-consumer outbox HA is correct-but-redundant (idempotent-sink dedup); a
  claim/lease column + reaper would make batches disjoint if that overhead matters.
- Stripe collection; HA / multi-region; secrets rotation; SOC 2 controls.

## 10. Deferred / roadmap
SAML + SCIM (SCIM deprovision reuses offboard); Stripe collection (rollups →
invoices); "Byoky Pay" settlement rail; DB-enforced RLS activation; Gemini-native
`:generateContent` protocol; content/DLP policy; per-org negotiated pricing;
cross-customer benchmarking; multi-region/HA.

See `/Users/m/.claude/plans/great-now-i-want-delightful-parrot.md` for the full
design + decision log.
