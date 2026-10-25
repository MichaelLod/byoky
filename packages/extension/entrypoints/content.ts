import type { Runtime } from 'wxt/browser';

// Backoff for reopening the notify port. A port that stayed up for
// NOTIFY_STABLE_MS closed because the worker went idle, not because it
// can't be reached, so the backoff starts over.
const NOTIFY_RETRY_MIN_MS = 1_000;
const NOTIFY_RETRY_MAX_MS = 60_000;
const NOTIFY_STABLE_MS = 10_000;

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,

  main() {
    // Ports registered by SDK instances for push notifications (revocations).
    // MessagePort cannot be spoofed by page scripts, unlike CustomEvent.
    const notifyPorts = new Set<MessagePort>();

    // This frame's notify port to the background (see connectNotifyPort).
    let notifyPort: Runtime.Port | null = null;
    let notifyRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let notifyRetryMs = NOTIFY_RETRY_MIN_MS;

    // The background port of each in-flight proxy request, by request id,
    // so the page can cancel it (BYOKY_PROXY_CANCEL).
    const proxyPorts = new Map<string, Runtime.Port>();

    // Relay messages from page to background
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;

      if (typeof data?.type !== 'string' || !data.type.startsWith('BYOKY_')) return;

      // Prefer MessagePort for response delivery (secure, unspoofable by page scripts).
      // Falls back to CustomEvent for older SDK versions that don't transfer a port.
      const replyPort: MessagePort | undefined = event.ports[0];

      function reply(msg: unknown) {
        if (replyPort) {
          replyPort.postMessage(msg);
        } else {
          document.dispatchEvent(
            new CustomEvent('byoky-message', { detail: msg }),
          );
        }
      }

      if (data.type === 'BYOKY_PROXY_REQUEST') {
        // Validate message structure before forwarding to background
        if (
          typeof data.requestId !== 'string' ||
          typeof data.sessionKey !== 'string' ||
          typeof data.providerId !== 'string' ||
          typeof data.url !== 'string' ||
          typeof data.method !== 'string'
        ) return;

        // Use a port for streaming proxy requests. Closing it cancels the
        // request: the background aborts the upstream fetch.
        const requestId: string = data.requestId;
        const port = browser.runtime.connect({ name: 'byoky-proxy' });
        proxyPorts.set(requestId, port);

        // Stops tracking the request. False if the response already finished
        // or the page cancelled it.
        const untrack = () => {
          if (proxyPorts.get(requestId) !== port) return false;
          proxyPorts.delete(requestId);
          return true;
        };

        port.postMessage(data);

        port.onMessage.addListener((msg) => {
          const type = (msg as { type?: string } | null)?.type;
          if (type === 'BYOKY_PROXY_RESPONSE_DONE' || type === 'BYOKY_PROXY_RESPONSE_ERROR') {
            untrack();
          }
          reply(msg);
        });

        port.onDisconnect.addListener(() => {
          if (!untrack()) return;
          reply({
            type: 'BYOKY_PROXY_RESPONSE_ERROR',
            requestId,
            status: 500,
            error: {
              code: 'PROXY_ERROR',
              message: 'Extension disconnected',
            },
          });
        });
      } else if (data.type === 'BYOKY_PROXY_CANCEL') {
        if (typeof data.requestId !== 'string') return;
        const port = proxyPorts.get(data.requestId);
        if (!port) return;
        proxyPorts.delete(data.requestId);
        // disconnect() doesn't fire this side's onDisconnect, so the page
        // gets no "Extension disconnected" error for its own cancel.
        port.disconnect();
      } else if (
        data.type === 'BYOKY_CONNECT_REQUEST' ||
        data.type === 'BYOKY_DISCONNECT' ||
        data.type === 'BYOKY_SESSION_STATUS' ||
        data.type === 'BYOKY_SESSION_USAGE'
      ) {
        // Older SDKs sent a disconnect with neither a port nor an id, and
        // nothing on the page waits for its acknowledgement.
        const isDisconnect = data.type === 'BYOKY_DISCONNECT';

        // When a MessagePort is available, skip the id check (port IS the reply channel).
        // Old SDK without MessagePort still needs id for CustomEvent correlation.
        if (!replyPort && !isDisconnect && typeof data.id !== 'string') return;

        // Use a port for these requests so the message goes directly to the
        // background and isn't also dispatched to the side-panel/popup, which
        // can swallow the response in Chrome MV3 when multiple onMessage
        // listeners exist.
        const port = browser.runtime.connect({ name: 'byoky-message' });
        let replied = false;
        port.postMessage(data);
        port.onMessage.addListener((msg) => {
          replied = true;
          // The background acknowledges a disconnect only so this port can
          // close; the page doesn't need it.
          if (!isDisconnect) reply(msg);
          port.disconnect();
        });
        port.onDisconnect.addListener(() => {
          if (replied || isDisconnect) return;
          reply({
            type: 'BYOKY_ERROR',
            requestId: data.id || data.requestId,
            payload: { code: 'EXTENSION_ERROR', message: 'Extension disconnected' },
          });
        });
      } else if (data.type === 'BYOKY_INTERNAL_FROM_PAGE') {
        // Only allow from localhost/127.0.0.1, checked by exact hostname match
        const hostname = window.location.hostname;
        if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]') {
          return;
        }
        // Only allow safe actions — never expose admin/crypto actions to web pages
        const ALLOWED_PAGE_ACTIONS = ['startBridgeProxy', 'checkBridge'];
        if (!ALLOWED_PAGE_ACTIONS.includes(data.action)) {
          return;
        }
        browser.runtime.sendMessage({
          type: 'BYOKY_INTERNAL',
          action: data.action,
          payload: data.payload,
        }).then((response) => {
          reply({ requestId: data.requestId, payload: response });
        }).catch(() => {});
      } else if (data.type === 'BYOKY_REGISTER_NOTIFY') {
        // SDK registers a MessagePort for secure push notifications
        if (replyPort) {
          notifyPorts.add(replyPort);
          if (!notifyPort && !notifyRetryTimer) connectNotifyPort();
        }
      }
    });

    // Persistent port for receiving notifications (revocations, provider
    // updates) from background. They carry a session key, so the background
    // only sends this frame the ones for sessions of its own origin.
    //
    // The port closes whenever the background service worker shuts down
    // (after ~30 s idle in MV3), so it is reopened, but only while an SDK in
    // this frame listens: reopening it in every frame of every tab would keep
    // waking the worker. The background needs no message to register a
    // port; it keys notifications by the port's sender origin.
    function forwardNotification(msg: unknown) {
      // Push to registered SDK notification ports (secure channel)
      for (const port of notifyPorts) {
        try {
          port.postMessage(msg);
        } catch {
          notifyPorts.delete(port);
        }
      }
      // Also dispatch CustomEvent for backwards compat with old SDK versions
      document.dispatchEvent(
        new CustomEvent('byoky-message', { detail: msg }),
      );
    }

    // After an extension update or reload this script lives on in the page
    // but is cut off: runtime.id goes away and connect() throws.
    function extensionAlive(): boolean {
      try {
        return !!browser.runtime?.id;
      } catch {
        return false;
      }
    }

    function connectNotifyPort() {
      notifyRetryTimer = null;
      if (!extensionAlive()) return;
      let port: Runtime.Port;
      try {
        port = browser.runtime.connect({ name: 'byoky-notify' });
      } catch {
        return;
      }
      notifyPort = port;
      const connectedAt = Date.now();
      port.onMessage.addListener(forwardNotification);
      port.onDisconnect.addListener(() => {
        notifyPort = null;
        if (Date.now() - connectedAt >= NOTIFY_STABLE_MS) notifyRetryMs = NOTIFY_RETRY_MIN_MS;
        scheduleNotifyReconnect();
      });
    }

    function scheduleNotifyReconnect() {
      if (notifyPort || notifyRetryTimer || notifyPorts.size === 0) return;
      if (!extensionAlive()) return;
      notifyRetryTimer = setTimeout(connectNotifyPort, notifyRetryMs);
      notifyRetryMs = Math.min(notifyRetryMs * 2, NOTIFY_RETRY_MAX_MS);
    }

    connectNotifyPort();
  },
});
