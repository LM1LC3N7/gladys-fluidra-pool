// Draws cover.png (800x534) for the store: plain Node, no dependency.
// A pool seen from above (tiles, ladder, water waves), a pH drop and a
// thermometer on a blue gradient (no brand logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = x / W;
    const s = y / H;
    set(x, y, [10 + 30 * t, 60 + 50 * s, 120 + 60 * t]);
  }
}
const white = [255, 255, 255];
const tile = [226, 236, 242];
const water = [40, 170, 220];
const deep = [20, 120, 190];
const steel = [200, 210, 220];
const warm = [255, 150, 60];
const green = [90, 200, 140];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const line = (x0, y0, x1, y1, width, color, alpha = 1) => {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 || 1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};

// The pool: a tiled border, the water, waves.
box(90, 110, 560, 430, 36, tile);
box(115, 135, 535, 405, 26, water);
for (let y = 135; y < 405; y += 1) {
  for (let x = 115; x < 535; x += 1) {
    const d = (y - 135) / 270;
    set(x, y, deep, 0.45 * d);
  }
}
for (const [y0, alpha] of [
  [190, 0.8],
  [260, 0.65],
  [330, 0.5],
]) {
  for (let x = 150; x < 500; x += 1) {
    disc(x, y0 + 8 * Math.sin((x / 70) * Math.PI), 3, white, alpha);
  }
}
// The ladder.
line(470, 95, 470, 175, 8, steel);
line(510, 95, 510, 175, 8, steel);
for (const y of [125, 150]) line(470, y, 510, y, 6, steel);

// A water drop, top right.
const dropY = 225;
const dropR = 42;
for (let y = dropY - 2.3 * dropR; y < dropY; y += 1) {
  const t = (y - (dropY - 2.3 * dropR)) / (1.95 * dropR);
  const half = Math.min(1, t) * dropR * 0.94;
  for (let x = -half; x <= half; x += 1) set(660 + x, y, green);
}
disc(660, dropY, dropR, green);
disc(645, dropY + 8, 9, white, 0.6);
// A thermometer, bottom right.
box(646, 315, 674, 430, 14, white);
disc(660, 440, 24, white);
disc(660, 440, 15, warm);
box(654, 350, 666, 442, 6, warm);

// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
