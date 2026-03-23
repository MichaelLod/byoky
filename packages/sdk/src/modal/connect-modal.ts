import type { ConnectResponse } from '@byoky/core';
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

type ModalState = 'choose' | 'connecting' | 'relay-connecting' | 'pairing' | 'success' | 'error';

let activeModal: ConnectModal | null = null;

function sanitizeCssValue(val: string): string {
  return val.replace(/[;{}()\\<>"']/g, '');
}

const STYLES = /* css */ `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  .overlay {
    position: fixed; inset: 0; z-index: 2147483647;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
    animation: fadeIn 0.15s ease-out;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .card {
    background: var(--bg, #0c0c14);
    border: 1px solid var(--border, rgba(255,255,255,0.08));
    border-radius: var(--radius, 16px);
    padding: 32px;
    max-width: 400px;
    width: calc(100vw - 32px);
    text-align: center;
    color: var(--text, #e4e4e7);
    animation: slideUp 0.2s ease-out;
  }

  .icon { margin-bottom: 16px; color: var(--accent, #0ea5e9); }
  .icon svg { width: 44px; height: 44px; }

  h2 { font-size: 18px; font-weight: 600; color: #f5f5f7; margin-bottom: 8px; }
  p { font-size: 14px; color: #a1a1aa; line-height: 1.5; margin-bottom: 20px; }

  .options { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }

  button {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    border: none; border-radius: 10px; font-size: 15px; font-weight: 500;
    padding: 12px 20px; cursor: pointer; transition: all 0.15s;
    font-family: inherit;
  }

  .btn-primary {
    background: var(--accent, #0ea5e9); color: #fff;
  }
  .btn-primary:hover { filter: brightness(1.1); }

  .btn-secondary {
    background: rgba(255,255,255,0.06); color: #e4e4e7;
    border: 1px solid rgba(255,255,255,0.1);
  }
  .btn-secondary:hover { background: rgba(255,255,255,0.1); }

  .btn-ghost {
    background: none; color: #71717a; font-size: 13px; padding: 8px 16px;
  }
  .btn-ghost:hover { color: #a1a1aa; }

  .qr { margin: 20px auto; width: 200px; height: 200px; border-radius: 12px; overflow: hidden; background: #1c1c22; }
  .qr svg { display: block; }

  .code-box {
    display: flex; align-items: center; gap: 8px;
    background: rgba(255,255,255,0.04); border-radius: 8px;
    padding: 8px 12px; margin-bottom: 16px;
  }
  .code-box code {
    flex: 1; font-size: 12px; color: #71717a;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: 'SF Mono', Menlo, Consolas, monospace;
  }
  .copy-btn {
    background: none; border: 1px solid rgba(255,255,255,0.1);
    color: #a1a1aa; font-size: 12px; padding: 4px 10px; border-radius: 6px;
    cursor: pointer; flex-shrink: 0;
  }
  .copy-btn:hover { color: #e4e4e7; border-color: rgba(255,255,255,0.2); }

  .status {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    font-size: 14px; color: #71717a; margin-bottom: 16px;
  }

  .spinner {
    width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.1);
    border-top-color: var(--accent, #0ea5e9); border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .success-check {
    width: 48px; height: 48px; color: #22c55e; margin-bottom: 12px;
  }

  .link { color: var(--accent, #0ea5e9); text-decoration: none; }
  .link:hover { text-decoration: underline; }

  .footer { font-size: 13px; color: #52525b; }

  .error-msg { color: #ef4444; font-size: 14px; margin-bottom: 16px; }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
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
  private state: ModalState = 'choose';
  private pairingCode: string | null = null;
  private errorMessage: string | null = null;
  private fns!: ConnectFunctions;
  private resolve!: (s: ByokySession) => void;
  private reject!: (e: Error) => void;
  private container: HTMLElement;
  private destroyed = false;

  constructor(options: ModalOptions = {}) {
    this.container = options.container ?? document.body;
    this.host = document.createElement('div');
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = STYLES;
    if (options.theme) {
      const t = options.theme;
      const vars: string[] = [];
      if (t.accentColor) vars.push(`--accent: ${sanitizeCssValue(t.accentColor)}`);
      if (t.backgroundColor) vars.push(`--bg: ${sanitizeCssValue(t.backgroundColor)}`);
      if (t.textColor) vars.push(`--text: ${sanitizeCssValue(t.textColor)}`);
      if (t.borderRadius) vars.push(`--radius: ${sanitizeCssValue(t.borderRadius)}`);
      if (vars.length) style.textContent += `:host { ${vars.join('; ')} }`;
    }
    this.shadow.appendChild(style);
  }

  show(fns: ConnectFunctions): Promise<ByokySession> {
    if (activeModal) activeModal.destroy();
    activeModal = this;
    this.fns = fns;
    this.container.appendChild(this.host);

    return new Promise<ByokySession>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.render();
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
      case 'choose': this.renderChoose(); break;
      case 'connecting': this.renderConnecting(); break;
      case 'relay-connecting': this.renderRelayConnecting(); break;
      case 'pairing': this.renderPairing(); break;
      case 'success': this.renderSuccess(); break;
      case 'error': this.renderError(); break;
    }
  }

  private renderChoose() {
    this.card.innerHTML = '';
    this.addIcon(ICON_SHIELD);
    this.addHeading('Connect your Byoky wallet');
    this.addText('Your API keys never leave your device. This app uses the Byoky SDK to proxy requests through your wallet.');

    const options = document.createElement('div');
    options.className = 'options';

    if (this.fns.hasExtension) {
      options.appendChild(this.createButton('Connect with Extension', 'btn-primary', ICON_EXT, () => this.handleExtension()));
      options.appendChild(this.createButton('Connect with Phone App', 'btn-secondary', ICON_PHONE, () => this.handleRelay()));
    } else {
      options.appendChild(this.createButton('Connect with Phone App', 'btn-primary', ICON_PHONE, () => this.handleRelay()));
      options.appendChild(this.createButton('Connect with Extension', 'btn-secondary', ICON_EXT, () => this.handleExtension()));
    }

    this.card.appendChild(options);

    const storeUrl = this.fns.getStoreUrl();
    if (storeUrl || !this.fns.hasExtension) {
      const footer = document.createElement('div');
      footer.className = 'footer';
      footer.textContent = "Don't have Byoky? ";
      const link = document.createElement('a');
      link.className = 'link';
      link.href = 'https://byoky.com';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Get the app or extension';
      footer.appendChild(link);
      this.card.appendChild(footer);
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
    this.addHeading('Scan with Byoky App');
    this.addText('Open the Byoky app on your phone, go to the Pair tab, and scan this QR code.');

    if (this.pairingCode) {
      const qrDiv = document.createElement('div');
      qrDiv.className = 'qr';
      try {
        const matrix = encode(this.pairingCode);
        qrDiv.innerHTML = toSvg(matrix, { size: 200, margin: 2, darkColor: '#f5f5f7', lightColor: '#1c1c22' });
      } catch {
        // Fallback if pairing code is too large for QR
      }
      this.card.appendChild(qrDiv);

      const codeBox = document.createElement('div');
      codeBox.className = 'code-box';
      const code = document.createElement('code');
      code.textContent = `${this.pairingCode.slice(0, 20)}...${this.pairingCode.slice(-10)}`;
      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(this.pairingCode!);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      });
      codeBox.appendChild(code);
      codeBox.appendChild(copyBtn);
      this.card.appendChild(codeBox);
    }

    this.addStatus('Waiting for phone...');
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
    options.appendChild(this.createButton('Try Again', 'btn-primary', null, () => this.setState('choose')));
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
