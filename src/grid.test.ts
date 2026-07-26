import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  CUSTOM_EMOJI_SIZE,
  CUSTOM_EMOJI_SLOT_COUNT,
  GRID_SLOT_COUNT,
  renderCustomEmojiGrid,
  renderGameGrid,
  STICKER_SIZE,
} from "./grid.js";

test("renderCustomEmojiGrid returns six 100x100 WEBP tiles", async () => {
  const tiles = await renderCustomEmojiGrid({
    pixels: Buffer.alloc(320 * 200 * 3, 96),
    width: 320,
    height: 200,
    channels: 3,
  });

  assert.equal(tiles.length, CUSTOM_EMOJI_SLOT_COUNT);
  for (const tile of tiles) {
    const metadata = await sharp(tile).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, CUSTOM_EMOJI_SIZE);
    assert.equal(metadata.height, CUSTOM_EMOJI_SIZE);
  }
});

test("renderGameGrid returns fifteen ordered 512x512 WEBP tiles", async () => {
  const width = 320;
  const height = 200;
  const pixels = Buffer.alloc(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      pixels[offset] = Math.floor((x / width) * 255);
      pixels[offset + 1] = Math.floor((y / height) * 255);
      pixels[offset + 2] = 64;
    }
  }

  const tiles = await renderGameGrid({
    pixels,
    width,
    height,
    channels: 3,
  });

  assert.equal(tiles.length, GRID_SLOT_COUNT);
  for (const tile of tiles) {
    const metadata = await sharp(tile).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, STICKER_SIZE);
    assert.equal(metadata.height, STICKER_SIZE);
  }

  const first = await sharp(tiles[0]).raw().toBuffer();
  const last = await sharp(tiles[tiles.length - 1]).raw().toBuffer();
  const centerOffset = (256 * STICKER_SIZE + 256) * 3;
  assert.ok((first[centerOffset] ?? 255) < (last[centerOffset] ?? 0));
  assert.ok((first[centerOffset + 1] ?? 255) < (last[centerOffset + 1] ?? 0));
});

test("renderGameGrid rejects a malformed raw frame", async () => {
  await assert.rejects(
    renderGameGrid({
      pixels: Buffer.alloc(4),
      width: 10,
      height: 10,
      channels: 3,
    }),
    /expected 300/,
  );
});
