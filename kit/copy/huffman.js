// The Huffman codes a CHD keeps its map and some of its hunks in (chd.js), as MAME's chdman writes them: a code for
// each value, the shortest for the most common, read a bit at a time from the highest bit of each byte down. A tree
// comes before the codes, as each value's code length, written one of two ways.

/** Bits read from `bytes`, highest first; reading past the end gives zeros and marks `over`. */
export class Bits {
  constructor(bytes, at = 0, end = bytes.length) {
    this.bytes = bytes;
    this.at = at;          // the next byte to take in
    this.end = end;
    this.buffer = 0;       // bits taken in and not yet read, at the top of a 32-bit word
    this.count = 0;
    this.over = false;
  }
  /** The next `n` bits (at most 24) without reading them. */
  peek(n) {
    if (!n) return 0;
    while (this.count < n) {
      const byte = this.at < this.end ? this.bytes[this.at] : 0;
      this.at++;
      this.buffer |= byte << (24 - this.count);
      this.count += 8;
    }
    return this.buffer >>> (32 - n);
  }
  /** Leaves out `n` bits already peeked. */
  skip(n) {
    this.buffer = (this.buffer << n) >>> 0;
    this.count -= n;
    if (this.at * 8 - this.count > this.end * 8) this.over = true;
  }
  /** Reads `n` bits, at most 32. */
  read(n) {
    if (n > 24) {
      const high = this.read(n - 16);
      return (high * 0x10000 + this.read(16)) >>> 0;
    }
    const value = this.peek(n);
    this.skip(n);
    return value;
  }
  /** Where the next whole byte is, the bits left of this one passed over. */
  get offset() { return this.at - (this.count >> 3); }
}

/** A Huffman code of `count` values, none longer than `longest` bits. */
export class Huffman {
  constructor(count, longest) {
    this.count = count;
    this.longest = longest;
    this.lengths = new Uint8Array(count);
    this.lookup = new Uint32Array(1 << longest);
  }

  /** The tree as chdman writes a map's: each length in a few bits, a 1 starting a run of one length. */
  readRle(bits) {
    const width = this.longest >= 16 ? 5 : this.longest >= 8 ? 4 : 3;
    for (let n = 0; n < this.count;) {
      let length = bits.read(width);
      if (length !== 1) this.lengths[n++] = length;
      else {
        length = bits.read(width);
        if (length === 1) this.lengths[n++] = 1;
        else {
          const repeat = bits.read(width) + 3;
          if (n + repeat > this.count) throw new Error('A Huffman tree in the CHD runs past its values.');
          this.lengths.fill(length, n, n + repeat);
          n += repeat;
        }
      }
    }
    this.build();
  }

  /** The tree as chdman writes a hunk's: each length coded by a small tree of its own, with runs. */
  readHuffman(bits) {
    const small = new Huffman(24, 6);
    small.lengths[0] = bits.read(3);
    const start = bits.read(3) + 1;
    let count = 0;
    for (let i = 1; i < 24; i++) {
      if (i < start || count === 7) small.lengths[i] = 0;
      else {
        count = bits.read(3);
        small.lengths[i] = count === 7 ? 0 : count;
      }
    }
    small.build();
    let full = 0;
    for (let rest = this.count - 9; rest; rest >>>= 1) full++;
    let last = 0;
    for (let n = 0; n < this.count;) {
      const value = small.decode(bits);
      if (value) this.lengths[n++] = last = value - 1;
      else {
        let repeat = bits.read(3) + 2;
        if (repeat === 9) repeat += bits.read(full);
        for (; repeat && n < this.count; repeat--) this.lengths[n++] = last;
      }
    }
    this.build();
  }

  // each length's codes in order, the longest first, then a table from `longest` bits to the value and its length
  build() {
    const histogram = new Uint32Array(33);
    for (const length of this.lengths) {
      if (length > this.longest) throw new Error('A Huffman code in the CHD is longer than it can be.');
      histogram[length]++;
    }
    let start = 0;
    for (let length = 32; length > 0; length--) {
      const next = (start + histogram[length]) >>> 1;
      if (length !== 1 && next * 2 !== start + histogram[length]) throw new Error("A Huffman tree in the CHD doesn't add up.");
      histogram[length] = start;
      start = next;
    }
    this.lookup.fill(0);
    for (let value = 0; value < this.count; value++) {
      const length = this.lengths[value];
      if (!length) continue;
      const code = histogram[length]++, shift = this.longest - length;
      this.lookup.fill(value << 5 | length, code << shift, (code + 1) << shift);
    }
  }

  /** The next value. */
  decode(bits) {
    const entry = this.lookup[bits.peek(this.longest)];
    bits.skip(entry & 0x1F);
    return entry >>> 5;
  }
}
