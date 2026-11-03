import { useEffect } from 'react';
import { useWalletStore } from '../store';

/**
 * Counts a form as in use while the calling component is mounted and `open`.
 * A connection request that comes in meanwhile then doesn't switch the view
 * to the approval screen, which would unmount the form and lose what was
 * typed; App shows a banner instead (PendingRequestBanner).
 */
export function useFormInUse(open = true): void {
  useEffect(() => {
    if (!open) return;
    useWalletStore.setState((s) => ({ formsInUse: s.formsInUse + 1 }));
    return () => useWalletStore.setState((s) => ({ formsInUse: Math.max(0, s.formsInUse - 1) }));
  }, [open]);
}
