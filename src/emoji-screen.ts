import {
  CUSTOM_EMOJI_COLUMNS,
  CUSTOM_EMOJI_ROWS,
  CUSTOM_EMOJI_SLOT_COUNT,
} from "./grid.js";
import type { TelegramStickerSet } from "./types.js";

export const CUSTOM_EMOJI_FALLBACK = "🎮";
export const CUSTOM_EMOJI_SLOT_FALLBACKS = [
  "🔴",
  "🟠",
  "🟡",
  "🟢",
  "🔵",
  "🟣",
] as const;

function normalizedEmoji(value: string | undefined): string {
  return (value ?? "").replaceAll("\ufe0f", "");
}

export function customEmojiScreenStickers(set: TelegramStickerSet) {
  const ordered = CUSTOM_EMOJI_SLOT_FALLBACKS.map((emoji) =>
    set.stickers.find(
      (sticker) => normalizedEmoji(sticker.emoji) === normalizedEmoji(emoji),
    ),
  );
  if (ordered.every((sticker) => sticker !== undefined)) {
    return ordered;
  }
  return set.stickers.slice(0, CUSTOM_EMOJI_SLOT_COUNT);
}

export function hasCustomEmojiSlotMarkers(set: TelegramStickerSet): boolean {
  return CUSTOM_EMOJI_SLOT_FALLBACKS.every((emoji) =>
    set.stickers.some(
      (sticker) => normalizedEmoji(sticker.emoji) === normalizedEmoji(emoji),
    ),
  );
}

export function customEmojiSetName(
  regularSetName: string,
  botUsername: string,
  configuredName?: string,
): string {
  const suffix = `_by_${botUsername}`;
  const resolved = configuredName?.trim()
    ? configuredName.trim()
    : regularSetName.toLowerCase().endsWith(suffix.toLowerCase())
      ? `${regularSetName.slice(0, -suffix.length)}_emoji${suffix}`
      : `${regularSetName}_emoji${suffix}`;

  if (!resolved.toLowerCase().endsWith(suffix.toLowerCase())) {
    throw new Error(`CUSTOM_EMOJI_SET_NAME must end with ${suffix}`);
  }
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(resolved)) {
    throw new Error(
      "CUSTOM_EMOJI_SET_NAME must be 1-64 characters and contain only letters, digits, and underscores",
    );
  }
  if (resolved.includes("__")) {
    throw new Error("CUSTOM_EMOJI_SET_NAME cannot contain consecutive underscores");
  }
  return resolved;
}

export function assertCustomEmojiScreenSet(
  set: TelegramStickerSet,
): void {
  if (set.sticker_type !== "custom_emoji") {
    throw new Error(
      `Sticker set ${set.name} is ${set.sticker_type}; a custom emoji set is required`,
    );
  }
  if (set.stickers.length < CUSTOM_EMOJI_SLOT_COUNT) {
    throw new Error(
      `Custom emoji screen requires at least ${CUSTOM_EMOJI_SLOT_COUNT} slots; set has ${set.stickers.length}`,
    );
  }
  const screen = customEmojiScreenStickers(set);
  if (screen.some((sticker) => sticker.is_animated || sticker.is_video)) {
    throw new Error(`Custom emoji set ${set.name} must contain only static emoji`);
  }
  if (screen.some((sticker) => !sticker.custom_emoji_id)) {
    throw new Error(`Custom emoji set ${set.name} has a slot without custom_emoji_id`);
  }
}

export function customEmojiScreenHtml(set: TelegramStickerSet): string {
  assertCustomEmojiScreenSet(set);
  const tags = customEmojiScreenStickers(set).map(
    (sticker, slot) =>
      `<tg-emoji emoji-id="${sticker.custom_emoji_id}">${CUSTOM_EMOJI_SLOT_FALLBACKS[slot]}</tg-emoji>`,
  );

  return Array.from({ length: CUSTOM_EMOJI_ROWS }, (_, row) =>
    tags
      .slice(
        row * CUSTOM_EMOJI_COLUMNS,
        (row + 1) * CUSTOM_EMOJI_COLUMNS,
      )
      .join(""),
  ).join("\n");
}
