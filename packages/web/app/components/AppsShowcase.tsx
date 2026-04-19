'use client';

import { useState, type ReactNode } from 'react';

type App = {
  id: string;
  name: string;
  domain: string;
  accent: string;
  bg: string;
  surface: string;
  text: string;
  subtle: string;
  render: () => ReactNode;
};

function ByokyPill() {
  return (
    <button className="byoky-pill" type="button">
      <img src="/byoky_logo.svg" alt="" width={16} height={16} style={{ borderRadius: '3px' }} />
      Connect Byoky wallet
      <style jsx>{`
        .byoky-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          border-radius: 10px;
          background: #FF4F00;
          color: #fff;
          font-size: 12.5px;
          font-weight: 600;
          letter-spacing: -0.01em;
          border: 1px solid rgba(255, 79, 0, 0.3);
          box-shadow: 0 4px 14px rgba(255, 79, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25);
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
        }
        .byoky-pill:hover { filter: brightness(1.05); }
      `}</style>
    </button>
  );
}

function BrowserFrame({
  domain,
  bg,
  surface,
  text,
  subtle,
  children,
}: {
  domain: string;
  bg: string;
  surface: string;
  text: string;
  subtle: string;
  children: ReactNode;
}) {
  return (
    <div className="frame" style={{ background: bg, color: text }}>
      <div className="frame-chrome" style={{ background: surface, borderBottom: `1px solid ${subtle}` }}>
        <div className="dots">
          <span style={{ background: '#ff5f57' }} />
          <span style={{ background: '#febc2e' }} />
          <span style={{ background: '#28c840' }} />
        </div>
        <div className="url" style={{ background: bg, color: text, border: `1px solid ${subtle}` }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v10H6z" stroke={text} strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span>{domain}</span>
        </div>
        <div style={{ width: 46 }} />
      </div>
      <div className="frame-body">{children}</div>
      <style jsx>{`
        .frame {
          border-radius: 12px;
          overflow: hidden;
          height: 100%;
          display: flex;
          flex-direction: column;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }
        .frame-chrome {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          flex-shrink: 0;
        }
        .dots {
          display: flex;
          gap: 6px;
          width: 46px;
        }
        .dots span {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          display: block;
        }
        .url {
          flex: 1;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 12px;
          border-radius: 999px;
          font-size: 11.5px;
          font-family: var(--font-sans);
        }
        .frame-body {
          flex: 1;
          min-height: 0;
          position: relative;
          display: flex;
          flex-direction: column;
        }
      `}</style>
    </div>
  );
}

/* ─── Individual app mockups ───────────────────── */

function LovableMock() {
  return (
    <div className="m">
      <div className="m-top">
        <div className="m-brand">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 21s-7-4.5-9-9.5C1.5 7 5 4 8.5 4c1.8 0 3.2.9 3.5 2 .3-1.1 1.7-2 3.5-2C19 4 22.5 7 21 11.5c-2 5-9 9.5-9 9.5Z" fill="url(#lg)" />
            <defs>
              <linearGradient id="lg" x1="0" y1="0" x2="24" y2="24">
                <stop offset="0" stopColor="#ff5edf" />
                <stop offset="1" stopColor="#7c5cff" />
              </linearGradient>
            </defs>
          </svg>
          <span>lovable</span>
        </div>
        <ByokyPill />
      </div>
      <div className="m-center">
        <h3>Build something <span className="grad">Lovable</span></h3>
        <p className="m-sub">Create apps and websites by chatting with AI.</p>
        <div className="m-input">
          <span>Ask Lovable to create a dashboard that tracks…</span>
          <div className="m-actions">
            <span className="attach">📎</span>
            <span className="send">➤</span>
          </div>
        </div>
        <div className="m-chips">
          <span>📊 Analytics dashboard</span>
          <span>🛍 Online store</span>
          <span>✈️ Travel planner</span>
          <span>📝 SaaS landing</span>
        </div>
        <p className="m-foot">
          <span className="dot" /> Running on your own keys · unlimited prompts
        </p>
      </div>
      <style jsx>{`
        .m { display: flex; flex-direction: column; height: 100%; background: radial-gradient(circle at 20% 0%, #ffe6f5 0%, #f3e8ff 50%, #fff 100%); color: #1b1230; }
        .m-top { display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; border-bottom: 1px solid rgba(0,0,0,0.06); }
        .m-brand { display: inline-flex; gap: 8px; align-items: center; font-weight: 600; font-size: 14px; color: #1b1230; letter-spacing: -0.01em; }
        .m-center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; gap: 14px; text-align: center; }
        h3 { font-size: 30px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; }
        .grad { background: linear-gradient(90deg, #ff5edf, #7c5cff); -webkit-background-clip: text; background-clip: text; color: transparent; font-style: italic; }
        .m-sub { color: #5a4e75; font-size: 13.5px; margin-top: -6px; }
        .m-input { width: 100%; max-width: 460px; padding: 14px 16px; background: #fff; border: 1px solid #e6deff; border-radius: 16px; display: flex; align-items: center; justify-content: space-between; color: #8c82a8; font-size: 13px; box-shadow: 0 8px 24px rgba(124, 92, 255, 0.08); }
        .m-actions { display: inline-flex; gap: 10px; align-items: center; }
        .attach { font-size: 14px; }
        .send { background: linear-gradient(135deg, #ff5edf, #7c5cff); color: #fff; width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; font-size: 12px; font-weight: 700; }
        .m-chips { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
        .m-chips span { font-size: 11.5px; padding: 6px 12px; border: 1px solid #e6deff; border-radius: 999px; background: rgba(255,255,255,0.7); color: #1b1230; }
        .m-foot { font-size: 11.5px; color: #7c5cff; display: inline-flex; gap: 6px; align-items: center; margin-top: 4px; }
        .dot { width: 6px; height: 6px; border-radius: 999px; background: #22c55e; display: inline-block; box-shadow: 0 0 0 3px rgba(34,197,94,0.2); }
      `}</style>
    </div>
  );
}

function NotionMock() {
  return (
    <div className="m">
      <div className="m-side">
        <div className="m-ws">
          <span className="ws-ic">N</span>
          <span>Michael&apos;s</span>
        </div>
        <div className="m-item dim">🔍 Search</div>
        <div className="m-item dim">🏠 Home</div>
        <div className="m-item dim">📥 Inbox</div>
        <div className="m-section">Private</div>
        <div className="m-item">📄 Q2 roadmap</div>
        <div className="m-item dim">📓 Journal</div>
        <div className="m-item dim">🎯 OKRs</div>
        <div className="m-item dim">📚 Reading list</div>
      </div>
      <div className="m-main">
        <div className="m-top">
          <span className="crumb">Private / Q2 roadmap</span>
          <ByokyPill />
        </div>
        <div className="m-doc">
          <h3>Q2 roadmap ✨</h3>
          <p className="m-line">Shipping plan for April — June. Focus: onboarding funnel, billing polish, mobile parity.</p>
          <div className="m-ai">
            <div className="ai-head">
              <span className="sparkle">✨</span>
              <span>Ask AI anything, or press space for options…</span>
              <span className="kbd">⌘ J</span>
            </div>
            <div className="ai-options">
              <div className="ai-opt"><span>✍️</span>Continue writing</div>
              <div className="ai-opt"><span>📋</span>Summarize</div>
              <div className="ai-opt"><span>🔍</span>Find action items</div>
              <div className="ai-opt"><span>🌐</span>Translate</div>
            </div>
          </div>
        </div>
      </div>
      <style jsx>{`
        .m { display: grid; grid-template-columns: 170px 1fr; height: 100%; background: #fff; color: #37352f; }
        .m-side { background: #f7f6f3; border-right: 1px solid #eceae5; padding: 10px 8px; display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
        .m-ws { display: inline-flex; gap: 8px; align-items: center; padding: 6px 8px; font-weight: 600; margin-bottom: 4px; }
        .ws-ic { width: 18px; height: 18px; border-radius: 4px; background: #37352f; color: #fff; display: grid; place-items: center; font-size: 11px; font-weight: 700; }
        .m-item { padding: 5px 8px; border-radius: 4px; color: #37352f; }
        .m-item.dim { color: #7f7a72; }
        .m-section { font-size: 10.5px; color: #9b968c; padding: 10px 8px 4px; letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; }
        .m-main { display: flex; flex-direction: column; min-width: 0; background: #fff; }
        .m-top { display: flex; justify-content: space-between; align-items: center; padding: 10px 18px; border-bottom: 1px solid #eceae5; }
        .crumb { font-size: 12px; color: #7f7a72; }
        .m-doc { padding: 24px 40px; flex: 1; display: flex; flex-direction: column; gap: 14px; }
        h3 { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
        .m-line { color: #37352f; font-size: 14px; line-height: 1.55; }
        .m-ai { margin-top: 4px; border: 1px solid #eceae5; border-radius: 10px; overflow: hidden; box-shadow: 0 8px 24px rgba(15,15,15,0.06); }
        .ai-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; font-size: 13px; color: #7f7a72; background: #fff; border-bottom: 1px solid #eceae5; }
        .ai-head .sparkle { color: #448ef7; font-size: 14px; }
        .ai-head .kbd { margin-left: auto; font-size: 11px; color: #9b968c; background: #f2f1ed; padding: 2px 6px; border-radius: 4px; }
        .ai-options { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0; background: #fff; }
        .ai-opt { display: inline-flex; gap: 8px; align-items: center; padding: 8px 14px; font-size: 12.5px; color: #37352f; border-right: 1px solid #eceae5; border-bottom: 1px solid #eceae5; }
        .ai-opt:nth-child(2n) { border-right: none; }
        .ai-opt:nth-child(n+3) { border-bottom: none; }
        @media (max-width: 560px) { .m { grid-template-columns: 1fr; } .m-side { display: none; } .m-doc { padding: 20px; } }
      `}</style>
    </div>
  );
}

function CursorMock() {
  return (
    <div className="m">
      <div className="m-side">
        <div className="m-sec">Explorer</div>
        <div className="m-file dim">📁 src</div>
        <div className="m-file dim" style={{ paddingLeft: 18 }}>📁 components</div>
        <div className="m-file" style={{ paddingLeft: 18 }}>📄 Dashboard.tsx</div>
        <div className="m-file dim" style={{ paddingLeft: 18 }}>📄 Nav.tsx</div>
        <div className="m-file dim">📁 lib</div>
        <div className="m-file dim">📄 package.json</div>
      </div>
      <div className="m-editor">
        <div className="m-tabs">
          <span className="tab active">Dashboard.tsx</span>
          <span className="tab">Nav.tsx</span>
        </div>
        <div className="m-code">
          <span className="ln">12</span><span><span className="kw">export function</span> <span className="fn">Dashboard</span>() {'{'}</span>
          <span className="ln">13</span><span>  <span className="kw">const</span> [stats, setStats] = <span className="fn">useState</span>(<span className="num">[]</span>);</span>
          <span className="ln">14</span><span className="caret">  <span className="cursor-hi">{'// ▎cursor: generate a pie chart'}</span></span>
          <span className="ln">15</span><span>  <span className="kw">return</span> (</span>
          <span className="ln">16</span><span>    &lt;<span className="fn">Card</span>&gt;…&lt;/<span className="fn">Card</span>&gt;</span>
        </div>
      </div>
      <div className="m-chat">
        <div className="chat-head">
          <span className="model">claude-4.5-sonnet ▾</span>
          <ByokyPill />
        </div>
        <div className="chat-msg">
          <span className="who">Cursor</span>
          <span>I&apos;ll add a pie chart using recharts and wire it to <code>stats</code>.</span>
        </div>
        <div className="chat-input">
          <span>Ask anything, ⌘K to edit</span>
          <span className="send">↑</span>
        </div>
      </div>
      <style jsx>{`
        .m { display: grid; grid-template-columns: 120px 1fr 240px; height: 100%; background: #1e1e20; color: #e4e4e7; font-family: var(--font-code); }
        .m-side { background: #181819; border-right: 1px solid #2a2a2e; padding: 10px 6px; display: flex; flex-direction: column; gap: 2px; font-size: 11.5px; }
        .m-sec { font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: 0.06em; padding: 6px 8px; font-family: var(--font-sans); }
        .m-file { padding: 4px 8px; border-radius: 4px; color: #e4e4e7; }
        .m-file.dim { color: #a1a1aa; }
        .m-editor { display: flex; flex-direction: column; min-width: 0; background: #1e1e20; }
        .m-tabs { display: flex; background: #181819; border-bottom: 1px solid #2a2a2e; font-family: var(--font-sans); }
        .tab { padding: 8px 14px; font-size: 11.5px; color: #a1a1aa; border-right: 1px solid #2a2a2e; }
        .tab.active { background: #1e1e20; color: #fff; }
        .m-code { padding: 12px 10px; font-size: 12px; line-height: 1.8; display: grid; grid-template-columns: 24px 1fr; gap: 0 10px; }
        .ln { color: #52525b; text-align: right; }
        .kw { color: #c586c0; }
        .fn { color: #4ec9b0; }
        .num { color: #b5cea8; }
        .caret .cursor-hi { background: linear-gradient(90deg, rgba(124,92,255,0.25), rgba(124,92,255,0)); color: #c9bdff; padding: 1px 4px; border-left: 2px solid #7c5cff; }
        .m-chat { background: #181819; border-left: 1px solid #2a2a2e; display: flex; flex-direction: column; min-width: 0; }
        .chat-head { display: flex; flex-direction: column; align-items: stretch; padding: 10px 12px; border-bottom: 1px solid #2a2a2e; gap: 8px; font-family: var(--font-sans); }
        .chat-head :global(.byoky-pill) { width: 100%; justify-content: center; }
        .model { font-size: 11px; color: #a1a1aa; background: #27272a; padding: 4px 8px; border-radius: 6px; align-self: flex-start; }
        .chat-msg { padding: 12px; font-family: var(--font-sans); font-size: 12px; color: #d4d4d8; line-height: 1.5; border-bottom: 1px solid #2a2a2e; display: flex; flex-direction: column; gap: 4px; }
        .chat-msg .who { font-size: 10.5px; color: #7c5cff; font-weight: 600; }
        .chat-msg code { background: #27272a; padding: 1px 6px; border-radius: 4px; font-size: 11px; color: #4ec9b0; }
        .chat-input { padding: 10px 12px; font-family: var(--font-sans); font-size: 12px; color: #71717a; display: flex; justify-content: space-between; align-items: center; background: #1e1e20; margin: 10px; border-radius: 8px; border: 1px solid #2a2a2e; }
        .chat-input .send { background: #7c5cff; color: #fff; width: 20px; height: 20px; border-radius: 4px; display: grid; place-items: center; font-size: 11px; font-weight: 700; }
        @media (max-width: 720px) { .m { grid-template-columns: 1fr; } .m-side { display: none; } .m-chat { border-left: none; border-top: 1px solid #2a2a2e; } }
      `}</style>
    </div>
  );
}


/* ─── App registry ─────────────────────────────── */

const APPS: App[] = [
  { id: 'lovable', name: 'Lovable', domain: 'lovable.dev', accent: '#ff5edf', bg: '#fff', surface: '#fff', text: '#1b1230', subtle: 'rgba(0,0,0,0.06)', render: () => <LovableMock /> },
  { id: 'notion', name: 'Notion AI', domain: 'notion.so', accent: '#448ef7', bg: '#fff', surface: '#f7f6f3', text: '#37352f', subtle: '#eceae5', render: () => <NotionMock /> },
  { id: 'cursor', name: 'Cursor', domain: 'cursor.com', accent: '#7c5cff', bg: '#1e1e20', surface: '#181819', text: '#e4e4e7', subtle: '#2a2a2e', render: () => <CursorMock /> },
];

export function AppsShowcase() {
  const [active, setActive] = useState(APPS[0].id);
  const app = APPS.find((a) => a.id === active)!;

  return (
    <section className="apps-showcase">
      <div className="container">
        <div className="apps-showcase-head">
          <h2>One wallet. Every AI app.</h2>
          <p className="subtitle">
            Log in with your own keys. Byoky brings Bring-Your-Own-Key to the apps you already use —
            no more subscriptions, no more lock-in. Pick an app below to see what it looks like.
          </p>
        </div>

        <div className="apps-showcase-box">
          <div className="apps-tabs" role="tablist" aria-label="AI apps">
            {APPS.map((a) => (
              <button
                key={a.id}
                role="tab"
                aria-selected={active === a.id}
                className={`apps-tab${active === a.id ? ' is-active' : ''}`}
                onClick={() => setActive(a.id)}
              >
                <span
                  className="apps-tab-dot"
                  style={{ background: a.accent }}
                />
                {a.name}
              </button>
            ))}
          </div>

          <div className="apps-panel" role="tabpanel">
            <BrowserFrame
              domain={app.domain}
              bg={app.bg}
              surface={app.surface}
              text={app.text}
              subtle={app.subtle}
            >
              {app.render()}
            </BrowserFrame>
          </div>
        </div>

        <p className="apps-showcase-foot">
          This is a preview of how the <strong>Connect Byoky wallet</strong> button could appear on these apps.
          Byoky is not affiliated with any of them.
        </p>
      </div>

      <style jsx>{`
        .apps-showcase {
          padding: var(--section-padding) 0;
          position: relative;
          z-index: 1;
        }
        .apps-showcase-head {
          text-align: center;
          max-width: 640px;
          margin: 0 auto 48px;
        }
        .apps-showcase-head h2 {
          font-size: 44px;
          font-weight: 700;
          letter-spacing: -0.03em;
          margin-bottom: 14px;
        }
        .apps-showcase-head .subtitle {
          font-size: 17px;
          color: var(--text-secondary);
          line-height: 1.55;
        }
        .apps-showcase-box {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 20px;
          padding: 16px;
          box-shadow: 0 12px 40px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.04);
        }
        .apps-tabs {
          display: flex;
          gap: 6px;
          overflow-x: auto;
          overflow-y: hidden;
          scrollbar-width: none;
          padding: 4px 4px 12px;
          border-bottom: 1px solid var(--border);
          margin-bottom: 16px;
        }
        .apps-tabs::-webkit-scrollbar { display: none; }
        .apps-tab {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          border-radius: 999px;
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 500;
          font-family: inherit;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .apps-tab:hover {
          background: var(--bg-elevated);
          color: var(--text);
        }
        .apps-tab.is-active {
          background: var(--bg-elevated);
          color: var(--text);
          border-color: var(--border);
        }
        .apps-tab-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          display: inline-block;
          box-shadow: 0 0 0 2px rgba(0,0,0,0.05);
        }
        .apps-panel {
          height: 480px;
        }
        .apps-showcase-foot {
          margin-top: 20px;
          text-align: center;
          font-size: 12.5px;
          color: var(--text-muted);
        }
        .apps-showcase-foot strong {
          color: var(--text-secondary);
          font-weight: 600;
        }
        @media (max-width: 720px) {
          .apps-showcase-head h2 { font-size: 32px; }
          .apps-showcase-head .subtitle { font-size: 15px; }
          .apps-panel { height: 560px; }
        }
      `}</style>
    </section>
  );
}
