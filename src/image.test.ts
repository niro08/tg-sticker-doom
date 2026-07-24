import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { renderFrame } from "./image.js";

test("renderFrame produces a valid 512x512 WEBP sticker", async () => {
  const bytes = await renderFrame(12, 3);
  const metadata = await sharp(bytes).metadata();

  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
  assert.ok(bytes.length < 512 * 1024);
});
