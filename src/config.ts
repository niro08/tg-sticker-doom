import "dotenv/config";
import path from "node:path";

export interface Config {
  botToken: string;
  ownerUserId: number;
  stickerSetName: string;
  stickerSetTitle: string;
  stateFile: string;
  logFile: string;
  defaultIntervalMs: number;
  defaultSlotDelayMs: number;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function positiveInteger(name: string, fallback?: number): number {
  const raw = process.env[name];
  if ((raw === undefined || raw === "") && fallback !== undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

export function loadConfig(): Config {
  const ownerUserId = Number(required("OWNER_USER_ID"));
  if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) {
    throw new Error("OWNER_USER_ID must be a positive integer");
  }

  return {
    botToken: required("BOT_TOKEN"),
    ownerUserId,
    stickerSetName: required("STICKER_SET_NAME"),
    stickerSetTitle:
      process.env.STICKER_SET_TITLE?.trim() || "Sticker Refresh Probe",
    stateFile: path.resolve(process.env.STATE_FILE || "./data/state.json"),
    logFile: path.resolve(process.env.LOG_FILE || "./logs/api.jsonl"),
    defaultIntervalMs: positiveInteger("DEFAULT_INTERVAL_MS", 10_000),
    defaultSlotDelayMs: positiveInteger("DEFAULT_SLOT_DELAY_MS", 0),
  };
}
