// Reproducible vector and raster versions of VoxHarbor's waveform mark.
// Uses Node built-ins only; no external image service or build-time dependency.
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
const root = new URL('../public/', import.meta.url);
const background = [23, 24, 24]; const accent = [236, 131, 81];
const bars = [[14, 20, 4, 24], [22, 14, 4, 36], [30, 18, 4, 28], [38, 10, 4, 44], [46, 23, 4, 18]];
const shapes = bars.map(([x, y, width, height]) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="2"/>`).join('');
await mkdir(new URL('icons/', root), { recursive: true });
await writeFile(new URL('favicon.svg', root), `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#171818"/><g fill="#ec8351">${shapes}</g></svg>\n`);
await writeFile(new URL('icons/safari-pinned-tab.svg', root), `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><g fill="#000">${shapes}</g></svg>\n`);
const table = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function chunk(type, data) {
  const tag = Buffer.from(type); let crc = 0xffffffff;
  for (const byte of Buffer.concat([tag, data])) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, tag, data, checksum]);
}
function inside(x, y, left, top, width, height, radius) {
  const dx = Math.max(left + radius - x, 0, x - (left + width - radius));
  const dy = Math.max(top + radius - y, 0, y - (top + height - radius));
  return dx * dx + dy * dy <= radius * radius;
}
function png(size, { rounded = false, scale = 1 } = {}) {
  const stride = size * 4 + 1; const pixels = Buffer.alloc(stride * size); const samples = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let red = 0, green = 0, blue = 0, alpha = 0;
    for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
      const px = (x + (sx + .5) / samples) * 64 / size; const py = (y + (sy + .5) / samples) * 64 / size;
      if (rounded && !inside(px, py, 0, 0, 64, 64, 14)) continue;
      const mx = (px - 32) / scale + 32; const my = (py - 32) / scale + 32;
      const color = bars.some(([left, top, width, height]) => inside(mx, my, left, top, width, height, 2)) ? accent : background;
      red += color[0]; green += color[1]; blue += color[2]; alpha++;
    }
    const offset = y * stride + 1 + x * 4;
    if (alpha) { pixels[offset] = Math.round(red / alpha); pixels[offset + 1] = Math.round(green / alpha); pixels[offset + 2] = Math.round(blue / alpha); pixels[offset + 3] = Math.round(alpha * 255 / (samples * samples)); }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
for (const [path, size, options] of [
  ['favicon-16x16.png', 16, { rounded: true }], ['favicon-32x32.png', 32, { rounded: true }],
  ['apple-touch-icon.png', 180, {}], ['icons/app-192.png', 192, {}], ['icons/app-512.png', 512, {}], ['icons/app-maskable-512.png', 512, { scale: .8 }],
]) await writeFile(new URL(path, root), png(size, options));
const sizes = [16, 32, 48]; const images = sizes.map(size => png(size, { rounded: true }));
const icoHeader = Buffer.alloc(6); icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(sizes.length, 4);
let offset = 6 + sizes.length * 16;
const directory = sizes.map((size, i) => { const entry = Buffer.alloc(16); entry[0] = size; entry[1] = size; entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(images[i].length, 8); entry.writeUInt32LE(offset, 12); offset += images[i].length; return entry; });
await writeFile(new URL('favicon.ico', root), Buffer.concat([icoHeader, ...directory, ...images]));
console.log('Generated VoxHarbor favicons, touch icons, app icons and pinned-tab mark.');
