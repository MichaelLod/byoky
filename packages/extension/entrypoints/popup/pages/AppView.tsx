import { useEffect, useRef } from 'react';
import { browser } from 'wxt/browser';
import { useWalletStore } from '../store';

export function AppView() {
  const { activeApp, navigate } = useWalletStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  if (!activeApp) {
    navigate('apps');
    return null;
  }

  // Block non-HTTPS URLs from loading in the iframe
  let safeUrl: string;
  let appOrigin: string;
  try {
    const parsed = new URL(activeApp.url);
    if (parsed.protocol !== 'https:') {
      navigate('apps');
      return null;
    }
    appOrigin = parsed.origin;
    // Hash marker tells the SDK it's running inside the extension popup so
    // it routes BYOKY_ messages to window.parent (bridged here) instead of
    // relying on content scripts.
    parsed.hash = parsed.hash ? `${parsed.hash}&byoky-in-popup=1` : 'byoky-in-popup=1';
    safeUrl = parsed.href;
  } catch {
    navigate('apps');
    return null;
  }

  // Bridge BYOKY_* messages between the hosted iframe and the background.
  // Mirrors the iOS NativeBridgeHandler: the extension popup itself acts as
  // the "native" side, declaring the iframe's origin on its behalf.
  useEffect(() => setupBridge(iframeRef, appOrigin), [appOrigin]);

  return (
    <div className="app-view">
      <div className="app-view-header">
        <button className="text-link" onClick={() => navigate('apps')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {activeApp.name}
        </button>
      </div>
      <iframe
        ref={iframeRef}
        src={safeUrl}
        className="app-view-iframe"
        sandbox="allow-scripts allow-forms allow-popups"
        referrerPolicy="no-referrer"
        title={activeApp.name}
      />
    </div>
  );
}

function setupBridge(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  appOrigin: string,
): () => void {
  const proxyPorts = new Map<string, ReturnType<typeof browser.runtime.connect>>();

  function handleMessage(event: MessageEvent) {
    const iframe = iframeRef.current;
    if (!iframe || event.source !== iframe.contentWindow) return;
    const data = event.data as { type?: string; [k: string]: unknown } | undefined;
    if (!data || typeof data.type !== 'string' || !data.type.startsWith('BYOKY_')) return;
    const replyPort: MessagePort | undefined = event.ports?.[0];

    if (data.type === 'BYOKY_PROXY_REQUEST') {
      const requestId = typeof data.requestId === 'string' ? data.requestId : null;
      if (!requestId || !replyPort) return;
      const port = browser.runtime.connect({ name: 'byoky-proxy' });
      proxyPorts.set(requestId, port);
      port.postMessage({ ...data, appOrigin });
      port.onMessage.addListener((msg: unknown) => {
        try { replyPort.postMessage(msg); } catch { /* port closed */ }
        const m = msg as { type?: string };
        if (m?.type === 'BYOKY_PROXY_RESPONSE_DONE' || m?.type === 'BYOKY_PROXY_RESPONSE_ERROR') {
          try { port.disconnect(); } catch {}
          proxyPorts.delete(requestId);
        }
      });
      port.onDisconnect.addListener(() => {
        proxyPorts.delete(requestId);
        try {
          replyPort.postMessage({
            type: 'BYOKY_PROXY_RESPONSE_ERROR',
            requestId,
            status: 500,
            error: { code: 'PROXY_ERROR', message: 'Extension disconnected' },
          });
        } catch {}
      });
      return;
    }

    if (
      data.type === 'BYOKY_CONNECT_REQUEST' ||
      data.type === 'BYOKY_DISCONNECT' ||
      data.type === 'BYOKY_SESSION_STATUS' ||
      data.type === 'BYOKY_SESSION_USAGE'
    ) {
      if (!replyPort && data.type !== 'BYOKY_DISCONNECT') return;
      const port = browser.runtime.connect({ name: 'byoky-message' });
      let replied = false;
      port.postMessage({ ...data, appOrigin });
      port.onMessage.addListener((msg: unknown) => {
        replied = true;
        try { replyPort?.postMessage(msg); } catch {}
        try { port.disconnect(); } catch {}
      });
      port.onDisconnect.addListener(() => {
        if (replied || !replyPort) return;
        try {
          replyPort.postMessage({
            type: 'BYOKY_ERROR',
            requestId: data.requestId ?? data.id,
            payload: { code: 'EXTENSION_ERROR', message: 'Extension disconnected' },
          });
        } catch {}
      });
      return;
    }

    if (data.type === 'BYOKY_REGISTER_NOTIFY') {
      // Push-notification channel: route background "session revoked" /
      // "providers updated" events to the iframe via the MessagePort.
      if (!replyPort) return;
      const notifyPort = browser.runtime.connect({ name: 'byoky-notify' });
      notifyPort.onMessage.addListener((msg: unknown) => {
        try { replyPort.postMessage(msg); } catch {}
      });
      notifyPort.onDisconnect.addListener(() => {
        try { replyPort.close(); } catch {}
      });
    }
  }

  window.addEventListener('message', handleMessage);
  return () => {
    window.removeEventListener('message', handleMessage);
    for (const p of proxyPorts.values()) { try { p.disconnect(); } catch {} }
    proxyPorts.clear();
  };
}
