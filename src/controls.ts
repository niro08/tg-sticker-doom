import sharp from "sharp";
import type { GameAction } from "./game.js";
import type { TelegramSticker } from "./types.js";

export const FIRST_CONTROL_SLOT = 15;

export interface ControlDefinition {
  action: GameAction;
  slot: number;
  emoji: string;
  label: string;
  holdTicks: number;
  captureTick?: number;
}

export interface BoundControl extends ControlDefinition {
  fileUniqueId?: string;
}

export const CONTROL_DEFINITIONS: readonly ControlDefinition[] = [
  {
    action: "turn_left",
    slot: FIRST_CONTROL_SLOT,
    emoji: "⬅️",
    label: "LEFT",
    holdTicks: 14,
  },
  {
    action: "turn_right",
    slot: FIRST_CONTROL_SLOT + 1,
    emoji: "➡️",
    label: "RIGHT",
    holdTicks: 14,
  },
  {
    action: "forward",
    slot: FIRST_CONTROL_SLOT + 2,
    emoji: "⬆️",
    label: "GO",
    holdTicks: 20,
  },
  {
    action: "fire",
    slot: FIRST_CONTROL_SLOT + 3,
    emoji: "🔥",
    label: "FIRE",
    holdTicks: 8,
    captureTick: 8,
  },
  {
    action: "use",
    slot: FIRST_CONTROL_SLOT + 4,
    emoji: "🚪",
    label: "USE",
    holdTicks: 2,
  },
];

export function resolveControlAction(
  sticker: Pick<TelegramSticker, "file_unique_id" | "emoji">,
  controls: readonly BoundControl[],
): GameAction | null {
  const exact = controls.find(
    (control) =>
      control.fileUniqueId &&
      control.fileUniqueId === sticker.file_unique_id,
  );
  if (exact) return exact.action;

  const emojiMatches = controls.filter(
    (control) => control.emoji === sticker.emoji,
  );
  return emojiMatches.length === 1 ? emojiMatches[0]?.action ?? null : null;
}

export async function renderControlSticker(
  definition: ControlDefinition,
): Promise<Buffer> {
  const svg = `
    <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" rx="72" fill="#181818"/>
      <rect x="18" y="18" width="476" height="476" rx="58"
            fill="none" stroke="#d12c20" stroke-width="12"/>
      <text x="256" y="292" text-anchor="middle"
            font-family="Arial, Helvetica, sans-serif" font-size="86"
            font-weight="900" fill="#f1e9d2">${definition.label}</text>
    </svg>`;

  return sharp(Buffer.from(svg))
    .webp({ quality: 90, effort: 4 })
    .toBuffer();
}
