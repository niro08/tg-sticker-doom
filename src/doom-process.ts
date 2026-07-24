import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { CONTROL_DEFINITIONS } from "./controls.js";
import {
  buildDoomLaunchArgs,
  type GameAction,
  type GameEngine,
  type GameFrame,
} from "./game.js";

export interface DoomProcessOptions {
  executablePath: string;
  wadPath: string;
  framePath: string;
  workingDirectory?: string;
  startupTimeoutMs?: number;
  actionTimeoutMs?: number;
  onOutput?: (stream: "stdout" | "stderr", text: string) => void;
}

interface ParsedPpm {
  sequence: number;
  width: number;
  height: number;
  pixels: Buffer;
}

export function parsePpmFrame(bytes: Buffer): ParsedPpm {
  const headerEndMarker = Buffer.from("\n255\n");
  const markerIndex = bytes.indexOf(headerEndMarker);
  if (markerIndex < 0) {
    throw new Error("Invalid PPM frame: missing max-value header");
  }

  const headerEnd = markerIndex + headerEndMarker.length;
  const header = bytes.subarray(0, headerEnd).toString("ascii");
  const match = /^P6\n# sequence=(\d+)\n(\d+) (\d+)\n255\n$/.exec(header);
  if (!match) {
    throw new Error("Invalid PPM frame header");
  }

  const sequence = Number(match[1]);
  const width = Number(match[2]);
  const height = Number(match[3]);
  const pixels = bytes.subarray(headerEnd);
  const expectedBytes = width * height * 3;

  if (
    !Number.isSafeInteger(sequence) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    sequence < 1 ||
    width < 1 ||
    height < 1
  ) {
    throw new Error("Invalid PPM frame metadata");
  }
  if (pixels.length !== expectedBytes) {
    throw new Error(
      `Invalid PPM frame payload: got ${pixels.length}, expected ${expectedBytes}`,
    );
  }

  return { sequence, width, height, pixels: Buffer.from(pixels) };
}

export class DoomProcess implements GameEngine {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lastSequence = 0;
  private operation: Promise<unknown> | null = null;
  private processError: Error | null = null;

  constructor(private readonly options: DoomProcessOptions) {}

  async start(): Promise<void> {
    if (this.child) throw new Error("Doom process is already running");

    await access(this.options.executablePath);
    await access(this.options.wadPath);
    await mkdir(path.dirname(this.options.framePath), { recursive: true });
    await unlink(this.options.framePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });

    const workingDirectory =
      this.options.workingDirectory ?? path.dirname(this.options.framePath);
    await mkdir(workingDirectory, { recursive: true });

    const args = [
      ...buildDoomLaunchArgs({ wadPath: this.options.wadPath }),
      "-framefile",
      this.options.framePath,
    ];
    const child = spawn(this.options.executablePath, args, {
      cwd: workingDirectory,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.processError = null;

    child.stdout.on("data", (chunk: Buffer) => {
      this.options.onOutput?.("stdout", chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.options.onOutput?.("stderr", chunk.toString("utf8"));
    });
    child.once("error", (error) => {
      this.processError = error;
    });
    child.once("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      if (code !== 0 && signal !== "SIGTERM") {
        this.processError = new Error(
          `Doom process exited unexpectedly (code=${code}, signal=${signal})`,
        );
      }
    });

    await this.waitForFrame(
      0,
      this.options.startupTimeoutMs ?? 20_000,
    );
  }

  async apply(action: GameAction): Promise<GameFrame> {
    const definition = CONTROL_DEFINITIONS.find(
      (control) => control.action === action,
    );
    if (!definition) throw new Error(`Unsupported game action: ${action}`);

    return this.serialize(async () => {
      const child = this.requireChild();
      const before = this.lastSequence;
      child.stdin.write(
        `${action} ${definition.holdTicks} ${definition.captureTick ?? 0}\n`,
      );
      return this.waitForFrame(
        before,
        this.options.actionTimeoutMs ?? 10_000,
      );
    });
  }

  async capture(): Promise<GameFrame> {
    return this.serialize(async () => {
      const child = this.requireChild();
      const before = this.lastSequence;
      child.stdin.write("capture\n");
      return this.waitForFrame(
        before,
        this.options.actionTimeoutMs ?? 10_000,
      );
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;

    child.stdin.write("quit\n");
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGTERM");
        }
        resolve();
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    if (this.child === child) this.child = null;
  }

  private requireChild(): ChildProcessWithoutNullStreams {
    if (this.processError) throw this.processError;
    if (!this.child) throw new Error("Doom process is not running");
    return this.child;
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    if (this.operation) {
      throw new Error("Another Doom operation is already in progress");
    }
    const running = operation();
    this.operation = running;
    try {
      return await running;
    } finally {
      this.operation = null;
    }
  }

  private async waitForFrame(
    afterSequence: number,
    timeoutMs: number,
  ): Promise<GameFrame> {
    const deadline = Date.now() + timeoutMs;
    let lastReadError: Error | null = null;

    while (Date.now() < deadline) {
      if (this.processError) throw this.processError;

      try {
        const parsed = parsePpmFrame(await readFile(this.options.framePath));
        if (parsed.sequence > afterSequence) {
          this.lastSequence = parsed.sequence;
          return {
            pixels: parsed.pixels,
            width: parsed.width,
            height: parsed.height,
            channels: 3,
            sequence: parsed.sequence,
            capturedAt: new Date().toISOString(),
          };
        }
      } catch (error) {
        lastReadError = error instanceof Error ? error : new Error(String(error));
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(
      `Timed out waiting for Doom frame after sequence ${afterSequence}${
        lastReadError ? `: ${lastReadError.message}` : ""
      }`,
    );
  }
}
