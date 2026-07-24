import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface LogRecord {
  timestamp: string;
  type: string;
  [key: string]: unknown;
}

export class JsonlLogger {
  constructor(private readonly filePath: string) {}

  async write(record: Omit<LogRecord, "timestamp">): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...record,
    });
    await appendFile(this.filePath, `${line}\n`, "utf8");
  }

  get path(): string {
    return this.filePath;
  }
}
