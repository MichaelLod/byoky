import type { ByokySession } from '../byoky.js';
import { encode, toSvg } from './qr.js';

export interface ModalOptions {
  container?: HTMLElement;
  theme?: {
    accentColor?: string;
    backgroundColor?: string;
    textColor?: string;
    borderRadius?: string;
  };
}

export interface ConnectFunctions {
  hasExtension: boolean;
  connectExtension: () => Promise<ByokySession>;
  connectRelay: (onPairingReady: (code: string) => void) => Promise<ByokySession>;
  getStoreUrl: () => string | null;
}

type ModalState = 'connecting' | 'relay-connecting' | 'pairing' | 'success' | 'error';

const PAIR_URL_BASE = 'https://byoky.com/pair';

let activeModal: ConnectModal | null = null;

function sanitizeCssValue(val: string): string {
  return val.replace(/[;{}()\\<>"']/g, '');
}

const STYLES = /* css */ `
  :host {
    all: initial;
    --byoky-accent: #FF4F00;
    --byoky-accent-hover: #e64500;
    --byoky-bg: #ffffff;
    --byoky-bg-elevated: #fafaf9;
    --byoky-text: #1c1917;
    --byoky-text-secondary: #57534e;
    --byoky-text-muted: #a8a29e;
    --byoky-border: rgba(28, 25, 23, 0.08);
    --byoky-border-strong: rgba(28, 25, 23, 0.14);
    --byoky-radius: 16px;
    --byoky-shadow: 0 20px 60px rgba(28, 25, 23, 0.18);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  .overlay {
    position: fixed; inset: 0; z-index: 2147483647;
    display: flex; align-items: center; justify-content: center;
    background: rgba(20, 20, 22, 0.55); backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    animation: fadeIn 0.15s ease-out;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .card {
    background: var(--byoky-bg);
    border: 1px solid var(--byoky-border);
    border-radius: var(--byoky-radius);
    padding: 32px;
    max-width: 400px;
    width: calc(100vw - 32px);
    text-align: center;
    color: var(--byoky-text);
    box-shadow: var(--byoky-shadow);
    animation: slideUp 0.2s ease-out;
  }

  .icon { margin-bottom: 16px; color: var(--byoky-accent); }
  .icon svg { width: 44px; height: 44px; }

  h2 { font-size: 18px; font-weight: 700; color: var(--byoky-text); margin-bottom: 8px; letter-spacing: -0.01em; }
  p { font-size: 14px; color: var(--byoky-text-secondary); line-height: 1.5; margin-bottom: 20px; }

  .options { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }

  button {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    border: none; border-radius: 10px; font-size: 14px; font-weight: 700;
    padding: 12px 20px; cursor: pointer; transition: all 0.18s;
    font-family: inherit;
  }

  .btn-primary { background: var(--byoky-accent); color: #fff; }
  .btn-primary:hover { background: var(--byoky-accent-hover); transform: translateY(-1px); }

  .btn-secondary {
    background: var(--byoky-bg-elevated); color: var(--byoky-text);
    border: 1px solid var(--byoky-border);
  }
  .btn-secondary:hover { background: #f5f5f4; border-color: var(--byoky-border-strong); }

  .btn-ghost {
    background: none; color: var(--byoky-text-muted); font-size: 13px; padding: 8px 16px;
    font-weight: 600;
  }
  .btn-ghost:hover { color: var(--byoky-accent); }

  a.install-link {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    border-radius: 10px; font-size: 14px; font-weight: 700;
    padding: 11px 20px; cursor: pointer; transition: all 0.18s;
    font-family: inherit; text-decoration: none;
    background: var(--byoky-bg-elevated); color: var(--byoky-text);
    border: 1px solid var(--byoky-border);
    margin-bottom: 8px;
  }
  a.install-link:hover { background: #f5f5f4; border-color: var(--byoky-border-strong); }

  .qr {
    margin: 20px auto; width: 220px; height: 220px;
    border-radius: 12px; overflow: hidden;
    background: #fff;
    border: 1px solid var(--byoky-border);
    padding: 10px;
  }
  .qr svg { display: block; width: 100%; height: 100%; }

  .code-box {
    display: flex; align-items: flex-start; gap: 8px;
    background: var(--byoky-bg-elevated); border: 1px solid var(--byoky-border);
    border-radius: 8px;
    padding: 10px 12px; margin-bottom: 16px;
  }
  .code-box code {
    flex: 1; font-size: 11px; line-height: 1.5; color: var(--byoky-text-secondary);
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    text-align: left;
    word-break: break-all;
    max-height: 4.5em; overflow: hidden;
  }
  .copy-btn {
    background: none; border: 1px solid var(--byoky-border-strong);
    color: var(--byoky-text-secondary); font-size: 12px; font-weight: 600;
    padding: 4px 10px; border-radius: 6px;
    cursor: pointer; flex-shrink: 0;
  }
  .copy-btn:hover { color: var(--byoky-accent); border-color: var(--byoky-accent); }

  .status {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    font-size: 13px; color: var(--byoky-text-muted); margin-bottom: 16px;
    font-weight: 500;
  }

  .spinner {
    width: 16px; height: 16px; border: 2px solid var(--byoky-border);
    border-top-color: var(--byoky-accent); border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .success-check {
    width: 48px; height: 48px; color: #16a34a; margin: 0 auto 12px;
  }

  .link { color: var(--byoky-accent); text-decoration: none; font-weight: 600; }
  .link:hover { text-decoration: underline; }

  .footer { font-size: 13px; color: var(--byoky-text-muted); }

  .error-msg { color: #dc2626; font-size: 14px; margin-bottom: 16px; }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

const ICON_SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>';
const ICON_PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>';
const ICON_EXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';

export class ConnectModal {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private card!: HTMLElement;
  private state: ModalState;
  private pairingCode: string | null = null;
  private errorMessage: string | null = null;
  private fns!: ConnectFunctions;
  private resolve!: (s: ByokySession) => void;
  private reject!: (e: Error) => void;
  private container: HTMLElement;
  private destroyed = false;

  constructor(options: ModalOptions = {}) {
    this.container = options.container ?? document.body;
    this.state = 'connecting';
    this.host = document.createElement('div');
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = STYLES;
    if (options.theme) {
      const t = options.theme;
      const vars: string[] = [];
      if (t.accentColor) vars.push(`--byoky-accent: ${sanitizeCssValue(t.accentColor)}`);
      if (t.backgroundColor) vars.push(`--byoky-bg: ${sanitizeCssValue(t.backgroundColor)}`);
      if (t.textColor) vars.push(`--byoky-text: ${sanitizeCssValue(t.textColor)}`);
      if (t.borderRadius) vars.push(`--byoky-radius: ${sanitizeCssValue(t.borderRadius)}`);
      if (vars.length) style.textContent += `:host { ${vars.join('; ')} }`;
    }
    this.shadow.appendChild(style);
  }

  show(fns: ConnectFunctions): Promise<ByokySession> {
    if (activeModal) activeModal.destroy();
    activeModal = this;
    this.fns = fns;
    this.state = fns.hasExtension ? 'connecting' : 'relay-connecting';
    this.container.appendChild(this.host);

    return new Promise<ByokySession>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.render();
      // Skip the choose step: if the extension is present we auto-connect,
      // otherwise we go straight to relay pairing (QR + app-store fallback).
      if (fns.hasExtension) {
        this.handleExtension();
      } else {
        this.handleRelay();
      }
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (activeModal === this) activeModal = null;
    this.host.remove();
  }

  private setState(state: ModalState) {
    this.state = state;
    this.render();
  }

  private render() {
    const existing = this.shadow.querySelector('.overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.handleCancel();
    });

    this.card = document.createElement('div');
    this.card.className = 'card';
    overlay.appendChild(this.card);
    this.shadow.appendChild(overlay);

    switch (this.state) {
      case 'connecting': this.renderConnecting(); break;
      case 'relay-connecting': this.renderRelayConnecting(); break;
      case 'pairing': this.renderPairing(); break;
      case 'success': this.renderSuccess(); break;
      case 'error': this.renderError(); break;
    }
  }

  private renderConnecting() {
    this.card.innerHTML = '';
    this.addIcon(ICON_EXT);
    this.addHeading('Connecting...');
    this.addStatus('Waiting for wallet approval');
  }

  private renderRelayConnecting() {
    this.card.innerHTML = '';
    this.addIcon(ICON_PHONE);
    this.addHeading('Connecting to relay...');
    this.addStatus('Establishing secure channel');
  }

  private renderPairing() {
    this.card.innerHTML = '';
    this.addIcon(ICON_PHONE);
    this.addHeading('Scan to connect');
    this.addText('Scan with your phone to pair the Byoky mobile app. No app yet? You\'ll be sent to the App Store or Play Store.');

    const qrUrl = this.pairingCode ? `${PAIR_URL_BASE}#${this.pairingCode}` : null;

    if (qrUrl) {
      const qrDiv = document.createElement('div');
      qrDiv.className = 'qr';
      try {
        const matrix = encode(qrUrl);
        qrDiv.innerHTML = toSvg(matrix, { size: 200, margin: 2, darkColor: '#1c1917', lightColor: '#ffffff' });
      } catch {
        // Fallback if pairing code is too large for QR
      }
      this.card.appendChild(qrDiv);

      const codeBox = document.createElement('div');
      codeBox.className = 'code-box';
      const code = document.createElement('code');
      code.textContent = qrUrl;
      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(qrUrl);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      });
      codeBox.appendChild(code);
      codeBox.appendChild(copyBtn);
      this.card.appendChild(codeBox);
    }

    this.addStatus('Waiting for phone...');

    const storeUrl = this.fns.getStoreUrl();
    if (storeUrl) {
      const extBtn = document.createElement('a');
      extBtn.className = 'btn-secondary install-link';
      extBtn.href = storeUrl;
      extBtn.target = '_blank';
      extBtn.rel = 'noopener noreferrer';
      const iconSpan = document.createElement('span');
      iconSpan.innerHTML = ICON_EXT;
      iconSpan.querySelector('svg')?.setAttribute('width', '18');
      iconSpan.querySelector('svg')?.setAttribute('height', '18');
      const label = document.createElement('span');
      label.textContent = 'Install the Byoky extension';
      extBtn.appendChild(iconSpan);
      extBtn.appendChild(label);
      this.card.appendChild(extBtn);
    }

    this.card.appendChild(this.createButton('Cancel', 'btn-ghost', null, () => this.handleCancel()));
  }

  private renderSuccess() {
    this.card.innerHTML = '';
    const icon = document.createElement('div');
    icon.className = 'success-check';
    icon.innerHTML = ICON_CHECK;
    this.card.appendChild(icon);
    this.addHeading('Connected!');
  }

  private renderError() {
    this.card.innerHTML = '';
    this.addIcon(ICON_SHIELD);
    this.addHeading('Connection failed');
    const msg = document.createElement('div');
    msg.className = 'error-msg';
    msg.textContent = this.errorMessage ?? 'Something went wrong. Please try again.';
    this.card.appendChild(msg);

    const options = document.createElement('div');
    options.className = 'options';
    options.appendChild(this.createButton('Try Again', 'btn-primary', null, () => {
      this.pairingCode = null;
      this.errorMessage = null;
      if (this.fns.hasExtension) {
        this.setState('connecting');
        this.handleExtension();
      } else {
        this.setState('relay-connecting');
        this.handleRelay();
      }
    }));
    options.appendChild(this.createButton('Cancel', 'btn-ghost', null, () => this.handleCancel()));
    this.card.appendChild(options);
  }

  // --- Helpers ---

  private addIcon(svg: string) {
    const div = document.createElement('div');
    div.className = 'icon';
    div.innerHTML = svg;
    this.card.appendChild(div);
  }

  private addHeading(text: string) {
    const h = document.createElement('h2');
    h.textContent = text;
    this.card.appendChild(h);
  }

  private addText(text: string) {
    const p = document.createElement('p');
    p.textContent = text;
    this.card.appendChild(p);
  }

  private addStatus(text: string) {
    const div = document.createElement('div');
    div.className = 'status';
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    div.appendChild(spinner);
    const span = document.createElement('span');
    span.textContent = text;
    div.appendChild(span);
    this.card.appendChild(div);
  }

  private createButton(text: string, cls: string, iconSvg: string | null, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = cls;
    if (iconSvg) {
      const iconSpan = document.createElement('span');
      iconSpan.innerHTML = iconSvg;
      iconSpan.querySelector('svg')?.setAttribute('width', '18');
      iconSpan.querySelector('svg')?.setAttribute('height', '18');
      btn.appendChild(iconSpan);
    }
    const label = document.createElement('span');
    label.textContent = text;
    btn.appendChild(label);
    btn.addEventListener('click', onClick);
    return btn;
  }

  // --- Actions ---

  private async handleExtension() {
    this.setState('connecting');
    try {
      const session = await this.fns.connectExtension();
      this.setState('success');
      setTimeout(() => { this.destroy(); this.resolve(session); }, 800);
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : 'Failed to connect to extension';
      this.setState('error');
    }
  }

  private async handleRelay() {
    this.setState('relay-connecting');
    try {
      const session = await this.fns.connectRelay((code) => {
        this.pairingCode = code;
        this.setState('pairing');
      });
      this.setState('success');
      setTimeout(() => { this.destroy(); this.resolve(session); }, 800);
    } catch (err) {
      if (this.destroyed) return;
      this.errorMessage = err instanceof Error ? err.message : 'Failed to connect via relay';
      this.setState('error');
    }
  }

  private handleCancel() {
    this.destroy();
    this.reject(new Error('User cancelled'));
  }
}
