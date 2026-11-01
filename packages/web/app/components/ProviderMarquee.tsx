'use client';

// Every provider a Byoky wallet can add (core's provider registry), and no
// others. The icons come from a pinned @lobehub/icons-static-svg release.
const ICON_BASE = 'https://unpkg.com/@lobehub/icons-static-svg@1.95.1/icons';

const providers = [
  { id: 'anthropic', name: 'Claude', icon: 'claude' },
  { id: 'openai', name: 'OpenAI', icon: 'openai' },
  { id: 'gemini', name: 'Gemini', icon: 'gemini' },
  { id: 'mistral', name: 'Mistral', icon: 'mistral' },
  { id: 'xai', name: 'Grok', icon: 'grok' },
  { id: 'deepseek', name: 'DeepSeek', icon: 'deepseek' },
  { id: 'cohere', name: 'Cohere', icon: 'cohere' },
  { id: 'groq', name: 'Groq', icon: 'groq' },
  { id: 'perplexity', name: 'Perplexity', icon: 'perplexity' },
  { id: 'together', name: 'Together AI', icon: 'together' },
  { id: 'fireworks', name: 'Fireworks', icon: 'fireworks' },
  { id: 'openrouter', name: 'OpenRouter', icon: 'openrouter' },
  { id: 'azure_openai', name: 'Azure OpenAI', icon: 'azureai' },
  { id: 'ollama', name: 'Ollama', icon: 'ollama' },
  { id: 'lm_studio', name: 'LM Studio', icon: 'lmstudio' },
];

function ProviderItem({ name, icon, hidden }: { name: string; icon: string; hidden?: boolean }) {
  return (
    <div className="pm-item" aria-hidden={hidden || undefined}>
      <img className="pm-icon" src={`${ICON_BASE}/${icon}.svg`} alt="" width={20} height={20} loading="lazy" />
      <span>{name}</span>
    </div>
  );
}

export function ProviderMarquee() {
  return (
    <section className="pm-section" aria-label="Supported AI providers">
      <p className="pm-label">Works with any AI provider</p>
      <div className="pm-wrapper">
        <div className="pm-track">
          {providers.map((p) => <ProviderItem key={p.id} name={p.name} icon={p.icon} />)}
          {providers.map((p) => <ProviderItem key={`dup-${p.id}`} name={p.name} icon={p.icon} hidden />)}
        </div>
      </div>

      <style>{`
        .pm-section {
          padding: 24px 0;
          overflow: hidden;
          max-width: 700px;
          margin: 0 auto;
        }
        .pm-label {
          text-align: center;
          font-size: 12px;
          color: var(--dim);
          margin-bottom: 24px;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          font-family: var(--font-code);
          padding: 0 16px;
        }
        .pm-wrapper {
          position: relative;
        }
        .pm-wrapper::before,
        .pm-wrapper::after {
          content: "";
          position: absolute;
          top: 0; bottom: 0;
          width: 64px;
          z-index: 10;
          pointer-events: none;
        }
        .pm-wrapper::before {
          left: 0;
          background: linear-gradient(to right, var(--void), transparent);
        }
        .pm-wrapper::after {
          right: 0;
          background: linear-gradient(to left, var(--void), transparent);
        }
        @keyframes pm-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(calc(-50% - 12px)); }
        }
        .pm-track {
          display: flex;
          gap: 24px;
          width: max-content;
          animation: pm-scroll 30s linear infinite;
        }
        .pm-track:hover {
          animation-play-state: paused;
        }
        .pm-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 4px;
          font-size: 13px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-family: var(--font-code);
          color: var(--fog);
          white-space: nowrap;
          flex-shrink: 0;
          cursor: default;
          transition: color 0.2s;
        }
        .pm-item:hover {
          color: var(--bone);
        }
        .pm-icon {
          width: 20px;
          height: 20px;
          flex-shrink: 0;
          filter: brightness(0) invert(0.68);
          transition: filter 0.2s;
        }
        .pm-item:hover .pm-icon {
          filter: brightness(0) invert(0.93);
        }
        @media (prefers-reduced-motion: reduce) {
          .pm-track {
            animation: none;
            flex-wrap: wrap;
            justify-content: center;
            width: auto;
            gap: 8px;
            padding: 0 16px;
          }
        }
      `}</style>
    </section>
  );
}
