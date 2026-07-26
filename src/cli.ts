#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { loadConfig } from "./config.js";
import { parseCli } from "./args.js";
import {
  CONTROL_DEFINITIONS,
  LEGACY_FIRST_CONTROL_SLOT,
  renderControlSticker,
  resolveControlAction,
  type BoundControl,
} from "./controls.js";
import { DoomProcess } from "./doom-process.js";
import {
  assertCustomEmojiScreenSet,
  customEmojiScreenHtml,
  customEmojiScreenStickers,
  customEmojiSetName,
  CUSTOM_EMOJI_SLOT_FALLBACKS,
  hasCustomEmojiSlotMarkers,
} from "./emoji-screen.js";
import type { GameFrame } from "./game.js";
import {
  CUSTOM_EMOJI_SLOT_COUNT,
  GRID_SLOT_COUNT,
  renderCustomEmojiGrid,
} from "./grid.js";
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

function uploadedInputSticker(
  fileId: string,
  slot: number,
): InputSticker {
  return {
    sticker: fileId,
    format: "static",
    emoji_list: [CUSTOM_EMOJI_SLOT_FALLBACKS[slot]!],
    keywords: [`doom-emoji-screen-${slot}`],
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

  if (state.slots.length === CONTROL_DEFINITIONS.length) {
    for (const definition of CONTROL_DEFINITIONS) {
      const existing = state.slots[definition.slot];
      if (
        !existing ||
        normalizedEmoji(existing.emoji) !== normalizedEmoji(definition.emoji)
      ) {
        throw new Error(
          `Slot ${definition.slot} is not the ${definition.action} control`,
        );
      }
    }
    return state;
  }

  if (
    state.slots.length < GRID_SLOT_COUNT ||
    state.slots.length > GRID_SLOT_COUNT + CONTROL_DEFINITIONS.length
  ) {
    throw new Error(
      `Game pack must be either ${CONTROL_DEFINITIONS.length} controls or a ${GRID_SLOT_COUNT}-slot legacy screen pack; set has ${state.slots.length}`,
    );
  }

  for (const [index, definition] of CONTROL_DEFINITIONS.entries()) {
    const legacySlot = LEGACY_FIRST_CONTROL_SLOT + index;
    const existing = state.slots[legacySlot];
    if (existing) {
      if (
        normalizedEmoji(existing.emoji) !==
        normalizedEmoji(definition.emoji)
      ) {
        throw new Error(
          `Legacy slot ${legacySlot} already exists but is not the ${definition.action} control`,
        );
      }
      continue;
    }
    if (state.slots.length !== legacySlot) {
      throw new Error(
        `Cannot append control at legacy slot ${legacySlot}; current size is ${state.slots.length}`,
      );
    }

    const attachment = "sticker_file";
    await client.addStickerToSet(
      config.ownerUserId,
      config.stickerSetName,
      inputSticker(
        attachment,
        legacySlot,
        definition.emoji,
        `doom-control-${definition.action}`,
      ),
      await renderControlSticker(definition),
      `control-${definition.action}.webp`,
    );
    await logger.write({
      type: "control_added",
      stickerSetName: config.stickerSetName,
      slot: legacySlot,
      action: definition.action,
    });
    state = await syncState(client, config, bot, state);
  }

  const obsoleteScreenSlots = state.slots.slice(0, GRID_SLOT_COUNT).reverse();
  for (const slot of obsoleteScreenSlots) {
    await client.deleteStickerFromSet(slot.fileId);
    await logger.write({
      type: "legacy_screen_sticker_deleted",
      stickerSetName: config.stickerSetName,
      oldPosition: slot.position,
      fileUniqueId: slot.fileUniqueId,
      deletedAt: new Date().toISOString(),
    });
  }

  state = await syncState(client, config, bot, state);
  if (state.slots.length !== CONTROL_DEFINITIONS.length) {
    throw new Error(
      `Control pack migration left ${state.slots.length} stickers; expected ${CONTROL_DEFINITIONS.length}`,
    );
  }
  for (const definition of CONTROL_DEFINITIONS) {
    const existing = state.slots[definition.slot];
    if (
      !existing ||
      normalizedEmoji(existing.emoji) !== normalizedEmoji(definition.emoji)
    ) {
      throw new Error(
        `Migrated slot ${definition.slot} is not the ${definition.action} control`,
      );
    }
  }

  await logger.write({
    type: "control_pack_compacted",
    stickerSetName: config.stickerSetName,
    slotCount: state.slots.length,
    compactedAt: new Date().toISOString(),
  });

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

async function publishCustomEmojiFrame(
  client: TelegramClient,
  logger: JsonlLogger,
  config: ReturnType<typeof loadConfig>,
  setName: string,
  frame: GameFrame,
): Promise<TelegramStickerSet> {
  const tiles = await renderCustomEmojiGrid(frame);
  let live = await getSetOrNull(client, setName);
  let replacedExistingSet = false;

  await logger.write({
    type: "game_emoji_frame_start",
    sequence: frame.sequence,
    capturedAt: frame.capturedAt,
    slotCount: CUSTOM_EMOJI_SLOT_COUNT,
    customEmojiSetName: setName,
  });

  if (!live) {
    const stickers = tiles.map((bytes, slot) => {
      const attachment = `sticker_${slot}`;
      return {
        input: inputSticker(
          attachment,
          slot,
          CUSTOM_EMOJI_SLOT_FALLBACKS[slot]!,
          `doom-emoji-screen-${slot}`,
        ),
        bytes,
        filename: `doom-emoji-${String(frame.sequence).padStart(6, "0")}-${slot}.webp`,
      };
    });
    await client.createNewStickerSet(
      config.ownerUserId,
      setName,
      config.customEmojiSetTitle.slice(0, 64),
      stickers,
      "custom_emoji",
    );
    await logger.write({
      type: "game_emoji_set_created",
      sequence: frame.sequence,
      customEmojiSetName: setName,
      slotCount: CUSTOM_EMOJI_SLOT_COUNT,
      createdAt: new Date().toISOString(),
    });
  } else {
    assertCustomEmojiScreenSet(live);
    const uploaded = await Promise.all(
      tiles.map(async (tile, slot) => {
        const startedAt = new Date().toISOString();
        const file = await client.uploadStickerFile(
          config.ownerUserId,
          tile,
          `doom-emoji-upload-${String(frame.sequence).padStart(6, "0")}-${slot}.webp`,
        );
        await logger.write({
          type: "game_emoji_tile_uploaded",
          sequence: frame.sequence,
          slot,
          fileUniqueId: file.file_unique_id,
          startedAt,
          acceptedAt: new Date().toISOString(),
        });
        return file;
      }),
    );
    replacedExistingSet = true;
    const current = live;
    const currentScreen = customEmojiScreenStickers(current);

    await Promise.all(
      Array.from({ length: CUSTOM_EMOJI_SLOT_COUNT }, async (_, slot) => {
        const oldSticker = currentScreen[slot];
        const file = uploaded[slot];
        if (!oldSticker || !file) {
          throw new Error(`Missing custom emoji tile ${slot}`);
        }

        const startedAt = new Date().toISOString();
        await client.replaceStickerInSetByFileId(
          config.ownerUserId,
          setName,
          oldSticker.file_id,
          uploadedInputSticker(file.file_id, slot),
        );
        await logger.write({
          type: "game_emoji_tile_replaced",
          sequence: frame.sequence,
          slot,
          oldFileUniqueId: oldSticker.file_unique_id,
          startedAt,
          acceptedAt: new Date().toISOString(),
        });
      }),
    );
  }

  live = await client.getStickerSet(setName);
  assertCustomEmojiScreenSet(live);
  if (replacedExistingSet && !hasCustomEmojiSlotMarkers(live)) {
    throw new Error("Custom emoji slot markers are incomplete after replacement");
  }
  const updatedAt = new Date().toISOString();
  await logger.write({
    type: "game_emoji_frame_end",
    sequence: frame.sequence,
    customEmojiSetName: setName,
    publishedAt: updatedAt,
  });
  return live;
}

function isPermanentScreenEditError(error: unknown): boolean {
  return (
    error instanceof TelegramApiError &&
    /message to edit not found|message can't be edited|MESSAGE_ID_INVALID/i.test(
      error.message,
    )
  );
}

async function updateCustomEmojiScreen(
  client: TelegramClient,
  logger: JsonlLogger,
  state: ProbeState,
  set: TelegramStickerSet,
  chatId: number,
  sequence: number,
  allowCreate: boolean,
  triggerMessageId?: number,
): Promise<void> {
  state.screenMessages ??= {};
  const key = String(chatId);
  const existing = state.screenMessages[key];
  const html = customEmojiScreenHtml(set);

  if (existing) {
    try {
      await client.editCustomEmojiScreen(chatId, existing.messageId, html);
      existing.updatedAt = new Date().toISOString();
      await logger.write({
        type: "game_emoji_screen_edited",
        sequence,
        customEmojiSetName: set.name,
        chatId,
        messageId: existing.messageId,
        triggerMessageId,
        editedAt: existing.updatedAt,
      });
      return;
    } catch (error) {
      const permanent = isPermanentScreenEditError(error);
      await logger.write({
        type: "game_emoji_screen_edit_failed",
        sequence,
        customEmojiSetName: set.name,
        chatId,
        messageId: existing.messageId,
        triggerMessageId,
        permanent,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!permanent) return;
      delete state.screenMessages[key];
    }
  }

  if (!allowCreate) return;

  try {
    const sent = await client.sendCustomEmojiScreen(
      chatId,
      html,
    );
    const sentAt = new Date().toISOString();
    state.screenMessages[key] = {
      chatId,
      messageId: sent.message_id,
      updatedAt: sentAt,
    };
    await logger.write({
      type: "game_emoji_screen_sent",
      sequence,
      customEmojiSetName: set.name,
      chatId,
      triggerMessageId,
      sentMessageId: sent.message_id,
      sentAt,
    });
  } catch (error) {
    await logger.write({
      type: "game_emoji_screen_send_failed",
      sequence,
      customEmojiSetName: set.name,
      chatId,
      triggerMessageId,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(
      `Failed to send custom emoji screen for sequence ${sequence}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function updateKnownScreens(
  client: TelegramClient,
  logger: JsonlLogger,
  state: ProbeState,
  set: TelegramStickerSet,
  sequence: number,
): Promise<void> {
  const screens = Object.values(state.screenMessages ?? {});
  for (const screen of screens) {
    await updateCustomEmojiScreen(
      client,
      logger,
      state,
      set,
      screen.chatId,
      sequence,
      false,
    );
  }
}

async function deleteControlMessageBestEffort(
  client: TelegramClient,
  logger: JsonlLogger,
  update: TelegramUpdate,
): Promise<void> {
  const message = update.message;
  if (!message) return;

  try {
    await client.deleteMessage(message.chat.id, message.message_id);
    await logger.write({
      type: "game_control_message_deleted",
      updateId: update.update_id,
      chatId: message.chat.id,
      messageId: message.message_id,
      deletedAt: new Date().toISOString(),
    });
  } catch (error) {
    await logger.write({
      type: "game_control_message_delete_failed",
      updateId: update.update_id,
      chatId: message.chat.id,
      messageId: message.message_id,
      chatType: message.chat.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
  if (!bot.username) {
    throw new Error("The bot must have a username before it can create a custom emoji set");
  }
  const emojiSetName = customEmojiSetName(
    config.stickerSetName,
    bot.username,
    config.customEmojiSetName,
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
    const initialFrame = await engine.capture();
    const initialEmojiSet = await publishCustomEmojiFrame(
      client,
      logger,
      config,
      emojiSetName,
      initialFrame,
    );
    await updateKnownScreens(
      client,
      logger,
      state,
      initialEmojiSet,
      initialFrame.sequence,
    );
    state.nextFrame = Math.max(state.nextFrame, initialFrame.sequence + 1);
    await saveState(config.stateFile, state);
    let offset = await drainPendingUpdates(client, logger);
    let nextAutoUpdateAt = Date.now() + config.autoUpdateIntervalMs;
    console.log(`Emoji screen: https://t.me/addemoji/${emojiSetName}`);
    console.log("Game is live. Waiting for control stickers...");

    while (!stopping) {
      const hasKnownScreen =
        Object.keys(state.screenMessages ?? {}).length > 0;
      const autoUpdateEnabled =
        config.autoUpdateIntervalMs > 0 && hasKnownScreen;
      const timeoutSeconds = autoUpdateEnabled
        ? Math.max(
            0,
            Math.min(
              5,
              Math.ceil((nextAutoUpdateAt - Date.now()) / 1_000),
            ),
          )
        : 5;
      const updates = await client.getUpdates(offset, timeoutSeconds);
      let actionPublished = false;
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
        if (config.deleteControlMessages) {
          await deleteControlMessageBestEffort(client, logger, update);
        }
        const frame = await engine.apply(action);
        const emojiSet = await publishCustomEmojiFrame(
          client,
          logger,
          config,
          emojiSetName,
          frame,
        );
        state.nextFrame = Math.max(state.nextFrame, frame.sequence + 1);
        const message = update.message;
        if (!message) continue;
        await updateCustomEmojiScreen(
          client,
          logger,
          state,
          emojiSet,
          message.chat.id,
          frame.sequence,
          true,
          message.message_id,
        );
        await saveState(config.stateFile, state);
        actionPublished = true;
        nextAutoUpdateAt = Date.now() + config.autoUpdateIntervalMs;
      }

      if (
        !actionPublished &&
        config.autoUpdateIntervalMs > 0 &&
        Object.keys(state.screenMessages ?? {}).length > 0 &&
        Date.now() >= nextAutoUpdateAt
      ) {
        const scheduledAt = nextAutoUpdateAt;
        const frame = await engine.capture();
        const emojiSet = await publishCustomEmojiFrame(
          client,
          logger,
          config,
          emojiSetName,
          frame,
        );
        await updateKnownScreens(
          client,
          logger,
          state,
          emojiSet,
          frame.sequence,
        );
        state.nextFrame = Math.max(state.nextFrame, frame.sequence + 1);
        await saveState(config.stateFile, state);
        await logger.write({
          type: "game_auto_update",
          sequence: frame.sequence,
          scheduledAt: new Date(scheduledAt).toISOString(),
          completedAt: new Date().toISOString(),
          screenCount: Object.keys(state.screenMessages ?? {}).length,
        });
        nextAutoUpdateAt = Math.max(
          scheduledAt + config.autoUpdateIntervalMs,
          Date.now(),
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
  const stateLock = new StateLock(`${config.stateFile}.lock`);
  let botLock: StateLock | null = null;

  await stateLock.acquire();
  try {
    const bot = await client.getMe();
    botLock = new StateLock(
      path.join(os.tmpdir(), `tg-sticker-doom-bot-${bot.id}.lock`),
    );
    await botLock.acquire();
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
      const emojiSetName = bot.username
        ? customEmojiSetName(
            config.stickerSetName,
            bot.username,
            config.customEmojiSetName,
          )
        : undefined;
      console.log(
        JSON.stringify(
          {
            stickerSetName: state.stickerSetName,
            stickerSetUrl: `https://t.me/addstickers/${state.stickerSetName}`,
            customEmojiSetName: emojiSetName,
            customEmojiSetUrl: emojiSetName
              ? `https://t.me/addemoji/${emojiSetName}`
              : undefined,
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
    await botLock?.release();
    await stateLock.release();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
