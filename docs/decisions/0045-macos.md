# 0045 — macOS build

- **Status:** accepted
- **Date:** 2026-11-09

## Context

Block 3.21. The beta has a tester who only has a Mac. Eduardo decided (09/11) not to pay for an
Apple Developer account for now: no Developer ID certificate, no notarization. The project must
stay at R$0, and macOS apps can only be built on macOS, while development happens on Windows.

## Decision

- **Signing.** Ad-hoc signature only (`mac.identity: "-"` in electron-builder), without the
  hardened runtime. Apple Silicon refuses to run unsigned arm64 code at all; ad-hoc is enough for
  it to start. Gatekeeper still blocks the first launch (the app isn't notarized): people open it
  through System Settings › Privacy & Security › "Open Anyway", or, when macOS says the app "is
  damaged" (quarantine flag on a download), run `xattr -cr /Applications/Aureum\ Voice.app`. Both
  steps are written on the landing page, the invite page and the README. Paying for the Apple
  account (signing, notarization, automatic updates) is Eduardo's decision, left for the public
  launch; certificates would then live only in GitHub secrets.
- **Where it's built.** A `release-mac.yml` workflow on GitHub's macOS runner (free because the
  repository is public), started by `npm run release` through the GitHub API (workflow_dispatch)
  after the Windows build has created the draft. It checks out the exact commit the Windows build
  came from (the script requires HEAD to be pushed to origin/main and the tree clean) and uploads
  into the same draft with the workflow's own `GITHUB_TOKEN`. No secret is added to the repository.
- **What ships.** dmg + zip, arm64 and x64 as separate files (each half the size of a universal
  build), plus `latest-mac.yml`.
- **Updates.** An ad-hoc signed app can't update itself (Squirrel.Mac checks the signature against
  a real identity). On macOS electron-updater only checks (`autoDownload` off, reading
  `latest-mac.yml`); a newer version shows "Baixar a versão X", which opens the download page.
- **Windows-only features are off on macOS:** in-game overlay, game detection and push-to-talk
  (Eduardo, 09/11: removed from the options on the Mac, not even with the window focused, so the
  app never asks for the Accessibility permission). The UI hides them instead of showing errors.
- **Platform conventions.** Cmd instead of Ctrl in shortcuts and their hints; the standard macOS
  app menu (with Edit, so Cmd+C/V work); a template icon in the menu bar instead of the tray; the
  window's traffic lights instead of the drawn title bar buttons; closing the window hides it and
  clicking the Dock icon brings it back.
- **Permissions.** Microphone and camera are asked through `systemPreferences.askForMediaAccess`
  with pt-BR usage texts in Info.plist; screen recording can't be asked for, so when it's missing
  the app explains and opens the right pane of System Settings.

## Consequences

- Every release needs the commit pushed before `npm run release`, and the GH_TOKEN needs the
  "Actions: read and write" permission to start the workflow.
- Mac users update by hand, guided by the in-app notice.
- If the repository ever becomes private, macOS runner minutes would be billed: stop and ask.
