# Install

## Chrome Install from Source

When the Chrome Web Store version is behind (pending review), you can install the latest version directly from source.

### Before you switch

- **It's a separate, empty wallet.** The release ZIP and a source build load under their own extension ID (`idlmdfkobnkdakcpiihighchdbbmbpep`), not the Web Store one, and Chrome keeps each extension's data apart. In the store wallet, open Settings → **Export backup** to save an encrypted `.byoky` file, then use **Import backup** in the new wallet.
- **Claude Code, OpenClaw and Hermes need `--dev`.** By default the bridge only lets the Web Store build launch it. Run `byoky-bridge install --dev` and restart Chrome before `byoky-bridge connect` or `openclaw models auth login`. (When the bridge isn't registered yet, the OpenClaw login registers it for the store build only.)
- **No auto-updates.** Chrome won't update an unpacked extension, security releases included. Update it yourself (see [Updating](#updating)).

### Option 1: Download the release ZIP

1. Go to the [latest GitHub release](https://github.com/MichaelLod/byoky/releases/latest)
2. Download `byoky-chrome-v*.zip`
3. Unzip the file
4. Open Chrome and go to `chrome://extensions/`
5. Enable **Developer mode** (toggle in the top right)
6. Click **Load unpacked**
7. Select the unzipped folder

### Option 2: Build from source

```bash
git clone https://github.com/MichaelLod/byoky.git
cd byoky
pnpm install
pnpm build
```

Then load the extension:

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select `packages/extension/.output/chrome-mv3`

### Updating

When using a source install, Chrome won't auto-update. To update:

- **Option 1**: Download the latest release ZIP and replace the files
- **Option 2**: `git pull && pnpm build`, then click the reload button on `chrome://extensions/`

Once the Chrome Web Store version catches up, you can switch back to the store version for automatic updates. Export a backup from this wallet first and import it into the store wallet, then run `byoky-bridge install` again without `--dev`.

## Firefox

Install from [Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/byoky/).

## iOS

Install from the [App Store](https://apps.apple.com/app/byoky/id6760779919). Includes the Safari extension.

## Android

Install from [Google Play](https://play.google.com/store/apps/details?id=com.byoky.app).

## npm

```bash
npm install @byoky/sdk
```

See the [SDK documentation](https://byoky.com/docs) for integration guides.
