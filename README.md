# tg-sticker-doom

A shared DOOM instance whose screen and controls live inside a static Telegram
sticker pack.

The current prototype combines a headless DoomGeneric process, a `5×3`
framebuffer grid, five permanent control stickers, and a Telegram Bot API
long-polling worker. Every user controls the same game, and every accepted input
replaces the same 15 screen stickers for everyone.

## Live experiment

- Bot: [@doom_228_bot](https://t.me/doom_228_bot)
- Sticker pack:
  [doom_refresh_probe_2_by_doom_228_bot](https://t.me/addstickers/doom_refresh_probe_2_by_doom_228_bot)

Add the pack, open a chat where the bot can receive sticker messages, and send
one of the five control stickers. Telegram may keep showing a cached version of
the pack even after the Bot API has accepted every replacement. To force a
refresh, open Telegram's sticker settings and move the pack to another position
in the list.

## Confirmed behavior

- A `5×3` screen grid has been tested in Telegram clients.
- The engine starts directly on E1M1 with no title screen or main menu.
- Telegram may display a mixture of old and new tiles while the 15 sequential
  replacements propagate.
- Moving the pack in Telegram's sticker settings forces the client to load the
  current version.
- The production worker can run continuously through systemd without exposing
  a public HTTP port.

## Sticker layout

The first 15 positions contain one framebuffer split into a `5×3` grid. The
last five positions are permanent controls and are never replaced:

```text
00    01     02   03    04
05    06     07   08    09
10    11     12   13    14
LEFT  RIGHT  GO   FIRE  USE
```

The controls use these actions:

| Position | Sticker | Action |
| ---: | :---: | --- |
| 15 | `⬅️` | Turn left |
| 16 | `➡️` | Turn right |
| 17 | `⬆️` | Move forward |
| 18 | `🔥` | Fire |
| 19 | `🚪` | Use/open |

DoomGeneric is launched with `-warp 1 1`, so the first published game frame is
from E1M1. The IWAD is supplied through a local path and is never stored in Git.

## How it works

```text
control sticker sent to Telegram
        ↓
Bot API getUpdates
        ↓
stable file_unique_id → game action
        ↓
headless DoomGeneric advances several ticks
        ↓
framebuffer is rendered into 15 WEBP tiles
        ↓
replaceStickerInSet runs sequentially for slots 0–14
        ↓
all users eventually receive the new shared frame
```

The worker also includes the original sticker-refresh probe. It can create or
reuse a static sticker set, generate `FRAME 001`, `FRAME 002`, and later test
images, replace one or several slots sequentially, persist current Telegram
file IDs in JSON, and record Bot API timing and errors in a JSONL log.

## Requirements

- Node.js 20 or newer
- A C compiler and `make`
- A Telegram bot created through
  [@BotFather](https://t.me/BotFather)
- The positive numeric Telegram user ID of the sticker-set owner
- A local IWAD: shareware `doom1.wad`, Freedoom Phase 1, or a legally obtained
  DOOM IWAD
- A username assigned to the bot

Telegram only allows a bot to modify sticker sets created by that bot. A new
`STICKER_SET_NAME` must end in `_by_<bot_username>`, and an existing set must
belong to `OWNER_USER_ID`.

## Installation

```bash
git submodule update --init --recursive
npm ci
npm run build:native
cp .env.example .env
```

Configure `.env`:

```dotenv
BOT_TOKEN=123456789:token-from-botfather
OWNER_USER_ID=123456789
STICKER_SET_NAME=doom_refresh_probe_by_your_bot
STICKER_SET_TITLE=DOOM Sticker Refresh Probe
DOOM_WAD_PATH=/absolute/path/to/doom1.wad
```

Use your own positive Telegram user ID for `OWNER_USER_ID`, not a group or
channel ID. Do not commit `.env`; it is already covered by `.gitignore`.

Optional paths and timing settings are documented in `.env.example`.

## Preparing a sticker pack

Create a new 15-slot screen pack, or connect to an existing compatible pack:

```bash
npm run dev -- init --slot-count 15
```

`init` never overwrites an existing set. If `STICKER_SET_NAME` already exists,
the command validates it, loads its current sticker positions, and writes the
result to `data/state.json`.

Append the five permanent controls:

```bash
npm run dev -- prepare-game
```

The command requires at least 15 screen slots and appends positions `15..19` in
the order `LEFT`, `RIGHT`, `GO`, `FIRE`, `USE`. It is idempotent: existing
controls are validated by position and emoji instead of being added again.

Check the Bot API connection and synchronized pack state:

```bash
npm run dev -- status
```

## Running the game

```bash
npm run dev -- play
```

`play` automatically validates or prepares the five controls, then:

1. starts native DoomGeneric directly on E1M1;
2. publishes the initial framebuffer to positions `0..14`;
3. drains the old Bot API backlog so a restart does not replay stale inputs;
4. waits for new sticker messages through `getUpdates`;
5. resolves a control primarily by its stable `file_unique_id`, with an
   unambiguous emoji fallback;
6. holds the corresponding key for several game ticks;
7. captures the next framebuffer and sequentially replaces all 15 screen
   tiles.

Stop a foreground worker with `Ctrl+C`. Only one `play` process may exist for a
given bot and sticker pack.

In groups, the bot must be able to receive ordinary sticker messages. Use a
private chat for the simplest setup, or disable Privacy Mode through BotFather
for a dedicated public control room.

## Sticker refresh probe

The probe commands remain useful for measuring Telegram propagation and cache
behavior without running DOOM.

Replace slot zero ten times at ten-second intervals:

```bash
npm run dev -- single --slot 0 --count 10 --interval 10000
```

Run three cycles that sequentially replace slots `0..4`:

```bash
npm run dev -- batch --slots 0,1,2,3,4 --count 3 --interval 30000
```

Add a 500 ms delay between replacements within a cycle:

```bash
npm run dev -- batch --slots 0,1,2,3,4 --count 3 --interval 30000 --slot-delay 500
```

By default, the first error stops the experiment. To log an error and continue
with the next slot:

```bash
npm run dev -- batch --slots 0,1,2,3,4 --count 3 --continue-on-error
```

All replacements are serialized. If an API call takes longer than the selected
interval, the next scheduled iteration starts immediately after the previous
one finishes.

## Logging and measurements

The default API log is `logs/api.jsonl`. Every line is a JSON object. An
`api_call` record includes:

- the Bot API method;
- `startedAt` and `finishedAt`;
- `durationMs`;
- the HTTP status;
- `ok`;
- Telegram's error code, description, and `retry_after` when present.

The bot token, image contents, and full request parameters are not written to
the log.

Events such as `cycle_start`, `replacement`, `game_input`,
`game_tile_replaced`, `game_frame_end`, and `replacement_error` make it
possible to compare server acceptance times with the moment each Telegram
client displays a new tile.

## Multi-client test procedure

1. Add the pack to two phones and Telegram Desktop.
2. Synchronize the device clocks, or record all screens in one video.
3. Keep the sticker panel open on the first client.
4. Close and reopen the panel after each expected update on the second client.
5. Switch between this pack and a neighboring pack on Desktop.
6. Run a single-slot probe with a ten-second interval.
7. Record whether each frame appears automatically, how long it takes, and
   whether any frames are skipped or reordered.
8. Run a batch probe and observe whether clients display a temporary mixture of
   old and new slots.
9. Compare the observations with `startedAt`, `finishedAt`, and `durationMs` in
   the JSONL log.
10. Repeat the test by moving the pack in sticker settings to force a refresh.

Suggested probe:

```bash
npm run dev -- single --slot 0 --count 12 --interval 10000
npm run dev -- batch --slots 0,1,2,3,4 --count 3 --interval 30000 --slot-delay 500
```

## State and runtime files

`data/state.json` stores the most recently observed `file_id`,
`file_unique_id`, position, frame number, and next global frame number. The
worker calls `getStickerSet` before replacements, so the file should not be
edited manually.

`data/state.json.lock` prevents two local workers from changing the same pack
concurrently. It is removed after a clean shutdown. Delete only that exact lock
file after confirming that no worker is still running.

The IWAD, Doom configuration, latest framebuffer, save data, runtime files, and
local bot state remain in ignored paths and are not committed.

## Build and verification

```bash
npm run build
npm test
npm run build:native
```

Run a real native smoke test with an available IWAD:

```bash
DOOM_WAD_PATH=/absolute/path/to/doom1.wad npm run smoke:native
```

The smoke test launches E1M1, captures an initial frame, applies a `forward`
action, and verifies that the result can be rendered into 15 WEBP tiles.

Run the compiled CLI:

```bash
npm run build
npm start -- status
```

## Production deployment

The current deployment model is a single hardened systemd service:

- service: `tg-sticker-doom.service`;
- unprivileged user: `tgdoom`;
- application root: `/opt/tg-sticker-doom`;
- immutable releases: `/opt/tg-sticker-doom/releases/<commit>`;
- active release symlink: `/opt/tg-sticker-doom/current`;
- secrets and IWAD: `/opt/tg-sticker-doom/shared`;
- persistent state and runtime files: `/opt/tg-sticker-doom/data`;
- transport: outbound Telegram Bot API long polling, with no public application
  port.

The environment file must remain outside the release directory with
owner-only permissions. Never place `BOT_TOKEN` in a service unit, command-line
argument, Git history, or deployment log.

Useful service commands:

```bash
sudo systemctl status tg-sticker-doom.service
sudo journalctl -u tg-sticker-doom.service -f
sudo systemctl restart tg-sticker-doom.service
```

Before starting production, stop every local `play` process that uses the same
bot token. A deployment should build and test a new release directory first,
atomically update `current`, restart the service, and confirm:

- `ActiveState=active`;
- `NRestarts=0`;
- a `Game is live. Waiting for control stickers...` log entry;
- successful `getUpdates` calls;
- one Node worker and one DoomGeneric child process, both running as `tgdoom`;
- no newly exposed network listeners.

There are no database migrations in this prototype. On a first deployment,
rollback means stopping the service; after later releases, keep the previous
release directory so the `current` symlink can be switched back.

## Limitations

- All users share one game state and can overwrite each other's intentions.
- The 15 screen stickers are replaced sequentially, so a frame is not atomic.
- Telegram cache invalidation and propagation time are client-dependent and are
  not confirmed by the Bot API.
- There is no automatic retry policy for rate limits; errors and `retry_after`
  are recorded as experimental data.
- The worker uses long polling rather than a webhook.
- Only one `play` worker can safely use a bot and sticker pack at a time.
- A process restart resets the game to E1M1.
- Sound is disabled because the sticker pack transports only the framebuffer
  and controls.

## Upstream and API documentation

DoomGeneric is included as a pinned Git submodule and is distributed under
GPL-2.0.

Relevant Telegram Bot API documentation:
[Stickers](https://core.telegram.org/bots/api#stickers), including
`getStickerSet`, `createNewStickerSet`, `addStickerToSet`, and
`replaceStickerInSet`.
