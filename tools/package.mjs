#!/usr/bin/env node
/**
 * Package the extension into a Chrome Web Store upload.
 *
 * The store wants a zip and the sandbox has no zip utility or npm access, so
 * this writes the archive directly: deflate via Node's zlib, plus the local
 * headers, central directory and end-of-central-directory record that make a
 * valid ZIP. Timestamps are fixed so two builds of the same source produce
 * byte-identical output.
 *
 *   node tools/package.mjs
 */

import { deflateRawSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'extension');
const OUT_DIR = join(ROOT, 'dist');

/** Fixed DOS timestamp (1 Jan 2026, 00:00) for reproducible archives. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

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
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const dirEntry = Buffer.alloc(46);
    dirEntry.writeUInt32LE(0x02014b50, 0);
    dirEntry.writeUInt16LE(20, 4); // version made by
    dirEntry.writeUInt16LE(20, 6); // version needed
    dirEntry.writeUInt16LE(0, 8);
    dirEntry.writeUInt16LE(8, 10);
    dirEntry.writeUInt16LE(DOS_TIME, 12);
    dirEntry.writeUInt16LE(DOS_DATE, 14);
    dirEntry.writeUInt32LE(crc, 16);
    dirEntry.writeUInt32LE(compressed.length, 20);
    dirEntry.writeUInt32LE(entry.data.length, 24);
    dirEntry.writeUInt16LE(name.length, 28);
    dirEntry.writeUInt16LE(0, 30);
    dirEntry.writeUInt16LE(0, 32);
    dirEntry.writeUInt16LE(0, 34);
    dirEntry.writeUInt16LE(0, 36);
    dirEntry.writeUInt32LE(0, 38);
    dirEntry.writeUInt32LE(offset, 42);
    central.push(dirEntry, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, end]);
}

const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
const files = walk(EXT).filter((file) => !file.endsWith('.DS_Store') && !file.endsWith('preview.html'));

const entries = files.map((file) => ({
  // ZIP paths always use forward slashes, whatever the host OS does.
  name: relative(EXT, file).split(sep).join('/'),
  data: readFileSync(file),
}));

mkdirSync(OUT_DIR, { recursive: true });
const archive = zip(entries);
const outPath = join(OUT_DIR, `billed-v${manifest.version}.zip`);
writeFileSync(outPath, archive);

console.log(`Packaged ${entries.length} files → ${relative(ROOT, outPath)} (${(archive.length / 1024).toFixed(1)} KB)`);
console.log('\nContents:');
for (const entry of entries) console.log(`  ${entry.name}`);
