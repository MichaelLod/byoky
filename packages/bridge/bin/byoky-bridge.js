#!/usr/bin/env node

const command = process.argv[2];

if (command === 'install' || command === 'uninstall' || command === 'status') {
  // CLI mode: manage native messaging registration
  const { install, uninstall, status } = await import('../dist/installer.js');

  console.log('Byoky Bridge\n');

  if (command === 'install') {
    // --extension-id <id> for custom/unpacked extension IDs
    const idIdx = process.argv.indexOf('--extension-id');
    const extensionId = idIdx !== -1 ? process.argv[idIdx + 1] : undefined;
    install(extensionId);
  }
  else if (command === 'uninstall') uninstall();
  else if (command === 'status') status();
} else if (command === 'relay') {
  // Mobile-pairing mode: open a WebSocket to the Byoky relay as a
  // recipient and expose the same HTTP proxy on 127.0.0.1:<port> that
  // OpenClaw already talks to. Used when the user paired via QR with
  // the mobile app instead of the browser extension.
  //
  //   byoky-bridge relay \
  //     --port 19280 \
  //     --relay-url wss://relay.byoky.com \
  //     --room-id <uuid> \
  //     --auth-token <hex> \
  //     --providers anthropic,openai,gemini
  const args = process.argv.slice(3);
  const opt = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    return args[i + 1];
  };
  const port = parseInt(opt('--port') ?? '19280', 10);
  const relayUrl = opt('--relay-url');
  const roomId = opt('--room-id');
  const authToken = opt('--auth-token');
  const providersArg = opt('--providers') ?? '';
  const providers = providersArg.split(',').map((s) => s.trim()).filter(Boolean);

  if (!relayUrl || !roomId || !authToken || providers.length === 0) {
    console.error('Usage: byoky-bridge relay --port <n> --relay-url <wss://...> --room-id <id> --auth-token <token> --providers <a,b,c>');
    process.exit(1);
  }

  const { startRelayMode } = await import('../dist/relay-mode.js');
  startRelayMode({ port, relayUrl, roomId, authToken, providers });
} else if (!command || command === 'host') {
  // Native messaging host mode (called by browser)
  await import('../dist/host.js');
} else {
  console.log(`Usage: byoky-bridge <command>

Commands:
  install     Register native messaging host with browsers
  uninstall   Remove native messaging registration
  status      Check registration status
  relay       Run the HTTP proxy against the mobile wallet via the relay

The bridge runs automatically when called by the Byoky extension.`);
}
