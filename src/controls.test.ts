import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  CONTROL_DEFINITIONS,
  renderControlSticker,
  resolveControlAction,
} from "./controls.js";

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
