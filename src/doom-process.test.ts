import assert from "node:assert/strict";
import test from "node:test";
import { parsePpmFrame } from "./doom-process.js";

function ppm(sequence: number, width: number, height: number): Buffer {
  const header = Buffer.from(
    `P6\n# sequence=${sequence}\n${width} ${height}\n255\n`,
    "ascii",
  );
  return Buffer.concat([header, Buffer.alloc(width * height * 3, 42)]);
}

test("parsePpmFrame reads the headless bridge format", () => {
  const frame = parsePpmFrame(ppm(7, 4, 3));

  assert.equal(frame.sequence, 7);
  assert.equal(frame.width, 4);
  assert.equal(frame.height, 3);
  assert.equal(frame.pixels.length, 36);
  assert.equal(frame.pixels[0], 42);
});

test("parsePpmFrame rejects a truncated payload", () => {
  const bytes = ppm(1, 4, 3).subarray(0, -1);
  assert.throws(() => parsePpmFrame(bytes), /got 35, expected 36/);
});
