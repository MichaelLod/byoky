import type { Byoky, ByokySession } from '../byoky.js';
import type { Balance, DeveloperAppInfo } from '@byoky/core';

export interface PayButtonOptions {
  byoky: Byoky;
  /** Called when user successfully connects wallet and session is ready. */
  onSession: (session: ByokySession) => void;
  /** Called on error. */
  onError?: (error: Error) => void;
  /** Override button text. Default uses app's discount from vault. */
  label?: string;
  /** Theme customization. */
  theme?: {
    accentColor?: string;
    backgroundColor?: string;
    textColor?: string;
    borderRadius?: string;
  };
}

type ButtonState = 'idle' | 'loading' | 'connecting' | 'active' | 'error';

const STYLES = /* css */ `
  :host { all: initial; display: inline-block; }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  .byoky-pay-btn {
    display: inline-flex; align-items: center; gap: 10px;
    border: none; border-radius: var(--radius, 12px);
    font-size: 15px; font-weight: 600;
    padding: 14px 24px; cursor: pointer;
    transition: all 0.15s ease;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--accent, #0ea5e9);
    color: #fff;
    position: relative;
    overflow: hidden;
  }
  .byoky-pay-btn:hover:not(:disabled) {
    filter: brightness(1.1);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);
  }
  .byoky-pay-btn:active:not(:disabled) {
    transform: translateY(0);
  }
  .byoky-pay-btn:disabled {
    opacity: 0.7; cursor: not-allowed;
  }

  .byoky-pay-btn .icon {
    width: 20px; height: 20px; flex-shrink: 0;
  }

  .byoky-pay-btn .spinner {
    width: 18px; height: 18px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  .byoky-pay-btn .badge {
    display: inline-flex; align-items: center;
    background: rgba(255,255,255,0.2);
    border-radius: 6px; padding: 2px 8px;
    font-size: 12px; font-weight: 700;
    letter-spacing: 0.02em;
  }

  .balance-bar {
    margin-top: 8px; font-size: 12px;
    color: var(--text-muted, #a1a1aa);
    text-align: center;
  }

  .connected-indicator {
    display: flex; align-items: center; gap: 6px;
    font-size: 13px; color: var(--text-muted, #a1a1aa);
    margin-top: 6px;
  }
  .connected-indicator .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #22c55e;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

const WALLET_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`;

export class PayButton {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private state: ButtonState = 'idle';
  private session: ByokySession | null = null;
  private appInfo: DeveloperAppInfo | null = null;
  private balance: Balance | null = null;

  /**
   * Mount a "Pay with Byoky" button into a container element.
   * Returns a cleanup function.
   */
  static mount(
    selector: string | HTMLElement,
    options: PayButtonOptions,
  ): () => void {
    const container = typeof selector === 'string'
      ? document.querySelector(selector) as HTMLElement
      : selector;

    if (!container) {
      throw new Error(`PayButton: container not found: ${selector}`);
    }

    const button = new PayButton();
    button.render(container, options);

    return () => button.destroy();
  }

  private render(container: HTMLElement, options: PayButtonOptions): void {
    this.host = document.createElement('div');
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    container.appendChild(this.host);

    const theme = options.theme ?? {};
    const cssVars = [
      theme.accentColor && `--accent: ${sanitize(theme.accentColor)}`,
      theme.backgroundColor && `--bg: ${sanitize(theme.backgroundColor)}`,
      theme.textColor && `--text: ${sanitize(theme.textColor)}`,
      theme.borderRadius && `--radius: ${sanitize(theme.borderRadius)}`,
    ].filter(Boolean).join(';');

    // Fetch app info for discount display
    this.fetchAppInfo(options.byoky);

    this.updateUI(options, cssVars);
  }

  private updateUI(options: PayButtonOptions, cssVars: string): void {
    if (!this.shadow) return;

    const discount = this.appInfo?.discountPercent ?? 0;
    const label = options.label
      ?? (discount > 0
        ? `Pay with Byoky — ${discount}% off`
        : 'Pay with Byoky');

    const disabled = this.state === 'loading' || this.state === 'connecting';
    const showSpinner = disabled;

    this.shadow.innerHTML = `
      <style>${STYLES}</style>
      <div style="${cssVars}">
        <button class="byoky-pay-btn" ${disabled ? 'disabled' : ''}>
          ${showSpinner
            ? '<div class="spinner"></div>'
            : `<span class="icon">${WALLET_SVG}</span>`}
          <span>${escapeHtml(label)}</span>
          ${discount > 0 && !showSpinner ? `<span class="badge">${discount}% OFF</span>` : ''}
        </button>
        ${this.state === 'active' && this.balance
          ? `<div class="connected-indicator">
              <span class="dot"></span>
              <span>Connected &middot; Balance: $${(this.balance.amountCents / 100).toFixed(2)}</span>
            </div>`
          : ''}
        ${this.state === 'error'
          ? '<div class="balance-bar" style="color: #ef4444;">Connection failed. Click to retry.</div>'
          : ''}
      </div>
    `;

    // Bind click handler
    const btn = this.shadow.querySelector('.byoky-pay-btn');
    btn?.addEventListener('click', () => this.handleClick(options, cssVars));
  }

  private async handleClick(options: PayButtonOptions, cssVars: string): Promise<void> {
    if (this.state === 'loading' || this.state === 'connecting') return;

    // If already connected, re-fire callback
    if (this.state === 'active' && this.session) {
      options.onSession(this.session);
      return;
    }

    this.state = 'connecting';
    this.updateUI(options, cssVars);

    try {
      const session = await options.byoky.connect({ modal: true });
      this.session = session;

      // Fetch balance
      try {
        const balanceData = await options.byoky.getBalance();
        if (balanceData) this.balance = balanceData;
      } catch {
        // Balance fetch is non-critical
      }

      this.state = 'active';
      this.updateUI(options, cssVars);
      options.onSession(session);
    } catch (err) {
      this.state = 'error';
      this.updateUI(options, cssVars);
      options.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async fetchAppInfo(byoky: Byoky): Promise<void> {
    try {
      this.appInfo = await byoky.getAppInfo();
    } catch {
      // App info fetch is non-critical — button works without it
    }
  }

  private destroy(): void {
    if (this.session) {
      this.session.disconnect();
      this.session = null;
    }
    if (this.host?.parentElement) {
      this.host.parentElement.removeChild(this.host);
    }
    this.host = null;
    this.shadow = null;
  }
}

function sanitize(val: string): string {
  return val.replace(/[;{}()\\<>"']/g, '');
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
