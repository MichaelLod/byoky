"use strict";
var BYOKY_TRANSLATE_BUNDLE = (() => {
  // src/translate/adapter.ts
  var ADAPTERS = /* @__PURE__ */ new Map();
  function registerAdapter(adapter) {
    ADAPTERS.set(adapter.family, adapter);
  }
  function getAdapter(family) {
    const adapter = ADAPTERS.get(family);
    if (!adapter) {
      throw new Error(`No translation adapter registered for family: ${family}`);
    }
    return adapter;
  }
  function hasAdapter(family) {
    return ADAPTERS.has(family);
  }

  // src/translate/types.ts
  var TranslationError = class extends Error {
    code;
    constructor(code, message) {
      super(message);
      this.name = "TranslationError";
      this.code = code;
    }
  };

  // src/models.ts
  var FRONTIER = {
    tools: true,
    toolChoice: true,
    parallelToolCalls: true,
    vision: true,
    structuredOutput: true,
    systemPrompt: true,
    streaming: true,
    reasoning: true
  };
  var MODELS = [
    // ─── Anthropic ───────────────────────────────────────────────────────────
    {
      id: "claude-opus-4-6",
      providerId: "anthropic",
      family: "anthropic",
      displayName: "Claude Opus 4.6",
      contextWindow: 1e6,
      maxOutput: 128e3,
      capabilities: FRONTIER
    },
    {
      id: "claude-sonnet-4-6",
      providerId: "anthropic",
      family: "anthropic",
      displayName: "Claude Sonnet 4.6",
      contextWindow: 1e6,
      maxOutput: 64e3,
      capabilities: FRONTIER
    },
    {
      id: "claude-haiku-4-5-20251001",
      providerId: "anthropic",
      family: "anthropic",
      displayName: "Claude Haiku 4.5",
      contextWindow: 2e5,
      maxOutput: 64e3,
      capabilities: FRONTIER
    },
    // ─── OpenAI ──────────────────────────────────────────────────────────────
    {
      id: "gpt-5.4",
      providerId: "openai",
      family: "openai",
      displayName: "GPT-5.4",
      contextWindow: 1e6,
      maxOutput: 128e3,
      capabilities: FRONTIER
    },
    {
      id: "gpt-5.4-mini",
      providerId: "openai",
      family: "openai",
      displayName: "GPT-5.4 mini",
      contextWindow: 4e5,
      maxOutput: 128e3,
      capabilities: FRONTIER
    },
    {
      id: "gpt-5.4-nano",
      providerId: "openai",
      family: "openai",
      displayName: "GPT-5.4 nano",
      contextWindow: 4e5,
      maxOutput: 128e3,
      capabilities: {
        ...FRONTIER,
        // The nano variant is text-only at the chat-completions surface.
        vision: false
      }
    },
    // ─── Google Gemini ───────────────────────────────────────────────────────
    {
      id: "gemini-2.5-pro",
      providerId: "gemini",
      family: "gemini",
      displayName: "Gemini 2.5 Pro",
      contextWindow: 1e6,
      maxOutput: 65536,
      capabilities: FRONTIER
    },
    {
      id: "gemini-2.5-flash",
      providerId: "gemini",
      family: "gemini",
      displayName: "Gemini 2.5 Flash",
      contextWindow: 1e6,
      maxOutput: 65536,
      capabilities: FRONTIER
    },
    // ─── Cohere ──────────────────────────────────────────────────────────────
    {
      id: "command-a-03-2025",
      providerId: "cohere",
      family: "cohere",
      displayName: "Command A",
      contextWindow: 256e3,
      maxOutput: 8e3,
      capabilities: {
        ...FRONTIER,
        // Command A does not accept image inputs at the chat API surface.
        vision: false,
        // No structured output constraint equivalent to OpenAI json_schema.
        structuredOutput: false
      }
    }
  ];
  function getModel(id) {
    return MODELS.find((m) => m.id === id);
  }
  function modelsForProvider(providerId) {
    return MODELS.filter((m) => m.providerId === providerId);
  }

  // src/translate/ir.ts
  function isIRError(x) {
    return x.error != null;
  }

  // src/translate/adapters/anthropic.ts
  var CHAT_ENDPOINT = "/v1/messages";
  var anthropicAdapter = {
    family: "anthropic",
    chatEndpoint: CHAT_ENDPOINT,
    matchesChatEndpoint(url) {
      try {
        const u = new URL(url);
        return u.pathname === CHAT_ENDPOINT || u.pathname.endsWith(CHAT_ENDPOINT);
      } catch {
        return false;
      }
    },
    buildChatUrl(base) {
      return `${base.replace(/\/$/, "")}${CHAT_ENDPOINT}`;
    },
    parseRequest,
    serializeRequest,
    parseResponse,
    serializeResponse,
    createStreamParser,
    createStreamSerializer
  };
  function parseRequest(body) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      throw new TranslationError(
        "INVALID_JSON",
        `Anthropic request body is not valid JSON: ${err.message}`
      );
    }
    const ir = {
      model: parsed.model,
      system: parseSystem(parsed.system),
      messages: Array.isArray(parsed.messages) ? parsed.messages.map(parseAnthropicMessage).filter((m) => m != null) : []
    };
    if (typeof parsed.max_tokens === "number") ir.maxTokens = parsed.max_tokens;
    if (typeof parsed.temperature === "number") ir.temperature = parsed.temperature;
    if (typeof parsed.top_p === "number") ir.topP = parsed.top_p;
    if (typeof parsed.top_k === "number") ir.topK = parsed.top_k;
    if (Array.isArray(parsed.stop_sequences) && parsed.stop_sequences.length > 0) {
      ir.stopSequences = parsed.stop_sequences.slice();
    }
    if (typeof parsed.stream === "boolean") ir.stream = parsed.stream;
    if (parsed.metadata && typeof parsed.metadata.user_id === "string") {
      ir.userId = parsed.metadata.user_id;
    }
    if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
      ir.tools = parsed.tools.map((t) => ({
        name: t.name,
        ...t.description ? { description: t.description } : {},
        parameters: t.input_schema ?? { type: "object", properties: {} }
      }));
    }
    if (parsed.tool_choice) {
      switch (parsed.tool_choice.type) {
        case "auto":
          ir.toolChoice = { type: "auto" };
          break;
        case "any":
          ir.toolChoice = { type: "any" };
          break;
        case "none":
          ir.toolChoice = { type: "none" };
          break;
        case "tool":
          ir.toolChoice = { type: "tool", name: parsed.tool_choice.name };
          break;
      }
    }
    if (parsed.thinking && parsed.thinking.type === "enabled") {
      ir.thinking = {
        enabled: true,
        ...typeof parsed.thinking.budget_tokens === "number" ? { budgetTokens: parsed.thinking.budget_tokens } : {}
      };
    }
    return ir;
  }
  function parseSystem(system) {
    if (!system) return [];
    if (typeof system === "string") {
      return system.length > 0 ? [{ text: system }] : [];
    }
    if (Array.isArray(system)) {
      return system.filter((b) => b && b.type === "text" && typeof b.text === "string" && b.text.length > 0).map((b) => ({ text: b.text }));
    }
    return [];
  }
  function parseAnthropicMessage(msg) {
    if (!msg || msg.role !== "user" && msg.role !== "assistant") return null;
    const content = [];
    if (typeof msg.content === "string") {
      if (msg.content.length > 0) content.push({ type: "text", text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        const parsed = parseAnthropicContentBlock(block);
        if (parsed) content.push(parsed);
      }
    }
    return { role: msg.role, content };
  }
  function parseAnthropicContentBlock(block) {
    if (!block || typeof block !== "object") return null;
    switch (block.type) {
      case "text":
        if (typeof block.text === "string") {
          return { type: "text", text: block.text };
        }
        return null;
      case "image": {
        const src = block.source;
        const irSrc = parseAnthropicImageSource(src);
        return irSrc ? { type: "image", source: irSrc } : null;
      }
      case "tool_use": {
        const tu = block;
        return { type: "tool_use", id: tu.id, name: tu.name, input: tu.input ?? {} };
      }
      case "tool_result": {
        const tr = block;
        return {
          type: "tool_result",
          toolUseId: tr.tool_use_id,
          content: parseAnthropicToolResultContent(tr.content),
          ...tr.is_error ? { isError: true } : {}
        };
      }
      case "thinking": {
        const th = block;
        const text = typeof th.thinking === "string" ? th.thinking : th.text ?? "";
        return {
          type: "thinking",
          text,
          ...th.signature ? { signature: th.signature } : {}
        };
      }
      default:
        return null;
    }
  }
  function parseAnthropicImageSource(src) {
    if (!src || typeof src !== "object") return null;
    if (src.type === "base64" && typeof src.media_type === "string" && typeof src.data === "string") {
      return { kind: "base64", mediaType: src.media_type, data: src.data };
    }
    if (src.type === "url" && typeof src.url === "string") {
      return { kind: "url", url: src.url };
    }
    return null;
  }
  function parseAnthropicToolResultContent(content) {
    if (content == null) return { kind: "text", text: "" };
    if (typeof content === "string") return { kind: "text", text: content };
    if (!Array.isArray(content)) return { kind: "text", text: "" };
    const blocks = [];
    for (const b of content) {
      const parsed = parseAnthropicContentBlock(b);
      if (parsed) blocks.push(parsed);
    }
    return { kind: "blocks", blocks };
  }
  function serializeRequest(ctx, ir) {
    if (typeof ir.n === "number" && ir.n > 1) {
      throw new TranslationError(
        "UNSUPPORTED_FEATURE",
        "Anthropic does not support generating multiple completions per request (n > 1)."
      );
    }
    let systemParts = ir.system.slice();
    if (ir.responseFormat?.type === "json_schema") {
      throw new TranslationError(
        "UNSUPPORTED_FEATURE",
        "OpenAI json_schema response format cannot be translated to Anthropic. Pin this app to an OpenAI- or Gemini-family model."
      );
    }
    if (ir.responseFormat?.type === "json") {
      systemParts.push({
        text: "Respond with valid JSON only. Do not include any prose outside the JSON object."
      });
    }
    let maxTokens = ir.maxTokens;
    if (typeof maxTokens !== "number") {
      const dst = getModel(ctx.dstModel);
      maxTokens = Math.min(dst?.maxOutput ?? 4096, 4096);
    }
    const out = {
      model: ctx.dstModel,
      max_tokens: maxTokens,
      messages: ir.messages.map(serializeMessageToAnthropic)
    };
    if (systemParts.length > 0) {
      out.system = systemParts.map((p) => p.text).join("\n\n");
    }
    if (typeof ir.temperature === "number") {
      out.temperature = Math.max(0, Math.min(1, ir.temperature));
    }
    if (typeof ir.topP === "number") out.top_p = ir.topP;
    if (typeof ir.topK === "number") out.top_k = ir.topK;
    if (ir.stopSequences && ir.stopSequences.length > 0) out.stop_sequences = ir.stopSequences.slice();
    if (typeof ir.stream === "boolean") out.stream = ir.stream;
    if (ir.userId) out.metadata = { user_id: ir.userId };
    if (ir.tools && ir.tools.length > 0) {
      out.tools = ir.tools.map((t) => ({
        name: t.name,
        ...t.description ? { description: t.description } : {},
        input_schema: t.parameters ?? { type: "object", properties: {} }
      }));
    }
    if (ir.toolChoice) {
      switch (ir.toolChoice.type) {
        case "auto":
          out.tool_choice = { type: "auto" };
          break;
        case "any":
          out.tool_choice = { type: "any" };
          break;
        case "none":
          out.tool_choice = { type: "none" };
          break;
        case "tool":
          out.tool_choice = { type: "tool", name: ir.toolChoice.name };
          break;
      }
    }
    if (ir.thinking?.enabled) {
      out.thinking = {
        type: "enabled",
        ...typeof ir.thinking.budgetTokens === "number" ? { budget_tokens: ir.thinking.budgetTokens } : {}
      };
    }
    return JSON.stringify(out);
  }
  function serializeMessageToAnthropic(msg) {
    const blocks = [];
    for (const b of msg.content) {
      const wire = serializeContentBlockToAnthropic(b);
      if (wire) blocks.push(wire);
    }
    if (blocks.length === 1 && blocks[0].type === "text") {
      return { role: msg.role, content: blocks[0].text };
    }
    if (blocks.length === 0) {
      return { role: msg.role, content: "" };
    }
    return { role: msg.role, content: blocks };
  }
  function serializeContentBlockToAnthropic(block) {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text };
      case "image":
        return { type: "image", source: irImageSourceToAnthropic(block.source) };
      case "tool_use":
        return { type: "tool_use", id: block.id, name: block.name, input: block.input };
      case "tool_result": {
        let content;
        if (block.content.kind === "text") {
          content = block.content.text;
        } else {
          const nested = [];
          for (const inner of block.content.blocks) {
            const wire = serializeContentBlockToAnthropic(inner);
            if (wire) nested.push(wire);
          }
          content = nested;
        }
        return {
          type: "tool_result",
          tool_use_id: block.toolUseId,
          content,
          ...block.isError ? { is_error: true } : {}
        };
      }
      case "thinking":
        return {
          type: "thinking",
          thinking: block.text,
          ...block.signature ? { signature: block.signature } : {}
        };
    }
  }
  function irImageSourceToAnthropic(source) {
    if (source.kind === "base64") {
      return { type: "base64", media_type: source.mediaType, data: source.data };
    }
    return { type: "url", url: source.url };
  }
  function parseResponse(body) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      throw new TranslationError(
        "INVALID_JSON",
        `Anthropic response body is not valid JSON: ${err.message}`
      );
    }
    if (parsed.type === "error") {
      return {
        error: {
          type: parsed.error?.type ?? "api_error",
          message: parsed.error?.message ?? "Anthropic API error"
        }
      };
    }
    const content = [];
    if (Array.isArray(parsed.content)) {
      for (const block of parsed.content) {
        if (!block || typeof block !== "object") continue;
        if (block.type === "text" && typeof block.text === "string") {
          content.push({ type: "text", text: block.text });
        } else if (block.type === "tool_use") {
          const tu = block;
          content.push({
            type: "tool_use",
            id: tu.id,
            name: tu.name,
            input: tu.input ?? {}
          });
        } else if (block.type === "thinking") {
          const th = block;
          const text = typeof th.thinking === "string" ? th.thinking : th.text ?? "";
          content.push({
            type: "thinking",
            text,
            ...th.signature ? { signature: th.signature } : {}
          });
        }
      }
    }
    return {
      id: parsed.id,
      model: parsed.model,
      content,
      stopReason: mapAnthropicStopToIR(parsed.stop_reason),
      stopSequence: parsed.stop_sequence ?? null,
      usage: {
        inputTokens: parsed.usage?.input_tokens ?? 0,
        outputTokens: parsed.usage?.output_tokens ?? 0
      }
    };
  }
  function serializeResponse(ctx, ir) {
    if (isIRError(ir)) {
      return JSON.stringify({
        type: "error",
        error: { type: ir.error.type, message: ir.error.message }
      });
    }
    const content = [];
    for (const block of ir.content) {
      if (block.type === "text") {
        content.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        content.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
      } else if (block.type === "thinking") {
        content.push({
          type: "thinking",
          thinking: block.text,
          ...block.signature ? { signature: block.signature } : {}
        });
      }
    }
    if (content.length === 0) content.push({ type: "text", text: "" });
    const out = {
      id: ir.id ?? `msg_${ctx.requestId}`,
      type: "message",
      role: "assistant",
      model: ctx.srcModel ?? ir.model ?? ctx.dstModel,
      content,
      stop_reason: mapIRStopToAnthropic(ir.stopReason),
      stop_sequence: ir.stopSequence ?? null,
      usage: {
        input_tokens: ir.usage.inputTokens,
        output_tokens: ir.usage.outputTokens
      }
    };
    return JSON.stringify(out);
  }
  function mapAnthropicStopToIR(stop) {
    switch (stop) {
      case "end_turn":
        return "end_turn";
      case "max_tokens":
        return "max_tokens";
      case "stop_sequence":
        return "stop_sequence";
      case "tool_use":
        return "tool_use";
      case "refusal":
        return "refusal";
      case "pause_turn":
        return "other";
      default:
        return "end_turn";
    }
  }
  function mapIRStopToAnthropic(stop) {
    switch (stop) {
      case "end_turn":
        return "end_turn";
      case "max_tokens":
        return "max_tokens";
      case "stop_sequence":
        return "stop_sequence";
      case "tool_use":
        return "tool_use";
      case "refusal":
        return "refusal";
      case "error":
      case "other":
        return "end_turn";
    }
  }
  function createStreamParser() {
    let buffer = "";
    let done = false;
    return {
      process(chunk) {
        buffer += chunk.replace(/\r/g, "");
        const events = [];
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (done) continue;
          parseAnthropicFrame(frame, events);
          if (events.length > 0 && events[events.length - 1].type === "message_stop") {
            done = true;
          }
        }
        return events;
      },
      flush() {
        return [];
      }
    };
  }
  function parseAnthropicFrame(frame, out) {
    const data = parseDataLine(frame);
    if (!data) return;
    switch (data.type) {
      case "message_start": {
        const id = data.message?.id ?? "";
        out.push({
          type: "message_start",
          id,
          model: data.message?.model,
          usage: {
            inputTokens: data.message?.usage?.input_tokens ?? 0,
            outputTokens: data.message?.usage?.output_tokens ?? 0
          }
        });
        return;
      }
      case "content_block_start": {
        const index = data.index;
        const cb = data.content_block;
        if (typeof index !== "number" || !cb) return;
        if (cb.type === "text") {
          out.push({ type: "content_block_start", index, block: { type: "text" } });
        } else if (cb.type === "tool_use") {
          out.push({
            type: "content_block_start",
            index,
            block: { type: "tool_use", id: cb.id ?? "", name: cb.name ?? "" }
          });
        } else if (cb.type === "thinking") {
          out.push({ type: "content_block_start", index, block: { type: "thinking" } });
        }
        return;
      }
      case "content_block_delta": {
        const index = data.index;
        if (typeof index !== "number") return;
        const deltaType = data.delta?.type;
        if (deltaType === "text_delta" && typeof data.delta?.text === "string") {
          out.push({ type: "text_delta", index, text: data.delta.text });
        } else if (deltaType === "input_json_delta" && typeof data.delta?.partial_json === "string") {
          out.push({ type: "tool_input_delta", index, partialJson: data.delta.partial_json });
        } else if (deltaType === "thinking_delta" && typeof data.delta?.thinking === "string") {
          out.push({ type: "thinking_delta", index, text: data.delta.thinking });
        }
        return;
      }
      case "content_block_stop": {
        const index = data.index;
        if (typeof index !== "number") return;
        out.push({ type: "content_block_stop", index });
        return;
      }
      case "message_delta": {
        const stopReason = data.delta?.stop_reason ? mapAnthropicStopToIR(data.delta.stop_reason) : void 0;
        const usage = {};
        if (typeof data.usage?.input_tokens === "number") usage.inputTokens = data.usage.input_tokens;
        if (typeof data.usage?.output_tokens === "number") usage.outputTokens = data.usage.output_tokens;
        out.push({
          type: "message_delta",
          ...stopReason ? { stopReason } : {},
          ...Object.keys(usage).length > 0 ? { usage } : {}
        });
        return;
      }
      case "message_stop":
        out.push({ type: "message_stop" });
        return;
      case "ping":
        return;
      case "error":
        out.push({
          type: "error",
          error: {
            type: data.error?.type ?? "api_error",
            message: data.error?.message ?? "Anthropic stream error"
          }
        });
        return;
      default:
        return;
    }
  }
  function parseDataLine(frame) {
    const lines = frame.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const json = line.slice(6);
        try {
          return JSON.parse(json);
        } catch {
          return void 0;
        }
      }
    }
    return void 0;
  }
  function createStreamSerializer(ctx) {
    const state = {
      messageId: `msg_${ctx.requestId}`,
      model: ctx.srcModel ?? ctx.dstModel,
      inputTokens: 0,
      outputTokens: 0,
      started: false,
      done: false,
      openBlocks: /* @__PURE__ */ new Set()
    };
    return {
      process(events) {
        let out = "";
        for (const event of events) {
          out += handleEvent(event, state);
        }
        return out;
      },
      flush() {
        if (state.done) return "";
        let out = "";
        for (const idx of state.openBlocks) {
          out += emitFrame("content_block_stop", { type: "content_block_stop", index: idx });
        }
        state.openBlocks.clear();
        if (state.started) {
          out += emitFrame("message_delta", {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { input_tokens: state.inputTokens, output_tokens: state.outputTokens }
          });
          out += emitFrame("message_stop", { type: "message_stop" });
        }
        state.done = true;
        return out;
      }
    };
  }
  function handleEvent(event, state) {
    if (state.done) return "";
    switch (event.type) {
      case "message_start": {
        state.started = true;
        if (event.id) state.messageId = event.id;
        if (event.model) state.model = event.model;
        if (typeof event.usage.inputTokens === "number") state.inputTokens = event.usage.inputTokens;
        if (typeof event.usage.outputTokens === "number") state.outputTokens = event.usage.outputTokens;
        return emitFrame("message_start", {
          type: "message_start",
          message: {
            id: state.messageId,
            type: "message",
            role: "assistant",
            content: [],
            model: state.model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: state.inputTokens, output_tokens: 0 }
          }
        });
      }
      case "content_block_start": {
        state.openBlocks.add(event.index);
        if (event.block.type === "text") {
          return emitFrame("content_block_start", {
            type: "content_block_start",
            index: event.index,
            content_block: { type: "text", text: "" }
          });
        }
        if (event.block.type === "tool_use") {
          return emitFrame("content_block_start", {
            type: "content_block_start",
            index: event.index,
            content_block: {
              type: "tool_use",
              id: event.block.id,
              name: event.block.name,
              input: {}
            }
          });
        }
        return emitFrame("content_block_start", {
          type: "content_block_start",
          index: event.index,
          content_block: { type: "thinking", thinking: "" }
        });
      }
      case "text_delta":
        return emitFrame("content_block_delta", {
          type: "content_block_delta",
          index: event.index,
          delta: { type: "text_delta", text: event.text }
        });
      case "tool_input_delta":
        return emitFrame("content_block_delta", {
          type: "content_block_delta",
          index: event.index,
          delta: { type: "input_json_delta", partial_json: event.partialJson }
        });
      case "thinking_delta":
        return emitFrame("content_block_delta", {
          type: "content_block_delta",
          index: event.index,
          delta: { type: "thinking_delta", thinking: event.text }
        });
      case "content_block_stop":
        state.openBlocks.delete(event.index);
        return emitFrame("content_block_stop", {
          type: "content_block_stop",
          index: event.index
        });
      case "message_delta": {
        if (typeof event.usage?.inputTokens === "number") state.inputTokens = event.usage.inputTokens;
        if (typeof event.usage?.outputTokens === "number") state.outputTokens = event.usage.outputTokens;
        const stopReason = mapIRStopToAnthropic(event.stopReason ?? "end_turn");
        return emitFrame("message_delta", {
          type: "message_delta",
          delta: { stop_reason: stopReason, stop_sequence: null },
          usage: { input_tokens: state.inputTokens, output_tokens: state.outputTokens }
        });
      }
      case "message_stop":
        state.done = true;
        return emitFrame("message_stop", { type: "message_stop" });
      case "error":
        state.done = true;
        return emitFrame("error", {
          type: "error",
          error: { type: event.error.type, message: event.error.message }
        });
    }
  }
  function emitFrame(eventType, data) {
    return `event: ${eventType}
data: ${JSON.stringify(data)}

`;
  }

  // src/translate/adapters/openai.ts
  var CHAT_ENDPOINT2 = "/v1/chat/completions";
  var openaiAdapter = {
    family: "openai",
    chatEndpoint: CHAT_ENDPOINT2,
    matchesChatEndpoint(url) {
      try {
        const u = new URL(url);
        return u.pathname === CHAT_ENDPOINT2 || u.pathname.endsWith(CHAT_ENDPOINT2);
      } catch {
        return false;
      }
    },
    buildChatUrl(base) {
      return `${base.replace(/\/$/, "")}${CHAT_ENDPOINT2}`;
    },
    parseRequest: parseRequest2,
    serializeRequest: serializeRequest2,
    parseResponse: parseResponse2,
    serializeResponse: serializeResponse2,
    createStreamParser: createStreamParser2,
    createStreamSerializer: createStreamSerializer2
  };
  function parseRequest2(body) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      throw new TranslationError(
        "INVALID_JSON",
        `OpenAI request body is not valid JSON: ${err.message}`
      );
    }
    const ir = {
      model: parsed.model,
      system: [],
      messages: []
    };
    const conversation = [];
    if (Array.isArray(parsed.messages)) {
      for (const m of parsed.messages) {
        if (m && m.role === "system") {
          const text = flattenOpenAIContent(m.content);
          if (text) ir.system.push({ text });
        } else if (m) {
          conversation.push(m);
        }
      }
    }
    ir.messages = translateOpenAIConversationToIR(conversation);
    if (typeof parsed.max_completion_tokens === "number") {
      ir.maxTokens = parsed.max_completion_tokens;
    } else if (typeof parsed.max_tokens === "number") {
      ir.maxTokens = parsed.max_tokens;
    }
    if (typeof parsed.temperature === "number") ir.temperature = parsed.temperature;
    if (typeof parsed.top_p === "number") ir.topP = parsed.top_p;
    if (parsed.stop !== void 0) {
      ir.stopSequences = Array.isArray(parsed.stop) ? parsed.stop : [parsed.stop];
    }
    if (typeof parsed.stream === "boolean") ir.stream = parsed.stream;
    if (typeof parsed.user === "string") ir.userId = parsed.user;
    if (typeof parsed.n === "number") ir.n = parsed.n;
    if (parsed.response_format) {
      if (parsed.response_format.type === "json_object") {
        ir.responseFormat = { type: "json" };
      } else if (parsed.response_format.type === "json_schema") {
        const schema = parsed.response_format.json_schema?.schema ?? {};
        ir.responseFormat = { type: "json_schema", schema };
      }
    }
    if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
      ir.tools = parsed.tools.filter((t) => !!t && t.type === "function" && !!t.function).map((t) => ({
        name: t.function.name,
        ...t.function.description ? { description: t.function.description } : {},
        parameters: t.function.parameters ?? { type: "object", properties: {} }
      }));
    }
    if (parsed.tool_choice !== void 0) {
      if (typeof parsed.tool_choice === "string") {
        switch (parsed.tool_choice) {
          case "auto":
            ir.toolChoice = { type: "auto" };
            break;
          case "required":
            ir.toolChoice = { type: "any" };
            break;
          case "none":
            ir.toolChoice = { type: "none" };
            break;
        }
      } else if (parsed.tool_choice && typeof parsed.tool_choice === "object" && parsed.tool_choice.type === "function" && parsed.tool_choice.function) {
        ir.toolChoice = { type: "tool", name: parsed.tool_choice.function.name };
      }
    }
    return ir;
  }
  function translateOpenAIConversationToIR(messages) {
    const out = [];
    let pendingToolResults = [];
    const flushPending = () => {
      if (pendingToolResults.length === 0) return;
      out.push({ role: "user", content: pendingToolResults });
      pendingToolResults = [];
    };
    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      switch (m.role) {
        case "tool": {
          pendingToolResults.push({
            type: "tool_result",
            toolUseId: m.tool_call_id,
            content: { kind: "text", text: flattenOpenAIContent(m.content) }
          });
          break;
        }
        case "user": {
          const userBlocks = parseOpenAIUserContent(m.content);
          if (pendingToolResults.length > 0) {
            out.push({ role: "user", content: [...pendingToolResults, ...userBlocks] });
            pendingToolResults = [];
          } else {
            out.push({ role: "user", content: userBlocks });
          }
          break;
        }
        case "assistant": {
          flushPending();
          out.push(parseOpenAIAssistantMessage(m));
          break;
        }
        default:
          break;
      }
    }
    flushPending();
    return out;
  }
  function parseOpenAIUserContent(content) {
    if (typeof content === "string") {
      return content.length > 0 ? [{ type: "text", text: content }] : [];
    }
    if (!Array.isArray(content)) return [];
    const out = [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "text" && typeof part.text === "string") {
        out.push({ type: "text", text: part.text });
      } else if (part.type === "image_url") {
        const url = extractOpenAIImageUrl(part.image_url);
        const source = parseImageUrl(url);
        if (source) out.push({ type: "image", source });
      }
    }
    return out;
  }
  function parseOpenAIAssistantMessage(m) {
    const blocks = [];
    const text = flattenOpenAIContent(m.content);
    if (text) blocks.push({ type: "text", text });
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        if (!tc || tc.type !== "function" || !tc.function) continue;
        let input;
        try {
          input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          input = { _raw: tc.function.arguments };
        }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }
    }
    return { role: "assistant", content: blocks };
  }
  function flattenOpenAIContent(content) {
    if (content == null) return "";
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map((p) => {
      if (p && typeof p === "object" && p.type === "text") {
        return p.text ?? "";
      }
      return "";
    }).filter((s) => s.length > 0).join("\n");
  }
  function extractOpenAIImageUrl(image_url) {
    if (typeof image_url === "string") return image_url;
    if (image_url && typeof image_url === "object" && typeof image_url.url === "string") {
      return image_url.url;
    }
    return "";
  }
  function parseImageUrl(url) {
    if (!url) return null;
    if (url.startsWith("data:")) {
      const match = /^data:([^;,]+);base64,(.+)$/.exec(url);
      if (!match) return null;
      return { kind: "base64", mediaType: match[1], data: match[2] };
    }
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return { kind: "url", url };
    }
    return null;
  }
  function serializeRequest2(ctx, ir) {
    const out = {
      model: ctx.dstModel,
      messages: []
    };
    if (ir.system.length > 0) {
      const text = ir.system.map((p) => p.text).join("\n\n");
      if (text) out.messages.push({ role: "system", content: text });
    }
    for (const msg of ir.messages) {
      for (const wire of serializeMessageToOpenAI(msg)) {
        out.messages.push(wire);
      }
    }
    const dst = getModel(ctx.dstModel);
    const isReasoningDst = dst?.capabilities.reasoning === true;
    if (typeof ir.maxTokens === "number") {
      if (isReasoningDst) out.max_completion_tokens = ir.maxTokens;
      else out.max_tokens = ir.maxTokens;
    }
    if (typeof ir.temperature === "number" && !isReasoningDst) {
      out.temperature = ir.temperature;
    }
    if (typeof ir.topP === "number" && !isReasoningDst) out.top_p = ir.topP;
    if (ir.stopSequences && ir.stopSequences.length > 0) out.stop = ir.stopSequences.slice();
    if (typeof ir.stream === "boolean") {
      out.stream = ir.stream;
      if (ir.stream) {
        out.stream_options = { include_usage: true };
      }
    }
    if (ir.userId) out.user = ir.userId;
    if (typeof ir.n === "number") out.n = ir.n;
    if (ir.responseFormat?.type === "json") {
      out.response_format = { type: "json_object" };
    } else if (ir.responseFormat?.type === "json_schema") {
      out.response_format = {
        type: "json_schema",
        json_schema: { name: "response", schema: ir.responseFormat.schema }
      };
    }
    if (ir.tools && ir.tools.length > 0) {
      out.tools = ir.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          ...t.description ? { description: t.description } : {},
          parameters: t.parameters ?? { type: "object", properties: {} }
        }
      }));
    }
    if (ir.toolChoice) {
      switch (ir.toolChoice.type) {
        case "auto":
          out.tool_choice = "auto";
          break;
        case "any":
          out.tool_choice = "required";
          break;
        case "none":
          out.tool_choice = "none";
          break;
        case "tool":
          out.tool_choice = { type: "function", function: { name: ir.toolChoice.name } };
          break;
      }
    }
    return JSON.stringify(out);
  }
  function serializeMessageToOpenAI(msg) {
    if (msg.role === "user") return serializeUserMessageToOpenAI(msg);
    return serializeAssistantMessageToOpenAI(msg);
  }
  function serializeUserMessageToOpenAI(msg) {
    const out = [];
    const userParts = [];
    for (const block of msg.content) {
      switch (block.type) {
        case "text":
          userParts.push({ type: "text", text: block.text });
          break;
        case "image": {
          const url = irImageSourceToDataUrl(block.source);
          if (url) userParts.push({ type: "image_url", image_url: { url } });
          break;
        }
        case "tool_result":
          out.push({
            role: "tool",
            tool_call_id: block.toolUseId,
            content: flattenIRToolResultContent(block.content)
          });
          break;
        // thinking/tool_use inside a user message — drop (invalid for user role)
        default:
          break;
      }
    }
    if (userParts.length > 0) {
      if (userParts.every((p) => p.type === "text")) {
        out.push({
          role: "user",
          content: userParts.map((p) => p.text).join("\n")
        });
      } else {
        out.push({ role: "user", content: userParts });
      }
    }
    return out;
  }
  function serializeAssistantMessageToOpenAI(msg) {
    const textParts = [];
    const toolCalls = [];
    for (const block of msg.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) }
        });
      }
    }
    const content = textParts.length > 0 ? textParts.join("\n") : null;
    const msgOut = { role: "assistant", content };
    if (toolCalls.length > 0) msgOut.tool_calls = toolCalls;
    return [msgOut];
  }
  function irImageSourceToDataUrl(source) {
    if (source.kind === "base64") {
      return `data:${source.mediaType};base64,${source.data}`;
    }
    return source.url;
  }
  function flattenIRToolResultContent(content) {
    if (content.kind === "text") return content.text;
    return content.blocks.map((b) => b.type === "text" ? b.text : "").filter((s) => s.length > 0).join("\n");
  }
  function parseResponse2(body) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      throw new TranslationError(
        "INVALID_JSON",
        `OpenAI response body is not valid JSON: ${err.message}`
      );
    }
    if (parsed.error) {
      return {
        error: {
          type: parsed.error.type ?? "api_error",
          message: parsed.error.message ?? "OpenAI API error",
          ...parsed.error.code ? { code: parsed.error.code } : {}
        }
      };
    }
    const choice = parsed.choices?.[0];
    const message = choice?.message;
    const blocks = [];
    const text = flattenOpenAIContent(message?.content ?? null);
    if (text) blocks.push({ type: "text", text });
    if (Array.isArray(message?.tool_calls)) {
      for (const tc of message.tool_calls) {
        if (!tc || tc.type !== "function" || !tc.function) continue;
        let input;
        try {
          input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          input = { _raw: tc.function.arguments };
        }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }
    }
    return {
      id: parsed.id,
      model: parsed.model,
      content: blocks,
      stopReason: mapOpenAIFinishToIR(choice?.finish_reason ?? null),
      stopSequence: null,
      usage: {
        inputTokens: parsed.usage?.prompt_tokens ?? 0,
        outputTokens: parsed.usage?.completion_tokens ?? 0
      }
    };
  }
  function serializeResponse2(ctx, ir) {
    if (isIRError(ir)) {
      return JSON.stringify({
        error: {
          message: ir.error.message,
          type: ir.error.type,
          code: ir.error.code ?? null
        }
      });
    }
    const textParts = [];
    const toolCalls = [];
    for (const block of ir.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) }
        });
      }
    }
    const out = {
      id: ir.id ?? `chatcmpl-${ctx.requestId}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1e3),
      model: ctx.srcModel ?? ir.model ?? ctx.dstModel,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: textParts.length > 0 ? textParts.join("") : null,
            ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {}
          },
          finish_reason: mapIRStopToOpenAIFinish(ir.stopReason)
        }
      ],
      usage: {
        prompt_tokens: ir.usage.inputTokens,
        completion_tokens: ir.usage.outputTokens,
        total_tokens: ir.usage.inputTokens + ir.usage.outputTokens
      }
    };
    return JSON.stringify(out);
  }
  function mapOpenAIFinishToIR(finish) {
    switch (finish) {
      case "stop":
        return "end_turn";
      case "length":
        return "max_tokens";
      case "tool_calls":
      case "function_call":
        return "tool_use";
      case "content_filter":
        return "refusal";
      default:
        return "end_turn";
    }
  }
  function mapIRStopToOpenAIFinish(stop) {
    switch (stop) {
      case "end_turn":
      case "stop_sequence":
      case "other":
        return "stop";
      case "max_tokens":
        return "length";
      case "tool_use":
        return "tool_calls";
      case "refusal":
        return "content_filter";
      case "error":
        return "stop";
    }
  }
  function createStreamParser2() {
    const state = {
      buffer: "",
      started: false,
      done: false,
      nextBlockIndex: 0,
      textBlockIndex: null,
      textBlockOpen: false,
      toolCalls: /* @__PURE__ */ new Map(),
      pendingFinish: null,
      inputTokens: 0,
      outputTokens: 0,
      messageId: "",
      model: void 0
    };
    return {
      process(chunk) {
        state.buffer += chunk.replace(/\r/g, "");
        const events = [];
        let idx;
        while ((idx = state.buffer.indexOf("\n\n")) !== -1) {
          const frame = state.buffer.slice(0, idx);
          state.buffer = state.buffer.slice(idx + 2);
          if (state.done) continue;
          processOpenAIFrame(frame, state, events);
        }
        return events;
      },
      flush() {
        if (state.done) return [];
        const events = [];
        closeAllOpenBlocks(state, events);
        if (state.started) {
          events.push({
            type: "message_delta",
            stopReason: state.pendingFinish ?? "end_turn",
            usage: { inputTokens: state.inputTokens, outputTokens: state.outputTokens }
          });
          events.push({ type: "message_stop" });
        }
        state.done = true;
        return events;
      }
    };
  }
  function processOpenAIFrame(frame, state, events) {
    const dataLine = extractOpenAIDataLine(frame);
    if (dataLine == null) return;
    if (dataLine === "[DONE]") {
      if (state.done) return;
      closeAllOpenBlocks(state, events);
      if (state.started) {
        events.push({
          type: "message_delta",
          stopReason: state.pendingFinish ?? "end_turn",
          usage: { inputTokens: state.inputTokens, outputTokens: state.outputTokens }
        });
        events.push({ type: "message_stop" });
      }
      state.done = true;
      return;
    }
    let data;
    try {
      data = JSON.parse(dataLine);
    } catch {
      return;
    }
    if (data.error) {
      state.done = true;
      events.push({
        type: "error",
        error: {
          type: data.error.type ?? "api_error",
          message: data.error.message ?? "OpenAI stream error",
          ...data.error.code ? { code: data.error.code } : {}
        }
      });
      return;
    }
    if (!state.started) {
      state.started = true;
      if (data.id) state.messageId = data.id;
      if (data.model) state.model = data.model;
      events.push({
        type: "message_start",
        id: state.messageId || `chatcmpl-${data.id ?? ""}`,
        model: state.model,
        usage: {}
      });
    }
    if (data.usage) {
      if (typeof data.usage.prompt_tokens === "number") state.inputTokens = data.usage.prompt_tokens;
      if (typeof data.usage.completion_tokens === "number") state.outputTokens = data.usage.completion_tokens;
    }
    const choice = data.choices?.[0];
    if (!choice) return;
    const delta = choice.delta;
    if (delta) {
      if (typeof delta.content === "string" && delta.content.length > 0) {
        handleTextDelta(state, events, delta.content);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          handleToolCallDelta(state, events, tc);
        }
      }
    }
    if (choice.finish_reason) {
      state.pendingFinish = mapOpenAIFinishToIR(choice.finish_reason);
    }
  }
  function extractOpenAIDataLine(frame) {
    const lines = frame.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) return line.slice(6);
      if (line.startsWith("data:")) return line.slice(5).trimStart();
    }
    return null;
  }
  function handleTextDelta(state, events, text) {
    if (!state.textBlockOpen) {
      closeAllOpenBlocksExcept(state, events, "text");
      state.textBlockIndex = state.nextBlockIndex++;
      state.textBlockOpen = true;
      events.push({
        type: "content_block_start",
        index: state.textBlockIndex,
        block: { type: "text" }
      });
    }
    events.push({ type: "text_delta", index: state.textBlockIndex, text });
  }
  function handleToolCallDelta(state, events, tc) {
    if (!tc || typeof tc.index !== "number") return;
    let entry = state.toolCalls.get(tc.index);
    if (!entry) {
      entry = {
        blockIndex: -1,
        open: false,
        started: false,
        id: tc.id ?? "",
        name: tc.function?.name ?? ""
      };
      state.toolCalls.set(tc.index, entry);
    } else {
      if (tc.id && !entry.id) entry.id = tc.id;
      if (tc.function?.name && !entry.name) entry.name = tc.function.name;
    }
    if (!entry.started && entry.id && entry.name) {
      closeAllOpenBlocksExcept(state, events, tc.index);
      entry.blockIndex = state.nextBlockIndex++;
      entry.started = true;
      entry.open = true;
      events.push({
        type: "content_block_start",
        index: entry.blockIndex,
        block: { type: "tool_use", id: entry.id, name: entry.name }
      });
    }
    const args = tc.function?.arguments;
    if (typeof args === "string" && args.length > 0 && entry.open) {
      events.push({ type: "tool_input_delta", index: entry.blockIndex, partialJson: args });
    }
  }
  function closeAllOpenBlocks(state, events) {
    if (state.textBlockOpen && state.textBlockIndex != null) {
      events.push({ type: "content_block_stop", index: state.textBlockIndex });
      state.textBlockOpen = false;
    }
    for (const entry of state.toolCalls.values()) {
      if (entry.open) {
        events.push({ type: "content_block_stop", index: entry.blockIndex });
        entry.open = false;
      }
    }
  }
  function closeAllOpenBlocksExcept(state, events, keep) {
    if (keep !== "text" && state.textBlockOpen && state.textBlockIndex != null) {
      events.push({ type: "content_block_stop", index: state.textBlockIndex });
      state.textBlockOpen = false;
    }
    for (const [idx, entry] of state.toolCalls.entries()) {
      if (idx === keep) continue;
      if (entry.open) {
        events.push({ type: "content_block_stop", index: entry.blockIndex });
        entry.open = false;
      }
    }
  }
  function createStreamSerializer2(ctx) {
    const state = {
      messageId: `chatcmpl-${ctx.requestId}`,
      model: ctx.srcModel ?? ctx.dstModel,
      created: Math.floor(Date.now() / 1e3),
      toolCallIndices: /* @__PURE__ */ new Map(),
      nextToolCallIndex: 0,
      inputTokens: 0,
      outputTokens: 0,
      done: false
    };
    return {
      process(events) {
        let out = "";
        for (const event of events) {
          out += handleSerializeEvent(event, state, ctx);
        }
        return out;
      },
      flush() {
        if (state.done) return "";
        let out = "";
        out += emitChunk(state, {}, null);
        out += emitUsageChunk(state);
        out += "data: [DONE]\n\n";
        state.done = true;
        return out;
      }
    };
  }
  function handleSerializeEvent(event, state, _ctx) {
    if (state.done) return "";
    switch (event.type) {
      case "message_start": {
        if (event.id) state.messageId = event.id;
        if (typeof event.usage.inputTokens === "number") state.inputTokens = event.usage.inputTokens;
        if (typeof event.usage.outputTokens === "number") state.outputTokens = event.usage.outputTokens;
        return emitChunk(state, { role: "assistant", content: "" }, null);
      }
      case "content_block_start": {
        if (event.block.type === "tool_use") {
          const toolIndex = state.nextToolCallIndex++;
          state.toolCallIndices.set(event.index, toolIndex);
          return emitChunk(
            state,
            {
              tool_calls: [
                {
                  index: toolIndex,
                  id: event.block.id,
                  type: "function",
                  function: { name: event.block.name, arguments: "" }
                }
              ]
            },
            null
          );
        }
        return "";
      }
      case "text_delta":
        return emitChunk(state, { content: event.text }, null);
      case "tool_input_delta": {
        const toolIndex = state.toolCallIndices.get(event.index);
        if (toolIndex == null) return "";
        return emitChunk(
          state,
          {
            tool_calls: [
              {
                index: toolIndex,
                function: { arguments: event.partialJson }
              }
            ]
          },
          null
        );
      }
      case "thinking_delta":
        return "";
      case "content_block_stop":
        return "";
      case "message_delta": {
        if (typeof event.usage?.inputTokens === "number") state.inputTokens = event.usage.inputTokens;
        if (typeof event.usage?.outputTokens === "number") state.outputTokens = event.usage.outputTokens;
        const finish = mapIRStopToOpenAIFinish(event.stopReason ?? "end_turn");
        return emitChunk(state, {}, finish);
      }
      case "message_stop": {
        state.done = true;
        let out = emitUsageChunk(state);
        out += "data: [DONE]\n\n";
        return out;
      }
      case "error": {
        state.done = true;
        const errChunk = {
          error: {
            message: event.error.message,
            type: event.error.type,
            code: event.error.code ?? null
          }
        };
        return `data: ${JSON.stringify(errChunk)}

data: [DONE]

`;
      }
    }
  }
  function emitChunk(state, delta, finish) {
    const chunk = {
      id: state.messageId,
      object: "chat.completion.chunk",
      created: state.created,
      model: state.model,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: finish
        }
      ]
    };
    return `data: ${JSON.stringify(chunk)}

`;
  }
  function emitUsageChunk(state) {
    const chunk = {
      id: state.messageId,
      object: "chat.completion.chunk",
      created: state.created,
      model: state.model,
      choices: [],
      usage: {
        prompt_tokens: state.inputTokens,
        completion_tokens: state.outputTokens,
        total_tokens: state.inputTokens + state.outputTokens
      }
    };
    return `data: ${JSON.stringify(chunk)}

`;
  }

  // src/translate/adapters/gemini.ts
  var geminiAdapter = {
    family: "gemini",
    chatEndpoint: "/v1beta/models",
    matchesChatEndpoint(url) {
      try {
        const u = new URL(url);
        return /^\/v1beta\/models\/[^/]+:(?:stream)?[Gg]enerateContent$/.test(u.pathname);
      } catch {
        return false;
      }
    },
    buildChatUrl(base, model, stream) {
      const b = base.replace(/\/$/, "");
      const method = stream ? "streamGenerateContent" : "generateContent";
      const suffix = stream ? "?alt=sse" : "";
      return `${b}/v1beta/models/${encodeURIComponent(model)}:${method}${suffix}`;
    },
    parseRequest: parseRequest3,
    serializeRequest: serializeRequest3,
    parseResponse: parseResponse3,
    serializeResponse: serializeResponse3,
    createStreamParser: createStreamParser3,
    createStreamSerializer: createStreamSerializer3
  };
  function parseRequest3(body) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      throw new TranslationError(
        "INVALID_JSON",
        `Gemini request body is not valid JSON: ${err.message}`
      );
    }
    const ir = {
      system: parseSystemInstruction(parsed.systemInstruction),
      messages: []
    };
    if (Array.isArray(parsed.contents)) {
      for (const c of parsed.contents) {
        const msg = parseGeminiContent(c);
        if (msg) ir.messages.push(msg);
      }
    }
    const gc = parsed.generationConfig;
    if (gc) {
      if (typeof gc.temperature === "number") ir.temperature = gc.temperature;
      if (typeof gc.topP === "number") ir.topP = gc.topP;
      if (typeof gc.topK === "number") ir.topK = gc.topK;
      if (typeof gc.maxOutputTokens === "number") ir.maxTokens = gc.maxOutputTokens;
      if (Array.isArray(gc.stopSequences) && gc.stopSequences.length > 0) {
        ir.stopSequences = gc.stopSequences.slice();
      }
      if (gc.responseMimeType === "application/json") {
        if (gc.responseSchema) {
          ir.responseFormat = { type: "json_schema", schema: gc.responseSchema };
        } else {
          ir.responseFormat = { type: "json" };
        }
      }
      if (gc.thinkingConfig && typeof gc.thinkingConfig.thinkingBudget === "number") {
        ir.thinking = { enabled: true, budgetTokens: gc.thinkingConfig.thinkingBudget };
      }
    }
    if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
      const flat = [];
      for (const group of parsed.tools) {
        if (!group?.functionDeclarations) continue;
        for (const fn of group.functionDeclarations) {
          flat.push({
            name: fn.name,
            ...fn.description ? { description: fn.description } : {},
            parameters: fn.parameters ?? { type: "object", properties: {} }
          });
        }
      }
      if (flat.length > 0) ir.tools = flat;
    }
    const tcMode = parsed.toolConfig?.functionCallingConfig?.mode;
    if (tcMode) {
      switch (tcMode) {
        case "AUTO":
          ir.toolChoice = { type: "auto" };
          break;
        case "ANY":
        case "VALIDATED": {
          const allowed = parsed.toolConfig?.functionCallingConfig?.allowedFunctionNames;
          if (Array.isArray(allowed) && allowed.length === 1) {
            ir.toolChoice = { type: "tool", name: allowed[0] };
          } else {
            ir.toolChoice = { type: "any" };
          }
          break;
        }
        case "NONE":
          ir.toolChoice = { type: "none" };
          break;
      }
    }
    return ir;
  }
  function parseSystemInstruction(si) {
    if (!si || !Array.isArray(si.parts)) return [];
    const out = [];
    for (const p of si.parts) {
      if (p && "text" in p && typeof p.text === "string" && p.text.length > 0) {
        out.push({ text: p.text });
      }
    }
    return out;
  }
  function parseGeminiContent(c) {
    if (!c || !Array.isArray(c.parts)) return null;
    const role = c.role === "model" ? "assistant" : "user";
    const blocks = [];
    for (const part of c.parts) {
      if (!part || typeof part !== "object") continue;
      if ("text" in part && typeof part.text === "string") {
        blocks.push({ type: "text", text: part.text });
      } else if ("inlineData" in part && part.inlineData) {
        blocks.push({
          type: "image",
          source: {
            kind: "base64",
            mediaType: part.inlineData.mimeType,
            data: part.inlineData.data
          }
        });
      } else if ("fileData" in part && part.fileData) {
        blocks.push({ type: "image", source: { kind: "url", url: part.fileData.fileUri } });
      } else if ("functionCall" in part && part.functionCall) {
        const fc = part.functionCall;
        blocks.push({
          type: "tool_use",
          id: fc.id ?? fc.name,
          name: fc.name,
          input: fc.args ?? {}
        });
      } else if ("functionResponse" in part && part.functionResponse) {
        const fr = part.functionResponse;
        blocks.push({
          type: "tool_result",
          toolUseId: fr.id ?? fr.name,
          content: { kind: "text", text: JSON.stringify(fr.response ?? {}) }
        });
      }
    }
    return { role, content: blocks };
  }
  function serializeRequest3(ctx, ir) {
    if (ir.tools && ir.tools.length > 0 && ir.responseFormat) {
      throw new TranslationError(
        "UNSUPPORTED_FEATURE",
        "Gemini does not support combining tools with JSON response format on the 2.5 series."
      );
    }
    if (typeof ir.n === "number" && ir.n > 1) {
      throw new TranslationError(
        "UNSUPPORTED_FEATURE",
        "Gemini does not reliably support generating multiple completions per request."
      );
    }
    const toolUseNames = /* @__PURE__ */ new Map();
    for (const msg of ir.messages) {
      for (const b of msg.content) {
        if (b.type === "tool_use") toolUseNames.set(b.id, b.name);
      }
    }
    const contents = [];
    for (const msg of ir.messages) {
      const c = serializeMessageToGemini(msg, toolUseNames);
      if (c) contents.push(c);
    }
    const out = {
      contents
    };
    if (ir.system.length > 0) {
      out.systemInstruction = {
        parts: ir.system.map((p) => ({ text: p.text }))
      };
    }
    const gc = {};
    if (typeof ir.temperature === "number") gc.temperature = ir.temperature;
    if (typeof ir.topP === "number") gc.topP = ir.topP;
    if (typeof ir.topK === "number") gc.topK = ir.topK;
    if (typeof ir.maxTokens === "number") gc.maxOutputTokens = ir.maxTokens;
    if (ir.stopSequences && ir.stopSequences.length > 0) gc.stopSequences = ir.stopSequences.slice();
    if (ir.responseFormat?.type === "json") {
      gc.responseMimeType = "application/json";
    } else if (ir.responseFormat?.type === "json_schema") {
      gc.responseMimeType = "application/json";
      gc.responseSchema = ir.responseFormat.schema;
    }
    if (ir.thinking?.enabled) {
      gc.thinkingConfig = {
        ...typeof ir.thinking.budgetTokens === "number" ? { thinkingBudget: ir.thinking.budgetTokens } : {}
      };
    }
    if (Object.keys(gc).length > 0) out.generationConfig = gc;
    if (ir.tools && ir.tools.length > 0) {
      out.tools = [
        {
          functionDeclarations: ir.tools.map((t) => ({
            name: t.name,
            ...t.description ? { description: t.description } : {},
            parameters: t.parameters ?? { type: "object", properties: {} }
          }))
        }
      ];
    }
    if (ir.toolChoice) {
      switch (ir.toolChoice.type) {
        case "auto":
          out.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
          break;
        case "any":
          out.toolConfig = { functionCallingConfig: { mode: "ANY" } };
          break;
        case "none":
          out.toolConfig = { functionCallingConfig: { mode: "NONE" } };
          break;
        case "tool":
          out.toolConfig = {
            functionCallingConfig: {
              mode: "ANY",
              allowedFunctionNames: [ir.toolChoice.name]
            }
          };
          break;
      }
    }
    void ctx;
    return JSON.stringify(out);
  }
  function serializeMessageToGemini(msg, toolUseNames) {
    const parts = [];
    for (const block of msg.content) {
      const wire = serializeBlockToGemini(block, toolUseNames);
      if (wire) parts.push(wire);
    }
    if (parts.length === 0) return null;
    return {
      role: msg.role === "assistant" ? "model" : "user",
      parts
    };
  }
  function serializeBlockToGemini(block, toolUseNames) {
    switch (block.type) {
      case "text":
        return { text: block.text };
      case "image":
        return irImageToGeminiPart(block.source);
      case "tool_use":
        return {
          functionCall: {
            id: block.id,
            name: block.name,
            args: block.input ?? {}
          }
        };
      case "tool_result": {
        const name = toolUseNames.get(block.toolUseId) ?? block.toolUseId;
        return {
          functionResponse: {
            id: block.toolUseId,
            name,
            response: parseToolResultForGemini(block.content)
          }
        };
      }
      case "thinking":
        return null;
    }
  }
  function irImageToGeminiPart(source) {
    if (source.kind === "base64") {
      return { inlineData: { mimeType: source.mediaType, data: source.data } };
    }
    return { fileData: { fileUri: source.url } };
  }
  function parseToolResultForGemini(content) {
    if (content.kind === "text") {
      try {
        return JSON.parse(content.text);
      } catch {
        return { result: content.text };
      }
    }
    const text = content.blocks.map((b) => b.type === "text" ? b.text : "").filter((s) => s.length > 0).join("\n");
    try {
      return JSON.parse(text);
    } catch {
      return { result: text };
    }
  }
  function parseResponse3(body) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      throw new TranslationError(
        "INVALID_JSON",
        `Gemini response body is not valid JSON: ${err.message}`
      );
    }
    if (parsed.error) {
      return {
        error: {
          type: parsed.error.status ?? "api_error",
          message: parsed.error.message ?? "Gemini API error",
          ...typeof parsed.error.code === "number" ? { code: String(parsed.error.code) } : {}
        }
      };
    }
    const candidate = parsed.candidates?.[0];
    const blocks = [];
    let hasToolUse = false;
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (!part || typeof part !== "object") continue;
        if ("text" in part && typeof part.text === "string" && part.text.length > 0) {
          blocks.push({ type: "text", text: part.text });
        } else if ("functionCall" in part && part.functionCall) {
          hasToolUse = true;
          blocks.push({
            type: "tool_use",
            id: part.functionCall.id ?? part.functionCall.name,
            name: part.functionCall.name,
            input: part.functionCall.args ?? {}
          });
        }
      }
    }
    const inputTokens = parsed.usageMetadata?.promptTokenCount ?? 0;
    const candidateTokens = parsed.usageMetadata?.candidatesTokenCount ?? 0;
    const thoughtsTokens = parsed.usageMetadata?.thoughtsTokenCount ?? 0;
    return {
      id: parsed.responseId,
      model: parsed.modelVersion,
      content: blocks,
      stopReason: mapGeminiFinishToIR(candidate?.finishReason, hasToolUse),
      stopSequence: null,
      usage: {
        inputTokens,
        outputTokens: candidateTokens + thoughtsTokens
      }
    };
  }
  function serializeResponse3(ctx, ir) {
    if (isIRError(ir)) {
      return JSON.stringify({
        error: {
          code: ir.error.code ? Number(ir.error.code) || 500 : 500,
          message: ir.error.message,
          status: ir.error.type
        }
      });
    }
    const parts = [];
    for (const block of ir.content) {
      if (block.type === "text") {
        parts.push({ text: block.text });
      } else if (block.type === "tool_use") {
        parts.push({
          functionCall: {
            id: block.id,
            name: block.name,
            args: block.input ?? {}
          }
        });
      }
    }
    if (parts.length === 0) parts.push({ text: "" });
    const out = {
      candidates: [
        {
          content: { role: "model", parts },
          finishReason: mapIRStopToGeminiFinish(ir.stopReason),
          index: 0
        }
      ],
      usageMetadata: {
        promptTokenCount: ir.usage.inputTokens,
        candidatesTokenCount: ir.usage.outputTokens,
        totalTokenCount: ir.usage.inputTokens + ir.usage.outputTokens
      },
      modelVersion: ctx.srcModel ?? ir.model ?? ctx.dstModel,
      ...ir.id ? { responseId: ir.id } : {}
    };
    return JSON.stringify(out);
  }
  function mapGeminiFinishToIR(finish, hasToolUse) {
    if (finish === "STOP" && hasToolUse) return "tool_use";
    switch (finish) {
      case "STOP":
        return "end_turn";
      case "MAX_TOKENS":
        return "max_tokens";
      case "SAFETY":
      case "RECITATION":
      case "BLOCKLIST":
      case "PROHIBITED_CONTENT":
      case "SPII":
        return "refusal";
      case "MALFORMED_FUNCTION_CALL":
        return "error";
      case "LANGUAGE":
      case "OTHER":
        return "other";
      default:
        return "end_turn";
    }
  }
  function mapIRStopToGeminiFinish(stop) {
    switch (stop) {
      case "end_turn":
      case "stop_sequence":
      case "tool_use":
        return "STOP";
      case "max_tokens":
        return "MAX_TOKENS";
      case "refusal":
        return "SAFETY";
      case "error":
        return "OTHER";
      case "other":
        return "OTHER";
    }
  }
  function createStreamParser3() {
    const state = {
      buffer: "",
      started: false,
      nextBlockIndex: 0,
      textBlockIndex: null,
      textBlockOpen: false,
      inputTokens: 0,
      outputTokens: 0,
      done: false,
      pendingFinish: null,
      messageId: "",
      model: void 0,
      hasToolUse: false
    };
    return {
      process(chunk) {
        state.buffer += chunk.replace(/\r/g, "");
        const events = [];
        let idx;
        while ((idx = state.buffer.indexOf("\n\n")) !== -1) {
          const frame = state.buffer.slice(0, idx);
          state.buffer = state.buffer.slice(idx + 2);
          if (state.done) continue;
          processGeminiFrame(frame, state, events);
        }
        return events;
      },
      flush() {
        if (state.done) return [];
        const events = [];
        if (state.textBlockOpen && state.textBlockIndex != null) {
          events.push({ type: "content_block_stop", index: state.textBlockIndex });
          state.textBlockOpen = false;
        }
        if (state.started) {
          events.push({
            type: "message_delta",
            stopReason: state.pendingFinish ?? "end_turn",
            usage: { inputTokens: state.inputTokens, outputTokens: state.outputTokens }
          });
          events.push({ type: "message_stop" });
        }
        state.done = true;
        return events;
      }
    };
  }
  function processGeminiFrame(frame, state, events) {
    const dataLine = extractGeminiDataLine(frame);
    if (dataLine == null) return;
    let data;
    try {
      data = JSON.parse(dataLine);
    } catch {
      return;
    }
    if (data.error) {
      state.done = true;
      events.push({
        type: "error",
        error: {
          type: data.error.status ?? "api_error",
          message: data.error.message ?? "Gemini stream error"
        }
      });
      return;
    }
    if (!state.started) {
      state.started = true;
      if (data.responseId) state.messageId = data.responseId;
      if (data.modelVersion) state.model = data.modelVersion;
      events.push({
        type: "message_start",
        id: state.messageId,
        model: state.model,
        usage: {}
      });
    }
    if (data.usageMetadata) {
      if (typeof data.usageMetadata.promptTokenCount === "number") {
        state.inputTokens = data.usageMetadata.promptTokenCount;
      }
      const cand = data.usageMetadata.candidatesTokenCount ?? 0;
      const thoughts = data.usageMetadata.thoughtsTokenCount ?? 0;
      if (cand > 0 || thoughts > 0) state.outputTokens = cand + thoughts;
    }
    const candidate = data.candidates?.[0];
    if (!candidate) return;
    if (Array.isArray(candidate.content?.parts)) {
      for (const part of candidate.content.parts) {
        if (!part || typeof part !== "object") continue;
        if ("text" in part && typeof part.text === "string" && part.text.length > 0) {
          if (!state.textBlockOpen) {
            state.textBlockIndex = state.nextBlockIndex++;
            state.textBlockOpen = true;
            events.push({
              type: "content_block_start",
              index: state.textBlockIndex,
              block: { type: "text" }
            });
          }
          events.push({ type: "text_delta", index: state.textBlockIndex, text: part.text });
        } else if ("functionCall" in part && part.functionCall) {
          if (state.textBlockOpen && state.textBlockIndex != null) {
            events.push({ type: "content_block_stop", index: state.textBlockIndex });
            state.textBlockOpen = false;
            state.textBlockIndex = null;
          }
          const blockIdx = state.nextBlockIndex++;
          const fc = part.functionCall;
          state.hasToolUse = true;
          events.push({
            type: "content_block_start",
            index: blockIdx,
            block: { type: "tool_use", id: fc.id ?? fc.name, name: fc.name }
          });
          events.push({
            type: "tool_input_delta",
            index: blockIdx,
            partialJson: JSON.stringify(fc.args ?? {})
          });
          events.push({ type: "content_block_stop", index: blockIdx });
        }
      }
    }
    if (candidate.finishReason) {
      state.pendingFinish = mapGeminiFinishToIR(candidate.finishReason, state.hasToolUse);
    }
  }
  function extractGeminiDataLine(frame) {
    const lines = frame.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) return line.slice(6);
      if (line.startsWith("data:")) return line.slice(5).trimStart();
    }
    return null;
  }
  function createStreamSerializer3(ctx) {
    const state = {
      model: ctx.srcModel ?? ctx.dstModel,
      responseId: `msg_${ctx.requestId}`,
      blocks: /* @__PURE__ */ new Map(),
      inputTokens: 0,
      outputTokens: 0,
      pendingFinish: "STOP",
      done: false
    };
    function emitFrame2(data) {
      return `data: ${JSON.stringify(data)}

`;
    }
    return {
      process(events) {
        let out = "";
        for (const event of events) {
          if (state.done) break;
          switch (event.type) {
            case "message_start":
              if (event.id) state.responseId = event.id;
              if (event.model) state.model = event.model;
              if (typeof event.usage.inputTokens === "number") state.inputTokens = event.usage.inputTokens;
              if (typeof event.usage.outputTokens === "number") state.outputTokens = event.usage.outputTokens;
              break;
            case "content_block_start":
              state.blocks.set(event.index, {
                type: event.block.type,
                ...event.block.type === "tool_use" ? { id: event.block.id, name: event.block.name } : {},
                args: ""
              });
              break;
            case "text_delta":
              out += emitFrame2({
                candidates: [
                  {
                    content: { role: "model", parts: [{ text: event.text }] },
                    index: 0
                  }
                ],
                modelVersion: state.model,
                responseId: state.responseId
              });
              break;
            case "tool_input_delta": {
              const entry = state.blocks.get(event.index);
              if (entry) entry.args += event.partialJson;
              break;
            }
            case "content_block_stop": {
              const entry = state.blocks.get(event.index);
              if (entry && entry.type === "tool_use" && entry.name) {
                let args = {};
                if (entry.args) {
                  try {
                    args = JSON.parse(entry.args);
                  } catch {
                    args = { _raw: entry.args };
                  }
                }
                out += emitFrame2({
                  candidates: [
                    {
                      content: {
                        role: "model",
                        parts: [{ functionCall: { id: entry.id, name: entry.name, args } }]
                      },
                      index: 0
                    }
                  ],
                  modelVersion: state.model,
                  responseId: state.responseId
                });
              }
              state.blocks.delete(event.index);
              break;
            }
            case "thinking_delta":
              break;
            case "message_delta":
              if (typeof event.usage?.inputTokens === "number") state.inputTokens = event.usage.inputTokens;
              if (typeof event.usage?.outputTokens === "number") state.outputTokens = event.usage.outputTokens;
              state.pendingFinish = mapIRStopToGeminiFinish(event.stopReason ?? "end_turn");
              break;
            case "message_stop":
              out += emitFrame2({
                candidates: [
                  {
                    content: { role: "model", parts: [] },
                    finishReason: state.pendingFinish,
                    index: 0
                  }
                ],
                usageMetadata: {
                  promptTokenCount: state.inputTokens,
                  candidatesTokenCount: state.outputTokens,
                  totalTokenCount: state.inputTokens + state.outputTokens
                },
                modelVersion: state.model,
                responseId: state.responseId
              });
              state.done = true;
              break;
            case "error":
              out += emitFrame2({
                error: {
                  code: 500,
                  message: event.error.message,
                  status: event.error.type
                }
              });
              state.done = true;
              break;
          }
        }
        return out;
      },
      flush() {
        state.done = true;
        return "";
      }
    };
  }

  // src/translate/adapters/cohere.ts
  var CHAT_ENDPOINT3 = "/v2/chat";
  var cohereAdapter = {
    family: "cohere",
    chatEndpoint: CHAT_ENDPOINT3,
    matchesChatEndpoint(url) {
      try {
        const u = new URL(url);
        return u.pathname === CHAT_ENDPOINT3 || u.pathname.endsWith(CHAT_ENDPOINT3);
      } catch {
        return false;
      }
    },
    buildChatUrl(base) {
      return `${base.replace(/\/$/, "")}${CHAT_ENDPOINT3}`;
    },
    parseRequest: parseRequest4,
    serializeRequest: serializeRequest4,
    parseResponse: parseResponse4,
    serializeResponse: serializeResponse4,
    createStreamParser: createStreamParser4,
    createStreamSerializer: createStreamSerializer4
  };
  function parseRequest4(body) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      throw new TranslationError(
        "INVALID_JSON",
        `Cohere request body is not valid JSON: ${err.message}`
      );
    }
    const ir = {
      model: parsed.model,
      system: [],
      messages: []
    };
    if (Array.isArray(parsed.messages)) {
      ir.messages = translateCohereConversationToIR(parsed.messages, ir);
    }
    if (typeof parsed.temperature === "number") ir.temperature = parsed.temperature;
    if (typeof parsed.p === "number") ir.topP = parsed.p;
    if (typeof parsed.k === "number") ir.topK = parsed.k;
    if (typeof parsed.max_tokens === "number") ir.maxTokens = parsed.max_tokens;
    if (Array.isArray(parsed.stop_sequences) && parsed.stop_sequences.length > 0) {
      ir.stopSequences = parsed.stop_sequences.slice();
    }
    if (typeof parsed.stream === "boolean") ir.stream = parsed.stream;
    if (parsed.response_format) {
      if (parsed.response_format.type === "json_object") {
        if (parsed.response_format.json_schema) {
          ir.responseFormat = { type: "json_schema", schema: parsed.response_format.json_schema };
        } else {
          ir.responseFormat = { type: "json" };
        }
      }
    }
    if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
      ir.tools = parsed.tools.filter((t) => t && t.type === "function" && t.function).map((t) => ({
        name: t.function.name,
        ...t.function.description ? { description: t.function.description } : {},
        parameters: t.function.parameters ?? { type: "object", properties: {} }
      }));
    }
    if (parsed.tool_choice === "REQUIRED") {
      ir.toolChoice = { type: "any" };
    } else if (parsed.tool_choice === "NONE") {
      ir.toolChoice = { type: "none" };
    }
    if (parsed.thinking && parsed.thinking.type === "enabled") {
      ir.thinking = {
        enabled: true,
        ...typeof parsed.thinking.token_budget === "number" ? { budgetTokens: parsed.thinking.token_budget } : {}
      };
    }
    return ir;
  }
  function translateCohereConversationToIR(messages, ir) {
    const out = [];
    let pendingToolResults = [];
    const flushPending = () => {
      if (pendingToolResults.length === 0) return;
      out.push({ role: "user", content: pendingToolResults });
      pendingToolResults = [];
    };
    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      switch (m.role) {
        case "system": {
          const text = flattenCohereContent(m.content);
          if (text) ir.system.push({ text });
          break;
        }
        case "tool": {
          pendingToolResults.push({
            type: "tool_result",
            toolUseId: m.tool_call_id,
            content: { kind: "text", text: flattenCohereToolResultContent(m.content) }
          });
          break;
        }
        case "user": {
          const blocks = parseCohereUserContent(m.content);
          if (pendingToolResults.length > 0) {
            out.push({ role: "user", content: [...pendingToolResults, ...blocks] });
            pendingToolResults = [];
          } else {
            out.push({ role: "user", content: blocks });
          }
          break;
        }
        case "assistant": {
          flushPending();
          out.push(parseCohereAssistantMessage(m));
          break;
        }
      }
    }
    flushPending();
    return out;
  }
  function parseCohereUserContent(content) {
    if (typeof content === "string") {
      return content.length > 0 ? [{ type: "text", text: content }] : [];
    }
    if (!Array.isArray(content)) return [];
    const out = [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "text" && typeof part.text === "string") {
        out.push({ type: "text", text: part.text });
      } else if (part.type === "image_url") {
        const url = extractCohereImageUrl(part.image_url);
        const source = parseImageUrl2(url);
        if (source) out.push({ type: "image", source });
      }
    }
    return out;
  }
  function parseCohereAssistantMessage(m) {
    const blocks = [];
    if (m.tool_plan && m.tool_plan.length > 0) {
      blocks.push({ type: "thinking", text: m.tool_plan, toolPlanning: true });
    }
    if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (!part || typeof part !== "object") continue;
        if (part.type === "text" && typeof part.text === "string") {
          blocks.push({ type: "text", text: part.text });
        } else if (part.type === "thinking" && typeof part.thinking === "string") {
          blocks.push({ type: "thinking", text: part.thinking });
        }
      }
    }
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        if (!tc || tc.type !== "function" || !tc.function) continue;
        let input;
        try {
          input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          input = { _raw: tc.function.arguments };
        }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }
    }
    return { role: "assistant", content: blocks };
  }
  function flattenCohereContent(content) {
    if (content == null) return "";
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map((p) => p && typeof p === "object" && p.type === "text" ? p.text ?? "" : "").filter((s) => s.length > 0).join("\n");
  }
  function flattenCohereToolResultContent(content) {
    if (content == null) return "";
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map((p) => {
      if (!p || typeof p !== "object") return "";
      if (p.type === "document" && p.document && typeof p.document.data === "string") {
        return p.document.data;
      }
      if (p.type === "text" && typeof p.text === "string") {
        return p.text;
      }
      return "";
    }).filter((s) => s.length > 0).join("\n");
  }
  function extractCohereImageUrl(image_url) {
    if (typeof image_url === "string") return image_url;
    if (image_url && typeof image_url === "object" && typeof image_url.url === "string") {
      return image_url.url;
    }
    return "";
  }
  function parseImageUrl2(url) {
    if (!url) return null;
    if (url.startsWith("data:")) {
      const match = /^data:([^;,]+);base64,(.+)$/.exec(url);
      if (!match) return null;
      return { kind: "base64", mediaType: match[1], data: match[2] };
    }
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return { kind: "url", url };
    }
    return null;
  }
  function serializeRequest4(ctx, ir) {
    if (typeof ir.n === "number" && ir.n > 1) {
      throw new TranslationError(
        "UNSUPPORTED_FEATURE",
        "Cohere v2 does not support generating multiple completions per request."
      );
    }
    const messages = [];
    if (ir.system.length > 0) {
      const text = ir.system.map((p) => p.text).join("\n\n");
      if (text) messages.push({ role: "system", content: text });
    }
    for (const msg of ir.messages) {
      for (const wire of serializeMessageToCohere(msg)) {
        messages.push(wire);
      }
    }
    const out = {
      model: ctx.dstModel,
      messages
    };
    if (typeof ir.maxTokens === "number") out.max_tokens = ir.maxTokens;
    if (typeof ir.temperature === "number") out.temperature = ir.temperature;
    if (typeof ir.topP === "number") out.p = ir.topP;
    if (typeof ir.topK === "number") out.k = ir.topK;
    if (ir.stopSequences && ir.stopSequences.length > 0) out.stop_sequences = ir.stopSequences.slice();
    if (typeof ir.stream === "boolean") out.stream = ir.stream;
    if (ir.responseFormat?.type === "json") {
      out.response_format = { type: "json_object" };
    } else if (ir.responseFormat?.type === "json_schema") {
      out.response_format = { type: "json_object", json_schema: ir.responseFormat.schema };
    }
    if (ir.tools && ir.tools.length > 0) {
      out.tools = ir.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          ...t.description ? { description: t.description } : {},
          parameters: t.parameters ?? { type: "object", properties: {} }
        }
      }));
    }
    if (ir.toolChoice) {
      switch (ir.toolChoice.type) {
        case "any":
          out.tool_choice = "REQUIRED";
          break;
        case "tool":
          throw new TranslationError(
            "UNSUPPORTED_FEATURE",
            "Cohere does not support forcing a specific tool by name."
          );
        case "none":
          out.tool_choice = "NONE";
          break;
      }
    }
    if (ir.thinking?.enabled) {
      out.thinking = {
        type: "enabled",
        ...typeof ir.thinking.budgetTokens === "number" ? { token_budget: ir.thinking.budgetTokens } : {}
      };
    }
    return JSON.stringify(out);
  }
  function serializeMessageToCohere(msg) {
    if (msg.role === "user") return serializeUserMessageToCohere(msg);
    return serializeAssistantMessageToCohere(msg);
  }
  function serializeUserMessageToCohere(msg) {
    const out = [];
    const userParts = [];
    for (const block of msg.content) {
      switch (block.type) {
        case "text":
          userParts.push({ type: "text", text: block.text });
          break;
        case "image": {
          const url = irImageSourceToUrl(block.source);
          if (url) userParts.push({ type: "image_url", image_url: { url } });
          break;
        }
        case "tool_result":
          out.push({
            role: "tool",
            tool_call_id: block.toolUseId,
            content: flattenIRToolResultContent2(block.content)
          });
          break;
        default:
          break;
      }
    }
    if (userParts.length > 0) {
      if (userParts.every((p) => p.type === "text")) {
        out.push({
          role: "user",
          content: userParts.map((p) => p.text).join("\n")
        });
      } else {
        out.push({ role: "user", content: userParts });
      }
    }
    return out;
  }
  function serializeAssistantMessageToCohere(msg) {
    const contentParts = [];
    const toolCalls = [];
    let toolPlan;
    for (const block of msg.content) {
      if (block.type === "text") {
        contentParts.push({ type: "text", text: block.text });
      } else if (block.type === "thinking") {
        if (block.toolPlanning) {
          toolPlan = (toolPlan ?? "") + block.text;
        } else {
          contentParts.push({ type: "thinking", thinking: block.text });
        }
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) }
        });
      }
    }
    const msgOut = {
      role: "assistant",
      content: contentParts
    };
    if (toolPlan) msgOut.tool_plan = toolPlan;
    if (toolCalls.length > 0) msgOut.tool_calls = toolCalls;
    return [msgOut];
  }
  function irImageSourceToUrl(source) {
    if (source.kind === "base64") {
      return `data:${source.mediaType};base64,${source.data}`;
    }
    return source.url;
  }
  function flattenIRToolResultContent2(content) {
    if (content.kind === "text") return content.text;
    return content.blocks.map((b) => b.type === "text" ? b.text : "").filter((s) => s.length > 0).join("\n");
  }
  function parseResponse4(body) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      throw new TranslationError(
        "INVALID_JSON",
        `Cohere response body is not valid JSON: ${err.message}`
      );
    }
    if (typeof parsed.message === "string") {
      return {
        error: {
          type: "api_error",
          message: parsed.message
        }
      };
    }
    const msg = parsed.message;
    if (!msg || msg.role !== "assistant") {
      return {
        error: {
          type: "api_error",
          message: "Cohere returned an unexpected response shape"
        }
      };
    }
    const blocks = [];
    if (typeof msg.tool_plan === "string" && msg.tool_plan.length > 0) {
      blocks.push({ type: "thinking", text: msg.tool_plan, toolPlanning: true });
    }
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (!part || typeof part !== "object") continue;
        if (part.type === "text" && typeof part.text === "string") {
          blocks.push({ type: "text", text: part.text });
        } else if (part.type === "thinking" && typeof part.thinking === "string") {
          blocks.push({ type: "thinking", text: part.thinking });
        }
      }
    }
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (!tc || tc.type !== "function" || !tc.function) continue;
        let input;
        try {
          input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          input = { _raw: tc.function.arguments };
        }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }
    }
    const tokens = parsed.usage?.tokens;
    return {
      id: parsed.id,
      content: blocks,
      stopReason: mapCohereFinishToIR(parsed.finish_reason),
      stopSequence: null,
      usage: {
        inputTokens: tokens?.input_tokens ?? 0,
        outputTokens: tokens?.output_tokens ?? 0
      }
    };
  }
  function serializeResponse4(ctx, ir) {
    if (isIRError(ir)) {
      return JSON.stringify({ message: ir.error.message });
    }
    const contentParts = [];
    const toolCalls = [];
    let toolPlan;
    for (const block of ir.content) {
      if (block.type === "text") {
        contentParts.push({ type: "text", text: block.text });
      } else if (block.type === "thinking") {
        if (block.toolPlanning) {
          toolPlan = (toolPlan ?? "") + block.text;
        } else {
          contentParts.push({ type: "thinking", thinking: block.text });
        }
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) }
        });
      }
    }
    const out = {
      id: ir.id ?? `msg_${ctx.requestId}`,
      finish_reason: mapIRStopToCohere(ir.stopReason),
      message: {
        role: "assistant",
        content: contentParts,
        ...toolPlan ? { tool_plan: toolPlan } : {},
        ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {}
      },
      usage: {
        tokens: {
          input_tokens: ir.usage.inputTokens,
          output_tokens: ir.usage.outputTokens
        },
        billed_units: {
          input_tokens: ir.usage.inputTokens,
          output_tokens: ir.usage.outputTokens
        }
      }
    };
    return JSON.stringify(out);
  }
  function mapCohereFinishToIR(finish) {
    switch (finish) {
      case "COMPLETE":
        return "end_turn";
      case "STOP_SEQUENCE":
        return "stop_sequence";
      case "MAX_TOKENS":
        return "max_tokens";
      case "TOOL_CALL":
        return "tool_use";
      case "ERROR":
        return "error";
      case "TIMEOUT":
        return "other";
      default:
        return "end_turn";
    }
  }
  function mapIRStopToCohere(stop) {
    switch (stop) {
      case "end_turn":
        return "COMPLETE";
      case "max_tokens":
        return "MAX_TOKENS";
      case "stop_sequence":
        return "STOP_SEQUENCE";
      case "tool_use":
        return "TOOL_CALL";
      case "error":
        return "ERROR";
      case "refusal":
        return "ERROR";
      case "other":
        return "COMPLETE";
    }
  }
  function createStreamParser4() {
    const state = {
      buffer: "",
      started: false,
      done: false,
      messageId: "",
      // cohere index → IR block index
      textBlocks: /* @__PURE__ */ new Map(),
      toolBlocks: /* @__PURE__ */ new Map(),
      toolPlanOpen: false,
      toolPlanIndex: null,
      nextBlockIndex: 0
    };
    return {
      process(chunk) {
        state.buffer += chunk.replace(/\r/g, "");
        const events = [];
        let idx;
        while ((idx = state.buffer.indexOf("\n\n")) !== -1) {
          const frame = state.buffer.slice(0, idx);
          state.buffer = state.buffer.slice(idx + 2);
          if (state.done) continue;
          processCohereFrame(frame, state, events);
        }
        return events;
      },
      flush() {
        if (state.done) return [];
        state.done = true;
        return [];
      }
    };
  }
  function processCohereFrame(frame, state, events) {
    const dataLine = extractCohereDataLine(frame);
    if (dataLine == null) return;
    let data;
    try {
      data = JSON.parse(dataLine);
    } catch {
      return;
    }
    switch (data.type) {
      case "message-start": {
        if (state.started) return;
        state.started = true;
        state.messageId = data.id ?? "";
        events.push({
          type: "message_start",
          id: state.messageId,
          usage: {}
        });
        return;
      }
      case "content-start": {
        if (typeof data.index !== "number") return;
        const blockIdx = state.nextBlockIndex++;
        state.textBlocks.set(data.index, blockIdx);
        events.push({
          type: "content_block_start",
          index: blockIdx,
          block: { type: "text" }
        });
        return;
      }
      case "content-delta": {
        if (typeof data.index !== "number") return;
        const blockIdx = state.textBlocks.get(data.index);
        if (blockIdx == null) return;
        const text = data.delta?.message?.content?.text;
        if (typeof text === "string" && text.length > 0) {
          events.push({ type: "text_delta", index: blockIdx, text });
        }
        return;
      }
      case "content-end": {
        if (typeof data.index !== "number") return;
        const blockIdx = state.textBlocks.get(data.index);
        if (blockIdx == null) return;
        events.push({ type: "content_block_stop", index: blockIdx });
        state.textBlocks.delete(data.index);
        return;
      }
      case "tool-plan-delta": {
        const text = data.delta?.message?.tool_plan;
        if (typeof text !== "string" || text.length === 0) return;
        if (!state.toolPlanOpen) {
          state.toolPlanIndex = state.nextBlockIndex++;
          state.toolPlanOpen = true;
          events.push({
            type: "content_block_start",
            index: state.toolPlanIndex,
            block: { type: "thinking", toolPlanning: true }
          });
        }
        events.push({ type: "thinking_delta", index: state.toolPlanIndex, text });
        return;
      }
      case "tool-call-start": {
        if (state.toolPlanOpen && state.toolPlanIndex != null) {
          events.push({ type: "content_block_stop", index: state.toolPlanIndex });
          state.toolPlanOpen = false;
          state.toolPlanIndex = null;
        }
        if (typeof data.index !== "number") return;
        const tc = data.delta?.message?.tool_calls;
        if (!tc || !tc.id || !tc.function?.name) return;
        const blockIdx = state.nextBlockIndex++;
        state.toolBlocks.set(data.index, {
          blockIndex: blockIdx,
          id: tc.id,
          name: tc.function.name
        });
        events.push({
          type: "content_block_start",
          index: blockIdx,
          block: { type: "tool_use", id: tc.id, name: tc.function.name }
        });
        return;
      }
      case "tool-call-delta": {
        if (typeof data.index !== "number") return;
        const entry = state.toolBlocks.get(data.index);
        if (!entry) return;
        const args = data.delta?.message?.tool_calls?.function?.arguments;
        if (typeof args === "string" && args.length > 0) {
          events.push({ type: "tool_input_delta", index: entry.blockIndex, partialJson: args });
        }
        return;
      }
      case "tool-call-end": {
        if (typeof data.index !== "number") return;
        const entry = state.toolBlocks.get(data.index);
        if (!entry) return;
        events.push({ type: "content_block_stop", index: entry.blockIndex });
        state.toolBlocks.delete(data.index);
        return;
      }
      case "message-end": {
        if (state.toolPlanOpen && state.toolPlanIndex != null) {
          events.push({ type: "content_block_stop", index: state.toolPlanIndex });
          state.toolPlanOpen = false;
          state.toolPlanIndex = null;
        }
        if (data.delta?.error) {
          events.push({
            type: "error",
            error: { type: "api_error", message: data.delta.error }
          });
          state.done = true;
          return;
        }
        const stopReason = mapCohereFinishToIR(data.delta?.finish_reason);
        const tokens = data.delta?.usage?.tokens;
        events.push({
          type: "message_delta",
          stopReason,
          ...tokens ? {
            usage: {
              inputTokens: tokens.input_tokens ?? 0,
              outputTokens: tokens.output_tokens ?? 0
            }
          } : {}
        });
        events.push({ type: "message_stop" });
        state.done = true;
        return;
      }
      default:
        return;
    }
  }
  function extractCohereDataLine(frame) {
    const lines = frame.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) return line.slice(6);
      if (line.startsWith("data:")) return line.slice(5).trimStart();
    }
    return null;
  }
  function createStreamSerializer4(ctx) {
    const state = {
      messageId: `msg_${ctx.requestId}`,
      nextCohereIndex: 0,
      // IR block index → { cohereIndex, kind }
      blocks: /* @__PURE__ */ new Map(),
      done: false,
      inputTokens: 0,
      outputTokens: 0,
      pendingFinish: "COMPLETE"
    };
    function emitFrame2(data) {
      return `data: ${JSON.stringify(data)}

`;
    }
    return {
      process(events) {
        let out = "";
        for (const event of events) {
          if (state.done) break;
          out += serializeCohereStreamEvent(event, state, emitFrame2);
        }
        return out;
      },
      flush() {
        state.done = true;
        return "";
      }
    };
  }
  function serializeCohereStreamEvent(event, state, emitFrame2) {
    switch (event.type) {
      case "message_start":
        if (event.id) state.messageId = event.id;
        if (typeof event.usage.inputTokens === "number") state.inputTokens = event.usage.inputTokens;
        if (typeof event.usage.outputTokens === "number") state.outputTokens = event.usage.outputTokens;
        return emitFrame2({
          type: "message-start",
          id: state.messageId,
          delta: { message: { role: "assistant" } }
        });
      case "content_block_start": {
        const cohereIndex = state.nextCohereIndex++;
        if (event.block.type === "text") {
          state.blocks.set(event.index, { cohereIndex, kind: "text" });
          return emitFrame2({
            type: "content-start",
            index: cohereIndex,
            delta: { message: { content: { type: "text", text: "" } } }
          });
        }
        if (event.block.type === "tool_use") {
          state.blocks.set(event.index, { cohereIndex, kind: "tool_use" });
          return emitFrame2({
            type: "tool-call-start",
            index: cohereIndex,
            delta: {
              message: {
                tool_calls: {
                  id: event.block.id,
                  type: "function",
                  function: { name: event.block.name, arguments: "" }
                }
              }
            }
          });
        }
        state.blocks.set(event.index, { cohereIndex, kind: "thinking" });
        return "";
      }
      case "text_delta": {
        const entry = state.blocks.get(event.index);
        if (!entry || entry.kind !== "text") return "";
        return emitFrame2({
          type: "content-delta",
          index: entry.cohereIndex,
          delta: { message: { content: { text: event.text } } }
        });
      }
      case "tool_input_delta": {
        const entry = state.blocks.get(event.index);
        if (!entry || entry.kind !== "tool_use") return "";
        return emitFrame2({
          type: "tool-call-delta",
          index: entry.cohereIndex,
          delta: { message: { tool_calls: { function: { arguments: event.partialJson } } } }
        });
      }
      case "thinking_delta": {
        const entry = state.blocks.get(event.index);
        if (!entry || entry.kind !== "thinking") return "";
        return emitFrame2({
          type: "tool-plan-delta",
          delta: { message: { tool_plan: event.text } }
        });
      }
      case "content_block_stop": {
        const entry = state.blocks.get(event.index);
        if (!entry) return "";
        state.blocks.delete(event.index);
        if (entry.kind === "text") {
          return emitFrame2({ type: "content-end", index: entry.cohereIndex });
        }
        if (entry.kind === "tool_use") {
          return emitFrame2({ type: "tool-call-end", index: entry.cohereIndex });
        }
        return "";
      }
      case "message_delta":
        if (typeof event.usage?.inputTokens === "number") state.inputTokens = event.usage.inputTokens;
        if (typeof event.usage?.outputTokens === "number") state.outputTokens = event.usage.outputTokens;
        if (event.stopReason) state.pendingFinish = mapIRStopToCohere(event.stopReason);
        return "";
      case "message_stop":
        state.done = true;
        return emitFrame2({
          type: "message-end",
          delta: {
            finish_reason: state.pendingFinish,
            usage: {
              tokens: {
                input_tokens: state.inputTokens,
                output_tokens: state.outputTokens
              }
            }
          }
        });
      case "error":
        state.done = true;
        return emitFrame2({
          type: "message-end",
          delta: {
            finish_reason: "ERROR",
            error: event.error.message
          }
        });
    }
  }

  // src/providers.ts
  var PROVIDERS = {
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      authMethods: ["api_key", "oauth"],
      baseUrl: "https://api.anthropic.com"
    },
    openai: {
      id: "openai",
      name: "OpenAI",
      authMethods: ["api_key"],
      baseUrl: "https://api.openai.com"
    },
    gemini: {
      id: "gemini",
      name: "Google Gemini",
      authMethods: ["api_key"],
      baseUrl: "https://generativelanguage.googleapis.com"
    },
    mistral: {
      id: "mistral",
      name: "Mistral",
      authMethods: ["api_key"],
      baseUrl: "https://api.mistral.ai"
    },
    cohere: {
      id: "cohere",
      name: "Cohere",
      authMethods: ["api_key"],
      baseUrl: "https://api.cohere.com"
    },
    xai: {
      id: "xai",
      name: "xAI (Grok)",
      authMethods: ["api_key"],
      baseUrl: "https://api.x.ai"
    },
    deepseek: {
      id: "deepseek",
      name: "DeepSeek",
      authMethods: ["api_key"],
      baseUrl: "https://api.deepseek.com",
      chatPath: "/chat/completions"
    },
    perplexity: {
      id: "perplexity",
      name: "Perplexity",
      authMethods: ["api_key"],
      baseUrl: "https://api.perplexity.ai",
      chatPath: "/chat/completions"
    },
    groq: {
      id: "groq",
      name: "Groq",
      authMethods: ["api_key"],
      baseUrl: "https://api.groq.com",
      chatPath: "/openai/v1/chat/completions"
    },
    together: {
      id: "together",
      name: "Together AI",
      authMethods: ["api_key"],
      baseUrl: "https://api.together.xyz"
    },
    fireworks: {
      id: "fireworks",
      name: "Fireworks AI",
      authMethods: ["api_key"],
      baseUrl: "https://api.fireworks.ai",
      chatPath: "/inference/v1/chat/completions"
    },
    openrouter: {
      id: "openrouter",
      name: "OpenRouter",
      authMethods: ["api_key"],
      baseUrl: "https://openrouter.ai/api"
    },
    azure_openai: {
      id: "azure_openai",
      name: "Azure OpenAI",
      authMethods: ["api_key"],
      baseUrl: "https://YOUR_RESOURCE.openai.azure.com"
    }
  };

  // src/translate/families.ts
  var FAMILY_PROVIDERS = {
    anthropic: /* @__PURE__ */ new Set(["anthropic"]),
    openai: /* @__PURE__ */ new Set([
      "openai",
      "azure_openai",
      "groq",
      "together",
      "deepseek",
      "xai",
      "perplexity",
      "fireworks",
      "openrouter",
      "mistral"
    ]),
    gemini: /* @__PURE__ */ new Set(["gemini"]),
    cohere: /* @__PURE__ */ new Set(["cohere"])
  };
  function familyOf(providerId) {
    for (const family of Object.keys(FAMILY_PROVIDERS)) {
      if (FAMILY_PROVIDERS[family].has(providerId)) return family;
    }
    return null;
  }
  function shouldTranslate(srcProviderId, dstProviderId) {
    const src = familyOf(srcProviderId);
    if (!src || !hasAdapter(src)) return false;
    const dst = familyOf(dstProviderId);
    if (!dst || !hasAdapter(dst)) return false;
    return src !== dst;
  }
  function sameFamily(srcProviderId, dstProviderId) {
    const src = familyOf(srcProviderId);
    if (!src) return false;
    return src === familyOf(dstProviderId);
  }
  function rewriteProxyUrl(dstProviderId, model, stream) {
    const provider = PROVIDERS[dstProviderId];
    if (!provider) return null;
    const family = familyOf(dstProviderId);
    if (!family || !hasAdapter(family)) return null;
    const base = provider.baseUrl.replace(/\/$/, "");
    if (provider.chatPath) {
      return `${base}${provider.chatPath}`;
    }
    return getAdapter(family).buildChatUrl(base, model, stream);
  }

  // src/translate/index.ts
  registerAdapter(anthropicAdapter);
  registerAdapter(openaiAdapter);
  registerAdapter(geminiAdapter);
  registerAdapter(cohereAdapter);
  function translateRequest(ctx, body) {
    const src = getAdapter(ctx.srcFamily);
    const dst = getAdapter(ctx.dstFamily);
    const ir = src.parseRequest(body);
    return dst.serializeRequest(ctx, ir);
  }
  function translateResponse(ctx, body) {
    const dst = getAdapter(ctx.dstFamily);
    const src = getAdapter(ctx.srcFamily);
    const ir = dst.parseResponse(body);
    return src.serializeResponse(ctx, ir);
  }
  function createStreamTranslator(ctx) {
    const dst = getAdapter(ctx.dstFamily);
    const src = getAdapter(ctx.srcFamily);
    const parser = dst.createStreamParser();
    const serializer = src.createStreamSerializer(ctx);
    return {
      process(chunk) {
        const events = parser.process(chunk);
        return serializer.process(events);
      },
      flush() {
        const trailing = parser.flush();
        let out = serializer.process(trailing);
        out += serializer.flush();
        return out;
      }
    };
  }

  // src/proxy-utils.ts
  var MAX_BODY_PARSE_SIZE = 10485760;
  function detectRequestCapabilities(body) {
    const empty = {
      tools: false,
      vision: false,
      structuredOutput: false,
      reasoning: false
    };
    if (!body || body.length > MAX_BODY_PARSE_SIZE) return empty;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return empty;
    }
    const out = { ...empty };
    if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
      out.tools = true;
    }
    const rf = parsed.response_format;
    if (rf && typeof rf === "object" && rf.type === "json_schema") {
      out.structuredOutput = true;
    }
    if (parsed.thinking != null) {
      out.reasoning = true;
    }
    if (Array.isArray(parsed.messages)) {
      outer: for (const msg of parsed.messages) {
        const content = msg?.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const type = block.type;
          if (type === "image" || type === "image_url") {
            out.vision = true;
            break outer;
          }
        }
      }
    }
    return out;
  }

  // src/translate/mobile-entry.ts
  var streams = /* @__PURE__ */ new Map();
  var nextHandle = 1;
  var bridge = {
    translateRequest(ctxJson, body) {
      const ctx = JSON.parse(ctxJson);
      return translateRequest(ctx, body);
    },
    translateResponse(ctxJson, body) {
      const ctx = JSON.parse(ctxJson);
      return translateResponse(ctx, body);
    },
    createStreamTranslator(ctxJson) {
      const ctx = JSON.parse(ctxJson);
      const handle = nextHandle++;
      streams.set(handle, createStreamTranslator(ctx));
      return handle;
    },
    processStreamChunk(handle, chunk) {
      const s = streams.get(handle);
      if (!s) throw new Error(`byoky: unknown stream handle ${handle}`);
      return s.process(chunk);
    },
    flushStreamTranslator(handle) {
      const s = streams.get(handle);
      if (!s) throw new Error(`byoky: unknown stream handle ${handle}`);
      const out = s.flush();
      streams.delete(handle);
      return out;
    },
    releaseStreamTranslator(handle) {
      streams.delete(handle);
    },
    shouldTranslate(srcProviderId, dstProviderId) {
      return shouldTranslate(srcProviderId, dstProviderId);
    },
    sameFamily(srcProviderId, dstProviderId) {
      return sameFamily(srcProviderId, dstProviderId);
    },
    buildTranslationContext(srcProviderId, dstProviderId, srcModel, dstModel, isStreaming, requestId) {
      const srcFamily = familyOf(srcProviderId);
      const dstFamily = familyOf(dstProviderId);
      if (!srcFamily) throw new Error(`byoky: unknown source family for provider "${srcProviderId}"`);
      if (!dstFamily) throw new Error(`byoky: unknown destination family for provider "${dstProviderId}"`);
      const ctx = {
        srcFamily,
        dstFamily,
        srcModel,
        dstModel,
        isStreaming,
        requestId
      };
      return JSON.stringify(ctx);
    },
    rewriteProxyUrl(dstProviderId, model, stream) {
      return rewriteProxyUrl(dstProviderId, model, stream);
    },
    getModelsForProvider(providerId) {
      const list = modelsForProvider(providerId).map((m) => ({
        id: m.id,
        displayName: m.displayName,
        contextWindow: m.contextWindow,
        maxOutput: m.maxOutput,
        capabilities: m.capabilities
      }));
      return JSON.stringify(list);
    },
    describeModel(modelId) {
      const m = getModel(modelId);
      if (!m) return null;
      return JSON.stringify({
        id: m.id,
        providerId: m.providerId,
        family: m.family,
        displayName: m.displayName,
        contextWindow: m.contextWindow,
        maxOutput: m.maxOutput,
        capabilities: m.capabilities
      });
    },
    detectRequestCapabilities(body) {
      return JSON.stringify(detectRequestCapabilities(body));
    },
    version: "0.5.1"
  };
  globalThis.BYOKY_TRANSLATE = bridge;
})();
