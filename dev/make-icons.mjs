// Renders icons/icon{16,32,48,128}.png: a masonry of four tiles on X's dark
// background. No dependencies; run with `node dev/make-icons.mjs` after editing.
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

const BG = [0x0f, 0x14, 0x19]; // X's dark surface
const TILE = [0xe7, 0xe9, 0xea]; // X's light text
const BLUE = [0x1d, 0x9b, 0xf0]; // X's accent
// Tiles in unit coordinates: [x, y, w, h, color]. Two columns, staggered heights.
const GAP = 0.07;
const colW = (1 - 3 * GAP) / 2;
const l = GAP;
const r = GAP * 2 + colW;
const TILES = [
  [l, GAP, colW, 0.5, TILE],
  [l, GAP + 0.5 + GAP, colW, 1 - 3 * GAP - 0.5, BLUE],
  [r, GAP, colW, 0.34, TILE],
  [r, GAP + 0.34 + GAP, colW, 1 - 3 * GAP - 0.34, TILE],
];

const inRound = (px, py, x, y, w, h, rad) => {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.max(x + rad, Math.min(px, x + w - rad));
  const cy = Math.max(y + rad, Math.min(py, y + h - rad));
  return (px - cx) ** 2 + (py - cy) ** 2 <= rad * rad;
};

function render(size) {
  const SS = 4; // supersampling
  const n = size * SS;
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x * SS + sx + 0.5) / n;
          const v = (y * SS + sy + 0.5) / n;
          let c = null;
          if (inRound(u, v, 0, 0, 1, 1, 0.22)) {
            c = BG;
            for (const [tx, ty, tw, th, col] of TILES) if (inRound(u, v, tx, ty, tw, th, 0.06)) c = col;
          }
          if (c) { acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 255; }
        }
      }
      const i = (y * size + x) * 4;
      const cover = acc[3] / 255; // samples that hit the shape
      if (cover) { px[i] = acc[0] / cover; px[i + 1] = acc[1] / cover; px[i + 2] = acc[2] / cover; }
      px[i + 3] = acc[3] / (SS * SS);
    }
  }
  return px;
}

function png(size, rgba) {
  const chunk = (type, data) => {
    const t = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL("../icons/", import.meta.url), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(new URL(`../icons/icon${size}.png`, import.meta.url), png(size, render(size)));
}
console.log("wrote icons/icon{16,32,48,128}.png");
