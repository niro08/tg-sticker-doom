import sharp from "sharp";
import type { RawGameFrame } from "./game.js";

export const GRID_COLUMNS = 5;
export const GRID_ROWS = 3;
export const GRID_SLOT_COUNT = GRID_COLUMNS * GRID_ROWS;
export const STICKER_SIZE = 512;
export const CUSTOM_EMOJI_SIZE = 100;
export const CUSTOM_EMOJI_COLUMNS = 3;
export const CUSTOM_EMOJI_ROWS = 2;
export const CUSTOM_EMOJI_SLOT_COUNT =
  CUSTOM_EMOJI_COLUMNS * CUSTOM_EMOJI_ROWS;

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

async function renderGrid(
  frame: RawGameFrame,
  tileSize: number,
  columns: number,
  rows: number,
): Promise<Buffer[]> {
  validateFrame(frame);

  const canvasWidth = columns * tileSize;
  const canvasHeight = rows * tileSize;
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
    Array.from({ length: columns * rows }, (_, slot) => {
      const column = slot % columns;
      const row = Math.floor(slot / columns);

      return sharp(canvas)
        .extract({
          left: column * tileSize,
          top: row * tileSize,
          width: tileSize,
          height: tileSize,
        })
        .webp({ quality: 90, effort: 4 })
        .toBuffer();
    }),
  );
}

export function renderGameGrid(frame: RawGameFrame): Promise<Buffer[]> {
  return renderGrid(frame, STICKER_SIZE, GRID_COLUMNS, GRID_ROWS);
}

export function renderCustomEmojiGrid(
  frame: RawGameFrame,
): Promise<Buffer[]> {
  return renderGrid(
    frame,
    CUSTOM_EMOJI_SIZE,
    CUSTOM_EMOJI_COLUMNS,
    CUSTOM_EMOJI_ROWS,
  );
}
