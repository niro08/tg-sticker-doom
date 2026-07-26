import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { StateLock, stateFromSet } from "./state.js";

test("stateFromSet preserves persisted screen messages", () => {
  const previous = {
    version: 1 as const,
    stickerSetName: "controls_by_test_bot",
    ownerUserId: 1,
    botId: 2,
    botUsername: "test_bot",
    nextFrame: 3,
    slots: [],
    screenMessages: {
      "-100": {
        chatId: -100,
        messageId: 42,
        updatedAt: "2026-07-26T00:00:00.000Z",
      },
    },
    syncedAt: "2026-07-26T00:00:00.000Z",
  };
  const state = stateFromSet(
    {
      name: "controls_by_test_bot",
      title: "Controls",
      sticker_type: "regular",
      stickers: [],
    },
    1,
    { id: 2, is_bot: true, first_name: "Test", username: "test_bot" },
    previous,
  );

  assert.deepEqual(state.screenMessages, previous.screenMessages);
});

test("StateLock excludes a concurrent holder", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tg-doom-lock-"));
  const lockPath = path.join(directory, "worker.lock");
  const first = new StateLock(lockPath);
  const second = new StateLock(lockPath);

  try {
    await first.acquire();
    await assert.rejects(second.acquire(), /Another probe may be running/);
  } finally {
    await first.release();
    await rm(directory, { recursive: true, force: true });
  }
});

test("StateLock recovers a lock owned by a dead process", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tg-doom-lock-"));
  const lockPath = path.join(directory, "worker.lock");
  const lock = new StateLock(lockPath);

  try {
    await writeFile(
      lockPath,
      `${JSON.stringify({ pid: 2_147_483_647, createdAt: "stale" })}\n`,
    );
    await lock.acquire();
  } finally {
    await lock.release();
    await rm(directory, { recursive: true, force: true });
  }
});
