# tg-sticker-doom

A shared DOOM instance controlled by a Telegram sticker pack and rendered as a
custom emoji mosaic in chat.

The current prototype combines a headless DoomGeneric process, a `3×2` custom
emoji framebuffer, five permanent control stickers, and a Telegram Bot API
long-polling worker. Every user controls the same game. The first accepted input
creates one screen message per chat; actions and periodic captures edit that
same message instead of adding new ones.

## Live experiment

- Bot: [@doom_228_bot](https://t.me/doom_228_bot)
- Sticker pack:
  [doom_refresh_probe_2_by_doom_228_bot](https://t.me/addstickers/doom_refresh_probe_2_by_doom_228_bot)

Add the regular pack, open a chat where the bot can receive sticker messages,
and send one of the five control stickers. The sticker panel can remain cached;
the current screen is delivered directly to the chat as custom emoji.

## Confirmed behavior

- A `5×3` screen grid has been tested in Telegram clients.
- The engine starts directly on E1M1 with no title screen or main menu.
- Telegram may display a mixture of old and new tiles while the 15 sequential
  replacements propagate.
- Moving the pack in Telegram's sticker settings forces the client to load the
  current version.
- Sending a newly replaced regular sticker directly to a chat displays its
  current contents, even while the installed pack remains cached.
- A `5×3` custom emoji message wraps after four tiles on iOS. The chat viewport
  therefore uses `3×2`, which also reduces each frame from 15 replacements to
  six.
- In the local Bot API test, publishing six emoji tiles takes about 3.3 seconds
  instead of roughly 10–11 seconds for 15 tiles.
- The production worker can run continuously through systemd without exposing
  a public HTTP port.

The custom emoji path intentionally uses new `custom_emoji_id` values after each
replacement so the message does not depend on invalidating the installed-pack
cache.

## Controller layout

The regular pack contains only five permanent controls:

```text
LEFT  RIGHT  GO   FIRE  USE
```

The controls use these actions:

| Position | Sticker | Action |
| ---: | :---: | --- |
| 0 | `⬅️` | Turn left |
| 1 | `➡️` | Turn right |
| 2 | `⬆️` | Move forward |
| 3 | `🔥` | Fire |
| 4 | `🚪` | Use/open |

DoomGeneric is launched with `-warp 1 1`, so the first published game frame is
from E1M1. The IWAD is supplied through a local path and is never stored in Git.

New custom emoji sets contain six static 100×100 WEBP tiles. Existing 15-slot
test sets remain compatible; only their first six positions are used:

```text
00  01  02
03  04  05
```

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
framebuffer is rendered into six 100×100 WEBP emoji tiles
        ↓
six files are uploaded in parallel
        ↓
replaceStickerInSet updates six distinct slots in parallel by file_id
        ↓
bot sends one 3×2 screen message, then edits it on actions and timer ticks
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
- Telegram Premium on the account that owns the bot, which lets the bot send
  custom emoji in its own messages

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
CUSTOM_EMOJI_SET_NAME=doom_refresh_probe_emoji_by_your_bot
CUSTOM_EMOJI_SET_TITLE=DOOM Emoji Screen
DOOM_WAD_PATH=/absolute/path/to/doom1.wad
AUTO_UPDATE_INTERVAL_MS=3000
DELETE_CONTROL_MESSAGES=true
```

Use your own positive Telegram user ID for `OWNER_USER_ID`, not a group or
channel ID. Do not commit `.env`; it is already covered by `.gitignore`.

`CUSTOM_EMOJI_SET_NAME` is optional. If omitted, `play` derives a sibling name
by inserting `_emoji` before `_by_<bot_username>`. A configured name must end
with the same bot suffix. Optional paths and timing settings are documented in
`.env.example`.

## Preparing a sticker pack

Create a new 15-slot screen pack, or connect to an existing compatible pack:

```bash
npm run dev -- init --slot-count 15
```

`init` never overwrites an existing set. If `STICKER_SET_NAME` already exists,
the command validates it, loads its current sticker positions, and writes the
result to `data/state.json`.

Create or migrate the five permanent controls:

```bash
npm run dev -- prepare-game
```

For a legacy 15-slot screen pack, the command appends any missing controls at
positions `15..19`, then deletes the obsolete screen positions `0..14`. The
result is a five-sticker pack ordered `LEFT`, `RIGHT`, `GO`, `FIRE`, `USE`.
Running it again validates the compact layout without deleting anything.

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
2. creates or validates a separate custom emoji set with at least six slots;
3. publishes the initial framebuffer to that emoji set;
4. drains the old Bot API backlog so a restart does not replay stale inputs;
5. waits for new sticker messages through `getUpdates`;
6. resolves a control primarily by its stable `file_unique_id`, with an
   unambiguous emoji fallback;
7. holds the corresponding key for several game ticks;
8. captures the next framebuffer, uploads six custom emoji tiles in parallel,
   and replaces the six distinct screen slots in parallel using the uploaded
   file IDs;
9. creates one silent standalone `3×2` screen message for a chat, or edits the
   existing one;
10. captures and publishes another frame every `AUTO_UPDATE_INTERVAL_MS`
    (default 3000 ms), editing the existing screen without posting a new
    message;
11. tries to delete each incoming control sticker when
    `DELETE_CONTROL_MESSAGES=true`.

The initial frame prepares the emoji set. If a screen message was saved from a
previous run, startup edits it immediately; otherwise the first control action
creates it. Telegram reply metadata is deliberately omitted because its preview
narrows the message and forces tiles to wrap on iOS. `triggerMessageId` in the
JSONL log keeps each action attributable without consuming visual space.

Bots can delete incoming messages in private chats. In groups, the bot must be
an administrator; in supergroups it needs `can_delete_messages`. A missing
permission is logged and never blocks the game action. Telegram only allows
deleting messages younger than 48 hours.

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
`game_emoji_tile_uploaded`, `game_emoji_tile_replaced`, `game_emoji_frame_end`,
`game_emoji_screen_sent`, `game_emoji_screen_edited`, `game_auto_update`,
`game_control_message_deleted`, and `replacement_error` make it possible to
compare server acceptance times with the moment each Telegram client displays
a new tile. Delete and edit failures are logged separately and do not expose the
bot token or request contents.

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
`file_unique_id`, position, frame number, next global frame number, and the
current screen message ID for every participating chat. Persisting the message
ID lets the worker continue editing the same screen after a restart. The worker
calls `getStickerSet` before replacements, so the file should not be edited
manually.

`data/state.json.lock` prevents two local workers from changing the same pack
concurrently. A second temporary lock keyed by Telegram bot ID prevents the
same bot token from being used by workers with different state paths or local
checkouts. Locks are removed after a clean shutdown, and stale locks are
recovered only when their recorded PID no longer exists.

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
- The six custom emoji files upload concurrently, then their replacements run
  sequentially to avoid a burst of `replaceStickerInSet` calls. The worker
  verifies the resulting slot order before sending the chat message.
- A requested 3-second refresh is bounded by Telegram sticker replacement
  latency; if publishing takes longer, the next cycle starts as soon as the
  worker can safely poll queued controls.
- Automatic refresh begins only after a chat has an existing screen message.
- Deleting control stickers in groups requires bot administrator rights.
- Telegram custom emoji rendering requires Premium on the bot owner's account.
- Telegram determines the visual size and spacing of the `3×2` emoji mosaic;
  it must still be checked on Android and Desktop after the iOS test.
- Telegram cache invalidation for the original regular pack remains
  client-dependent and is not used for the live chat screen.
- Telegram `429` responses keep the worker alive. It waits for `retry_after`
  when provided, otherwise uses exponential backoff capped at 60 seconds, logs
  the scheduled retry, and retries the same API call.
- The worker uses long polling rather than a webhook.
- Only one `play` worker can safely use a bot and sticker pack at a time.
- A process restart resets the game to E1M1.
- Sound is disabled because the chat screen transports only the framebuffer.

## Upstream and API documentation

DoomGeneric is included as a pinned Git submodule and is distributed under
GPL-2.0.

Relevant Telegram Bot API documentation:
[Stickers](https://core.telegram.org/bots/api#stickers), including
`getStickerSet`, `createNewStickerSet`, `addStickerToSet`, and
`replaceStickerInSet`; [formatting
options](https://core.telegram.org/bots/api#formatting-options) for custom emoji
entities; and [custom emoji pack links](https://core.telegram.org/api/links#custom-emoji-stickerset-links).
