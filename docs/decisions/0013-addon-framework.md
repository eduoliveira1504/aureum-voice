# 0013 — Addon framework

- **Status:** accepted
- **Date:** 2026-10-18

## Context

Block 2.8 adds addons, starting with a Kanban board and "watch together" (YouTube), with more later
(a BlueMap Minecraft map, RPG sheets...). They need a common base before any of them is built:

- where an addon lives in a server;
- how its code stays apart from the core, so one can be added, changed or removed without touching
  the rest. The board is meant to become a product of its own one day;
- who may add and configure one;
- how its tables are migrated.

## Decision

**An addon runs in a channel**
- A new channel type, `addon`, with two new columns: `addon_key`, which says which addon runs the
  channel, and `config` (jsonb), which holds its settings. A CHECK constraint keeps
  `addon_key` set exactly on addon channels.
- Everything channels already have comes for free: a position in the sidebar, overrides that make one
  private, `channel.*` events, the panel tabs (`channel:<id>`), and several of the same addon per
  server (two boards, for example). The placeholder tabs from block 2.L (`addon:<key>`) are dropped
  from saved layouts. The API still accepts them, so settings saved by older versions remain valid.

**Permissions**
- Adding an addon creates a channel, so it needs both **MANAGE_CHANNELS** and **MANAGE_ADDONS**.
- Changing its settings needs **MANAGE_ADDONS** in that channel, and not MANAGE_CHANNELS. Renaming
  and moving still need MANAGE_CHANNELS.
- Deleting an addon channel also deletes what was made in it, so it needs both permissions.
- Inside the channel, each addon declares named actions and the channel permission each one needs.
  "view" is always VIEW_CHANNEL. The notes addon maps "edit" to SEND_MESSAGES and "manage" to
  MANAGE_ADDONS. Clients get this map from `GET /api/addons`, but the API checks it on every route.

**API: one package per addon**
- `apps/api/app/addons/<key>/` holds:
  - a router, mounted at `/api/addons/<key>`;
  - models, in tables prefixed `addon_<key>_`;
  - its own migrations;
  - a manifest (`AddonManifest`) with the key, name, icon, router, settings model (Pydantic) and
    permissions. `app/addons/registry.py` lists the manifests.
- An addon never loads channels or checks permissions itself. Its routes call
  `addon_channel(session, manifest, channel_id, user_id, action)`. It returns 404 when the channel
  isn't visible to the user or isn't this addon's, and 403 when the action isn't allowed. On success
  it hands back the channel's id as a generic `workspace_id`.
- Addon tables reference the `workspace_id` with **no foreign key** to `channels`, so the board can
  later run outside servers. Their data is removed instead through a cleanup hook in the manifest. The
  registry calls it before a channel or a whole server is deleted, in the same transaction.
- Settings are validated against the addon's model when a channel is created or changed, and stored
  with their defaults filled in. They are validated again when read, so a field added later gets its
  default on old channels.
- Events are published as `addon.<key>.<event>` to everyone who can see the channel.

**Migrations: one Alembic branch per addon**
- Each addon's migrations live in `app/addons/<key>/migrations`, listed in `version_locations` in
  `alembic.ini`. Each branch starts with `down_revision = None`, `branch_labels = ('<key>',)` and
  `depends_on` set to the core revision that created addon channels.
- That core revision is labeled `core`. With several heads:
  - migrations are applied with `alembic upgrade heads`, in the Dockerfile and in the tests;
  - new revisions are created with `alembic revision --head core@head` or `--head <key>@head`.
- A test checks that every addon's migrations folder is listed in `alembic.ini`.
- The alternative, keeping addon tables in the core chain, would tie an addon's schema history to the
  core's. Removing or extracting an addon would then mean editing core migrations.

**Desktop: one folder per addon**
- `apps/desktop/src/renderer/src/addons/<key>/` exports an `AddonModule`. It contains:
  - a `Panel` (the channel's content);
  - optionally a `Summary` (its card on the server overview) and a `Settings` form (a channel
    settings tab, for people who can manage addons);
  - optionally `onEvent`, which receives its `addon.<key>.*` events, plus `ready` after every
    reconnection so it can refetch.
- A module keeps its own state and calls its own routes. The shell gives it the server, the channel,
  the user and the user's permissions in the channel. A module may use the shared UI components.
- The "Adicionar addon" modal offers the addons that both the API (`GET /api/addons`) and the app
  know. A channel whose addon the app doesn't have shows a note to update the app instead of
  breaking.

**Example addon: notes**
- Block 2.8 is built in three parts, and this is the first. It ships one deliberately small addon to
  prove the whole path: one shared text page per channel, with its own table and branch, a
  `read_only` setting, real-time updates, and a cleanup hook.
- Saves carry the version they were based on. A save based on an old version gets a 409 instead of
  overwriting someone else's text, and the app offers "Ver a versão nova" or "Manter a minha".

## Consequences

- Kanban and watch-together become two more packages and two more folders, with no changes to the
  core expected.
- Addon data isn't covered by foreign keys, so every addon must implement the cleanup hook. The
  delete tests check it for the notes addon.
- Contributors need to know about `upgrade heads` and `--head`. `alembic.ini` and this record
  explain it.
