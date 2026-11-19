// LZMA, as a CHD's hunks are compressed with it (chd.js): a stream with no header of its own, whose properties the
// reader knows (`lc`, `lp`, `pb`) and which ends when `size` bytes have come out. Written from the format's description
// in the LZMA SDK's LzmaSpec.cpp (public domain): a range coder whose bits each have a probability of their own, and
// literals and matches into what has come out before.

const TOP = 1 << 24, MODEL = 11, MOVE = 5, HALF = 1 << (MODEL - 1);
const STATES = 12, POS_STATES = 16, END_MODEL = 14, FULL_DISTANCES = 128, ALIGN = 4;

// where each kind of probability is in the one table of them
const IS_MATCH = 0, IS_REP = IS_MATCH + STATES * POS_STATES, IS_REP_G0 = IS_REP + STATES, IS_REP_G1 = IS_REP_G0 + STATES;
const IS_REP_G2 = IS_REP_G1 + STATES, IS_REP0_LONG = IS_REP_G2 + STATES, POS_SLOT = IS_REP0_LONG + STATES * POS_STATES;
const SPEC_POS = POS_SLOT + 4 * 64, ALIGNED = SPEC_POS + 1 + FULL_DISTANCES - END_MODEL;
// a length's: its two choices, then its short, middle and long trees
const CHOICE = 0, LOW = 2, MID = LOW + POS_STATES * 8, HIGH = MID + POS_STATES * 8, LENGTH = HIGH + 256;
const MATCH_LENGTH = ALIGNED + (1 << ALIGN), REP_LENGTH = MATCH_LENGTH + LENGTH, LITERAL = REP_LENGTH + LENGTH;

class Range {
  constructor(input, at, end) {
    this.input = input;
    this.end = end;
    this.pos = at + 1;
    this.range = 0xFFFFFFFF;
    this.code = 0;
    for (let i = 0; i < 4; i++) this.code = (this.code * 256 + input[this.pos++]) >>> 0;
  }
  bit(p, i) {
    const prob = p[i], bound = (this.range >>> MODEL) * prob;
    let result;
    if (this.code < bound) {
      this.range = bound;
      p[i] = prob + ((2048 - prob) >>> MOVE);
      result = 0;
    } else {
      this.range = (this.range - bound) >>> 0;
      this.code = (this.code - bound) >>> 0;
      p[i] = prob - (prob >>> MOVE);
      result = 1;
    }
    if (this.range < TOP) {
      this.range = (this.range * 256) >>> 0;
      this.code = (this.code * 256 + (this.pos < this.end ? this.input[this.pos] : 0)) >>> 0;
      this.pos++;
    }
    return result;
  }
  direct(count) {
    let result = 0;
    for (; count > 0; count--) {
      this.range >>>= 1;
      let one = 0;
      if (this.code >= this.range) { this.code = (this.code - this.range) >>> 0; one = 1; }
      result = (result * 2 + one) >>> 0;
      if (this.range < TOP) {
        this.range = (this.range * 256) >>> 0;
        this.code = (this.code * 256 + (this.pos < this.end ? this.input[this.pos] : 0)) >>> 0;
        this.pos++;
      }
    }
    return result;
  }
  tree(p, base, count) {
    let m = 1;
    for (let i = 0; i < count; i++) m = (m << 1) | this.bit(p, base + m);
    return m - (1 << count);
  }
  reverse(p, base, count) {
    let m = 1, symbol = 0;
    for (let i = 0; i < count; i++) {
      const b = this.bit(p, base + m);
      m = (m << 1) | b;
      symbol |= b << i;
    }
    return symbol;
  }
  length(p, base, posState) {
    if (!this.bit(p, base + CHOICE)) return this.tree(p, base + LOW + posState * 8, 3);
    if (!this.bit(p, base + CHOICE + 1)) return 8 + this.tree(p, base + MID + posState * 8, 3);
    return 16 + this.tree(p, base + HIGH, 8);
  }
}

/** `size` bytes from the LZMA stream in `input`, from `at` to `end`. Throws when the stream is broken. */
export function lzmaDecode(input, size, { lc = 3, lp = 0, pb = 2, at = 0, end = input.length } = {}) {
  const out = new Uint8Array(size);
  if (!size) return out;
  if (end - at < 5 || input[at] !== 0) throw new Error("An LZMA stream in the copy doesn't start as one does.");
  const rc = new Range(input, at, end);
  const p = new Uint16Array(LITERAL + (0x300 << (lc + lp))).fill(HALF);
  const pbMask = (1 << pb) - 1, lpMask = (1 << lp) - 1;
  let state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0, n = 0;
  while (n < size) {
    const posState = n & pbMask;
    if (!rc.bit(p, IS_MATCH + state * POS_STATES + posState)) {
      const previous = n ? out[n - 1] : 0;
      const base = LITERAL + 0x300 * (((n & lpMask) << lc) + (previous >>> (8 - lc)));
      let symbol = 1;
      if (state >= 7) {
        let match = n > rep0 ? out[n - rep0 - 1] : 0;
        do {
          const matchBit = (match >>> 7) & 1;
          match <<= 1;
          const b = rc.bit(p, base + ((1 + matchBit) << 8) + symbol);
          symbol = (symbol << 1) | b;
          if (matchBit !== b) break;
        } while (symbol < 0x100);
      }
      while (symbol < 0x100) symbol = (symbol << 1) | rc.bit(p, base + symbol);
      out[n++] = symbol & 0xFF;
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
      continue;
    }
    let len;
    if (rc.bit(p, IS_REP + state)) {
      if (!n) throw new Error('An LZMA stream in the copy repeats bytes before any came out.');
      if (!rc.bit(p, IS_REP_G0 + state)) {
        if (!rc.bit(p, IS_REP0_LONG + state * POS_STATES + posState)) {
          state = state < 7 ? 9 : 11;
          out[n] = out[n - rep0 - 1];
          n++;
          continue;
        }
      } else {
        let distance;
        if (!rc.bit(p, IS_REP_G1 + state)) distance = rep1;
        else {
          if (!rc.bit(p, IS_REP_G2 + state)) distance = rep2;
          else {
            distance = rep3;
            rep3 = rep2;
          }
          rep2 = rep1;
        }
        rep1 = rep0;
        rep0 = distance;
      }
      len = rc.length(p, REP_LENGTH, posState);
      state = state < 7 ? 8 : 11;
    } else {
      rep3 = rep2;
      rep2 = rep1;
      rep1 = rep0;
      len = rc.length(p, MATCH_LENGTH, posState);
      state = state < 7 ? 7 : 10;
      const slot = rc.tree(p, POS_SLOT + Math.min(len, 3) * 64, 6);
      if (slot < 4) rep0 = slot;
      else {
        const bits = (slot >>> 1) - 1;
        let distance = ((2 | (slot & 1)) << bits) >>> 0;
        if (slot < END_MODEL) distance += rc.reverse(p, SPEC_POS + distance - slot, bits);
        else {
          distance += rc.direct(bits - ALIGN) * (1 << ALIGN);
          distance += rc.reverse(p, ALIGNED, ALIGN);
        }
        rep0 = distance >>> 0;
        // the mark that ends a stream of unknown size
        if (rep0 === 0xFFFFFFFF) break;
      }
    }
    len += 2;
    if (rep0 >= n) throw new Error('An LZMA stream in the copy reaches back before its start.');
    const stop = Math.min(size, n + len);
    for (let from = n - rep0 - 1; n < stop; n++, from++) out[n] = out[from];
  }
  if (n < size) throw new Error('An LZMA stream in the copy ended early.');
  return out;
}
