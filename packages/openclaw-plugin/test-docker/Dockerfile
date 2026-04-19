FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/*

# Install OpenClaw, then install the local byoky plugin tarballs produced by
# `run.sh` (they are copied into /pkgs below). This exercises the in-progress
# code rather than whatever is on npm.
RUN npm install -g openclaw

# Stage the local plugin + bridge tarballs. The plugin tarball declares
# @byoky/bridge as a dep, so OpenClaw's plugin installer will pull the
# matching version from npm unless we override — but here we install the
# plugin directly with npm install -g using both local tarballs, then register
# it manually with OpenClaw.
COPY _local_pkgs/ /pkgs/
RUN npm install -g /pkgs/byoky-bridge-*.tgz /pkgs/byoky-openclaw-plugin-*.tgz
# Tell OpenClaw to pick up the globally installed plugin.
RUN PLUGIN_PATH="$(npm root -g)/@byoky/openclaw-plugin" \
  && openclaw plugins install "$PLUGIN_PATH" \
  && openclaw plugins trust byoky 2>&1 || true

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

# Pre-register a stub native-messaging manifest so the plugin's preflight
# returns "already registered" and skips the confirm prompt. The image has no
# real browsers; the fake bridge (bridge.mjs) handles proxying. The path must
# match homedir() + linux chrome path used by the plugin's preflight check.
RUN mkdir -p /root/.config/google-chrome/NativeMessagingHosts \
  && printf '{"name":"com.byoky.bridge","path":"/bin/true","type":"stdio","allowed_origins":[]}' \
     > /root/.config/google-chrome/NativeMessagingHosts/com.byoky.bridge.json

CMD ["./run-test.sh"]
