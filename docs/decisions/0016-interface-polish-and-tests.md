# 0016 — Interface polish: title bar, people menus, per-tab member list, test commands

- **Status:** accepted
- **Date:** 2026-10-19

## Context

Polish block, part 3. The window loses the system title bar. Servers without an uploaded banner need
a default one. The overview shouldn't offer the member panel it already contains. A person's
right-click menu should work everywhere they appear, and conversations in the DM list get their own
items (groups can change their picture). Each of these needs a test.

Two practical gaps showed up along the way:

- The API tests could only run with the stack in dev mode.
- The desktop app had no test runner at all.

## Decision

**Title bar**
- `titleBarStyle: 'hidden'` with `titleBarOverlay` at the top bar's height (48 px). Windows draws its
  buttons over the bar's right end. The renderer sends `--bg-rail` and `--text` (re-tinted by the
  user's accent) to the main process whenever the theme or the accent changes, so the buttons match.
- The bar is `-webkit-app-region: drag`, and clickable things inside it opt out with a CSS rule.
  Electron keeps drag regions active under layers drawn on top, so modals and the image viewer are
  marked `no-drag` too. `env(titlebar-area-*)` reserves room for the buttons. The sign-in and loading
  screens get a thin drag strip.

**Default banner**
- A mosaic of triangles in `--accent` at a few fixed opacities over `--bg-elevated`. Each triangle
  has a single flat tint, so there's no gradient. The layout comes from a small PRNG seeded with the
  server id, so each server keeps its own pattern. It's SVG with no stored image, and it follows the
  accent live. An uploaded banner replaces it.

**Member list per tab**
- `PanelLayout` gets `members`, the tabs that show the member list. It's stored with the rest of the
  server's layout in `panel_layouts`, so no migration is needed and it syncs like the panels. The
  list follows the focused panel's active tab. The overview never shows it, nor the button. Tabs that
  close are dropped from `members`. The old global `members_open` setting is no longer read.

**One person menu**
- `UserContextMenu` (in `components/UserMenu.tsx`) plus a `userContextMenu(user, meId, serverId?)`
  handler are used everywhere a person appears. Its `before` slot lets a place add its own items:
  `ConversationMenu` puts read, silence and close (and the group's rename, picture and leave) on top
  of the person's menu in a 1:1. A group, with no single person, gets only the conversation items.
- @mentions in messages use the API's own pattern (`app/reads.py`) and resolve only to people in
  that server or conversation. They open the profile on click and the menu on right click.
- Own messages show the user's avatar on the mirrored side.
- Silencing a DM reuses `muted_places`, the same setting as channels. The DM keeps its sound off (as
  before), and now also its count in the list and on the Home tab.

**Group pictures**
- `channels.icon_url`, set by any member (like the name) through `POST/DELETE /api/dms/{id}/icon`.
  It uses the same image rules as server icons and is public under `/api/media/groups/...`. The file
  is deleted when it's replaced or when the group's last member leaves.

**Test commands**
- `node scripts/test-api.mjs` runs pytest in a throwaway `api-test` container
  (`infra/docker-compose.test.yml`, profile `test`) on the stack's network, against the same services
  with test-only names. The code is bind-mounted, so there's no rebuild per change. It doesn't
  publish ports or recreate anything, so it's safe while friends use the plan B server. It's written
  in Node so it works the same from PowerShell and Git Bash.
- The desktop app uses Vitest with Testing Library in jsdom (`npm test`). A fake `window.aureum`
  bridge stands in for the preload, and the noise filter (WebAssembly and audio worklets) is mocked.
  The first suite mounts the real components with sample stores. It right-clicks each place and checks
  the menu's items, including what changes with permissions.

## Consequences

- Places that need a live call (call tiles, the call card, the floating call window) aren't covered
  by the component tests. They use the same `userContextMenu` handler as the tested places.
- The system title bar's double-click to maximize still works on the drag area. Its right-click
  system menu doesn't, which is the usual trade-off of custom title bars.
