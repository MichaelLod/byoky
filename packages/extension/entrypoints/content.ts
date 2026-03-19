export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',

  main() {
    // Relay messages from page to background
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;

      if (typeof data?.type !== 'string' || !data.type.startsWith('BYOKY_')) return;

      if (data.type === 'BYOKY_PROXY_REQUEST') {
        // Use a port for streaming proxy requests
        const port = browser.runtime.connect({ name: 'byoky-proxy' });

        port.postMessage(data);

        port.onMessage.addListener((msg) => {
          document.dispatchEvent(
            new CustomEvent('byoky-message', { detail: msg }),
          );
        });

        port.onDisconnect.addListener(() => {
          document.dispatchEvent(
            new CustomEvent('byoky-message', {
              detail: {
                type: 'BYOKY_PROXY_RESPONSE_ERROR',
                requestId: data.requestId,
                status: 500,
                error: {
                  code: 'PROXY_ERROR',
                  message: 'Extension disconnected',
                },
              },
            }),
          );
        });
      } else if (
        data.type === 'BYOKY_CONNECT_REQUEST' ||
        data.type === 'BYOKY_DISCONNECT' ||
        data.type === 'BYOKY_SESSION_STATUS' ||
        data.type === 'BYOKY_SESSION_USAGE'
      ) {
        browser.runtime.sendMessage(data).then((response) => {
          if (response) {
            document.dispatchEvent(
              new CustomEvent('byoky-message', { detail: response }),
            );
          }
        }).catch(() => {});
      } else if (data.type === 'BYOKY_INTERNAL_FROM_PAGE') {
        // Bridge proxy requests from auth pages (localhost only)
        browser.runtime.sendMessage({
          type: 'BYOKY_INTERNAL',
          action: data.action,
          payload: data.payload,
        }).then((response) => {
          document.dispatchEvent(
            new CustomEvent('byoky-message', {
              detail: { requestId: data.requestId, payload: response },
            }),
          );
        }).catch(() => {});
      }
    });

    // Persistent port for receiving notifications (revocations) from background
    const notifyPort = browser.runtime.connect({ name: 'byoky-notify' });
    notifyPort.onMessage.addListener((msg) => {
      document.dispatchEvent(
        new CustomEvent('byoky-message', { detail: msg }),
      );
    });
  },
});
