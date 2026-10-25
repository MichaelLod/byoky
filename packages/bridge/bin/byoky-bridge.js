#!/usr/bin/env node

const command = process.argv[2];

if (command === 'install' || command === 'uninstall' || command === 'status') {
  // CLI mode: manage native messaging registration
  const { install, uninstall, status } = await import('../dist/installer.js');

  console.log('Byoky Bridge\n');

  if (command === 'install') {
    // --extension-id <id> allows a custom extension instead of the Web Store
    // build; --dev also allows the unpacked build pinned in wxt.config.ts.
    const idIdx = process.argv.indexOf('--extension-id');
    const extensionId = idIdx !== -1 ? process.argv[idIdx + 1] : undefined;
    install({ extensionId, dev: process.argv.includes('--dev') });
  }
  else if (command === 'uninstall') uninstall();
  else if (command === 'status') status();
} else if (command === 'token') {
  // Print the bridge token (created on first use). Clients send it as their
  // API key, e.g. export ANTHROPIC_API_KEY=$(byoky-bridge token)
  const { loadOrCreateToken } = await import('../dist/token.js');
  console.log(loadOrCreateToken());
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
  const port = Number(opt('--port') ?? '19280');
  const providersArg = opt('--providers') ?? 'anthropic';
  const providers = providersArg.split(',').map((s) => s.trim()).filter(Boolean);

  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error('Invalid --port. Must be between 1024 and 65535.');
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
      console.log('  export ANTHROPIC_API_KEY=$(byoky-bridge token)');
      console.log('  claude');
      console.log('\nNote: use ANTHROPIC_API_KEY (not AUTH_TOKEN) — Claude Code\'s first-run');
      console.log('wizard checks API_KEY to skip the OAuth login prompt. The bridge checks');
      console.log('the token, strips it and the extension injects the real credential.');
    } else {
      console.log('\nClients send the bridge token as their API key: `byoky-bridge token` prints it.');
    }
    process.exit(0);
  } catch (e) {
    console.error(`\n✗ ${(e && e.message) ? e.message : String(e)}`);
    process.exit(1);
  }
} else if (command === 'hermes-setup') {
  // Patch ~/.hermes/config.yaml so Hermes Agent routes through the byoky bridge.
  // Hermes's built-in `anthropic` provider goes direct to api.anthropic.com and
  // ignores ANTHROPIC_BASE_URL — routing has to live in `custom_providers`.
  //
  //   byoky-bridge hermes-setup [--port 19280] [--model claude-sonnet-4-6] [--config <path>]
  const args = process.argv.slice(3);
  const opt = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    return args[i + 1];
  };
  const port = Number(opt('--port') ?? '19280');
  const model = opt('--model');
  const configPath = opt('--config');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error('Invalid --port. Must be between 1024 and 65535.');
    process.exit(1);
  }
  const { runHermesSetup } = await import('../dist/hermes-setup.js');
  console.log('Byoky Bridge — Hermes setup\n');
  try {
    const result = runHermesSetup({ port, model, configPath });
    if (result.alreadyConfigured) {
      console.log(`✓ ${result.configPath} already routes through the bridge. Nothing to do.`);
    } else {
      console.log(`Patched ${result.configPath}:`);
      for (const c of result.changes) console.log(`  • ${c}`);
      if (result.backupPath) console.log(`\nBackup written to ${result.backupPath}`);
      console.log('\nSmoke-test:');
      console.log('  hermes chat -q "ping" -Q');
    }
    process.exit(0);
  } catch (e) {
    console.error(`✗ ${(e && e.message) ? e.message : String(e)}`);
    process.exit(1);
  }
} else if (!command || command === 'host') {
  // Native messaging host mode (called by browser)
  await import('../dist/host.js');
} else {
  console.log(`Usage: byoky-bridge <command>

Commands:
  install        Register native messaging host with browsers (--dev: also allow the unpacked build)
  uninstall      Remove native messaging registration
  status         Check registration status
  connect        Open browser, approve a session, start the HTTP proxy on :19280
  token          Print the bridge token clients send as their API key
  hermes-setup   Patch ~/.hermes/config.yaml so Hermes Agent routes through the bridge

The bridge runs automatically when called by the Byoky extension.
Use \`connect\` for CLI tools like Claude Code that need the proxy running on demand.`);
}
