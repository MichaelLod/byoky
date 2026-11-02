// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { ConnectModal, type ModalOptions } from '../src/modal/connect-modal.js';

/** Opens the modal (no wallet installed) and returns the CSS in its shadow root. */
function modalCss(options?: ModalOptions): string {
  const modal = new ConnectModal(options);
  void modal.show({
    isExtensionInstalled: () => false,
    connectExtension: () => new Promise(() => {}),
    getStoreUrl: () => null,
  });
  const host = Array.from(document.body.children).find((el) => el.shadowRoot);
  const css = host!.shadowRoot!.querySelector('style')!.textContent ?? '';
  modal.destroy();
  return css;
}

/** The `:host { ... }` block a theme appends after the defaults. */
function themeBlock(css: string): string {
  return css.slice(css.lastIndexOf(':host {'));
}

describe('connect modal styles', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('defaults to the Byoky brand: dark, violet, square, no retired orange', () => {
    const css = modalCss();
    expect(css).toContain('--byoky-accent: #7C3AED');
    expect(css).toContain('--byoky-bg: #100D16');
    expect(css).toContain('--byoky-radius: 0px');
    // The retired light theme: orange accent, white card, light-grey hovers.
    expect(css).not.toMatch(/#FF4F00|#e64500|#ffffff|#fafaf9|#f5f5f4/i);
    expect(css).not.toContain('box-shadow');
  });

  it('derives raised surfaces, borders and softer text from a themed background and text colour', () => {
    // A dark theme used to keep the light #fafaf9 secondary button under light text.
    const block = themeBlock(modalCss({ theme: { backgroundColor: '#0d0d1a', textColor: '#e2e2ec' } }));
    expect(block).toContain('--byoky-bg: #0d0d1a');
    for (const token of ['bg-elevated', 'border', 'border-strong', 'text-secondary', 'text-muted']) {
      expect(block).toMatch(new RegExp(`--byoky-${token}: color-mix\\(in srgb, var\\(--byoky-text\\) \\d+%, var\\(--byoky-bg\\)\\)`));
    }
  });

  it('derives the hover and link colours from a themed accent', () => {
    const block = themeBlock(modalCss({ theme: { accentColor: '#0ea5e9' } }));
    expect(block).toContain('--byoky-accent: #0ea5e9');
    expect(block).toContain('--byoky-accent-hover: color-mix(in srgb, var(--byoky-accent)');
    expect(block).toContain('--byoky-accent-text: var(--byoky-accent)');
    // An accent alone keeps the default surfaces.
    expect(block).not.toContain('--byoky-bg-elevated');
  });

  it('uses no fixed colour that a theme could not reach', () => {
    const css = modalCss();
    const rules = css.slice(css.indexOf('}') + 1); // everything after the :host defaults
    // White text on the accent button and the backdrop are the only literals.
    const literals = (rules.match(/#[0-9a-f]{3,8}\b/gi) ?? []).filter((c) => c.toLowerCase() !== '#fff');
    expect(literals).toEqual([]);
  });
});
