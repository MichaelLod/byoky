# Install

## Chrome Install from Source

When the Chrome Web Store version is behind (pending review), you can install the latest version directly from source.

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

Once the Chrome Web Store version catches up, you can switch back to the store version for automatic updates.

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
