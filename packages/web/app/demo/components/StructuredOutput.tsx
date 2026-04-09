import { useState } from 'react';
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

export function StructuredOutput({ session }: Props) {
  const [input, setInput] = useState(sampleTexts[0]);
  const [result, setResult] = useState<ExtractedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // All OpenAI-compatible providers support JSON mode
  const openaiCompat: Record<string, { url: string; model: string; name: string }> = {
    openai:     { url: 'https://api.openai.com/v1/chat/completions',       model: 'gpt-4o',                  name: 'OpenAI (GPT-4o)' },
    groq:       { url: 'https://api.groq.com/openai/v1/chat/completions',  model: 'llama-3.3-70b-versatile', name: 'Groq (Llama 3.3)' },
    deepseek:   { url: 'https://api.deepseek.com/chat/completions',        model: 'deepseek-chat',           name: 'DeepSeek' },
    xai:        { url: 'https://api.x.ai/v1/chat/completions',             model: 'grok-3-mini',             name: 'xAI (Grok)' },
    mistral:    { url: 'https://api.mistral.ai/v1/chat/completions',       model: 'mistral-large-latest',    name: 'Mistral' },
    together:   { url: 'https://api.together.xyz/v1/chat/completions',     model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Together AI' },
    fireworks:  { url: 'https://api.fireworks.ai/inference/v1/chat/completions', model: 'accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Fireworks AI' },
    openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions',    model: 'anthropic/claude-sonnet-4', name: 'OpenRouter' },
  };

  // Default to first directly-available provider; fall back to openai (so the
  // user always sees something selected, even with no credentials yet).
  const firstDirect = dropdownProviders.find(id => session.providers[id]?.available === true);
  const [selectedProvider, setSelectedProvider] = useState(firstDirect ?? 'openai');
  const provider = selectedProvider;

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
          model: config.model,
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
            model: 'claude-sonnet-4-20250514',
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
          {dropdownProviders.map((id) => {
            const meta = session.providers[id];
            const direct = meta?.available === true;
            const isGift = meta?.gift;
            const suffix = isGift ? ' (Gift)' : direct ? '' : ' (via routing)';
            const label = id === 'anthropic' ? 'Anthropic (Claude)' : openaiCompat[id]?.name ?? id;
            return (
              <option key={id} value={id}>{label}{suffix}</option>
            );
          })}
        </select>
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
