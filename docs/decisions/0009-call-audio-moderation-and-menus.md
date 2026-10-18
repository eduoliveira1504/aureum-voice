# 0009 — Per-person call audio, voice moderation and right-click menus

- **Status:** accepted
- **Date:** 2026-10-18

## Context

Block 2.R came out of playtests. It asks for:

- each person's volume from 0 to 200%, and a local mute, saved per user;
- server mute, deafen and move, from right-click menus that respect the 2.4 permissions;
- nicknames;
- silencing channels and servers;
- resizable columns, with sizes saved per user.

The project must stay free (LiveKit Cloud free plan now, self-hosted LiveKit later), and permissions must
be enforced on the server, not only in the client.

## Decision

### Call audio

- Remote audio plays through the room's Web Audio graph (`webAudioMix`), which gives each track its own
  gain. An `<audio>` element's volume stops at 1, so this is what allows 200%.
- One function, `applyVolumes()`, sets every track's gain from:
  - deafen (ours or the server's): 0;
  - the screen-share volume, for stream audio;
  - otherwise the person's volume, or 0 if we muted them locally.

  Deafen no longer mutes elements; with `webAudioMix` they are silent anyway.
- With `webAudioMix` the output device is set on the room's `AudioContext` (`setSinkId`), so the saved
  device is applied right after connecting.
- Screen-share capture still excludes the app's own audio: `restrictOwnAudio` excludes the app's whole
  process tree (ADR 0002), Web Audio output included.
- Volumes live in `user_settings.user_audio` (user id → `{volume, muted}`). Like panel layouts, the server
  merges it key by key, so two PCs tuning different people don't overwrite each other. A person back at
  100% and unmuted is removed.

### Voice moderation

- Server mute and deafen are stored on the membership (`server_members.voice_muted` / `voice_deafened`)
  and last until lifted, across calls. They are enforced in three places:
  1. **Voice state.** `server_muted` / `server_deafened` are set by the API, and a client can't report
     itself unmuted while muted by the server.
  2. **Tokens.** No `microphone` source, and no `canSubscribe` when deafened.
  3. **Live calls.** LiveKit's server API (Twirp, `UpdateParticipant`, then `MutePublishedTrack` on the
     published mic) applies the change mid-call. The server API is part of every LiveKit plan, and of
     the self-hosted server. `LIVEKIT_API_URL` covers the case where the API container reaches LiveKit
     at another address than clients do.
- A move sets the member's voice state to the new room right away and sends them `voice.moved`. Their
  app joins the new room with a new token. LiveKit doesn't force them out of the old room, so a modified
  client could stay there; in the app, the move is immediate.
- Each action needs its permission in the member's current room (server-wide if they aren't in one),
  plus a rank above theirs. A move also needs both people to be able to join the target room. These are
  the same rules as kick and ban (ADR 0007).

### Nicknames

`server_members.nickname` (up to 32 characters). Members change their own with CHANGE_NICKNAME; someone
ranked below the user is changed with MANAGE_NICKNAMES. Clients show the nickname in that server's
member lists, chat, calls and the sidebar's room lists. Profiles keep the display name.

### Menus, silencing and columns

- Every menu goes through one host (`ContextMenu.tsx`): one menu at a time, kept on screen, with
  submenus, checkboxes and sliders. Dialogs opened from a menu and short confirmations ("Copiado!") go
  through the same host, since the menu is gone by the time they show.
- Items are built from the client's mirror of the permissions (`lib/permissions.ts`), and items without
  permission don't show. The API still checks every action.
- Silenced channels and servers are a plain list, `user_settings.muted_places`. They lose their unread
  badges and leave the overview's news. Mentions still show. Sounds (block 2.6) will follow the same list.
- Column widths are stored in `user_settings.column_sizes` (key → px, merged key by key). Each column
  has a minimum and a maximum, and a double click on its handle restores the default.
- "Copiar convite" copies a new invite's code. Invites have no web link: the code is what people paste
  at sign-up or in "Tenho um convite".

## Consequences

- Volume, mute and deafen cost no bandwidth: they only change local gains.
- If LiveKit's server API is unreachable, the change still applies through the voice state, the client
  and the next token. Only the media server's enforcement waits until then.
- Every permission from ADR 0007 is now in use, except ATTACH_FILES, ADD_REACTIONS, MENTION_EVERYONE and
  MANAGE_ADDONS.
