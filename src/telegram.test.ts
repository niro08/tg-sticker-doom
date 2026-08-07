import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonlLogger } from "./logger.js";
import {
  rateLimitRetryDelayMs,
  TelegramApiError,
  TelegramClient,
} from "./telegram.js";

test("rateLimitRetryDelayMs honors retry_after", () => {
  const error = new TelegramApiError(
    "replaceStickerInSet",
    429,
    "Too Many Requests",
    { retry_after: 1_702 },
  );

  assert.equal(rateLimitRetryDelayMs(error, 1), 1_702_000);
});

test("rateLimitRetryDelayMs uses capped exponential fallback", () => {
  const error = new TelegramApiError(
    "replaceStickerInSet",
    429,
    "Too Many Requests",
  );

  assert.equal(rateLimitRetryDelayMs(error, 1), 1_000);
  assert.equal(rateLimitRetryDelayMs(error, 2), 2_000);
  assert.equal(rateLimitRetryDelayMs(error, 7), 60_000);
  assert.equal(rateLimitRetryDelayMs(error, 20), 60_000);
});

test("TelegramClient retries a 429 without rejecting the caller", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tg-doom-telegram-"));
  const logFile = path.join(directory, "api.jsonl");
  const waits: number[] = [];
  const requestBodies: string[] = [];
  let requests = 0;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_input, init) => {
    requests += 1;
    requestBodies.push(String(init?.body));
    if (requests === 1) {
      return new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          description: "Too Many Requests",
          parameters: { retry_after: 17 },
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        result: true,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const client = new TelegramClient(
      "test-token",
      new JsonlLogger(logFile),
      async (ms) => {
        waits.push(ms);
      },
    );
    const replaced = await client.replaceStickerInSetByFileId(
      1,
      "doom_by_test_bot",
      "old-sticker",
      {
        sticker: "new-sticker",
        format: "static",
        emoji_list: ["🎮"],
      },
    );

    assert.equal(replaced, true);
    assert.equal(requests, 2);
    assert.equal(requestBodies[0], requestBodies[1]);
    assert.deepEqual(waits, [17_000]);

    const records = (await readFile(logFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(records[0]?.type, "api_call");
    assert.equal(records[0]?.ok, false);
    assert.deepEqual(records[0]?.parameters, { retry_after: 17 });
    assert.equal(records[1]?.type, "api_rate_limit_retry");
    assert.equal(records[1]?.attempt, 1);
    assert.equal(records[1]?.delayMs, 17_000);
    assert.equal(records[2]?.type, "api_call");
    assert.equal(records[2]?.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
