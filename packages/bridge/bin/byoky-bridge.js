#!/usr/bin/env node

const command = process.argv[2];

if (command === 'install' || command === 'uninstall' || command === 'status') {
  // CLI mode: manage native messaging registration
  const { install, uninstall, status } = await import('../dist/installer.js');

  console.log('Byoky Bridge\n');

  if (command === 'install') install();
  else if (command === 'uninstall') uninstall();
  else if (command === 'status') status();
} else if (!command || command === 'host') {
  // Native messaging host mode (called by browser)
  await import('../dist/host.js');
} else {
  console.log(`Usage: byoky-bridge <command>

Commands:
  install     Register native messaging host with browsers
  uninstall   Remove native messaging registration
  status      Check registration status

The bridge runs automatically when called by the Byoky extension.`);
}
