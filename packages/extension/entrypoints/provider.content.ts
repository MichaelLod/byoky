export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',

  main() {
    // Inject the byoky provider into the page context
    Object.defineProperty(window, '__byoky__', {
      value: Object.freeze({
        version: '0.3.0',
        isByoky: true,
      }),
      writable: false,
      configurable: false,
    });
  },
});
