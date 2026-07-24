import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ProbeState,
  TelegramStickerSet,
  TelegramUser,
} from "./types.js";

export async function loadState(filePath: string): Promise<ProbeState | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as ProbeState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function saveState(
  filePath: string,
  state: ProbeState,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export function stateFromSet(
  set: TelegramStickerSet,
  ownerUserId: number,
  bot: TelegramUser,
  previous: ProbeState | null,
): ProbeState {
  const now = new Date().toISOString();
  return {
    version: 1,
    stickerSetName: set.name,
    ownerUserId,
    botId: bot.id,
    botUsername: bot.username || "",
    nextFrame: previous?.nextFrame ?? 1,
    slots: set.stickers.map((sticker, position) => {
      const old = previous?.slots.find((slot) => slot.position === position);
      return {
        position,
        fileId: sticker.file_id,
        fileUniqueId: sticker.file_unique_id,
        emoji: sticker.emoji,
        frame: old?.frame ?? 0,
        updatedAt: old?.updatedAt ?? now,
      };
    }),
    syncedAt: now,
  };
}

export class StateLock {
  private acquired = false;

  constructor(private readonly lockPath: string) {}

  async acquire(): Promise<void> {
    await mkdir(path.dirname(this.lockPath), { recursive: true });
    try {
      const handle = await open(this.lockPath, "wx");
      await handle.writeFile(
        `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
      );
      await handle.close();
      this.acquired = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(
          `Another probe may be running. Lock exists: ${this.lockPath}`,
        );
      }
      throw error;
    }
  }

  async release(): Promise<void> {
    if (!this.acquired) return;
    await unlink(this.lockPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    this.acquired = false;
  }
}
