import { parseArgs } from "node:util";

export interface CliOptions {
  command:
    | "init"
    | "status"
    | "single"
    | "batch"
    | "prepare-game"
    | "play";
  slot?: number;
  slotCount?: number;
  slots?: number[];
  count?: number;
  intervalMs?: number;
  slotDelayMs?: number;
  continueOnError: boolean;
}

export function parseSlotList(value: string): number[] {
  const slots = value.split(",").map((item) => Number(item.trim()));
  if (
    slots.length === 0 ||
    slots.some((slot) => !Number.isSafeInteger(slot) || slot < 0)
  ) {
    throw new Error("--slots must be a comma-separated list of zero-based positions");
  }
  return [...new Set(slots)];
}

function optionalNonNegativeInteger(
  value: string | undefined,
  flag: string,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

export function parseCli(argv: string[]): CliOptions {
  const command = argv[0];
  if (
    !["init", "status", "single", "batch", "prepare-game", "play"].includes(
      command || "",
    )
  ) {
    throw new Error(
      "Usage: npm run dev -- <init|status|single|batch|prepare-game|play> [options]",
    );
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      slot: { type: "string" },
      "slot-count": { type: "string" },
      slots: { type: "string" },
      count: { type: "string" },
      interval: { type: "string" },
      "slot-delay": { type: "string" },
      "continue-on-error": { type: "boolean", default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  const slots = values.slots ? parseSlotList(values.slots) : undefined;
  const slot = optionalNonNegativeInteger(values.slot, "--slot");
  const slotCount = optionalNonNegativeInteger(
    values["slot-count"],
    "--slot-count",
  );
  if (slotCount === 0) {
    throw new Error("--slot-count must be at least 1");
  }
  const count = optionalNonNegativeInteger(values.count, "--count");
  if (count === 0) {
    throw new Error("--count must be at least 1");
  }

  return {
    command: command as CliOptions["command"],
    slot,
    slotCount,
    slots,
    count,
    intervalMs: optionalNonNegativeInteger(values.interval, "--interval"),
    slotDelayMs: optionalNonNegativeInteger(
      values["slot-delay"],
      "--slot-delay",
    ),
    continueOnError: values["continue-on-error"] ?? false,
  };
}
