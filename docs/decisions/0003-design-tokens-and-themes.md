# 0003 — Design tokens, themes and a user-picked accent

- **Status:** accepted
- **Date:** 2026-10-16

## Context

Phase 2 adds a light theme and lets every user pick the accent color (five presets or any color).
The app had a single dark palette in Tailwind, plus a few stock colors (`green-500`, `sky-400`,
`black`) in components. A user-picked accent can break contrast in two ways: text drawn *on* the
accent (button labels) and the accent used *as* text (links), especially on light backgrounds.

## Decision

- **CSS variables are the single source of colors.** `main.css` defines one palette per theme
  under `:root[data-theme=dark|light]`. Tailwind's `@theme inline` maps them to semantic names
  (`bg-rail`, `bg-panel`, `bg-main`, `bg-elevated`, `border-line`, `text-fg`, `text-fg-muted`,
  `text-accent-text`, `text-on-accent`, `bg-success`, ...).
- **The stock Tailwind palette is removed** (`--color-*: initial`), so `bg-red-500` or `text-white`
  generate no CSS. A hardcoded color in a component is visibly broken right away instead of drifting
  from the theme.
- **Accent-derived colors are computed at runtime** (`lib/color.ts`, WCAG 2.x relative luminance):
  - `--on-accent` is whichever of `#1A1406` and `#FFFFFF` contrasts more with the accent.
  - `--accent-text` is the accent mixed toward black (light theme) or white (dark theme) in 2% steps
    until it reaches 4.5:1 against **every** surface of the current theme. The spec only requires this
    for the light theme, but a very dark custom accent is just as unreadable on the dark theme, and
    colors that already pass are left untouched.
  - The same function makes profile colors on names readable (`useReadableColor`).
- **Settings live on the server** (`user_settings`: theme, accent, sounds) so they follow the user
  across PCs, and a `settings.updated` event updates the user's other open sessions. The last value is
  also cached in `localStorage`, so the next start (sign-in screen included) opens in the right theme
  with no flash.
- **Fonts are bundled** with `@fontsource-variable/sora` and `@fontsource-variable/figtree` (OFL-1.1):
  no requests to Google at runtime, and they work offline.

## Consequences

- New UI must use the semantic tokens. Colors over video (name labels, screen share controls) use
  `scrim` / `on-scrim`, which stay dark in both themes.
- Adding a theme means adding one palette block in `main.css`; components don't change.
- The UI accent (`user_settings.accent_color`) is separate from the profile color
  (`users.accent_color`), which other people see on the profile card and on the user's name.
