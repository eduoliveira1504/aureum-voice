# 0025 — Device menus and device changes inside a call

- **Status:** accepted
- **Date:** 2026-10-25
- **Phase 3, block 3.7**

## Context

Changing the mic, the output or the camera meant leaving the call screen for Settings. Settings
reopened the mic (mute, then unmute with the new device). Nothing happened when a headset was
plugged in or out mid-call. The floating window only had mic and leave.

## Decision

**One bar, three places.** The call's control bar stays at the bottom of the call, centered: mic,
headphone, camera, screen and leave. The painel de sons joins it when block 3.15 exists. An arrow
next to the mic, headphone and camera buttons opens a popover (`components/CallDeviceMenus.tsx`):
- mic: the device, its volume, Detecção de voz / Pressionar para falar, and the sensitivity;
- headphone: the output and the call's volume;
- camera: the device and a small preview (the call's own track while the camera is on, otherwise
  the camera opened for the preview and closed with the popover).

Each popover links to Configurações › Voz e vídeo. The popover goes into a portal with a fixed
position, above the arrow or below it when there's more room there. React events stop at the
portal, so a click inside never drags the floating window. The same buttons and arrows show,
smaller, on the call card and in the floating window. In fullscreen the bar fades out after 2 s
without mouse movement, unless a popover or the screen picker is open.

**Switching keeps the pipeline.** `switchDevice(kind, id)` saves the choice as the preference and
moves the call to the device. Output and camera use `room.switchActiveDevice`. The mic is restarted
with the whole capture from `micCapture` (0020: 48 kHz, the browser's own processing off), then the
mic processor is put back on the new track. A switch never passes just a device id. When a mic goes
away, LiveKit restarts it with only `deviceId: 'default'`, and that turns the browser's noise
suppression back on under RNNoise. The camera only moves while it's on; turning it on reads the
preference.

**Volumes.** `inputVolume` and `outputVolume` (0–200 %, per PC, in the media preferences). The
mic volume is a gain node after the voice gate, so it doesn't move the sensitivity threshold. The
call volume multiplies every remote track's gain: per-person volume, screen-share volume and local
mutes still apply.

**Device changes.** `store/devices.ts` keeps one device list, refreshed on `devicechange` while
Settings or a popover shows it, or a call is on. A headset plugged in shows up right away. When
the chosen device goes away mid-call, the call moves to the Windows default and a toast says
"<device> desconectado. Usando o padrão do Windows." When it comes back, the call moves back to it.
The preference itself never changes. If LiveKit restarted the mic bare (the system default went
away), the capture settings are put back.

## Consequences

- No API change, no migration.
- The mic test in Settings uses the mic volume too, so it still sounds like the call.
- Manual tests to do: switch the input, output and camera during a call. Unplug the device in use
  mid-call (toast, sound keeps going) and plug it back.
