import { useState, useEffect } from 'react';
import type { ByokySession } from '@byoky/sdk';

const sampleTexts = [
  'Hi, I\'m Sarah Chen from Acme Corp. Reach me at sarah.chen@acme.io or call 555-0123.',
  'Just got back from the conference — met Dr. James Rivera, he\'s leading AI research at Nebula Labs. His email is j.rivera@nebulalabs.com.',
  'Invoice #4821 from CloudSync Inc. Total: $2,450.00. Due date: March 30, 2026. Contact: billing@cloudsync.io',
];

// Static list of providers the structured-output tab knows how to call. The
// dropdown shows all of them — even when the wallet has no credential — so
// the user can exercise cross-family routing via the bound group.
const dropdownProviders: string[] = [
  'anthropic',
  'openai', 'groq', 'deepseek', 'xai', 'mistral', 'together', 'fireworks', 'openrouter',
];

interface ExtractedData {
  [key: string]: unknown;
}

interface Props {
  session: ByokySession;
}

// All OpenAI-compatible providers support JSON mode
const openaiCompat: Record<string, { url: string; models: string[]; name: string }> = {
  openai:     { url: 'https://api.openai.com/v1/chat/completions',             models: ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.4-nano', 'gpt-5-mini', 'gpt-4o', 'gpt-4o-mini'],                                                name: 'OpenAI (GPT)' },
  groq:       { url: 'https://api.groq.com/openai/v1/chat/completions',        models: ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.1-8b-instant'],                                name: 'Groq (Llama)' },
  deepseek:   { url: 'https://api.deepseek.com/chat/completions',              models: ['deepseek-chat', 'deepseek-reasoner'],                                                                                         name: 'DeepSeek' },
  xai:        { url: 'https://api.x.ai/v1/chat/completions',                   models: ['grok-4-fast-non-reasoning', 'grok-4-fast-reasoning', 'grok-4', 'grok-3-mini'],                                                 name: 'xAI (Grok)' },
  mistral:    { url: 'https://api.mistral.ai/v1/chat/completions',             models: ['mistral-large-latest', 'mistral-small-latest'],                                                                                name: 'Mistral' },
  together:   { url: 'https://api.together.xyz/v1/chat/completions',           models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', 'Qwen/Qwen2.5-72B-Instruct-Turbo'], name: 'Together AI' },
  fireworks:  { url: 'https://api.fireworks.ai/inference/v1/chat/completions', models: ['accounts/fireworks/models/llama4-maverick-instruct-basic', 'accounts/fireworks/models/llama-v3p3-70b-instruct'],               name: 'Fireworks AI' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions',          models: ['anthropic/claude-sonnet-4.6', 'openai/gpt-5.4-mini', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct'],           name: 'OpenRouter' },
};

const anthropicModels = ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5'];

function modelsFor(id: string): string[] {
  if (id === 'anthropic') return anthropicModels;
  return openaiCompat[id]?.models ?? [];
}

export function StructuredOutput({ session }: Props) {
  const [input, setInput] = useState(sampleTexts[0]);
  const [result, setResult] = useState<ExtractedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableProviders = dropdownProviders.filter(id => session.providers[id]?.available === true);
  const [selectedProvider, setSelectedProvider] = useState(availableProviders[0] ?? '');
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem('byoky-demo-models-structured') || '{}'); } catch { return {}; }
  });
  const provider = selectedProvider;
  const currentModel = provider ? (selectedModels[provider] ?? modelsFor(provider)[0] ?? '') : '';

  useEffect(() => {
    if (selectedProvider && availableProviders.includes(selectedProvider)) return;
    setSelectedProvider(availableProviders[0] ?? '');
  }, [availableProviders, selectedProvider]);

  useEffect(() => {
    try { localStorage.setItem('byoky-demo-models-structured', JSON.stringify(selectedModels)); } catch {}
  }, [selectedModels]);

  async function handleExtract() {
    if (!input.trim() || loading || !provider) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const proxyFetch = session.createFetch(provider);

      const jsonPrompt = `Extract structured data from this text. Return a JSON object with "people" (array of {name, email, company, role}), "amounts" (array of {description, value, currency}), and "dates" (array of {description, date}). Only output valid JSON, no other text.\n\n${input}`;

      if (provider in openaiCompat) {
        const config = openaiCompat[provider];
        const body: Record<string, unknown> = {
          model: currentModel,
          messages: [{ role: 'user', content: jsonPrompt }],
        };
        // OpenAI supports strict json_schema; others use json_object mode
        if (provider === 'openai') {
          body.response_format = {
            type: 'json_schema',
            json_schema: {
              name: 'extraction',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  people: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, company: { type: 'string' }, role: { type: 'string' } }, required: ['name', 'email', 'company', 'role'], additionalProperties: false } },
                  amounts: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, value: { type: 'string' }, currency: { type: 'string' } }, required: ['description', 'value', 'currency'], additionalProperties: false } },
                  dates: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, date: { type: 'string' } }, required: ['description', 'date'], additionalProperties: false } },
                },
                required: ['people', 'amounts', 'dates'],
                additionalProperties: false,
              },
            },
          };
        } else {
          body.response_format = { type: 'json_object' };
        }

        const response = await proxyFetch(config.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error?.message || `API error: ${response.status}`);
        }

        const data = await response.json();
        setResult(JSON.parse(data.choices[0].message.content));
      } else if (provider === 'anthropic') {
        const response = await proxyFetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: currentModel,
            max_tokens: 1024,
            messages: [{
              role: 'user',
              content: `Extract structured data from this text. Return a JSON object with "people" (array of {name, email, company, role}), "amounts" (array of {description, value, currency}), and "dates" (array of {description, date}). Only output valid JSON, no other text.\n\n${input}`,
            }],
          }),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error?.message || `API error: ${response.status}`);
        }

        const data = await response.json();
        const text = data.content?.[0]?.text ?? '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          setResult(JSON.parse(jsonMatch[0]));
        } else {
          throw new Error('Could not parse structured output');
        }
      } else {
        throw new Error(`Structured output not supported for ${provider}`);
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
        <h3>Structured Output</h3>
        <select
          className="demo-provider-select"
          value={selectedProvider}
          onChange={(e) => setSelectedProvider(e.target.value)}
        >
          {availableProviders.length === 0 && (
            <option value="" disabled>No keys in wallet</option>
          )}
          {availableProviders.map((id) => {
            const meta = session.providers[id];
            const suffix = meta?.gift ? ' (Gift)' : '';
            const label = id === 'anthropic' ? 'Anthropic (Claude)' : openaiCompat[id]?.name ?? id;
            return (
              <option key={id} value={id}>{label}{suffix}</option>
            );
          })}
        </select>
        {selectedProvider && modelsFor(selectedProvider).length > 0 && (
          <select
            className="demo-provider-select"
            value={currentModel}
            onChange={(e) => setSelectedModels(prev => ({ ...prev, [selectedProvider]: e.target.value }))}
          >
            {modelsFor(selectedProvider).map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
      </div>
      <p className="demo-desc">
        Extract typed data from unstructured text. Paste any text and get back clean JSON.
      </p>

      <div className="demo-samples">
        {sampleTexts.map((text, i) => (
          <button
            key={i}
            className={`demo-sample-btn ${input === text ? 'active' : ''}`}
            onClick={() => { setInput(text); setResult(null); }}
          >
            Sample {i + 1}
          </button>
        ))}
      </div>

      <textarea
        className="demo-textarea"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={3}
        placeholder="Paste text to extract data from..."
      />

      <button
        className="btn btn-primary"
        onClick={handleExtract}
        disabled={loading || !input.trim()}
        style={{ width: 'auto', alignSelf: 'flex-start' }}
      >
        {loading ? 'Extracting...' : 'Extract'}
      </button>

      {error && <div className="demo-error">{error}</div>}

      {result && (
        <div className="demo-result">
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
