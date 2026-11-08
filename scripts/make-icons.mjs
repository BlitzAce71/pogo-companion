// Rasterises the app icon to PNG (192/512 + maskable) without external deps.
import fs from 'node:fs';
import zlib from 'node:zlib';

function png(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const S = size / 512;
  const c = 256 * S;
  const set = (i, [r, g, b]) => { px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    // supersample 3x3 for antialiasing
    let acc = [0, 0, 0], n = 0;
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
      const X = (x + (sx + 0.5) / 3) / S, Y = (y + (sy + 0.5) / 3) / S; // in 512 space
      const scale = maskable ? 0.78 : 1;
      const dx = (X - 256) / scale, dy = (Y - 256) / scale;
      const d = Math.hypot(dx, dy);
      let col = [13, 17, 23];
      // rounded square background (full bleed when maskable)
      if (!maskable) {
        const qx = Math.max(Math.abs(X - 256) - 144, 0), qy = Math.max(Math.abs(Y - 256) - 144, 0);
        if (Math.hypot(qx, qy) > 112) col = null;
      }
      if (col && d <= 184) {
        if (Math.abs(dy) <= 16) col = [13, 17, 23];
        else if (dy < 0) { const t = (dx + dy + 368) / 736; col = [255 - 61 * t, 90 - 66 * t, 95 - 4 * t]; }
        else col = [244, 246, 251];
        if (d <= 96 && d > 64) col = [13, 17, 23];
        if (d <= 64) col = [244, 246, 251];
        if (d <= 22) col = [79, 142, 247];
      }
      if (col) { acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; n++; }
    }
    if (n) { set(i, acc.map((v) => Math.round(v / n))); px[i + 3] = Math.round((n / 9) * 255); }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) >>> 0 : crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }

fs.writeFileSync('public/icon-192.png', png(192, false));
fs.writeFileSync('public/icon-512.png', png(512, false));
fs.writeFileSync('public/icon-maskable-512.png', png(512, true));
console.log('icons written');
