import type {
  InputSticker,
  TelegramEnvelope,
  TelegramStickerSet,
  TelegramUser,
} from "./types.js";
import { JsonlLogger } from "./logger.js";

export class TelegramApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly errorCode: number | undefined,
    description: string,
    public readonly parameters?: TelegramEnvelope<never>["parameters"],
  ) {
    super(`${method}: ${errorCode ?? "unknown"} ${description}`);
    this.name = "TelegramApiError";
  }
}

export class TelegramClient {
  private readonly baseUrl: string;

  constructor(
    token: string,
    private readonly logger: JsonlLogger,
  ) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  private async request<T>(
    method: string,
    body?: Record<string, unknown> | FormData,
  ): Promise<T> {
    const startedAt = new Date();
    const startedMs = performance.now();
    let httpStatus: number | undefined;

    try {
      const isMultipart = body instanceof FormData;
      const response = await fetch(`${this.baseUrl}/${method}`, {
        method: "POST",
        headers: isMultipart ? undefined : { "content-type": "application/json" },
        body:
          body === undefined
            ? undefined
            : isMultipart
              ? body
              : JSON.stringify(body),
      });
      httpStatus = response.status;
      const raw = await response.text();
      let envelope: TelegramEnvelope<T>;

      try {
        envelope = JSON.parse(raw) as TelegramEnvelope<T>;
      } catch {
        throw new Error(
          `${method}: Telegram returned non-JSON response (${response.status})`,
        );
      }

      const durationMs = Math.round((performance.now() - startedMs) * 10) / 10;
      if (!response.ok || !envelope.ok || envelope.result === undefined) {
        await this.logger.write({
          type: "api_call",
          method,
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs,
          httpStatus,
          ok: false,
          errorCode: envelope.error_code,
          description: envelope.description,
          parameters: envelope.parameters,
        });
        throw new TelegramApiError(
          method,
          envelope.error_code,
          envelope.description || "Unknown Telegram API error",
          envelope.parameters,
        );
      }

      await this.logger.write({
        type: "api_call",
        method,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs,
        httpStatus,
        ok: true,
      });
      return envelope.result;
    } catch (error) {
      if (!(error instanceof TelegramApiError)) {
        await this.logger.write({
          type: "api_call",
          method,
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Math.round((performance.now() - startedMs) * 10) / 10,
          httpStatus,
          ok: false,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        });
      }
      throw error;
    }
  }

  getMe(): Promise<TelegramUser> {
    return this.request<TelegramUser>("getMe");
  }

  getStickerSet(name: string): Promise<TelegramStickerSet> {
    return this.request<TelegramStickerSet>("getStickerSet", { name });
  }

  createNewStickerSet(
    userId: number,
    name: string,
    title: string,
    stickers: Array<{ input: InputSticker; bytes: Buffer; filename: string }>,
  ): Promise<true> {
    const form = new FormData();
    form.set("user_id", String(userId));
    form.set("name", name);
    form.set("title", title);
    form.set(
      "stickers",
      JSON.stringify(stickers.map(({ input }) => input)),
    );

    for (const [index, sticker] of stickers.entries()) {
      form.set(
        `sticker_${index}`,
        new Blob([Uint8Array.from(sticker.bytes)], { type: "image/webp" }),
        sticker.filename,
      );
    }
    return this.request<true>("createNewStickerSet", form);
  }

  replaceStickerInSet(
    userId: number,
    name: string,
    oldSticker: string,
    input: InputSticker,
    bytes: Buffer,
    filename: string,
  ): Promise<true> {
    const form = new FormData();
    form.set("user_id", String(userId));
    form.set("name", name);
    form.set("old_sticker", oldSticker);
    form.set("sticker", JSON.stringify(input));
    form.set(
      "replacement",
      new Blob([Uint8Array.from(bytes)], { type: "image/webp" }),
      filename,
    );
    return this.request<true>("replaceStickerInSet", form);
  }
}
