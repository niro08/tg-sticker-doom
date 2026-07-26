import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  CONTROL_DEFINITIONS,
  FIRST_CONTROL_SLOT,
  LEGACY_FIRST_CONTROL_SLOT,
  renderControlSticker,
  resolveControlAction,
} from "./controls.js";

test("the compact pack keeps only five controls", () => {
  assert.equal(FIRST_CONTROL_SLOT, 0);
  assert.equal(LEGACY_FIRST_CONTROL_SLOT, 15);
  assert.deepEqual(
    CONTROL_DEFINITIONS.map((control) => control.slot),
    [0, 1, 2, 3, 4],
  );
});

test("control timings make movement visible and capture fire while held", () => {
  const controls = Object.fromEntries(
    CONTROL_DEFINITIONS.map((control) => [control.action, control]),
  );

  assert.equal(controls.turn_left?.holdTicks, 14);
  assert.equal(controls.turn_right?.holdTicks, 14);
  assert.equal(controls.forward?.holdTicks, 20);
  assert.equal(controls.fire?.holdTicks, 8);
  assert.equal(controls.fire?.captureTick, 8);
  assert.equal(controls.use?.holdTicks, 2);
});

test("resolveControlAction prefers the stable file_unique_id", () => {
  const controls = CONTROL_DEFINITIONS.map((control) => ({
    ...control,
    fileUniqueId: `control-${control.action}`,
  }));

  assert.equal(
    resolveControlAction(
      { file_unique_id: "control-fire", emoji: "⬅️" },
      controls,
    ),
    "fire",
  );
});

test("resolveControlAction uses an unambiguous emoji as fallback", () => {
  assert.equal(
    resolveControlAction(
      { file_unique_id: "unknown", emoji: "🚪" },
      CONTROL_DEFINITIONS,
    ),
    "use",
  );
});

test("renderControlSticker creates a static Telegram-sized WEBP", async () => {
  const bytes = await renderControlSticker(CONTROL_DEFINITIONS[0]!);
  const metadata = await sharp(bytes).metadata();

  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
  assert.ok(bytes.length < 512 * 1024);
});
