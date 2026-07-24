import path from "node:path";
import { DoomProcess } from "./doom-process.js";
import { renderGameGrid } from "./grid.js";

async function main(): Promise<void> {
  const wadPath = process.env.DOOM_WAD_PATH?.trim();
  if (!wadPath) {
    throw new Error("DOOM_WAD_PATH is required");
  }

  const engine = new DoomProcess({
    executablePath: path.resolve(
      process.env.DOOM_EXECUTABLE || "./native/bin/doomgeneric-headless",
    ),
    wadPath: path.resolve(wadPath),
    framePath: path.resolve("./data/smoke-frame.ppm"),
    workingDirectory: path.resolve("./data/smoke-runtime"),
    startupTimeoutMs: 10_000,
    onOutput: (stream, text) => {
      if (stream === "stderr") process.stderr.write(text);
    },
  });

  try {
    await engine.start();
    const initial = await engine.capture();
    const moved = await engine.apply("forward");
    const fired = await engine.apply("fire");
    const tiles = await renderGameGrid(fired);

    console.log(
      JSON.stringify({
        initialSequence: initial.sequence,
        movedSequence: moved.sequence,
        firedSequence: fired.sequence,
        frame: `${fired.width}x${fired.height}`,
        tiles: tiles.length,
        tileBytes: tiles.map((tile) => tile.length),
      }),
    );
  } finally {
    await engine.stop();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
