// A picture as a PNG file, for the pictures the proof tools keep on this computer.

import { deflateSync } from 'node:zlib';

const TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xEDB88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc = bytes => {
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

/** A PNG of `rgba`, width × height pixels of four bytes each. */
export function png(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** The console's 15-bit colours (the Game Boy Advance's) as RGBA bytes. */
export function fromColours(colours) {
  const out = new Uint8Array(colours.length * 4);
  for (let i = 0; i < colours.length; i++) {
    const c = colours[i];
    out[i * 4] = (c & 31) << 3 | (c & 31) >> 2;
    out[i * 4 + 1] = (c >> 5 & 31) << 3 | (c >> 5 & 31) >> 2;
    out[i * 4 + 2] = (c >> 10 & 31) << 3 | (c >> 10 & 31) >> 2;
    out[i * 4 + 3] = 255;
  }
  return out;
}
