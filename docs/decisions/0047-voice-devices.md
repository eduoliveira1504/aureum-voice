# 0047 — Voice rooms with one account on several devices

- **Status:** accepted
- **Date:** 2026-11-12

## Context

Block 4.1.2: with five friends in a call, a room's list in the sidebar showed four. The list is
not LiveKit's view of the room: it's the voice state each app reports over the WebSocket (stored
in Redis per scope, see `app/voice.py`). Two things took someone off the list while they were still
talking (both reproduced in the API tests):

- **The app open on two devices.** An idle app sends "not in a call" every time its WebSocket
  connects (on `ready`, to recover a leave that couldn't be sent while offline). The API took that
  as the account leaving, so the device that *was* in the call vanished from everyone's list.
  The friend who went missing keeps the app open on two computers.
- **A connection that goes silent.** The API drops a WebSocket after 60 s without a message and,
  if it was the user's last one, takes them out of voice at once. The app never checked for the
  pong, so a socket that died under a network change could stay "open" on its side for a long
  time without reconnecting and re-sending its state.

## Decision

- **The device that joined holds the call.** The app connects with `?device=<id>`, a random id made
  once per app run (`DEVICE_ID` in `lib/realtime.ts`), never stored and unrelated to the install id
  of the security notice. `voice.update` with a room stores that device in
  `voice:device:{user}`. "Not in a call" from another device, or from an app without an id while a
  device holds the call, changes nothing. Server-side removals (kick, room deleted, server left)
  ignore devices.
- **Joining from another device moves the call.** The new device takes `voice:device`; the API sends
  `voice.device {device}` to the user, and the old device leaves on its side without announcing
  (LiveKit also kicks it from the same room with `DUPLICATE_IDENTITY`, handled the same way). For
  the others the person just stays in the room (same `joined_at`).
- **The other device says so.** Where the call card goes, an idle app whose account is in a room
  shows "Você está nesta chamada pelo outro dispositivo" with **Entrar por aqui**.
- **A grace for drops.** When the holding device's last connection closes, its user goes into
  `voice:grace` (a Redis sorted set, deadline as score) instead of leaving. A sweeper task
  (`voice.run_sweeper`, every 2 s) removes whoever's grace ended without that device having a
  connection open again (20 s). It lives in Redis, not in in-memory timers, so a restart doesn't
  lose it: at startup everyone in voice gets 60 s to reconnect, which also clears calls left over
  from before the restart.
- **The app notices dead connections.** No message (not even the pong) for 55 s: the socket is
  dropped and opened again, and `ready` re-sends the call state. In a call, the app also re-sends
  its state every minute, so the list heals by itself if the API ever loses it.
- **A reload doesn't undo live changes.** `refreshServer` keeps the voice states it already has if
  events arrived while the request was on its way (same guard as `loadServers`).

## Compatibility

Apps from before this (0.2.0-beta.10 and older) connect without `device`. For them the old rule
stays: out when their last connection closes. Their "not in a call" is ignored only while a newer
device holds the call. The `ready` event gains `device` and `voice_device`; old apps ignore them.

## Notes

- The connection counts per device are kept in the API process (`routers/ws.py`). The API runs as
  a single process (one uvicorn worker); more processes would need these counts in Redis.
- Same behavior as other voice apps (the call follows the device you join from), with the Aureum's
  own wording and layout.
