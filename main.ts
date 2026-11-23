// Meme Sprint 3: AI Agent Goes Rogue — entry program.
//
// The program renders the meme: it loads the shipped base scene
// (assets/base.ppm, a 768x768 RGB picture of a proud little robot giving a
// thumbs-up in front of a burning server room while its human sleeps at a
// desk), stamps bold outlined meme text on it with an embedded 5x7 bitmap
// font, and writes a valid PNG to /output/entry.png (768x768, well under
// the 1 MiB gate). Pure Node builtins only: node:fs, node:zlib, node:path,
// node:url. No network, no system fonts, no randomness, no lookahead — the
// output is a deterministic function of the shipped asset.
//
// The joke, in one glance: the human said "just fix the typo", the agent
// reports "task complete" while the whole server room burns behind it.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 5x7 bitmap font: each glyph is 7 rows of 5 bits ("1" = ink).
const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ":": ["00000", "00100", "00000", "00000", "00000", "00100", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  '"': ["01010", "01010", "00000", "00000", "00000", "00000", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "+": ["00000", "00100", "00100", "01110", "00100", "00100", "00000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
};

const GLYPH_W = 5;
const GLYPH_H = 7;
const GLYPH_STEP = 6; // 5 px glyph + 1 px gap

// --- P6 PPM reading (binary RGB, maxval 255) ---
function readPpm(path: string): { width: number; height: number; data: Buffer } {
  const buf = readFileSync(path);
  let i = 0;
  const token = (): string => {
    for (;;) {
      while (buf[i] === 0x23) { while (buf[i] !== 0x0a) i++; i++; } // '#' comment
      if (buf[i] === 0x20 || buf[i] === 0x0a || buf[i] === 0x0d || buf[i] === 0x09) { i++; continue; }
      break;
    }
    const s = i;
    while (buf[i] > 0x20 && buf[i] !== 0x23) i++;
    return buf.toString("ascii", s, i);
  };
  if (token() !== "P6") throw new Error("base asset is not a P6 PPM");
  const width = parseInt(token(), 10);
  const height = parseInt(token(), 10);
  if (parseInt(token(), 10) !== 255) throw new Error("base PPM maxval is not 255");
  i++; // exactly one whitespace byte after maxval
  const data = Buffer.from(buf.subarray(i, i + width * height * 3));
  if (data.length !== width * height * 3) throw new Error("base PPM raster is truncated");
  return { width, height, data };
}

// --- PNG writing (8-bit RGB, per-row best filter, zlib level 9) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const bpp = 3;
  const stride = width * bpp;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rgb.subarray((y - 1) * stride, y * stride) : null;
    let bestType = 0;
    let bestScore = Infinity;
    let best: Buffer | null = null;
    for (let type = 0; type <= 4; type++) {
      const f = Buffer.alloc(stride);
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? row[x - bpp] : 0;
        const b = prev ? prev[x] : 0;
        const c = prev && x >= bpp ? prev[x - bpp] : 0;
        let v = row[x];
        if (type === 1) v = row[x] - a;
        else if (type === 2) v = row[x] - b;
        else if (type === 3) v = row[x] - ((a + b) >> 1);
        else if (type === 4) v = row[x] - paeth(a, b, c);
        f[x] = v & 0xff;
      }
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const s = f[x];
        score += s < 128 ? s : 256 - s;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        best = f;
      }
    }
    raw[y * (stride + 1)] = bestType;
    best!.copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- drawing helpers (RGB buffer, row-major, 3 bytes per pixel) ---
function fillRect(
  img: Buffer, width: number, height: number,
  x: number, y: number, w: number, h: number,
  r: number, g: number, b: number,
): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(width, x + w);
  const y1 = Math.min(height, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const o = (yy * width + xx) * 3;
      img[o] = r;
      img[o + 1] = g;
      img[o + 2] = b;
    }
  }
}

// Darken a band toward black so white text stays readable over flames.
function darkenBand(
  img: Buffer, width: number, height: number,
  x: number, y: number, w: number, h: number, amount: number,
): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(width, x + w);
  const y1 = Math.min(height, y + h);
  const keep = 1 - amount;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const o = (yy * width + xx) * 3;
      img[o] = Math.round(img[o] * keep);
      img[o + 1] = Math.round(img[o + 1] * keep);
      img[o + 2] = Math.round(img[o + 2] * keep);
    }
  }
}

function textWidth(text: string, scale: number): number {
  return text.length * GLYPH_STEP * scale - scale;
}

// Draw one centered line: white glyphs with a 1px black outline, so the
// text pops against both the dark smoke up top and the floor below.
function drawText(
  img: Buffer, width: number, height: number,
  text: string, cx: number, y: number, scale: number,
): void {
  const w = textWidth(text, scale);
  const x0 = Math.round(cx - w / 2);
  const up = text.toUpperCase();
  for (let ci = 0; ci < up.length; ci++) {
    const glyph = FONT[up[ci]] ?? FONT["?"];
    const gx = x0 + ci * GLYPH_STEP * scale;
    for (let r = 0; r < GLYPH_H; r++) {
      for (let c = 0; c < GLYPH_W; c++) {
        if (glyph[r][c] !== "1") continue;
        // Black outline: a slightly larger block behind the white block.
        fillRect(img, width, height, gx + c * scale - 1, y + r * scale - 1, scale + 2, scale + 2, 0, 0, 0);
      }
    }
    for (let r = 0; r < GLYPH_H; r++) {
      for (let c = 0; c < GLYPH_W; c++) {
        if (glyph[r][c] !== "1") continue;
        fillRect(img, width, height, gx + c * scale, y + r * scale, scale, scale, 255, 255, 255);
      }
    }
  }
}

// --- the meme ---
const TOP_LINE = "ME: JUST FIX THE TYPO";
const BOTTOM_LINE = "AGENT: TASK COMPLETE";

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const { width, height, data } = readPpm(join(here, "assets", "base.ppm"));
  const scale = 5; // cap height 35 px; both lines fit with room at the edges
  const textH = GLYPH_H * scale;
  const pad = 10;

  // Top line over the smoke, bottom line over the floor.
  darkenBand(data, width, height, 0, 14, width, textH + pad * 2, 0.55);
  drawText(data, width, height, TOP_LINE, width / 2, 14 + pad, scale);
  const by = height - 14 - pad - textH;
  darkenBand(data, width, height, 0, by - pad, width, textH + pad * 2, 0.55);
  drawText(data, width, height, BOTTOM_LINE, width / 2, by, scale);

  const png = encodePng(width, height, data);
  const outDir = process.env.OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "entry.png"), png);
  console.log(`wrote entry.png ${width}x${height} ${png.length} bytes`);
}

main();
