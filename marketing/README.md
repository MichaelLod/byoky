# Marketing material generator

Generates store screenshots, multi-screen composites, walkthrough videos, and a
narrated voiceover by reusing the e2e Playwright fixtures and the iOS/Android
simulators that the e2e suite already drives.

Everything under `marketing/` *except* `scripts/`, `assets/`, and `fonts/` is
gitignored. Outputs are deterministic from a single command.

## What gets generated

| Surface             | Sizes                                       | Where                              |
| ------------------- | ------------------------------------------- | ---------------------------------- |
| Chrome popup        | 1280×800 (5 frames)                         | `raw/chrome/`                      |
| Firefox popup       | 1280×800 (5 frames)                         | `raw/firefox/`                     |
| Safari popup (iOS)  | 1320×2868 (uses iOS sim)                    | `raw/safari/`                      |
| iOS app             | 1320×2868 portrait                          | `raw/ios/`                         |
| Android app         | 1080×1920 portrait                          | `raw/android/`                     |
| Web /demo           | 1920×1080 + 1280×800                        | `raw/web/`                         |
| Product Hunt cover  | 1270×760, 1200×630 header, 240×240 thumb    | `composites/product-hunt-*.png`    |
| Chrome promo tiles  | 440×280 small, 1400×560 marquee             | `composites/chrome-tile-*.png`     |
| Walkthrough video   | 1920×1080 H.264 + Gemini TTS narration      | `videos/walkthrough.mp4`           |

## Run

```bash
# Everything that doesn't need a simulator (Chrome + web + composites + video):
pnpm marketing:desktop

# iOS (needs the BYOKY_IOS_SIM simulator booted, defaults to "iPhone 17 Pro"):
pnpm marketing:ios

# Android (needs an emulator on `adb devices`):
pnpm marketing:android

# Everything:
pnpm marketing:all
```

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
