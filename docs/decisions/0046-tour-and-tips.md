# 0046 — Tour and first-time tips

- **Status:** accepted
- **Date:** 2026-11-09

## Context

Block 3.16: people coming from Discord should understand the Aureum's own layout (tabs on top,
Home hub, panels, the single member bar, the detached call window) without getting lost. The spec
asks for a skippable tour with a spotlight, progress saved on the server, versioned tours, and a
one-time tip the first time each feature is used. It suggested a library such as driver.js, but
asked before adding a dependency; the block ran unattended, so no package was added.

## Decision

- **Own engine, no dependency.** `components/Tour.tsx`: a full-window layer (z-70, `app-no-drag`
  so the top bar's drag region doesn't swallow clicks) with a spotlight box whose huge
  `box-shadow` in `--scrim` darkens the rest, and the guide's balloon (the official logo, title,
  text, `n/N`, Pular, Voltar, Próximo). Esc skips, arrows move, listened in the capture phase ahead
  of the call's and the modals' own Esc. Motion only under `motion-safe:` (prefers-reduced-motion).
  `balloonPosition` (pure, tested) puts the balloon below, above, right or left of the element and
  keeps it inside the window.
- **Fixed anchors.** Elements are found by `data-tour="..."`, never by class. `useAnchor` follows
  the element's box every frame while active. A step whose element doesn't show up within 1.2 s is
  skipped (or shown centered, for steps marked `centerIfMissing`, like Addons on a server without
  any). `anchors.test.ts` reads the app's sources and fails if an anchor used by a tour step or a
  tip is gone.
- **Saved on the server.** `user_settings.onboarding` (JSONB, merged key by key like the other
  merged settings): `tour_version_done` (0 = never), `tour_invite` and `tips_seen` (the whole list;
  `[]` is "Mostrar dicas de novo"). The migration sets `{"tour_invite": true}` on every account that
  exists before it (creating the settings row when missing): those get a single "Quer fazer um tour
  rápido pelo Aureum?" (Sim / Agora não; closing counts as no). Accounts created afterwards start
  the tour by themselves after the first sign-in. Nothing starts until the server's settings
  arrive with the `onboarding` key, so a stale cache or an older API never triggers it.
- **Versioned tours.** `TOUR_VERSION` in `lib/onboarding.ts`; each step has `since`. Someone who
  finished version N sees only steps with `since > N`, marked "Novidade". Finishing, skipping or
  declining all save the current version.
- **Steps.** Welcome, tabs, Home (hub and the calendar of all servers), and on a server (the
  official one if the person is in it, else the first tab; left out without any server): sidebar,
  overview, panels, the member bar, addons; then profile (GIF avatar and banner, Conta), the bell
  with each version's news, and the end (mentions Destacar). Shortcuts go through `shortcut()`, so
  they read Cmd on the Mac. The tour starts 0.9 s after the shell and the servers load, after the
  loading screen fades. At the end the app goes back to where the person was.
- **Tips.** `lib/tips.ts` holds every tip (anchor, title, text); the key is what's saved, so keys
  are never renamed. `<Tip id>` is mounted where the thing happens (the call bar, Assistir, the
  share modal, an addon's panel, the composer's +, reaction chips, the DM header, a person's
  right-click menu, the push-to-talk key). Only one tip shows at a time (the store holds which
  mounted copy owns the slot), never during the tour or the invite, and "Entendi" saves it. The
  overlay tip only shows on Windows with the overlay on; tips inside the detached call window (its
  own document) don't show, the main window covers the same controls.
- **Where to get it back.** Profile menu › "Rever tour", and Configurações › Dicas with "Rever tour"
  and "Mostrar dicas de novo".

## Consequences

- No new dependency or license to track; the engine is ~250 lines and covered by Vitest.
- Adding a step: bump `TOUR_VERSION`, give the step that `since`, add its `data-tour` anchor.
- Adding a tip: an entry in `lib/tips.ts`, its anchor and a `<Tip id>` where it belongs.
- "Primeiro servidor criado" became "owner of the open server" (same moment in practice, without
  tracking creation), and "primeira enquete" points at the composer's + the first time a chat
  offers polls.
