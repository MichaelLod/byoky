# Byoky design: retro security

Approved for 1.1.1. Byoky looks like a piece of security hardware with a
terminal for a face: black ground, one violet signal colour, square edges,
monospace labels, and a raven that keeps watch. Every surface uses it: the
browser extension, the iOS and Android apps, byoky.com and the store images.

The interface is dark only. There is no light theme.

## Colours

| Token | Hex | Use |
| --- | --- | --- |
| void | `#07060A` | Page and screen background |
| crypt | `#100D16` | Cards, sheets, list rows |
| ash | `#17121F` | Raised and hover surfaces |
| ink | `#0B0910` | Terminal/log blocks, the raven's body |
| seam | `#2A2236` | Borders, dividers |
| seam-strong | `#3B2D55` | Input borders, ghost-button borders, icon tiles |
| bone | `#ECE8F4` | Primary text |
| fog | `#A79FB8` | Secondary text |
| dim | `#857C95` | Muted text, mono labels (4.5:1 on void) |
| violet | `#7C3AED` | Primary buttons, focus, active nav, the perch |
| violet-hover | `#8B5CF6` | Primary button hover/pressed |
| phosphor | `#A78BFA` | Accent text, links, `>` prompts, cursor |
| lilac | `#C4B5FD` | Highlights on violet-soft, the raven's eye |
| violet-soft | `rgba(124, 58, 237, 0.18)` | Badges, selected rows |
| focus-ring | `rgba(124, 58, 237, 0.25)` | 3px ring around focused inputs |
| signal | `#4ADE80` | Success, unlocked, 2xx |
| amber | `#FBBF24` | Warnings |
| alarm | `#F87171` | Errors, destructive actions, 4xx/5xx |

White (`#FFFFFF`) is only for text on violet buttons. Don't add more hues,
and never use the old orange (`#FF4F00`).

## Type

- **Chakra Petch** 600/700: headings, buttons, the wordmark. Headings and
  buttons are uppercase with 0.02–0.1em letter-spacing (more on small text).
- **IBM Plex Sans** 400/500/600: body text and form labels written as
  sentences.
- **IBM Plex Mono** 400/500: anything machine-like. That covers section
  labels (uppercase, 11–13px, 0.12–0.16em letter-spacing), status lines,
  masked keys, origins and URLs, timestamps, token counts and logs.

All three are SIL Open Font License fonts. Bundle them with the app (the
extension can't load remote fonts; use the `@fontsource` packages). On iOS
and Android the system font may stand in for IBM Plex Sans in body text;
Chakra Petch and IBM Plex Mono should be bundled.

## Shape and texture

- **Square corners** on cards, buttons, inputs, sheets and badges. Only the
  logo tile (6–7px) and the app icon are rounded.
- **1px borders** in seam. Elevation comes from surface colour (void →
  crypt → ash), not from shadows.
- **Dot grid** on large backgrounds: 1px dots of `rgba(167, 139, 250, 0.08)`
  every 22–32px.
- **Scanlines** over hero areas and lock screens:
  `repeating-linear-gradient(0deg, rgba(0,0,0,0.2) 0 1px, transparent 1px 3px)`,
  never intercepting touches or clicks.
- **Corner brackets** (2px violet L-shapes, 18px long) frame one featured
  panel per screen at most.

## Voice in the interface

- Mono status lines with a prompt and a blinking cursor:
  `> WALLET LOCKED_`, `> INCOMING CONNECTION_`. The cursor stops blinking
  under reduced motion.
- Status pills: a 6–7px square dot plus mono text,
  `● UNLOCKED · AUTO-LOCK 14:59`.
- Bracketed text actions: `[ LOCK ]`.
- Results as tags: `[ KEY READY ]` in signal, `[ NO KEY · REQUIRED ]` in alarm.
- Copy stays plain and short. The retro feel comes from layout and type,
  not jargon.

## Components

- **Primary button**: violet fill, white Chakra Petch 600 uppercase,
  0.1em spacing, 44–52px tall.
- **Ghost button**: transparent, 1px seam-strong border, bone text.
- **Danger button**: transparent, 1px alarm border, alarm text.
- **Input**: void background, 1px seam-strong border; on focus a violet border
  and the focus ring. Secrets and keys are in IBM Plex Mono.
- **Card / row**: crypt background, 1px seam border. The provider icon sits in
  a square seam-strong tile.
- **Log block**: ink background, IBM Plex Mono 11.5–14px, timestamps dim,
  2xx in signal, errors in alarm.
- **Header**: the logo tile (ink square, 1.5px violet inner stroke, phosphor
  "b" in Chakra Petch 700) plus the wordmark `BYOKY` in Chakra Petch 700
  uppercase with 0.08em spacing.

The store icon and app icon aren't part of this change yet.

## The raven

The canonical drawing is [`raven.svg`](raven.svg) (viewBox 240×240, facing
right, perched on a violet key). Its parts have ids so each platform can
animate the same drawing; reproduce it as SVG, a SwiftUI `Shape`/`Canvas`, or a
Compose `ImageVector`/`Canvas`. Its name is **Muninn**, Odin's raven of memory.

It behaves like a pet, not a logo:

| State | When | What it does |
| --- | --- | --- |
| WATCHING | Unlock and onboarding screens, the website hero | The head (`#head`, pivot 140,96) tilts toward the pointer or finger, up to ±16° (≈0.05–0.07° per px of vertical distance). The whole bird (`#raven`) mirrors to face left once the pointer is more than ~20px left of the head. The pupil moves up to 2.6px (x) / 2.4px (y). It blinks every ~4s (eye `ry` 7 → 0.8 for 140ms, pupil hidden). |
| ASLEEP | The wallet is locked (mobile lock screen, side panel when locked) | Head tucked: `translate(-6 26) rotate(34 140 96)`. `#eye`/`#pupil` hidden, `#eye-closed` shown, small phosphor "z z" beside it. |
| ALERT | A connection request is waiting | `#crest` shown, `#eye-glow` shown, head tilted back (−8°), pupil looking at the request (forward). |
| NOD | Unlock succeeded, a request was approved | One quick tilt down by 18° and back (~260ms total). |

Under reduced motion (`prefers-reduced-motion`, iOS Reduce Motion, Android
"Remove animations"), it doesn't track or blink. It holds a neutral watching
pose, and state changes swap poses without animation.

Where it appears: the unlock screen (large, ~200–250px), the connection
request screen (ALERT, ~100px), the wallet header or status strip (head only,
~28–40px, awake), and the mobile lock screen (ASLEEP).

## Rules

- "Byoky" with a capital B in sentences. `BYOKY` only in uppercase display
  type.
- Store screenshots, store text and the extension manifest never name
  another brand. The MetaMask comparison is for byoky.com, GitHub and
  Product Hunt only.
- Text meets 4.5:1 contrast (3:1 at 24px and up). The tokens above are
  chosen for that on void and crypt.
