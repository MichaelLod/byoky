import { useState } from 'react';
import type { ByokySession } from '@byoky/sdk';

interface Step {
  type: 'user' | 'tool_call' | 'tool_result' | 'assistant';
  content: string;
}

const prompts = [
  'What\'s the weather like in Tokyo and New York right now?',
  'Look up the weather in London, then convert 20°C to Fahrenheit.',
  'Is it warmer in Paris or Berlin today?',
];

function getWeather(city: string): { temperature: number; condition: string; humidity: number } {
  const cities: Record<string, { temperature: number; condition: string; humidity: number }> = {
    tokyo: { temperature: 22, condition: 'Partly Cloudy', humidity: 65 },
    'new york': { temperature: 18, condition: 'Sunny', humidity: 45 },
    london: { temperature: 14, condition: 'Rainy', humidity: 82 },
    paris: { temperature: 19, condition: 'Cloudy', humidity: 58 },
    berlin: { temperature: 16, condition: 'Overcast', humidity: 70 },
  };
  return cities[city.toLowerCase()] ?? { temperature: 20, condition: 'Clear', humidity: 50 };
}

function convertTemperature(value: number, from: string): { result: number; unit: string } {
  if (from === 'celsius') return { result: Math.round(value * 9 / 5 + 32), unit: 'fahrenheit' };
  return { result: Math.round((value - 32) * 5 / 9), unit: 'celsius' };
}

function executeTool(name: string, args: Record<string, unknown>): unknown {
  if (name === 'get_weather') return getWeather(args.city as string);
  if (name === 'convert_temperature') return convertTemperature(args.value as number, args.from as string);
  return { error: 'Unknown tool' };
}

// Anthropic tool format
const anthropicTools = [
  {
    name: 'get_weather',
    description: 'Get current weather for a city',
    input_schema: {
      type: 'object' as const,
      properties: { city: { type: 'string', description: 'City name' } },
      required: ['city'],
    },
  },
  {
    name: 'convert_temperature',
    description: 'Convert temperature between celsius and fahrenheit',
    input_schema: {
      type: 'object' as const,
      properties: {
        value: { type: 'number', description: 'Temperature value' },
        from: { type: 'string', enum: ['celsius', 'fahrenheit'], description: 'Source unit' },
      },
      required: ['value', 'from'],
    },
  },
];

// OpenAI-compatible tool format (used by OpenAI, Groq, DeepSeek, xAI, Mistral, Together, Fireworks, Perplexity, OpenRouter)
const openaiTools = [
  {
    type: 'function' as const,
    function: {
      name: 'get_weather',
      description: 'Get current weather for a city',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string', description: 'City name' } },
        required: ['city'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'convert_temperature',
      description: 'Convert temperature between celsius and fahrenheit',
      parameters: {
        type: 'object',
        properties: {
          value: { type: 'number', description: 'Temperature value' },
          from: { type: 'string', enum: ['celsius', 'fahrenheit'], description: 'Source unit' },
        },
        required: ['value', 'from'],
      },
    },
  },
];

// OpenAI-compatible providers with their endpoint and default model
const openaiCompatible: Record<string, { url: string; model: string; name: string }> = {
  openai:       { url: 'https://api.openai.com/v1/chat/completions',       model: 'gpt-4o',                        name: 'GPT-4o' },
  groq:         { url: 'https://api.groq.com/openai/v1/chat/completions',  model: 'llama-3.3-70b-versatile',       name: 'Llama 3.3 70B' },
  deepseek:     { url: 'https://api.deepseek.com/chat/completions',        model: 'deepseek-chat',                 name: 'DeepSeek' },
  xai:          { url: 'https://api.x.ai/v1/chat/completions',             model: 'grok-3-mini',                   name: 'Grok 3 Mini' },
  mistral:      { url: 'https://api.mistral.ai/v1/chat/completions',       model: 'mistral-large-latest',          name: 'Mistral Large' },
  together:     { url: 'https://api.together.xyz/v1/chat/completions',     model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B' },
  fireworks:    { url: 'https://api.fireworks.ai/inference/v1/chat/completions', model: 'accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Llama 3.3 70B' },
  openrouter:   { url: 'https://openrouter.ai/api/v1/chat/completions',    model: 'anthropic/claude-sonnet-4',     name: 'Claude Sonnet' },
};

// Static list of providers the tool-use tab knows how to call. The dropdown
// shows all of them — even when the wallet has no credential — so the user
// can exercise cross-family routing via the bound group.
const dropdownProviders: string[] = ['anthropic', ...Object.keys(openaiCompatible)];

interface Props {
  session: ByokySession;
}

export function ToolUseDemo({ session }: Props) {
  const [input, setInput] = useState(prompts[0]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default to anthropic if directly available, else first directly-available,
  // else just anthropic so the dropdown is populated even with zero credentials.
  const firstDirect = dropdownProviders.find(id => session.providers[id]?.available === true);
  const [selectedProvider, setSelectedProvider] = useState(
    session.providers['anthropic']?.available ? 'anthropic' : firstDirect ?? 'anthropic',
  );

  const providerLabel = selectedProvider === 'anthropic'
    ? 'Claude'
    : openaiCompatible[selectedProvider]?.name ?? selectedProvider;

  async function runAnthropic() {
    const proxyFetch = session.createFetch('anthropic');
    const messages: Array<Record<string, unknown>> = [{ role: 'user', content: input }];

    for (let round = 0; round < 5; round++) {
      const response = await proxyFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          tools: anthropicTools,
          messages,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      const toolUseBlocks = (data.content ?? []).filter((b: Record<string, string>) => b.type === 'tool_use');
      const textBlocks = (data.content ?? []).filter((b: Record<string, string>) => b.type === 'text');

      if (toolUseBlocks.length === 0) {
        setSteps((prev) => [...prev, { type: 'assistant', content: textBlocks.map((b: Record<string, string>) => b.text).join('') }]);
        break;
      }

      const toolResults: Array<Record<string, unknown>> = [];
      for (const block of toolUseBlocks) {
        const tc = block as unknown as { id: string; name: string; input: Record<string, unknown> };
        setSteps((prev) => [...prev, { type: 'tool_call', content: `${tc.name}(${JSON.stringify(tc.input)})` }]);
        const result = executeTool(tc.name, tc.input);
        const resultStr = JSON.stringify(result);
        setSteps((prev) => [...prev, { type: 'tool_result', content: resultStr }]);
        toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: resultStr });
      }

      messages.push({ role: 'assistant', content: data.content });
      messages.push({ role: 'user', content: toolResults });
    }
  }

  async function runOpenAICompatible(providerId: string) {
    const config = openaiCompatible[providerId];
    if (!config) throw new Error(`No config for ${providerId}`);

    const proxyFetch = session.createFetch(providerId);
    const messages: Array<Record<string, unknown>> = [{ role: 'user', content: input }];

    for (let round = 0; round < 5; round++) {
      const response = await proxyFetch(config.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          tools: openaiTools,
          messages,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      const msg = data.choices?.[0]?.message;

      if (!msg?.tool_calls || msg.tool_calls.length === 0) {
        setSteps((prev) => [...prev, { type: 'assistant', content: msg?.content ?? '' }]);
        break;
      }

      const toolMessages: Array<Record<string, unknown>> = [];
      for (const tc of msg.tool_calls) {
        const args = JSON.parse(tc.function.arguments);
        setSteps((prev) => [...prev, { type: 'tool_call', content: `${tc.function.name}(${JSON.stringify(args)})` }]);
        const result = executeTool(tc.function.name, args);
        const resultStr = JSON.stringify(result);
        setSteps((prev) => [...prev, { type: 'tool_result', content: resultStr }]);
        toolMessages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr });
      }

      messages.push(msg);
      messages.push(...toolMessages);
    }
  }

  async function handleRun() {
    if (!input.trim() || loading || !selectedProvider) return;
    setLoading(true);
    setError(null);
    setSteps([{ type: 'user', content: input }]);

    try {
      if (selectedProvider === 'anthropic') {
        await runAnthropic();
      } else {
        await runOpenAICompatible(selectedProvider);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="demo-panel">
      <div className="demo-header">
        <h3>Tool Use</h3>
        <select
          className="demo-provider-select"
          value={selectedProvider}
          onChange={(e) => setSelectedProvider(e.target.value)}
        >
          {dropdownProviders.map((id) => {
            const meta = session.providers[id];
            const direct = meta?.available === true;
            const isGift = meta?.gift;
            const suffix = isGift ? ' (Gift)' : direct ? '' : ' (via routing)';
            const label = id === 'anthropic' ? 'Anthropic (Claude)' : openaiCompatible[id]?.name ?? id;
            return (
              <option key={id} value={id}>{label}{suffix}</option>
            );
          })}
        </select>
      </div>
      <p className="demo-desc">
        The model calls tools (get_weather, convert_temperature) and gets results back.
        Watch the full agentic loop in real time.
      </p>

      <div className="demo-samples">
        {prompts.map((text, i) => (
          <button
            key={i}
            className={`demo-sample-btn ${input === text ? 'active' : ''}`}
            onClick={() => { setInput(text); setSteps([]); }}
          >
            Example {i + 1}
          </button>
        ))}
      </div>

      <textarea
        className="demo-textarea"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={2}
        placeholder="Ask about weather..."
      />

      <button
        className="btn btn-primary"
        onClick={handleRun}
        disabled={loading || !input.trim()}
        style={{ width: 'auto', alignSelf: 'flex-start' }}
      >
        {loading ? 'Running...' : 'Run'}
      </button>

      {error && <div className="demo-error">{error}</div>}

      {steps.length > 0 && (
        <div className="tool-steps">
          {steps.map((step, i) => (
            <div key={i} className={`tool-step tool-step-${step.type}`}>
              <div className="tool-step-label">
                {step.type === 'user' ? 'You' :
                 step.type === 'tool_call' ? 'Tool Call' :
                 step.type === 'tool_result' ? 'Result' : providerLabel}
              </div>
              <div className="tool-step-content">
                {step.type === 'tool_result' || step.type === 'tool_call' ? (
                  <code>{step.content}</code>
                ) : (
                  step.content
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="tool-step tool-step-assistant">
              <div className="tool-step-label">{providerLabel}</div>
              <div className="tool-step-content">
                <div className="typing-indicator"><span /><span /><span /></div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
