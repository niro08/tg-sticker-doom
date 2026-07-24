#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { parseCli } from "./args.js";
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
  TelegramUser,
} from "./types.js";

const DEFAULT_SLOTS = 5;
const DEFAULT_COUNT = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inputSticker(attachment: string, slot: number): InputSticker {
  return {
    sticker: `attach://${attachment}`,
    format: "static",
    emoji_list: ["🎮"],
    keywords: [`probe-slot-${slot}`],
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
