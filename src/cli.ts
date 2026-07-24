#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { parseCli } from "./args.js";
import {
  CONTROL_DEFINITIONS,
  renderControlSticker,
  resolveControlAction,
  type BoundControl,
} from "./controls.js";
import { DoomProcess } from "./doom-process.js";
import type { GameFrame } from "./game.js";
import { GRID_SLOT_COUNT, renderGameGrid } from "./grid.js";
import { renderFrame } from "./image.js";
import { JsonlLogger } from "./logger.js";
import {
  loadState,
  saveState,
  StateLock,
  stateFromSet,
} from "./state.js";
import { TelegramApiError, TelegramClient } from "./telegram.js";
import type {
  InputSticker,
  ProbeState,
  TelegramStickerSet,
  TelegramUpdate,
  TelegramUser,
} from "./types.js";

const DEFAULT_SLOTS = 5;
const DEFAULT_COUNT = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inputSticker(
  attachment: string,
  slot: number,
  emoji = "🎮",
  keyword = `probe-slot-${slot}`,
): InputSticker {
  return {
    sticker: `attach://${attachment}`,
    format: "static",
    emoji_list: [emoji],
    keywords: [keyword],
  };
}

function assertStaticRegularSet(set: TelegramStickerSet): void {
  if (set.sticker_type !== "regular") {
    throw new Error(
      `Sticker set ${set.name} is ${set.sticker_type}; a regular set is required`,
    );
  }
  if (set.stickers.some((sticker) => sticker.is_animated || sticker.is_video)) {
    throw new Error(`Sticker set ${set.name} must contain only static stickers`);
  }
}

function validateSlots(slots: number[], state: ProbeState): void {
  for (const slot of slots) {
    if (slot >= state.slots.length) {
      throw new Error(
        `Slot ${slot} does not exist; set currently has ${state.slots.length} stickers`,
      );
    }
  }
}

async function getSetOrNull(
  client: TelegramClient,
  name: string,
): Promise<TelegramStickerSet | null> {
  try {
    return await client.getStickerSet(name);
  } catch (error) {
    if (
      error instanceof TelegramApiError &&
      error.errorCode === 400 &&
      /STICKERSET_INVALID/i.test(error.message)
    ) {
      return null;
    }
    throw error;
  }
}

async function syncState(
  client: TelegramClient,
  config: ReturnType<typeof loadConfig>,
  bot: TelegramUser,
  previous: ProbeState | null,
): Promise<ProbeState> {
  const set = await client.getStickerSet(config.stickerSetName);
  assertStaticRegularSet(set);
  const state = stateFromSet(set, config.ownerUserId, bot, previous);
  await saveState(config.stateFile, state);
  return state;
}

async function initialize(
  client: TelegramClient,
  logger: JsonlLogger,
  config: ReturnType<typeof loadConfig>,
  bot: TelegramUser,
  requestedSlots: number,
): Promise<ProbeState> {
  const previous = await loadState(config.stateFile);
  const existing = await getSetOrNull(client, config.stickerSetName);
  if (existing) {
    assertStaticRegularSet(existing);
    if (existing.stickers.length < requestedSlots) {
      throw new Error(
        `Existing set has ${existing.stickers.length} stickers, fewer than requested ${requestedSlots}`,
      );
    }
    const state = stateFromSet(
      existing,
      config.ownerUserId,
      bot,
      previous,
    );
    await saveState(config.stateFile, state);
    await logger.write({
      type: "init",
      action: "use_existing",
      stickerSetName: existing.name,
      slotCount: existing.stickers.length,
    });
    return state;
  }

  if (!bot.username) {
    throw new Error("The bot must have a username before it can create a sticker set");
  }
  const requiredSuffix = `_by_${bot.username}`.toLowerCase();
  if (!config.stickerSetName.toLowerCase().endsWith(requiredSuffix)) {
    throw new Error(
      `STICKER_SET_NAME must end with ${requiredSuffix} when created by this bot`,
    );
  }

  const stickers = await Promise.all(
    Array.from({ length: requestedSlots }, async (_, slot) => {
      const attachment = `sticker_${slot}`;
      return {
        input: inputSticker(attachment, slot),
        bytes: await renderFrame(0, slot),
        filename: `frame-000-slot-${slot}.webp`,
      };
    }),
  );
  await client.createNewStickerSet(
    config.ownerUserId,
    config.stickerSetName,
    config.stickerSetTitle,
    stickers,
  );
  await logger.write({
    type: "init",
    action: "created",
    stickerSetName: config.stickerSetName,
    slotCount: requestedSlots,
  });
  return syncState(client, config, bot, previous);
}

async function replaceSlot(
  client: TelegramClient,
  logger: JsonlLogger,
  config: ReturnType<typeof loadConfig>,
  bot: TelegramUser,
  state: ProbeState,
  slot: number,
  frame: number,
): Promise<ProbeState> {
  const live = await syncState(client, config, bot, state);
  validateSlots([slot], live);
  const oldSticker = live.slots[slot];
  if (!oldSticker) throw new Error(`Missing slot ${slot}`);

  const attachment = "replacement";
  const bytes = await renderFrame(frame, slot);
  const startedAt = new Date().toISOString();
  await client.replaceStickerInSet(
    config.ownerUserId,
    config.stickerSetName,
    oldSticker.fileId,
    inputSticker(attachment, slot),
    bytes,
    `frame-${String(frame).padStart(3, "0")}-slot-${slot}.webp`,
  );
  await logger.write({
    type: "replacement",
    stickerSetName: config.stickerSetName,
    slot,
    frame,
    oldFileUniqueId: oldSticker.fileUniqueId,
    startedAt,
    acceptedAt: new Date().toISOString(),
  });

  const updated = await syncState(client, config, bot, live);
  const updatedSlot = updated.slots[slot];
  if (updatedSlot) {
    updatedSlot.frame = frame;
    updatedSlot.updatedAt = new Date().toISOString();
  }
  updated.nextFrame = Math.max(updated.nextFrame, frame + 1);
  await saveState(config.stateFile, updated);
  return updated;
}

async function runExperiment(
  mode: "single" | "batch",
  client: TelegramClient,
  logger: JsonlLogger,
  config: ReturnType<typeof loadConfig>,
  bot: TelegramUser,
  initialState: ProbeState,
  slots: number[],
  count: number,
  intervalMs: number,
  slotDelayMs: number,
  continueOnError: boolean,
): Promise<ProbeState> {
  validateSlots(slots, initialState);
  let state = initialState;
  let nextCycleAt = Date.now();

  await logger.write({
    type: "experiment_start",
    mode,
    slots,
    count,
    intervalMs,
    slotDelayMs,
    firstFrame: state.nextFrame,
  });

  for (let cycle = 0; cycle < count; cycle += 1) {
    await sleep(Math.max(0, nextCycleAt - Date.now()));
    const frame = state.nextFrame;
    await logger.write({
      type: "cycle_start",
      mode,
      cycle: cycle + 1,
      frame,
      slots,
    });

    for (const [index, slot] of slots.entries()) {
      try {
        state = await replaceSlot(
          client,
          logger,
          config,
          bot,
          state,
          slot,
          frame,
        );
        console.log(
          `${new Date().toISOString()} accepted FRAME ${String(frame).padStart(3, "0")} slot ${slot}`,
        );
      } catch (error) {
        await logger.write({
          type: "replacement_error",
          mode,
          cycle: cycle + 1,
          frame,
          slot,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        });
        console.error(
          `${new Date().toISOString()} failed FRAME ${frame} slot ${slot}:`,
          error,
        );
        if (!continueOnError) throw error;
      }

      if (index < slots.length - 1 && slotDelayMs > 0) {
        await sleep(slotDelayMs);
      }
    }

    state.nextFrame = Math.max(state.nextFrame, frame + 1);
    await saveState(config.stateFile, state);
    await logger.write({
      type: "cycle_end",
      mode,
      cycle: cycle + 1,
      frame,
    });
    nextCycleAt += intervalMs;
  }

  await logger.write({
    type: "experiment_end",
    mode,
    lastFrame: state.nextFrame - 1,
  });
  return state;
}

function normalizedEmoji(value: string | undefined): string {
  return (value ?? "").replaceAll("\ufe0f", "");
}

async function prepareGamePack(
  client: TelegramClient,
  logger: JsonlLogger,
  config: ReturnType<typeof loadConfig>,
  bot: TelegramUser,
  initialState: ProbeState,
): Promise<ProbeState> {
  let state = await syncState(client, config, bot, initialState);

  if (state.slots.length < GRID_SLOT_COUNT) {
    throw new Error(
      `Game mode requires ${GRID_SLOT_COUNT} screen slots; set has ${state.slots.length}`,
    );
  }
  if (
    state.slots.length > GRID_SLOT_COUNT + CONTROL_DEFINITIONS.length
  ) {
    throw new Error(
      `Game layout supports exactly ${GRID_SLOT_COUNT + CONTROL_DEFINITIONS.length} slots; set has ${state.slots.length}`,
    );
  }

  for (const definition of CONTROL_DEFINITIONS) {
    const existing = state.slots[definition.slot];
    if (existing) {
      if (
        normalizedEmoji(existing.emoji) !==
        normalizedEmoji(definition.emoji)
      ) {
        throw new Error(
          `Slot ${definition.slot} already exists but is not the ${definition.action} control`,
        );
      }
      continue;
    }
    if (state.slots.length !== definition.slot) {
      throw new Error(
        `Cannot append control at slot ${definition.slot}; current size is ${state.slots.length}`,
      );
    }

    const attachment = "sticker_file";
    await client.addStickerToSet(
      config.ownerUserId,
      config.stickerSetName,
      inputSticker(
        attachment,
        definition.slot,
        definition.emoji,
        `doom-control-${definition.action}`,
      ),
      await renderControlSticker(definition),
      `control-${definition.action}.webp`,
    );
    await logger.write({
      type: "control_added",
      stickerSetName: config.stickerSetName,
      slot: definition.slot,
      action: definition.action,
    });
    state = await syncState(client, config, bot, state);
  }

  return state;
}

function boundControls(state: ProbeState): BoundControl[] {
  return CONTROL_DEFINITIONS.map((definition) => {
    const slot = state.slots[definition.slot];
    if (!slot) {
      throw new Error(`Missing control sticker at slot ${definition.slot}`);
    }
    return { ...definition, fileUniqueId: slot.fileUniqueId };
  });
}

async function publishGameFrame(
  client: TelegramClient,
  logger: JsonlLogger,
  config: ReturnType<typeof loadConfig>,
  bot: TelegramUser,
  previous: ProbeState,
  frame: GameFrame,
): Promise<ProbeState> {
  const tiles = await renderGameGrid(frame);
  const live = await syncState(client, config, bot, previous);
  validateSlots(
    Array.from({ length: GRID_SLOT_COUNT }, (_, slot) => slot),
    live,
  );

  await logger.write({
    type: "game_frame_start",
    sequence: frame.sequence,
    capturedAt: frame.capturedAt,
    slotCount: GRID_SLOT_COUNT,
  });

  for (let slot = 0; slot < GRID_SLOT_COUNT; slot += 1) {
    const oldSticker = live.slots[slot];
    const tile = tiles[slot];
    if (!oldSticker || !tile) throw new Error(`Missing game tile ${slot}`);

    const startedAt = new Date().toISOString();
    await client.replaceStickerInSet(
      config.ownerUserId,
      config.stickerSetName,
      oldSticker.fileId,
      inputSticker("replacement", slot, "🎮", `doom-screen-${slot}`),
      tile,
      `doom-${String(frame.sequence).padStart(6, "0")}-${slot}.webp`,
    );
    await logger.write({
      type: "game_tile_replaced",
      sequence: frame.sequence,
      slot,
      oldFileUniqueId: oldSticker.fileUniqueId,
      startedAt,
      acceptedAt: new Date().toISOString(),
    });
  }

  const updated = await syncState(client, config, bot, live);
  const updatedAt = new Date().toISOString();
  for (let slot = 0; slot < GRID_SLOT_COUNT; slot += 1) {
    const stateSlot = updated.slots[slot];
    if (stateSlot) {
      stateSlot.frame = frame.sequence;
      stateSlot.updatedAt = updatedAt;
    }
  }
  updated.nextFrame = Math.max(updated.nextFrame, frame.sequence + 1);
  await saveState(config.stateFile, updated);
  await logger.write({
    type: "game_frame_end",
    sequence: frame.sequence,
    publishedAt: updatedAt,
  });
  return updated;
}

async function drainPendingUpdates(
  client: TelegramClient,
  logger: JsonlLogger,
): Promise<number | undefined> {
  let offset: number | undefined;
  let dropped = 0;

  while (true) {
    const updates = await client.getUpdates(offset, 0);
    if (updates.length === 0) break;
    dropped += updates.length;
    offset = updates[updates.length - 1]!.update_id + 1;
  }

  await logger.write({
    type: "telegram_backlog_drained",
    dropped,
    nextOffset: offset,
  });
  return offset;
}

function actionFromUpdate(
  update: TelegramUpdate,
  stickerSetName: string,
  controls: readonly BoundControl[],
) {
  const sticker = update.message?.sticker;
  if (!sticker || sticker.set_name !== stickerSetName) return null;
  return resolveControlAction(sticker, controls);
}

async function runGame(
  client: TelegramClient,
  logger: JsonlLogger,
  config: ReturnType<typeof loadConfig>,
  bot: TelegramUser,
  initialState: ProbeState,
): Promise<void> {
  if (!config.doomWadPath) {
    throw new Error("DOOM_WAD_PATH is required for play");
  }

  let state = await prepareGamePack(
    client,
    logger,
    config,
    bot,
    initialState,
  );
  const controls = boundControls(state);
  const engine = new DoomProcess({
    executablePath: config.doomExecutable,
    wadPath: config.doomWadPath,
    framePath: config.doomFrameFile,
    workingDirectory: config.doomWorkingDirectory,
    startupTimeoutMs: config.doomStartupTimeoutMs,
    onOutput: (stream, text) => {
      const output = text.trim();
      if (output) console[stream === "stderr" ? "error" : "log"](output);
    },
  });
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    console.log("Starting headless DOOM on E1M1...");
    await engine.start();
    state = await publishGameFrame(
      client,
      logger,
      config,
      bot,
      state,
      await engine.capture(),
    );
    let offset = await drainPendingUpdates(client, logger);
    console.log("Game is live. Waiting for control stickers...");

    while (!stopping) {
      const updates = await client.getUpdates(offset, 5);
      for (const update of updates) {
        offset = update.update_id + 1;
        const action = actionFromUpdate(
          update,
          config.stickerSetName,
          controls,
        );
        if (!action) continue;

        await logger.write({
          type: "game_input",
          updateId: update.update_id,
          messageId: update.message?.message_id,
          chatId: update.message?.chat.id,
          userId: update.message?.from?.id,
          action,
          receivedAt: new Date().toISOString(),
        });
        console.log(
          `${new Date().toISOString()} action=${action} user=${update.message?.from?.id ?? "unknown"}`,
        );
        state = await publishGameFrame(
          client,
          logger,
          config,
          bot,
          state,
          await engine.apply(action),
        );
      }
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await engine.stop();
  }
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const config = loadConfig();
  const logger = new JsonlLogger(config.logFile);
  const client = new TelegramClient(config.botToken, logger);
  const lock = new StateLock(`${config.stateFile}.lock`);

  await lock.acquire();
  try {
    const bot = await client.getMe();
    let state = await loadState(config.stateFile);

    if (options.command === "init") {
      const slotCount = options.slotCount ?? DEFAULT_SLOTS;
      state = await initialize(client, logger, config, bot, slotCount);
      console.log(`Ready: https://t.me/addstickers/${state.stickerSetName}`);
      console.log(`Slots: ${state.slots.length}`);
      console.log(`State: ${config.stateFile}`);
      console.log(`Log: ${logger.path}`);
      return;
    }

    state = await syncState(client, config, bot, state);
    if (options.command === "status") {
      console.log(
        JSON.stringify(
          {
            stickerSetName: state.stickerSetName,
            stickerSetUrl: `https://t.me/addstickers/${state.stickerSetName}`,
            bot: `@${state.botUsername}`,
            slots: state.slots.length,
            nextFrame: state.nextFrame,
            syncedAt: state.syncedAt,
            stateFile: config.stateFile,
            logFile: config.logFile,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (options.command === "prepare-game") {
      state = await prepareGamePack(client, logger, config, bot, state);
      console.log(`Game layout ready: ${state.slots.length} slots`);
      console.log(`Pack: https://t.me/addstickers/${state.stickerSetName}`);
      return;
    }

    if (options.command === "play") {
      await runGame(client, logger, config, bot, state);
      return;
    }

    const count = options.count ?? DEFAULT_COUNT;
    const intervalMs = options.intervalMs ?? config.defaultIntervalMs;
    const slotDelayMs =
      options.slotDelayMs ?? config.defaultSlotDelayMs;
    const slots =
      options.command === "single"
        ? [options.slot ?? options.slots?.[0] ?? 0]
        : options.slots ?? state.slots.map((slot) => slot.position);

    if (options.command === "single" && options.slot !== undefined && options.slots) {
      throw new Error("Use either --slot or --slots with single, not both");
    }
    if (options.command === "single" && (options.slots?.length ?? 0) > 1) {
      throw new Error("single accepts only one slot in --slots");
    }

    await runExperiment(
      options.command,
      client,
      logger,
      config,
      bot,
      state,
      slots,
      count,
      intervalMs,
      slotDelayMs,
      options.continueOnError,
    );
  } finally {
    await lock.release();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
