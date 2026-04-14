# byoky TODO

Tracked deferrals and follow-ups. Living document — add to it freely; remove
items when they ship or are explicitly dropped.

---

## Provider support — currently removed

These providers were removed from the registry in 0.5.0 because their inference
APIs cannot be translated through the canonical chat-completions surface, and
the byoky pitch ("drag any app between any provider") is misleading when a
provider can't actually participate in cross-family routing.

### Replicate

- **Why removed:** Every model on Replicate has its own `input` schema. There
  is no shared chat format. Some models are text→text, some image→text, some
  diffusion (text→image), some TTS, some video. The endpoint shape is
  `POST /v1/predictions { version, input }` with model-specific fields.
- **What it'd take to bring back:** Per-model adapters. Each Replicate model we
  want to support would need its own translation entry that maps from the
  canonical chat shape to that model's specific input schema and back. That's
  not a translation feature — it's a model registry with hand-rolled adapters,
  closer to what LangChain or Replicate's own client does.
- **Status:** Out of scope until there's clear user demand AND a finite set of
  Replicate models worth supporting. If we do bring it back, it should ship as
  its own subsystem (`packages/core/src/replicate-adapters/`) rather than
  pretending to be a generic translation target.

### HuggingFace Inference API

- **Why removed:** The general HF Inference API at
  `api-inference.huggingface.co` is per-model — same problem as Replicate. Each
  model has its own inference schema (text-generation has `inputs` + per-task
  `parameters`, classification has different shape, etc.). No unified chat
  surface across the catalog.
- **Workaround for users who want HF:** HuggingFace runs a separate
  OpenAI-compatible router at `https://router.huggingface.co/v1/chat/completions`
  for serverless inference of certain models. A user with HF credentials can
  point a custom OpenAI-family provider at that URL and it works as a
  drop-in OpenAI-compatible provider.
- **Status:** Possible quick re-add — register a new `huggingface_router`
  provider entry pointing at the HF chat router URL and put it in the OpenAI
  family. No translator code needed. **Defer until user asks.**

---

## Translation layer — phase 2 follow-ups

_Shipped in 0.5.0 — canonical IR refactor + Gemini and Cohere adapters._
See `packages/core/src/translate/ir.ts`, `adapter.ts`, and `adapters/*.ts`.
Full 4-family cross-product (12 directed pairs) is now supported via a single
`FamilyAdapter` interface; each new family is one file and one line in
`index.ts` to register. Live tests cover openai↔anthropic (pre-existing),
anthropic↔gemini (new), gemini→openai (new), and openai↔cohere (new, requires
`COHERE_API_KEY`).

**Cohere tool schema trivia**: older docs and blog tutorials show v1's
`parameter_definitions` shape. **Cohere v2 uses OpenAI-style `parameters`**
(JSON Schema wrapped in `function: { parameters }`). Don't regress back to v1
if you extend the cohere adapter.

---

## Mobile apps — separate codebase, separate cleanup

The iOS and Android apps still list Replicate and HuggingFace in their
provider arrays:

- `packages/ios/Byoky/Models/Credential.swift` — Provider entries
- `packages/android/app/src/main/java/com/byoky/app/data/Models.kt` — Provider
  entries

These are managed through the mobile release scripts, not edited from this
session. When the next mobile release goes out, remove those entries to keep
the mobile and extension provider sets consistent.

---

## Popup polish — phase 2.5

### Surface `actualModel` and `actualProviderId` in the request log UI

- Phase 2 now records both the source-requested model and the destination model
  on every translated request (`RequestLogEntry.actualModel`,
  `actualProviderId`, `groupId`). The popup logs the data but the UI doesn't
  display it.
- A user looking at their request log should be able to see "this app called
  Anthropic but byoky routed it to OpenAI's gpt-5.4." That's the entire
  user-facing point of cross-family routing.
- Small UI change in the request log view in the popup. Could ship as part of
  0.5.0 or 0.5.1.

### Make `model` required (not "optional") on cross-family groups

- The group form's "Default model (optional)" hint is misleading. For
  cross-family routing it's actually required — without a destination model,
  `resolveCrossFamilyRoute` refuses to set up translation and falls through to
  the source's own credential.
- Either: (a) update the hint to say it's required when group provider differs
  from typical app providers, or (b) enforce it client-side at group save
  time when the group's provider doesn't match the user's other connected
  apps. Option (b) is harder to get right because byoky doesn't know in
  advance which providers an app will request.

---

## Misc

### Add `huggingface_router` as an OpenAI-compatible provider

- See "HuggingFace Inference API" above.
- Trivial: one new entry in `PROVIDERS` with
  `baseUrl: 'https://router.huggingface.co'` and put `huggingface_router` in
  `OPENAI_FAMILY` in `families.ts`.
- Defer until user asks.

### Add Perplexity / other minor OpenAI-compatible providers

- Perplexity is already in `OPENAI_FAMILY` and works.
- Other small OpenAI-compatible providers can be added with a one-line entry
  if requested.

### Five mobile version-bump files

- Per the previous session handover, there were 5 mobile version-bump files
  sitting in working tree from a half-finished release. They appear to have
  been resolved out of band — they're not in the current dev tree. If they
  resurface, route them through `scripts/release.sh` rather than committing
  them by hand.

### Vault integration test — hermetic DB option

- `packages/vault/tests/integration.test.ts` is an integration test against
  live Railway Postgres via `DATABASE_URL` in `.env.local`. It has
  `describe.skipIf(!DATABASE_URL)` and `vitest.setup.env.ts` auto-loads the
  env, so it runs on every dev machine that has the env set and cleanly
  skips otherwise. No action needed today.
- **Possible future improvement**: swap the real-DB dependency for
  testcontainers (ephemeral Postgres in Docker) so the test is hermetic and
  doesn't couple dev runs to the production DB.
