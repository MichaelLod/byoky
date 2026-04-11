'use client';

const providers = [
  { name: 'Claude', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude.svg' },
  { name: 'OpenAI', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openai.svg' },
  { name: 'Gemini', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/gemini.svg' },
  { name: 'Mistral', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/mistral.svg' },
  { name: 'Grok', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/grok.svg' },
  { name: 'DeepSeek', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/deepseek.svg' },
  { name: 'Cohere', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/cohere.svg' },
  { name: 'Groq', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/groq.svg' },
  { name: 'Perplexity', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/perplexity.svg' },
  { name: 'Together AI', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/together.svg' },
  { name: 'Fireworks', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/fireworks.svg' },
  { name: 'OpenRouter', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openrouter.svg' },
  { name: 'Hugging Face', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/huggingface.svg' },
  { name: 'Replicate', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/replicate.svg' },
  { name: 'Azure OpenAI', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/azureai.svg' },
  { name: 'Ollama', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/ollama.svg' },
  { name: 'Bedrock', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/bedrock.svg' },
  { name: 'LM Studio', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/lmstudio.svg' },
  { name: 'Vertex AI', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/vertexai.svg' },
];

function ProviderItem({ name, icon, hidden }: { name: string; icon: string; hidden?: boolean }) {
  return (
    <div className="pm-item" aria-hidden={hidden || undefined}>
      <img className="pm-icon" src={icon} alt="" width={20} height={20} loading="lazy" />
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
          {providers.map((p) => <ProviderItem key={p.name} {...p} />)}
          {providers.map((p) => <ProviderItem key={`dup-${p.name}`} {...p} hidden />)}
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
          font-size: 14px;
          color: var(--text-muted);
          margin-bottom: 24px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          font-weight: 500;
          font-family: var(--font-sans);
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
          background: linear-gradient(to right, var(--bg), transparent);
        }
        .pm-wrapper::after {
          right: 0;
          background: linear-gradient(to left, var(--bg), transparent);
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
          font-size: 14px;
          font-weight: 500;
          font-family: var(--font-sans);
          color: var(--text-muted);
          white-space: nowrap;
          flex-shrink: 0;
          cursor: default;
          transition: color 0.2s;
        }
        .pm-item:hover {
          color: var(--text);
        }
        .pm-icon {
          width: 20px;
          height: 20px;
          flex-shrink: 0;
          filter: brightness(0) invert(0.7);
          transition: filter 0.2s;
        }
        .pm-item:hover .pm-icon {
          filter: brightness(0) invert(0.3);
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
