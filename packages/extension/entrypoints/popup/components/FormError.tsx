import { useState, type ReactNode } from 'react';
import { lockoutAnnouncement, lockoutMessage } from '../hooks/useLockoutCountdown';

/**
 * An inline form error. Screen readers announce it when it appears
 * (role=alert); `id` lets the field it is about point at it with
 * aria-describedby.
 */
export function FormError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <div id={id} className="error" role="alert">
      {children}
    </div>
  );
}

/**
 * A password lockout as a form error. The countdown on screen changes every
 * second, which an alert would read out every second, so it is hidden from
 * screen readers; they get a fixed alert instead, once, when the lockout
 * starts. Key it by the lockout so a new one is announced again.
 */
export function LockoutError({ id, seconds }: { id?: string; seconds: number }) {
  const [announcement] = useState(() => lockoutAnnouncement(seconds));
  return (
    <>
      <div className="error" aria-hidden="true">
        {lockoutMessage(seconds)}
      </div>
      <div id={id} className="sr-only" role="alert">
        {announcement}
      </div>
    </>
  );
}

/**
 * Says, politely and once, that a lockout is over. A live region is only
 * read when its content changes, so it stays mounted, empty until then.
 */
export function LockoutEndedStatus({ ended }: { ended: boolean }) {
  return (
    <div className="sr-only" role="status">
      {ended ? 'You can try again now.' : ''}
    </div>
  );
}
