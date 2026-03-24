'use client';

import { useState, useCallback, useRef } from 'react';
import { Byoky } from '@byoky/sdk';
import type { ByokySession } from '@byoky/sdk';
import {
  startDeviceFlow,
  pollForToken,
  getUser,
  createRepo,
  pushFiles,
} from './github';
import type { GitHubUser, RepoInfo } from './github';
import type { Template } from './templates';
import { TEMPLATES } from './templates';
import './dev.css';

/* ─── Main Component ──────────────────────────── */

export default function DevHub() {
  const [walletSession, setWalletSession] = useState<ByokySession | null>(null);
  const [walletConnecting, setWalletConnecting] = useState(false);
  const [githubToken, setGithubToken] = useState<string | null>(null);
  const [githubUser, setGithubUser] = useState<GitHubUser | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [repoName, setRepoName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [deviceFlow, setDeviceFlow] = useState<{
    user_code: string;
    verification_uri: string;
  } | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushProgress, setPushProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState<RepoInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const bothConnected = walletSession !== null && githubUser !== null;
  const templateReady = bothConnected && selectedTemplate !== null;

  /* ─── Wallet connect ────────────────────────── */

  const connectWallet = useCallback(async () => {
    setWalletConnecting(true);
    setError(null);
    try {
      const byoky = new Byoky();
      const session = await byoky.connect({
        providers: [
          { id: 'anthropic', required: false },
          { id: 'openai', required: false },
          { id: 'gemini', required: false },
        ],
        modal: true,
      });
      setWalletSession(session);
    } catch (e) {
      if (e instanceof Error && e.message.includes('cancelled')) return;
      setError(e instanceof Error ? e.message : 'Failed to connect wallet');
    } finally {
      setWalletConnecting(false);
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    walletSession?.disconnect();
    setWalletSession(null);
  }, [walletSession]);

  /* ─── GitHub connect (device flow) ──────────── */

  const connectGitHub = useCallback(async () => {
    setError(null);
    try {
      const flow = await startDeviceFlow();
      setDeviceFlow({
        user_code: flow.user_code,
        verification_uri: flow.verification_uri,
      });
      window.open(flow.verification_uri, '_blank');

      const controller = new AbortController();
      abortRef.current = controller;

      const token = await pollForToken(
        flow.device_code,
        flow.interval,
        controller.signal,
      );
      setGithubToken(token);

      const user = await getUser(token);
      setGithubUser(user);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'GitHub auth failed');
    } finally {
      setDeviceFlow(null);
      abortRef.current = null;
    }
  }, []);

  const cancelDeviceFlow = useCallback(() => {
    abortRef.current?.abort();
    setDeviceFlow(null);
  }, []);

  const disconnectGitHub = useCallback(() => {
    setGithubToken(null);
    setGithubUser(null);
    setResult(null);
  }, []);

  /* ─── Template selection ────────────────────── */

  const selectTemplate = useCallback((id: string) => {
    setSelectedTemplate(id);
    setRepoName(`my-${id}`);
    setResult(null);
    setError(null);
  }, []);

  /* ─── Push to GitHub ────────────────────────── */

  const handlePush = useCallback(async () => {
    if (!githubToken || !githubUser || !selectedTemplate || !repoName.trim()) return;

    const template = TEMPLATES.find((t) => t.id === selectedTemplate);
    if (!template) return;

    setPushing(true);
    setPushProgress(null);
    setError(null);
    setResult(null);

    try {
      const repo = await createRepo(githubToken, repoName.trim(), isPrivate);

      const processedFiles: Record<string, string> = {};
      for (const [path, content] of Object.entries(template.files)) {
        processedFiles[path] = content.replaceAll(
          '{{PROJECT_NAME}}',
          repoName.trim(),
        );
      }

      await pushFiles(
        githubToken,
        githubUser.login,
        repoName.trim(),
        processedFiles,
        (done, total) => setPushProgress({ done, total }),
      );

      setResult(repo);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to push to GitHub');
    } finally {
      setPushing(false);
      setPushProgress(null);
    }
  }, [githubToken, githubUser, selectedTemplate, repoName, isPrivate]);

  /* ─── Providers list from session ───────────── */

  const connectedProviders = walletSession
    ? Object.entries(walletSession.providers)
        .filter(([, v]) => v.available)
        .map(([k]) => k)
    : [];

  /* ─── Render ────────────────────────────────── */

  return (
    <>
      <Header />

      <main className="dh-main">
        {/* Step 1: Connect */}
        <StepSection label="Step 1 · Connect">
          <div className="dh-connect-grid">
            <WalletCard
              session={walletSession}
              connecting={walletConnecting}
              providers={connectedProviders}
              onConnect={connectWallet}
              onDisconnect={disconnectWallet}
            />
            <GitHubCard
              user={githubUser}
              deviceFlow={deviceFlow}
              onConnect={connectGitHub}
              onCancel={cancelDeviceFlow}
              onDisconnect={disconnectGitHub}
            />
          </div>
        </StepSection>

        {/* Step 2: Choose Template */}
        <StepSection
          label="Step 2 · Choose Template"
          disabled={!bothConnected}
        >
          <div className="dh-templates-grid">
            {TEMPLATES.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                selected={selectedTemplate === t.id}
                onSelect={selectTemplate}
              />
            ))}
          </div>
          {!bothConnected && (
            <p className="dh-step-notice">
              Connect both your wallet and GitHub to choose a template.
            </p>
          )}
        </StepSection>

        {/* Step 3: Create Repository */}
        <StepSection
          label="Step 3 · Create Repository"
          disabled={!templateReady}
        >
          {result ? (
            <div className="dh-result">
              <div className="dh-result-title">Repository created</div>
              <div className="dh-result-repo">
                <a
                  href={result.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {result.full_name}
                </a>
              </div>
              <a
                href={result.html_url}
                className="dh-connect-btn dh-connect-btn-primary"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Repository
              </a>
            </div>
          ) : (
            <div className="dh-create-form">
              <div className="dh-field">
                <label htmlFor="repo-name">Repository name</label>
                <input
                  id="repo-name"
                  className="dh-input"
                  type="text"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  placeholder="my-ai-chat"
                  disabled={!templateReady || pushing}
                />
              </div>
              <div className="dh-checkbox-row">
                <input
                  id="private-repo"
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  disabled={!templateReady || pushing}
                />
                <label htmlFor="private-repo">Private repository</label>
              </div>
              <button
                className="dh-connect-btn dh-connect-btn-primary"
                onClick={handlePush}
                disabled={!templateReady || pushing || !repoName.trim()}
              >
                {pushing ? 'Pushing...' : 'Push to GitHub'}
              </button>
              {pushing && pushProgress && (
                <div className="dh-progress">
                  <div className="dh-progress-bar">
                    <div
                      className="dh-progress-fill"
                      style={{
                        width: `${(pushProgress.done / pushProgress.total) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="dh-progress-text">
                    {pushProgress.done} of {pushProgress.total} files...
                  </div>
                </div>
              )}
            </div>
          )}
          {!templateReady && !result && (
            <p className="dh-step-notice">Select a template first.</p>
          )}
        </StepSection>

        {/* Error display */}
        {error && (
          <div className="dh-error">
            <span>{error}</span>
            <button className="dh-link-btn" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        {/* CLI alternative */}
        <div className="dh-divider">or use the CLI</div>
        <div className="dh-cli">
          <h3>Prefer the CLI?</h3>
          <code className="dh-cli-code">npx create-byoky-app</code>
          <p>Same templates, runs locally. No GitHub connection needed.</p>
        </div>

        {/* Quick Recipes */}
        <div className="dh-divider">Quick Recipes</div>
        <RecipesSection />
      </main>

      <Footer />
    </>
  );
}

/* ─── Header ──────────────────────────────────── */

function Header() {
  return (
    <header className="dh-header">
      <div className="dh-header-inner">
        <div className="dh-header-left">
          <a href="/" className="dh-header-back">
            &larr; byoky.com
          </a>
          <span className="dh-header-title">Byoky Developer Hub</span>
        </div>
        <nav className="dh-header-links">
          <a
            href="https://github.com/MichaelLod/byoky"
            target="_blank"
            rel="noopener noreferrer"
          >
            Docs
          </a>
          <a
            href="https://github.com/MichaelLod/byoky"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}

/* ─── Step wrapper ────────────────────────────── */

function StepSection({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="dh-step-section">
      <div className="dh-step-label">{label}</div>
      <div className={disabled ? 'dh-step-disabled' : undefined}>
        {children}
      </div>
    </section>
  );
}

/* ─── Wallet Card ─────────────────────────────── */

function WalletCard({
  session,
  connecting,
  providers,
  onConnect,
  onDisconnect,
}: {
  session: ByokySession | null;
  connecting: boolean;
  providers: string[];
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const connected = session !== null;

  return (
    <div className="dh-connect-card">
      <div className="dh-connect-card-header">
        <span className="dh-connect-card-title">Byoky Wallet</span>
        <span className="dh-connect-status">
          <span
            className={`dh-connect-status-dot${connected ? ' dh-connected' : ''}`}
          />
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {connected ? (
        <>
          {providers.length > 0 && (
            <div className="dh-provider-pills">
              {providers.map((p) => (
                <span key={p} className="dh-provider-pill">
                  {p}
                </span>
              ))}
            </div>
          )}
          <button className="dh-link-btn" onClick={onDisconnect}>
            Disconnect
          </button>
        </>
      ) : (
        <>
          <p className="dh-connect-desc">
            Connect your Byoky wallet to access AI providers.
          </p>
          <button
            className="dh-connect-btn dh-connect-btn-primary"
            onClick={onConnect}
            disabled={connecting}
          >
            {connecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
        </>
      )}
    </div>
  );
}

/* ─── GitHub Card ─────────────────────────────── */

function GitHubCard({
  user,
  deviceFlow,
  onConnect,
  onCancel,
  onDisconnect,
}: {
  user: GitHubUser | null;
  deviceFlow: { user_code: string; verification_uri: string } | null;
  onConnect: () => void;
  onCancel: () => void;
  onDisconnect: () => void;
}) {
  const connected = user !== null;

  return (
    <div className="dh-connect-card">
      <div className="dh-connect-card-header">
        <span className="dh-connect-card-title">GitHub</span>
        <span className="dh-connect-status">
          <span
            className={`dh-connect-status-dot${connected ? ' dh-connected' : ''}`}
          />
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {connected ? (
        <>
          <div className="dh-connect-info">
            <img
              className="dh-connect-avatar"
              src={user.avatar_url}
              alt={user.login}
              width={28}
              height={28}
            />
            <span className="dh-connect-username">{user.login}</span>
          </div>
          <button className="dh-link-btn" onClick={onDisconnect}>
            Disconnect
          </button>
        </>
      ) : deviceFlow ? (
        <div className="dh-device-flow">
          <div className="dh-device-code">{deviceFlow.user_code}</div>
          <a
            className="dh-device-link"
            href={deviceFlow.verification_uri}
            target="_blank"
            rel="noopener noreferrer"
          >
            {deviceFlow.verification_uri}
          </a>
          <div className="dh-device-waiting">
            <span className="dh-spinner" />
            Waiting for authorization...
          </div>
          <button className="dh-link-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <p className="dh-connect-desc">
            Connect GitHub to push templates to your repos.
          </p>
          <button className="dh-connect-btn" onClick={onConnect}>
            <GitHubIcon />
            Connect GitHub
          </button>
        </>
      )}
    </div>
  );
}

/* ─── Template Card ───────────────────────────── */

function TemplateCard({
  template,
  selected,
  onSelect,
}: {
  template: Template;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const techTags = template.tech.split(' \u00b7 ');

  return (
    <div
      className={`dh-template-card${selected ? ' dh-selected' : ''}`}
      onClick={() => onSelect(template.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(template.id);
        }
      }}
    >
      <div
        className="dh-template-icon"
        style={{
          background: `${template.color}15`,
          color: template.color,
        }}
      >
        {template.name.charAt(0)}
      </div>
      <h3>{template.name}</h3>
      <p>{template.description}</p>
      <div className="dh-template-tags">
        {techTags.map((tag) => (
          <span key={tag} className="dh-template-tag">
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── Recipes ─────────────────────────────────── */

const RECIPES = [
  {
    title: 'Streaming Chat',
    code: `import Anthropic from '@anthropic-ai/sdk';
import { Byoky } from '@byoky/sdk';

const session = await new Byoky().connect({
  providers: [{ id: 'anthropic', required: true }],
  modal: true,
});

const client = new Anthropic({
  apiKey: session.sessionKey,
  fetch: session.createFetch('anthropic'),
});

const stream = client.messages.stream({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
});

for await (const event of stream) {
  process.stdout.write(event.delta.text);
}`,
  },
  {
    title: 'Multi-Provider',
    code: `import { Byoky } from '@byoky/sdk';

const session = await new Byoky().connect({
  providers: [
    { id: 'anthropic' },
    { id: 'openai' },
    { id: 'gemini' },
  ],
  modal: true,
});

const available = Object.keys(session.providers);
const fetch = session.createFetch(available[0]);`,
  },
  {
    title: 'Backend Relay',
    code: `// Frontend
const session = await new Byoky().connect({
  providers: [{ id: 'anthropic', required: true }],
  modal: true,
});
session.createRelay('wss://your-app.com/ws/relay');

// Backend (Node.js)
import { ByokyServer } from '@byoky/sdk/server';

const byoky = new ByokyServer();
wss.on('connection', async (ws) => {
  const client = await byoky.handleConnection(ws);
  const fetch = client.createFetch('anthropic');
});`,
  },
  {
    title: 'Extension Detection',
    code: `import { isExtensionInstalled, getStoreUrl } from '@byoky/sdk';

if (!await isExtensionInstalled()) {
  const storeUrl = getStoreUrl();
  // Show install prompt with storeUrl
}`,
  },
];

function RecipesSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="dh-recipes-section">
      <h3>Collapsible code snippets for common patterns</h3>
      <div className="dh-recipes-list">
        {RECIPES.map((recipe, i) => (
          <div key={recipe.title} className="dh-recipe-card">
            <div
              className="dh-recipe-header"
              onClick={() => setOpenIndex(openIndex === i ? null : i)}
            >
              <span className="dh-recipe-title">{recipe.title}</span>
              <ChevronIcon open={openIndex === i} />
            </div>
            {openIndex === i && (
              <div className="dh-recipe-body">
                <code className="dh-recipe-code">{recipe.code}</code>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Footer ──────────────────────────────────── */

function Footer() {
  return (
    <footer className="dh-footer">
      <div className="dh-footer-inner">
        <span className="dh-footer-brand">Byoky</span>
        <nav className="dh-footer-links">
          <a href="/">byoky.com</a>
          <a
            href="https://github.com/MichaelLod/byoky"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <a href="/demo">Demo</a>
          <a href="/built-with">Built with Byoky</a>
          <a href="/dev" aria-current="page">
            Developers
          </a>
        </nav>
      </div>
    </footer>
  );
}

/* ─── Icons ───────────────────────────────────── */

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`dh-recipe-chevron${open ? ' dh-open' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
