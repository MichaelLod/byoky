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
          window.postMessage(msg, '*');
        });

        port.onDisconnect.addListener(() => {
          window.postMessage(
            {
              type: 'BYOKY_PROXY_RESPONSE_ERROR',
              requestId: data.requestId,
              status: 500,
              error: {
                code: 'PROXY_ERROR',
                message: 'Extension disconnected',
              },
            },
            '*',
          );
        });
      } else if (
        data.type === 'BYOKY_CONNECT_REQUEST' ||
        data.type === 'BYOKY_DISCONNECT'
      ) {
        // Simple message passing for connect/disconnect
        console.log('[byoky:content] forwarding to background:', data.type);
        browser.runtime.sendMessage(data).then((response) => {
          console.log('[byoky:content] got response from background:', response);
          if (response) {
            window.postMessage(response, '*');
          }
        }).catch((err) => {
          console.error('[byoky:content] error from background:', err);
        });
      }
    });
  },
});
