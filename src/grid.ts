import sharp from "sharp";
import type { RawGameFrame } from "./game.js";

export const GRID_COLUMNS = 5;
export const GRID_ROWS = 3;
export const GRID_SLOT_COUNT = GRID_COLUMNS * GRID_ROWS;
export const STICKER_SIZE = 512;

function validateFrame(frame: RawGameFrame): void {
  if (
    !Number.isSafeInteger(frame.width) ||
    !Number.isSafeInteger(frame.height) ||
    frame.width <= 0 ||
    frame.height <= 0
  ) {
    throw new Error("Frame dimensions must be positive integers");
  }

  const expectedBytes = frame.width * frame.height * frame.channels;
  if (frame.pixels.length !== expectedBytes) {
    throw new Error(
      `Frame has ${frame.pixels.length} bytes; expected ${expectedBytes}`,
    );
  }
}

export async function renderGameGrid(
  frame: RawGameFrame,
): Promise<Buffer[]> {
  validateFrame(frame);

  const canvasWidth = GRID_COLUMNS * STICKER_SIZE;
  const canvasHeight = GRID_ROWS * STICKER_SIZE;
  const canvas = await sharp(frame.pixels, {
    raw: {
      width: frame.width,
      height: frame.height,
      channels: frame.channels,
    },
  })
    .resize(canvasWidth, canvasHeight, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 1 },
      kernel: "nearest",
    })
    .png()
    .toBuffer();

  return Promise.all(
    Array.from({ length: GRID_SLOT_COUNT }, (_, slot) => {
      const column = slot % GRID_COLUMNS;
      const row = Math.floor(slot / GRID_COLUMNS);

      return sharp(canvas)
        .extract({
          left: column * STICKER_SIZE,
          top: row * STICKER_SIZE,
          width: STICKER_SIZE,
          height: STICKER_SIZE,
        })
        .webp({ quality: 90, effort: 4 })
        .toBuffer();
    }),
  );
}
