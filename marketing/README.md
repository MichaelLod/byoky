# Marketing material generator

Generates store screenshots, multi-screen composites, walkthrough videos, and a
narrated voiceover by reusing the e2e Playwright patterns and the iOS/Android
simulators.

Everything under `marketing/` *except* `scripts/`, `assets/`, and `fonts/` is
gitignored. Outputs are deterministic from a single command.

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
