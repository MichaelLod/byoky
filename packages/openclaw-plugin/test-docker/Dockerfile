FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/*

# Fresh install of OpenClaw from npm, then install the byoky plugin via
# OpenClaw's own plugin installer — matches the real user path. OpenClaw only
# scans its stock-extensions dir on its own; third-party plugins must be added
# through `openclaw plugins install`.
RUN npm install -g openclaw
RUN openclaw plugins install @byoky/openclaw-plugin

WORKDIR /test
# Install @byoky/core so bridge.mjs can import the real extension transforms
# (buildHeaders, injectClaudeCodeSystemPrompt, rewriteToolNamesForClaudeCode).
COPY package.json ./
RUN npm install
COPY bridge.mjs fake-browser.sh run-test.sh ./
RUN chmod +x fake-browser.sh run-test.sh

# The plugin's auth flow calls ctx.openUrl, which on Linux shells out to xdg-open.
# We replace xdg-open with a script that intercepts the URL and POSTs the
# callback directly, completing the auth handshake without a real browser.
RUN install -m 755 fake-browser.sh /usr/local/bin/xdg-open

ENV BRIDGE_PORT=19280
# OpenClaw's browser-open module skips xdg-open on Linux when no display is
# set. We have no real display, but we need the shim to run — fake DISPLAY.
ENV DISPLAY=:0

CMD ["./run-test.sh"]
