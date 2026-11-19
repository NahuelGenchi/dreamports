// SHA-1, a piece at a time, as a browser's own (crypto.subtle) needs the whole of what it hashes at once, and a disc of
// gigabytes can't be had at once. For telling a player's copy's version apart (page.js), never for keeping anything safe.

export class Sha1 {
  constructor() {
    this.h = new Uint32Array([0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0]);
    this.w = new Uint32Array(80);
    this.block = new Uint8Array(64);
    this.filled = 0;
    this.length = 0;
  }

  /** Hashes `bytes` on from what came before. */
  update(bytes) {
    let at = 0;
    this.length += bytes.length;
    if (this.filled) {
      const take = Math.min(64 - this.filled, bytes.length);
      this.block.set(bytes.subarray(0, take), this.filled);
      this.filled += take;
      at = take;
      if (this.filled < 64) return this;
      this.compress(this.block, 0);
      this.filled = 0;
    }
    for (; at + 64 <= bytes.length; at += 64) this.compress(bytes, at);
    this.block.set(bytes.subarray(at), 0);
    this.filled = bytes.length - at;
    return this;
  }

  compress(bytes, at) {
    const w = this.w, h = this.h;
    for (let i = 0; i < 16; i++) w[i] = bytes[at + i * 4] << 24 | bytes[at + i * 4 + 1] << 16 | bytes[at + i * 4 + 2] << 8 | bytes[at + i * 4 + 3];
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = x << 1 | x >>> 31;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], t;
    // the four rounds of twenty, each with its own sum
    for (let i = 0; i < 20; i++) { t = ((a << 5 | a >>> 27) + ((b & c) | (~b & d)) + e + 0x5A827999 + w[i]) | 0; e = d; d = c; c = b << 30 | b >>> 2; b = a; a = t; }
    for (let i = 20; i < 40; i++) { t = ((a << 5 | a >>> 27) + (b ^ c ^ d) + e + 0x6ED9EBA1 + w[i]) | 0; e = d; d = c; c = b << 30 | b >>> 2; b = a; a = t; }
    for (let i = 40; i < 60; i++) { t = ((a << 5 | a >>> 27) + ((b & c) | (b & d) | (c & d)) + e + 0x8F1BBCDC + w[i]) | 0; e = d; d = c; c = b << 30 | b >>> 2; b = a; a = t; }
    for (let i = 60; i < 80; i++) { t = ((a << 5 | a >>> 27) + (b ^ c ^ d) + e + 0xCA62C1D6 + w[i]) | 0; e = d; d = c; c = b << 30 | b >>> 2; b = a; a = t; }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
  }

  /** The SHA-1 of everything hashed, as lowercase hex. */
  hex() {
    const bits = this.length * 8, tail = new Uint8Array((this.filled < 56 ? 64 : 128) - this.filled);
    tail[0] = 0x80;
    for (let i = 0; i < 8; i++) tail[tail.length - 1 - i] = Math.floor(bits / 2 ** (i * 8)) & 0xFF;
    const length = this.length;
    this.update(tail);
    this.length = length;
    return [...this.h].map(word => word.toString(16).padStart(8, '0')).join('');
  }
}
