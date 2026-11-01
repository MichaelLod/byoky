import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface DialogFocusOptions {
  /** Called on Escape; leave it out while Escape must not close the dialog. */
  onEscape?: () => void;
  /** Selector, inside the dialog, of what to focus first (else the first focusable). */
  initialFocus?: string;
}

/**
 * Focus handling for a modal dialog: move focus into it on open, keep Tab
 * and Shift+Tab inside it, close it on Escape, and on close give focus back
 * to what opened it, or to the + button when that is gone (the add menu's
 * item unmounts as the dialog opens). The dialog element needs tabIndex={-1}.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, { onEscape, initialFocus }: DialogFocusOptions) {
  // Read while rendering, before the dialog mounts and takes focus.
  const opener = useRef<Element | null>(null);
  if (opener.current === null) opener.current = document.activeElement;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const focusables = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = (initialFocus ? dialog.querySelector<HTMLElement>(initialFocus) : null) ?? focusables()[0] ?? dialog;
    first.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (onEscapeRef.current) {
          e.preventDefault();
          onEscapeRef.current();
        }
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? tail : head).focus();
      } else if (e.shiftKey && (active === head || active === dialog)) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && active === tail) {
        e.preventDefault();
        head.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const back = opener.current;
      const target = back instanceof HTMLElement && back.isConnected && back !== document.body && !dialog.contains(back)
        ? back
        : document.querySelector<HTMLElement>('.fab-button');
      target?.focus();
    };
  }, [ref, initialFocus]);
}
