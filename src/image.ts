import sharp from "sharp";

const SIZE = 512;

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;",
    };
    return entities[character] ?? character;
  });
}

export async function renderFrame(
  frame: number,
  slot: number,
): Promise<Buffer> {
  const frameLabel = `FRAME ${String(frame).padStart(3, "0")}`;
  const slotLabel = `SLOT ${String(slot).padStart(2, "0")}`;
  const hue = (frame * 47 + slot * 83) % 360;
  const svg = `
    <svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" rx="28" fill="hsl(${hue}, 78%, 42%)"/>
      <rect x="18" y="18" width="476" height="476" rx="20"
            fill="none" stroke="rgba(255,255,255,.68)" stroke-width="8"/>
      <text x="256" y="230" text-anchor="middle"
            font-family="Arial, Helvetica, sans-serif" font-size="66"
            font-weight="800" fill="white">${escapeXml(frameLabel)}</text>
      <text x="256" y="310" text-anchor="middle"
            font-family="Arial, Helvetica, sans-serif" font-size="40"
            font-weight="600" fill="rgba(255,255,255,.82)">${escapeXml(slotLabel)}</text>
    </svg>`;

  return sharp(Buffer.from(svg))
    .webp({ quality: 90, effort: 4 })
    .toBuffer();
}
