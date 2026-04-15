export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,

  main() {
    // Ports registered by SDK instances for push notifications (revocations).
    // MessagePort cannot be spoofed by page scripts, unlike CustomEvent.
    const notifyPorts = new Set<MessagePort>();

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

        // Use a port for streaming proxy requests
        const port = browser.runtime.connect({ name: 'byoky-proxy' });

        port.postMessage(data);

        port.onMessage.addListener((msg) => {
          reply(msg);
        });

        port.onDisconnect.addListener(() => {
          reply({
            type: 'BYOKY_PROXY_RESPONSE_ERROR',
            requestId: data.requestId,
            status: 500,
            error: {
              code: 'PROXY_ERROR',
              message: 'Extension disconnected',
            },
          });
        });
      } else if (
        data.type === 'BYOKY_CONNECT_REQUEST' ||
        data.type === 'BYOKY_DISCONNECT' ||
        data.type === 'BYOKY_SESSION_STATUS' ||
        data.type === 'BYOKY_SESSION_USAGE'
      ) {
        // When a MessagePort is available, skip the id check (port IS the reply channel).
        // Old SDK without MessagePort still needs id for CustomEvent correlation.
        if (!replyPort && typeof data.id !== 'string') return;

        // Use a port for these requests so the message goes directly to the
        // background and isn't also dispatched to the side-panel/popup, which
        // can swallow the response in Chrome MV3 when multiple onMessage
        // listeners exist.
        const port = browser.runtime.connect({ name: 'byoky-message' });
        let replied = false;
        port.postMessage(data);
        port.onMessage.addListener((msg) => {
          replied = true;
          reply(msg);
          port.disconnect();
        });
        port.onDisconnect.addListener(() => {
          if (replied) return;
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
        const ALLOWED_PAGE_ACTIONS = ['startBridgeProxy', 'checkBridge', 'startOAuth'];
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
        }
      }
    });

    // Persistent port for receiving notifications (revocations) from background
    const notifyPort = browser.runtime.connect({ name: 'byoky-notify' });
    notifyPort.onMessage.addListener((msg) => {
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
    });
  },
});
