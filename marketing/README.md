# Marketing material generator

Generates store screenshots, multi-screen composites, walkthrough videos, and a
narrated voiceover by reusing the e2e Playwright patterns and the iOS/Android
simulators.

Everything under `marketing/` *except* `scripts/`, `assets/`, and `fonts/` is
gitignored. Outputs are deterministic from a single command.

## Store images (1.1.1, retro security)

The store set is built from fresh captures with fake data only (placeholder
keys, byoky.com / example.com / localhost:3000 origins, made-up usage) and
composed in the design from `docs/brand/README.md`. Store rules are in
`docs/store-listing.md`: no other brand outside the app's own UI, nothing
from retired features.

```bash
cd marketing
pnpm store:build-extension     # popup build → raw/ext-build (not packages/extension/.output)
pnpm store:capture:extension   # stubbed browser API → raw/store-extension/
pnpm store:capture:web         # byoky.com/demo connect screen; serve packages/web on :3917 first
pnpm store:capture:mac         # Mac app window page in a real WKWebView → raw/store-mac/
pnpm store:capture:ios         # iPhone 18 Pro Max + iPad Pro 13" simulators → raw/store-ios/
pnpm store:capture:android     # one emulator on `adb devices` → raw/store-android/
pnpm compose                   # → composites/1.1.1/<store>/ + composites/1.1.1-contact/
```

The iOS and Android captures build from a scratch copy of the app under
`marketing/.cache/` with a DEBUG-only seed (`store-capture/*/MarketingSeed.*`)
that fills the wallet with fake keys, sessions, groups, limits and request
history. The repo's app sources are never modified. `compose.ts` renders each
image as HTML in Chromium (`store-kit.ts`) at the exact store size and writes
RGB PNGs; `android-store-assets.ts` adds the Play feature graphic and copies
the 512 px icon from `packages/android/` after checking it.

| Store | Files |
| --- | --- |
| Chrome Web Store | 5 × 1280×800, promo tile 440×280, marquee 1400×560 |
| Firefox Add-ons | the same 5 × 1280×800 |
| App Store | 6 × iPhone 1320×2868 (6.9"), 5 × iPad 2064×2752 (13") |
| Mac App Store | 5 × 2880×1800 |
| Google Play | 6 × 1080×1920, feature graphic 1024×500, icon 512×512 |
| Product Hunt | 7 × 1270×760 gallery, thumbnail 240×240 (`--only producthunt`; listing text in `producthunt/listing.md`) |

The pre-1.1.1 composer (old look, Product Hunt and social images that
`make-producthunt*.ts` read) is kept as `compose-legacy.ts`
(`pnpm compose:legacy`).

## Story

Every surface tells the same pitch, in this order (see `scripts/compose.ts`
and `scripts/narrate.ts`):

1. The MetaMask for API keys.
2. One wallet, every provider.
3. Apps connect, keys never leave.
4. You're in control: approve, see every request, token caps, revoke.
5. Drag an app from Claude to GPT (groups + cross-provider routing).
6. On your phone too: in-wallet browser, Safari extension, add any app by URL.
7. No servers, no account, open source.
8. byoky.com

## What gets generated

| Surface             | Sizes                                       | Where                              |
| ------------------- | ------------------------------------------- | ---------------------------------- |
| Extension popup     | 420×720 @2x (18 frames)                     | `raw/popup-frames/`                |
| iOS app             | 1320×2868 portrait                          | `raw/ios/`                         |
| Android app         | emulator native portrait                    | `raw/android/`                     |
| Web pages           | 1920×1080 + 1280×800                        | `raw/web/`                         |
| Chrome / Firefox    | 1280×800 (6 slides)                         | `composites/chrome-store-*`, `composites/firefox-amo-*` |
| App Store / Play    | 1320×2868 / 1080×1920 (6 slides each)       | `composites/ios-app-store-*`, `composites/android-app-store-*` |
| Product Hunt cover  | 1270×760, 1200×630 header, 240×240 thumb    | `composites/product-hunt-*.png`    |
| Chrome promo tiles  | 440×280 small, 1400×560 marquee             | `composites/chrome-promo-*.png`    |
| Walkthrough video   | 1920×1080 H.264 + Gemini TTS narration      | `videos/walkthrough.mp4`           |

Frame names are a contract between the capture scripts and their consumers
(`compose.ts`, `build-landing-demos.ts`). The full list lives in the header of
each capture script: `capture-extension.spec.ts`, `capture-ios.sh` (names come
from `packages/ios/ByokyUITests/ByokyMarketingTests.swift`) and
`capture-android.sh`. Rename both sides together.

The extension capture connects the e2e test page (`e2e/test-page`) as the demo
app and, when `.env.local` has keys, makes one tiny call per provider so the
history, usage and token-cap frames show real numbers.

## Run

```bash
# Everything that doesn't need a simulator (Chrome + web + composites + video):
pnpm marketing:desktop

# iOS (needs the BYOKY_IOS_SIM simulator booted, defaults to "iPhone 17 Pro"):
pnpm marketing:capture:ios

# Android (needs an emulator on `adb devices` with the debug APK installed):
pnpm marketing:capture:android
# Re-snap an already set-up Android wallet without onboarding again:
bash marketing/scripts/capture-android-simple.sh

# Everything:
pnpm marketing:all
```

Extra outputs, run on demand with `tsx` from `marketing/`:
`make-producthunt.ts` (+ `make-producthunt-batman.ts`), `make-batman.ts`,
`build-landing-demos.ts` (writes `packages/web/public/demos/`) and
`android-store-assets.ts` (writes the Play icon + feature graphic into
`packages/android/`).

## Layout

```
marketing/
├── scripts/        # capture, compose, narrate, mux — all checked in
├── assets/         # logos, brand colors, fixtures — checked in
├── fonts/          # bundled fonts for composites — checked in
├── raw/            # captured frames                          [gitignored]
├── composites/     # Sharp-rendered store/PH images           [gitignored]
├── videos/         # ffmpeg outputs                           [gitignored]
└── voiceover/      # Gemini TTS WAV/MP3                       [gitignored]
```
