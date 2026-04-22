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
} else if (command === 'connect') {
  // Interactive mode: open a loopback page that connects the wallet and
  // tells the extension to start the HTTP proxy on 127.0.0.1:<port>.
  //
  //   byoky-bridge connect [--port 19280] [--providers anthropic]
  //
  // Once the user approves the session, the bridge listens on :<port>
  // and stays up as long as the browser's extension service worker is
  // alive. Re-run the command to restart after a browser restart.
  const args = process.argv.slice(3);
  const opt = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    return args[i + 1];
  };
  const port = parseInt(opt('--port') ?? '19280', 10);
  const providersArg = opt('--providers') ?? 'anthropic';
  const providers = providersArg.split(',').map((s) => s.trim()).filter(Boolean);

  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    console.error('Invalid --port. Must be between 1 and 65535.');
    process.exit(1);
  }
  if (providers.length === 0) {
    console.error('--providers must list at least one provider (e.g. `anthropic`).');
    process.exit(1);
  }

  const { runConnect } = await import('../dist/connect-mode.js');
  try {
    const result = await runConnect({ port, providers });
    console.log(`\n✓ Bridge listening on http://127.0.0.1:${result.port}`);
    console.log(`  Providers: ${result.providers.join(', ')}`);
    if (providers.includes('anthropic')) {
      console.log('\nRun Claude Code:');
      console.log('  export ANTHROPIC_BASE_URL=http://127.0.0.1:' + result.port + '/anthropic');
      console.log('  export ANTHROPIC_API_KEY=byoky');
      console.log('  claude');
      console.log('\nNote: use ANTHROPIC_API_KEY (not AUTH_TOKEN) — Claude Code\'s first-run');
      console.log('wizard checks API_KEY to skip the OAuth login prompt. The bridge strips');
      console.log('the header and injects the real credential from your wallet.');
    }
    process.exit(0);
  } catch (e) {
    console.error(`\n✗ ${(e && e.message) ? e.message : String(e)}`);
    process.exit(1);
  }
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
  connect     Open browser, approve a session, start the HTTP proxy on :19280
  relay       Run the HTTP proxy against the mobile wallet via the relay

The bridge runs automatically when called by the Byoky extension.
Use \`connect\` for CLI tools like Claude Code that need the proxy running on demand.`);
}
