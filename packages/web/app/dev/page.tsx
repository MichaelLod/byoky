'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
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
import { generateApp } from './generator';
import type { GenerateResult, Message } from './generator';
import { TEMPLATES } from './templates';
import './dev.css';

/* ─── Helpers ──────────────────────────────────── */

function sanitizeRepoName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'my-app';
}

function fileExtension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot + 1);
}

/* ─── Main Component ──────────────────────────── */

export default function DevHub() {
  /* ── Connection state ── */
  const [walletSession, setWalletSession] = useState<ByokySession | null>(null);
  const [walletConnecting, setWalletConnecting] = useState(false);
  const [githubToken, setGithubToken] = useState<string | null>(null);
  const [githubUser, setGithubUser] = useState<GitHubUser | null>(null);
  const [deviceFlow, setDeviceFlow] = useState<{
    user_code: string;
    verification_uri: string;
  } | null>(null);

  /* ── Generator state ── */
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedFiles, setGeneratedFiles] = useState<Record<string, string> | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [generationDescription, setGenerationDescription] = useState<string | null>(null);

  /* ── Refine state ── */
  const [refineInput, setRefineInput] = useState('');

  /* ── Deploy state ── */
  const [repoName, setRepoName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushProgress, setPushProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState<RepoInfo | null>(null);

  /* ── General ── */
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'generate' | 'template'>('generate');

  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const refineRef = useRef<HTMLInputElement>(null);

  /* ── Auto-focus textarea on mount ── */
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  /* ── Derived ── */
  const connectedProviders = walletSession
    ? Object.entries(walletSession.providers)
        .filter(([, v]) => v.available)
        .map(([k]) => k)
    : [];

  const filePaths = generatedFiles ? Object.keys(generatedFiles).sort() : [];

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

  /* ─── Generate with AI ──────────────────────── */

  const handleGenerate = useCallback(async () => {
    if (!walletSession || !prompt.trim() || generating) return;
    setGenerating(true);
    setError(null);
    setResult(null);

    try {
      const proxyFetch = walletSession.createFetch('anthropic');
      const res: GenerateResult = await generateApp(proxyFetch, prompt.trim());

      setGeneratedFiles(res.files);
      setGenerationDescription(res.description);
      setMessages([
        { role: 'user', content: prompt.trim() },
        { role: 'assistant', content: res.description },
      ]);

      const firstFile = Object.keys(res.files).sort()[0] ?? null;
      setActiveFile(firstFile);
      setRepoName(sanitizeRepoName(prompt.trim().split(/\s+/).slice(0, 4).join('-')));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }, [walletSession, prompt, generating]);

  /* ─── Template selection ────────────────────── */

  const selectTemplate = useCallback((id: string) => {
    const template = TEMPLATES.find((t) => t.id === id);
    if (!template) return;

    setGeneratedFiles(template.files);
    setGenerationDescription(template.description);
    setMessages([]);

    const firstFile = Object.keys(template.files).sort()[0] ?? null;
    setActiveFile(firstFile);
    setRepoName(`my-${id}`);
    setResult(null);
    setError(null);
    setMode('generate');
  }, []);

  /* ─── Refine ────────────────────────────────── */

  const handleRefine = useCallback(async () => {
    if (!walletSession || !refineInput.trim() || generating) return;
    setGenerating(true);
    setError(null);

    try {
      const proxyFetch = walletSession.createFetch('anthropic');
      const res: GenerateResult = await generateApp(
        proxyFetch,
        refineInput.trim(),
        messages,
      );

      setGeneratedFiles((prev) => ({
        ...prev,
        ...res.files,
      }));
      setGenerationDescription(res.description);
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: refineInput.trim() },
        { role: 'assistant', content: res.description },
      ]);

      const changedFiles = Object.keys(res.files);
      if (changedFiles.length > 0) {
        setActiveFile(changedFiles.sort()[0]);
      }
      setRefineInput('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refinement failed');
    } finally {
      setGenerating(false);
    }
  }, [walletSession, refineInput, generating, messages]);

  /* ─── Push to GitHub ────────────────────────── */

  const handlePush = useCallback(async () => {
    if (!githubToken || !githubUser || !generatedFiles || !repoName.trim()) return;

    setPushing(true);
    setPushProgress(null);
    setError(null);
    setResult(null);

    try {
      const repo = await createRepo(githubToken, repoName.trim(), isPrivate);

      const processedFiles: Record<string, string> = {};
      for (const [path, content] of Object.entries(generatedFiles)) {
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
  }, [githubToken, githubUser, generatedFiles, repoName, isPrivate]);

  /* ─── Keyboard shortcuts ────────────────────── */

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleGenerate();
      }
    },
    [handleGenerate],
  );

  const handleRefineKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleRefine();
      }
    },
    [handleRefine],
  );

  /* ─── Render ────────────────────────────────── */

  return (
    <>
      {/* ── Header ── */}
      <header className="dh-header">
        <div className="dh-header-inner">
          <div className="dh-header-left">
            <a href="/" className="dh-header-back">
              &larr; byoky.com
            </a>
            <span className="dh-header-title">Byoky App Generator</span>
          </div>
          <div className="dh-header-right">
            {/* Wallet status */}
            {walletSession ? (
              <button className="dh-status-pill dh-status-connected" onClick={disconnectWallet}>
                <span className="dh-status-dot dh-dot-green" />
                {connectedProviders.length} provider{connectedProviders.length !== 1 ? 's' : ''}
              </button>
            ) : (
              <button
                className="dh-status-pill"
                onClick={connectWallet}
                disabled={walletConnecting}
              >
                {walletConnecting ? (
                  <>
                    <span className="dh-spinner-sm" />
                    Connecting...
                  </>
                ) : (
                  'Connect Wallet'
                )}
              </button>
            )}

            {/* GitHub status */}
            {githubUser ? (
              <button className="dh-status-pill dh-status-connected" onClick={disconnectGitHub}>
                <span className="dh-status-dot dh-dot-green" />
                {githubUser.login}
              </button>
            ) : deviceFlow ? (
              <div className="dh-device-inline">
                <code className="dh-device-code-sm">{deviceFlow.user_code}</code>
                <span className="dh-spinner-sm" />
                <button className="dh-link-btn" onClick={cancelDeviceFlow}>
                  Cancel
                </button>
              </div>
            ) : (
              <button className="dh-status-pill" onClick={connectGitHub}>
                <GitHubIcon />
                Connect GitHub
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="dh-main">
        {/* ── Generate Section ── */}
        <section className="dh-section">
          <div className="dh-section-label">Generate</div>
          <div className={`dh-generate-box${generating ? ' dh-generating' : ''}`}>
            {mode === 'generate' ? (
              <>
                {!walletSession ? (
                  <div className="dh-connect-prompt">
                    <div className="dh-connect-prompt-icon">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                        <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                        <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
                      </svg>
                    </div>
                    <h3 className="dh-connect-prompt-title">Connect your Byoky wallet to start</h3>
                    <p className="dh-connect-prompt-text">
                      Your AI keys power the code generation — no subscription, no API costs for us.
                      Connect your wallet with at least one provider (Anthropic recommended).
                    </p>
                    <button
                      className="dh-btn dh-btn-primary"
                      onClick={connectWallet}
                      disabled={walletConnecting}
                    >
                      {walletConnecting ? (
                        <><span className="dh-spinner-sm" /> Connecting...</>
                      ) : (
                        'Connect Wallet'
                      )}
                    </button>
                    <button
                      className="dh-btn dh-btn-secondary"
                      onClick={() => setMode('template')}
                      style={{ marginTop: 12 }}
                    >
                      or start from a template
                    </button>
                  </div>
                ) : (
                  <>
                    <label className="dh-generate-label" htmlFor="dh-prompt">
                      What do you want to build?
                    </label>
                    <textarea
                      ref={textareaRef}
                      id="dh-prompt"
                      className="dh-textarea"
                      rows={4}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={handleTextareaKeyDown}
                      placeholder="A chat app that lets users compare responses from Claude and GPT side by side..."
                      disabled={generating}
                    />
                    <div className="dh-generate-actions">
                      <button
                        className="dh-btn dh-btn-primary"
                        onClick={handleGenerate}
                        disabled={generating || !prompt.trim()}
                      >
                        {generating ? (
                          <>
                            <span className="dh-spinner-sm" />
                            Generating your app...
                          </>
                        ) : (
                          'Generate with AI'
                        )}
                      </button>
                      <button
                        className="dh-btn dh-btn-secondary"
                        onClick={() => setMode('template')}
                        disabled={generating}
                      >
                        Start from template
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="dh-template-header">
                  <button
                    className="dh-link-btn dh-back-btn"
                    onClick={() => setMode('generate')}
                  >
                    &larr; Back to generate
                  </button>
                  <span className="dh-generate-label">Pick a template</span>
                </div>
                <div className="dh-templates-grid">
                  {TEMPLATES.map((t) => (
                    <TemplateCard
                      key={t.id}
                      template={t}
                      onSelect={selectTemplate}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        {/* ── Files Section ── */}
        {generatedFiles && (
          <section className="dh-section">
            <div className="dh-section-label">Files</div>
            {generationDescription && (
              <p className="dh-file-description">{generationDescription}</p>
            )}
            <div className="dh-files-panel">
              <div className="dh-code-preview">
                {activeFile && generatedFiles[activeFile] !== undefined ? (
                  <pre className="dh-code-block">
                    <code>{generatedFiles[activeFile]}</code>
                  </pre>
                ) : (
                  <div className="dh-code-empty">Select a file to preview</div>
                )}
              </div>
              <div className="dh-file-tree">
                {filePaths.map((fp) => (
                  <button
                    key={fp}
                    className={`dh-file-entry${activeFile === fp ? ' dh-file-active' : ''}`}
                    onClick={() => setActiveFile(fp)}
                  >
                    <FileIcon ext={fileExtension(fp)} />
                    <span className="dh-file-name">{fp}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── Refine Section ── */}
        {generatedFiles && walletSession && (
          <section className="dh-section">
            <div className="dh-section-label">Refine</div>
            <div className="dh-refine-row">
              <input
                ref={refineRef}
                className="dh-refine-input"
                type="text"
                value={refineInput}
                onChange={(e) => setRefineInput(e.target.value)}
                onKeyDown={handleRefineKeyDown}
                placeholder="Make the sidebar collapsible and add settings..."
                disabled={generating}
              />
              <button
                className="dh-refine-submit"
                onClick={handleRefine}
                disabled={generating || !refineInput.trim()}
                aria-label="Submit refinement"
              >
                {generating ? <span className="dh-spinner-sm" /> : <ArrowIcon />}
              </button>
            </div>
          </section>
        )}

        {/* ── Deploy Section ── */}
        {generatedFiles && githubUser && (
          <section className="dh-section">
            <div className="dh-section-label">Deploy</div>
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
                  className="dh-btn dh-btn-primary"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open Repository
                </a>
              </div>
            ) : (
              <div className="dh-deploy-form">
                <div className="dh-deploy-row">
                  <div className="dh-field">
                    <label htmlFor="repo-name">Repository</label>
                    <input
                      id="repo-name"
                      className="dh-input"
                      type="text"
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                      placeholder="my-ai-chat"
                      disabled={pushing}
                    />
                  </div>
                  <div className="dh-checkbox-row">
                    <input
                      id="private-repo"
                      type="checkbox"
                      checked={isPrivate}
                      onChange={(e) => setIsPrivate(e.target.checked)}
                      disabled={pushing}
                    />
                    <label htmlFor="private-repo">Private</label>
                  </div>
                  <button
                    className="dh-btn dh-btn-primary"
                    onClick={handlePush}
                    disabled={pushing || !repoName.trim()}
                  >
                    {pushing ? 'Pushing...' : 'Push to GitHub'}
                  </button>
                </div>
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
          </section>
        )}
      </main>

      {/* ── Error banner ── */}
      {error && (
        <div className="dh-error">
          <span>{error}</span>
          <button className="dh-link-btn" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* ── Footer ── */}
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
            <a
              href="https://github.com/MichaelLod/byoky"
              target="_blank"
              rel="noopener noreferrer"
            >
              Docs
            </a>
            <a href="/built-with">Built with Byoky</a>
          </nav>
        </div>
      </footer>
    </>
  );
}

/* ─── Template Card ───────────────────────────── */

function TemplateCard({
  template,
  onSelect,
}: {
  template: { id: string; name: string; description: string; tech: string; color: string };
  onSelect: (id: string) => void;
}) {
  const techTags = template.tech.split(' \u00b7 ');

  return (
    <div
      className="dh-template-card"
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

/* ─── Icons ───────────────────────────────────── */

function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function FileIcon({ ext }: { ext: string }) {
  const color =
    ext === 'tsx' || ext === 'ts'
      ? '#3178c6'
      : ext === 'json'
        ? '#f59e0b'
        : ext === 'css'
          ? '#a855f7'
          : ext === 'md'
            ? '#6b7280'
            : ext === 'html'
              ? '#e34c26'
              : 'var(--text-muted)';

  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
