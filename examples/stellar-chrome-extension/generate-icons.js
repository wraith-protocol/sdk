#!/usr/bin/env node
/**
 * Generates minimal solid-colour PNG icons for the extension.
 * Run once before loading unpacked: `node generate-icons.js`
 *
 * No dependencies — uses only Node built-ins and a hand-rolled PNG encoder
 * (IDAT with zlib deflate via node:zlib). The output is a valid 32-bit RGBA
 * PNG that Chrome accepts for all four required sizes.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'icons');
mkdirSync(OUT, { recursive: true });

// Wraith brand purple
const BG = [0x6d, 0x5e, 0xfc, 0xff];
// White "W" letterform pixels are drawn procedurally below
const FG = [0xff, 0xff, 0xff, 0xff];

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([typeBytes, data]);
  return Buffer.concat([u32be(data.length), payload, u32be(crc32(payload))]);
}

function makePng(size) {
  // Draw a simple "W" on a purple background
  const pixels = [];
  const mid = size / 2;
  const pad = Math.round(size * 0.15);

  for (let y = 0; y < size; y++) {
    // PNG filter byte (0 = None) before each row
    pixels.push(0);
    for (let x = 0; x < size; x++) {
      const nx = (x - mid) / (mid - pad);
      const ny = (y - mid) / (mid - pad);
      // Simple "W" shape: two V shapes side by side
      const inW =
        Math.abs(ny) < 0.9 &&
        ny > -0.85 &&
        (Math.abs(Math.abs(nx) - 0.5) < 0.12 ||
          (Math.abs(nx) < 0.55 && Math.abs(ny - 0.6 + Math.abs(nx) * 0.5) < 0.12));
      pixels.push(...(inW ? FG : BG));
    }
  }

  const raw = Buffer.from(pixels);
  const compressed = deflateSync(raw);

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  // 8-bit depth, colour type 6 = RGBA (4 bytes/pixel, matching the rows above).
  const ihdr6 = chunk(
    'IHDR',
    Buffer.concat([u32be(size), u32be(size), Buffer.from([8, 6, 0, 0, 0])]),
  );
  const idat = chunk('IDAT', compressed);
  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr6, idat, iend]);
}

for (const size of [16, 32, 48, 128]) {
  const path = join(OUT, `icon-${size}.png`);
  writeFileSync(path, makePng(size));
  console.log(`wrote ${path}`);
}
console.log('Icons generated.');
