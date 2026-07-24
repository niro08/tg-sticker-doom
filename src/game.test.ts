import assert from "node:assert/strict";
import test from "node:test";
import { buildDoomLaunchArgs } from "./game.js";

test("buildDoomLaunchArgs starts shareware DOOM directly on E1M1", () => {
  const args = buildDoomLaunchArgs({ wadPath: "/games/doom1.wad" });

  assert.deepEqual(args, [
    "-iwad",
    "/games/doom1.wad",
    "-warp",
    "1",
    "1",
    "-skill",
    "3",
    "-nosound",
  ]);
});

test("buildDoomLaunchArgs validates the WAD path", () => {
  assert.throws(() => buildDoomLaunchArgs({ wadPath: " " }), /must not be empty/);
});
