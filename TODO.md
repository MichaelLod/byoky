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

### Add Gemini family + translator

- Google AI Studio / Generative Language API (`generateContent` /
  `streamGenerateContent`) is the third major frontier provider with a stable
  documented chat surface.
- Different shape from OpenAI/Anthropic: `contents[].parts[]`, `model` role,
  top-level `systemInstruction`, `tools[].functionDeclarations`,
  `generationConfig`, `safetySettings`.
- Different streaming format: chunked array of `GenerateContentResponse` JSON
  objects, sometimes wrapped in SSE depending on endpoint.
- Worth doing as part of the canonical-IR refactor (see below) so the third
  family doesn't trigger an N² translator explosion.

### Add Cohere v2 family + translator

- Cohere `/v2/chat`. Closer to OpenAI shape than Gemini but still its own
  thing: distinct streaming SSE event names (`message-start`, `content-delta`,
  `tool-call-start`, etc.), `parameter_definitions` instead of `parameters` on
  tools.
- Smaller user base than Gemini but real, especially for enterprise.

### Refactor pairwise translators to canonical IR

- Current architecture has hand-written translators for each (src, dst) pair
  (`anthropic-to-openai.ts`, `openai-to-anthropic.ts`, etc.). For 2 families
  that's manageable; for ≥3 families it explodes (4 families = 12 directed
  pairs, each with 4 surfaces = 48 functions).
- Right move before adding Gemini/Cohere: introduce a normalized internal
  request/response IR and rewrite each family as `family ↔ canonical`. With
  N families that's N translators instead of N(N-1).
- Existing live tests should stay green throughout the refactor as the
  regression net.

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

### Vault integration test failure

- `packages/vault/tests/integration.test.ts` fails on every dev run because
  it requires `DATABASE_URL` for the Railway Postgres. Either add a `.skipIf`
  guard or document the required env var in the vault package's README.
