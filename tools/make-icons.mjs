#!/usr/bin/env node
/**
 * Icon generator.
 *
 * The sandbox has no image libraries and no network, so this writes valid PNGs
 * directly: a minimal RGBA encoder on top of Node's built-in zlib, with the mark
 * rendered at 4x and box-downsampled for clean antialiased edges.
 *
 *   node tools/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- brand

const BRAND = {
  bg: [11, 18, 32, 255], // #0B1220 deep navy
  bgTop: [23, 33, 54, 255], // subtle vertical lift
  barDim: [100, 116, 139, 255], // #64748B slate
  barMid: [148, 163, 184, 255], // #94A3B8
  barLive: [34, 197, 94, 255], // #22C55E — the recovered hour
};

/**
 * Three ascending bars: two grey (the hours you remembered) and one green
 * (the hours you didn't). Reads clearly even at 16px.
 */
const BARS = [
  { x: 0.20, w: 0.145, h: 0.26, color: BRAND.barDim },
  { x: 0.4275, w: 0.145, h: 0.42, color: BRAND.barMid },
  { x: 0.655, w: 0.145, h: 0.62, color: BRAND.barLive },
];
const BASELINE = 0.80;

// ---------------------------------------------------------------- png encoder

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** @param {Uint8Array} rgba length = width * height * 4 */
function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- geometry

function insideRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const radius = Math.min(r, w / 2, h / 2);
  const cx = Math.min(Math.max(px, x + radius), x + w - radius);
  const cy = Math.min(Math.max(py, y + radius), y + h - radius);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Render the mark at `size`, supersampled then averaged down. */
function renderMark(size, { rounded = true, padding = 0 } = {}) {
  const scale = 4;
  const n = size * scale;
  const hi = new Uint8Array(n * n * 4);

  const boxX = padding * n;
  const boxY = padding * n;
  const boxW = n - 2 * boxX;
  const boxH = n - 2 * boxY;
  const cornerRadius = rounded ? boxW * 0.22 : 0;

  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const i = (y * n + x) * 4;
      if (!insideRoundedRect(x + 0.5, y + 0.5, boxX, boxY, boxW, boxH, cornerRadius)) continue;

      // Background with a gentle top-to-bottom gradient.
      const t = (y - boxY) / boxH;
      hi[i] = lerp(BRAND.bgTop[0], BRAND.bg[0], t);
      hi[i + 1] = lerp(BRAND.bgTop[1], BRAND.bg[1], t);
      hi[i + 2] = lerp(BRAND.bgTop[2], BRAND.bg[2], t);
      hi[i + 3] = 255;

      // Bars, in local box coordinates.
      const ux = (x + 0.5 - boxX) / boxW;
      const uy = (y + 0.5 - boxY) / boxH;
      for (const bar of BARS) {
        const top = BASELINE - bar.h;
        if (insideRoundedRect(ux, uy, bar.x, top, bar.w, bar.h, bar.w * 0.42)) {
          hi[i] = bar.color[0];
          hi[i + 1] = bar.color[1];
          hi[i + 2] = bar.color[2];
          hi[i + 3] = 255;
          break;
        }
      }
    }
  }

  // Box-downsample by `scale`.
  const out = new Uint8Array(size * size * 4);
  const samples = scale * scale;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const i = ((y * scale + dy) * n + x * scale + dx) * 4;
          const alpha = hi[i + 3] / 255;
          r += hi[i] * alpha;
          g += hi[i + 1] * alpha;
          b += hi[i + 2] * alpha;
          a += hi[i + 3];
        }
      }
      const o = (y * size + x) * 4;
      const alphaSum = a / 255;
      out[o] = alphaSum ? Math.round(r / alphaSum) : 0;
      out[o + 1] = alphaSum ? Math.round(g / alphaSum) : 0;
      out[o + 2] = alphaSum ? Math.round(b / alphaSum) : 0;
      out[o + 3] = Math.round(a / samples);
    }
  }
  return out;
}

/** The mark centred on a solid brand field — used for the store promo tile. */
function renderTile(width, height) {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const y = Math.floor(i / width);
    const t = y / height;
    out[i * 4] = lerp(BRAND.bgTop[0], BRAND.bg[0], t);
    out[i * 4 + 1] = lerp(BRAND.bgTop[1], BRAND.bg[1], t);
    out[i * 4 + 2] = lerp(BRAND.bgTop[2], BRAND.bg[2], t);
    out[i * 4 + 3] = 255;
  }

  const markSize = Math.round(Math.min(width, height) * 0.62);
  const mark = renderMark(markSize, { rounded: true });
  const offsetX = Math.round((width - markSize) / 2);
  const offsetY = Math.round((height - markSize) / 2);

  for (let y = 0; y < markSize; y += 1) {
    for (let x = 0; x < markSize; x += 1) {
      const src = (y * markSize + x) * 4;
      const alpha = mark[src + 3] / 255;
      if (!alpha) continue;
      const dst = ((y + offsetY) * width + x + offsetX) * 4;
      for (let c = 0; c < 3; c += 1) {
        out[dst + c] = Math.round(out[dst + c] * (1 - alpha) + mark[src + c] * alpha);
      }
      out[dst + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------- outputs

function write(path, buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
  console.log(`  ${path.replace(`${ROOT}/`, '')}  (${buffer.length.toLocaleString()} bytes)`);
}

console.log('Generating Billed icons…');

for (const size of [16, 32, 48, 128, 256]) {
  write(join(ROOT, 'extension/assets/icons', `icon-${size}.png`), encodePNG(size, size, renderMark(size)));
}

// Landing page assets.
write(join(ROOT, 'web/assets/icon-512.png'), encodePNG(512, 512, renderMark(512)));
write(join(ROOT, 'web/assets/favicon-32.png'), encodePNG(32, 32, renderMark(32)));

// Chrome Web Store promotional tile (440x280).
write(join(ROOT, 'store/promo-tile-440x280.png'), encodePNG(440, 280, renderTile(440, 280)));
// Marquee tile (1400x560), optional but it makes a listing look finished.
write(join(ROOT, 'store/promo-marquee-1400x560.png'), encodePNG(1400, 560, renderTile(1400, 560)));

console.log('Done.');
