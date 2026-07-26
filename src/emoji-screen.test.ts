import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCustomEmojiScreenSet,
  customEmojiScreenHtml,
  customEmojiScreenStickers,
  customEmojiSetName,
  CUSTOM_EMOJI_SLOT_FALLBACKS,
  hasCustomEmojiSlotMarkers,
} from "./emoji-screen.js";
import type { TelegramStickerSet } from "./types.js";

function emojiSet(count = 15): TelegramStickerSet {
  return {
    name: "doom_emoji_by_test_bot",
    title: "DOOM Emoji Screen",
    sticker_type: "custom_emoji",
    stickers: Array.from({ length: count }, (_, index) => ({
      file_id: `file-${index}`,
      file_unique_id: `unique-${index}`,
      custom_emoji_id: String(10_000 + index),
      type: "custom_emoji",
      width: 100,
      height: 100,
      is_animated: false,
      is_video: false,
      emoji: "🎮",
    })),
  };
}

test("customEmojiSetName derives a bot-owned sibling set", () => {
  assert.equal(
    customEmojiSetName("doom_by_test_bot", "test_bot"),
    "doom_emoji_by_test_bot",
  );
});

test("customEmojiSetName validates an explicit name", () => {
  assert.equal(
    customEmojiSetName(
      "doom_by_test_bot",
      "test_bot",
      "screen_by_test_bot",
    ),
    "screen_by_test_bot",
  );
  assert.throws(
    () => customEmojiSetName("doom_by_test_bot", "test_bot", "screen"),
    /must end with/,
  );
});

test("customEmojiScreenHtml creates a three by two emoji matrix", () => {
  const html = customEmojiScreenHtml(emojiSet());
  const rows = html.split("\n");
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.match(/<tg-emoji/g)?.length, 3);
  }
  assert.match(html, /emoji-id="10000"/);
  assert.match(html, /emoji-id="10005"/);
  assert.doesNotMatch(html, /emoji-id="10006"/);
});

test("customEmojiScreenStickers restores slot order from emoji markers", () => {
  const set = emojiSet();
  for (let slot = 0; slot < 6; slot += 1) {
    set.stickers[slot]!.emoji = CUSTOM_EMOJI_SLOT_FALLBACKS[slot];
  }
  set.stickers = [
    ...set.stickers.slice(0, 6).reverse(),
    ...set.stickers.slice(6),
  ];

  assert.deepEqual(
    customEmojiScreenStickers(set).map((sticker) => sticker.file_unique_id),
    Array.from({ length: 6 }, (_, slot) => `unique-${slot}`),
  );
  assert.equal(hasCustomEmojiSlotMarkers(set), true);
});

test("assertCustomEmojiScreenSet rejects the wrong slot count", () => {
  assert.throws(() => assertCustomEmojiScreenSet(emojiSet(5)), /at least 6/);
});
