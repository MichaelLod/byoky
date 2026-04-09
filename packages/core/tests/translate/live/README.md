# Live translation tests

These tests hit real provider APIs (Anthropic and OpenAI) to verify the
translation layer works end-to-end against actual production responses, not
just hand-crafted fixtures.

## Running

Set the relevant API keys and run the live test script:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
pnpm test:live
```

Tests automatically skip when their corresponding key is missing — running
`pnpm test:live` with no keys set produces a clean skip-only run, not a
failure.

## Cost

Each full run costs roughly $0.005 (Anthropic Haiku + OpenAI nano, very short
prompts). Don't run on every commit; run when you've changed translator code
or when validating a release.

## Why these are not in `pnpm test`

The default test suite must be hermetic, fast, and free. Live tests require
network and cost real money. They are excluded from `vitest.config.ts`'s
include pattern and only run via `pnpm test:live`.

## What's tested

For each direction (Anthropic→OpenAI and OpenAI→Anthropic):

- Non-streaming chat: simple text → real API → response translated back to
  the source dialect, verified for shape correctness
- Streaming chat: SSE response chunks fed through the stream translator,
  reassembled and verified
- Tool use round-trip: tool definitions translated, real API call, tool_call
  blocks in the translated response are verified to match the source dialect
  shape
