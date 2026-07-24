import assert from "node:assert/strict";
import test from "node:test";
import { parseCli, parseSlotList } from "./args.js";

test("parseSlotList removes duplicates and preserves order", () => {
  assert.deepEqual(parseSlotList("2,0,2,4"), [2, 0, 4]);
});

test("parseCli parses a batch experiment", () => {
  assert.deepEqual(
    parseCli([
      "batch",
      "--slots",
      "0,1,2",
      "--count",
      "3",
      "--interval",
      "10000",
      "--slot-delay",
      "250",
    ]),
    {
      command: "batch",
      slot: undefined,
      slotCount: undefined,
      slots: [0, 1, 2],
      count: 3,
      intervalMs: 10000,
      slotDelayMs: 250,
      continueOnError: false,
    },
  );
});

test("parseCli rejects a zero count", () => {
  assert.throws(() => parseCli(["single", "--count", "0"]), /at least 1/);
});

test("parseCli parses init slot count and a single slot", () => {
  assert.equal(parseCli(["init", "--slot-count", "15"]).slotCount, 15);
  assert.equal(parseCli(["single", "--slot", "4"]).slot, 4);
});
