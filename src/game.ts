export const DOOM_FRAME_WIDTH = 320;
export const DOOM_FRAME_HEIGHT = 200;

export type GameAction =
  | "turn_left"
  | "turn_right"
  | "forward"
  | "fire"
  | "use";

export interface RawGameFrame {
  pixels: Buffer;
  width: number;
  height: number;
  channels: 3 | 4;
}

export interface GameFrame extends RawGameFrame {
  sequence: number;
  capturedAt: string;
}

export interface GameEngine {
  start(): Promise<void>;
  apply(action: GameAction): Promise<GameFrame>;
  capture(): Promise<GameFrame>;
  stop(): Promise<void>;
}

export interface DoomLaunchOptions {
  wadPath: string;
  episode?: number;
  map?: number;
  skill?: 1 | 2 | 3 | 4 | 5;
  extraArgs?: string[];
}

export function buildDoomLaunchArgs(options: DoomLaunchOptions): string[] {
  const episode = options.episode ?? 1;
  const map = options.map ?? 1;
  const skill = options.skill ?? 3;

  if (!options.wadPath.trim()) {
    throw new Error("wadPath must not be empty");
  }
  if (!Number.isSafeInteger(episode) || episode < 1) {
    throw new Error("episode must be a positive integer");
  }
  if (!Number.isSafeInteger(map) || map < 1) {
    throw new Error("map must be a positive integer");
  }

  return [
    "-iwad",
    options.wadPath,
    "-warp",
    String(episode),
    String(map),
    "-skill",
    String(skill),
    "-nosound",
    ...(options.extraArgs ?? []),
  ];
}
