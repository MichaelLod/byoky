// Loaded into the bridge host with NODE_OPTIONS=--import (bridge-fake.spec.ts).
// A Claude setup token is used by the host itself, from Node, not by the
// browser, so the browser-side fakes never see that request. This sends the
// host's fetches for api.anthropic.com to the fake upstream the spec runs.
const upstream = process.env.BYOKY_E2E_ANTHROPIC_UPSTREAM;

if (upstream) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    // The host passes a URL string; a Request goes through unchanged.
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : '';
    if (url.startsWith('https://api.anthropic.com/')) {
      return realFetch(upstream + url.slice('https://api.anthropic.com'.length), init);
    }
    return realFetch(input, init);
  };
}
