// FLAC, as a CHD keeps a CD's sound and other hunks of 16-bit samples (chd.js): frames with no stream header before
// them, two channels of 16 bits at 44100 a second unless a frame says otherwise. Written from the format's description
// (RFC 9639): each frame's channels are predicted from the samples before, and what the prediction misses is kept in
// Rice codes.

const BLOCK = [0, 192, 576, 1152, 2304, 4608, -1, -2, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];
const SAMPLE_BITS = [0, 8, 12, 0, 16, 20, 24, 32];

class Bits {
  constructor(bytes, at, end) {
    this.bytes = bytes;
    this.at = at;
    this.end = end;
    this.bit = 0;   // how many bits of bytes[at] are read
  }
  read(n) {
    let value = 0;
    while (n > 0) {
      if (this.at >= this.end) throw new Error('A FLAC frame in the copy ends early.');
      const left = 8 - this.bit, take = Math.min(left, n), byte = this.bytes[this.at];
      value = value * (1 << take) + ((byte >>> (left - take)) & ((1 << take) - 1));
      this.bit += take;
      n -= take;
      if (this.bit === 8) { this.bit = 0; this.at++; }
    }
    return value;
  }
  signed(n) {
    const value = this.read(n);
    return n && value >= 2 ** (n - 1) ? value - 2 ** n : value;
  }
  // how many zeros before the next one, the one read too
  unary() {
    let count = 0;
    for (;;) {
      if (this.at >= this.end) throw new Error('A FLAC frame in the copy ends early.');
      const rest = (this.bytes[this.at] << this.bit) & 0xFF;
      if (rest) {
        const zeros = Math.clz32(rest) - 24;
        count += zeros;
        this.bit += zeros + 1;
        if (this.bit === 8) { this.bit = 0; this.at++; }
        return count;
      }
      count += 8 - this.bit;
      this.bit = 0;
      this.at++;
    }
  }
  align() { if (this.bit) { this.bit = 0; this.at++; } }
}

function residual(bits, out, count, order) {
  const method = bits.read(2);
  if (method > 1) throw new Error('A FLAC frame in the copy uses a residual coding that doesn\'t exist.');
  const paramBits = method ? 5 : 4, escape = method ? 31 : 15, partitionOrder = bits.read(4);
  const partitions = 1 << partitionOrder, each = count >> partitionOrder;
  let n = order;
  for (let part = 0; part < partitions; part++) {
    const samples = part ? each : each - order, param = bits.read(paramBits);
    if (param === escape) {
      const width = bits.read(5);
      for (let i = 0; i < samples; i++) out[n++] = bits.signed(width);
    } else {
      for (let i = 0; i < samples; i++) {
        const value = bits.unary() * (1 << param) + bits.read(param);
        out[n++] = value % 2 ? -(value + 1) / 2 : value / 2;
      }
    }
  }
}

const FIXED = [[], [1], [2, -1], [3, -3, 1], [4, -6, 4, -1]];

function subframe(bits, count, sampleBits) {
  if (bits.read(1)) throw new Error('A FLAC subframe in the copy starts wrongly.');
  const type = bits.read(6);
  let wasted = 0;
  if (bits.read(1)) wasted = bits.unary() + 1;
  const width = sampleBits - wasted, out = new Float64Array(count);
  if (type === 0) out.fill(bits.signed(width));
  else if (type === 1) for (let i = 0; i < count; i++) out[i] = bits.signed(width);
  else if (type >= 8 && type <= 12) {
    const order = type - 8;
    for (let i = 0; i < order; i++) out[i] = bits.signed(width);
    residual(bits, out, count, order);
    const c = FIXED[order];
    for (let i = order; i < count; i++) {
      let sum = 0;
      for (let j = 0; j < order; j++) sum += c[j] * out[i - j - 1];
      out[i] += sum;
    }
  } else if (type >= 32) {
    const order = type - 31;
    for (let i = 0; i < order; i++) out[i] = bits.signed(width);
    const precision = bits.read(4) + 1;
    if (precision === 16) throw new Error('A FLAC subframe in the copy has no precision.');
    const shift = bits.signed(5), coefficients = [];
    if (shift < 0) throw new Error('A FLAC subframe in the copy shifts the wrong way.');
    for (let i = 0; i < order; i++) coefficients.push(bits.signed(precision));
    residual(bits, out, count, order);
    const scale = 2 ** shift;
    for (let i = order; i < count; i++) {
      let sum = 0;
      for (let j = 0; j < order; j++) sum += coefficients[j] * out[i - j - 1];
      out[i] += Math.floor(sum / scale);
    }
  } else throw new Error(`A FLAC subframe in the copy is of a kind that doesn't exist (${type}).`);
  if (wasted) for (let i = 0; i < count; i++) out[i] *= 2 ** wasted;
  return out;
}

/**
 * Decodes `frames` stereo samples of 16 bits from the FLAC frames in `input` from `at`, into `out` (4 bytes a sample,
 * left then right, big-endian when `bigEndian`), and returns where the last frame ended, for what a CHD keeps after it.
 */
export function flacDecode(input, frames, out, { at = 0, end = input.length, bigEndian = false } = {}) {
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let done = 0;
  while (done < frames) {
    const bits = new Bits(input, at, end);
    if (bits.read(14) !== 0x3FFE) throw new Error('A FLAC frame in the copy has no sync.');
    bits.read(2);
    const blockCode = bits.read(4);
    const rateCode = bits.read(4);
    const channels = bits.read(4);
    const sizeCode = bits.read(3);
    bits.read(1);
    // the frame's number, coded as UTF-8 codes characters
    const first = bits.read(8);
    for (let extra = Math.clz32(~(first << 24)) - 1; extra > 0; extra--) bits.read(8);
    let count = BLOCK[blockCode];
    if (count === -1) count = bits.read(8) + 1;
    else if (count === -2) count = bits.read(16) + 1;
    if (rateCode === 12) bits.read(8);
    else if (rateCode === 13 || rateCode === 14) bits.read(16);
    bits.read(8);   // the header's CRC
    const sampleBits = SAMPLE_BITS[sizeCode] || 16;
    if (!count) throw new Error('A FLAC frame in the copy has no samples.');
    let left, right;
    if (channels === 1) {
      left = subframe(bits, count, sampleBits);
      right = subframe(bits, count, sampleBits);
    } else if (channels >= 8 && channels <= 10) {
      const a = subframe(bits, count, sampleBits + (channels === 9 ? 1 : 0));
      const b = subframe(bits, count, sampleBits + (channels === 9 ? 0 : 1));
      if (channels === 8) { left = a; right = a.map((l, i) => l - b[i]); }
      else if (channels === 9) { right = b; left = a.map((s, i) => s + b[i]); }
      else {
        left = new Float64Array(count);
        right = new Float64Array(count);
        for (let i = 0; i < count; i++) {
          const mid = a[i] * 2 + (b[i] & 1);
          left[i] = (mid + b[i]) / 2;
          right[i] = (mid - b[i]) / 2;
        }
      }
    } else throw new Error(`A FLAC frame in the copy has ${channels + 1} channels where two were wanted.`);
    bits.align();
    bits.read(16);   // the frame's CRC
    const take = Math.min(count, frames - done);
    for (let i = 0; i < take; i++) {
      view.setInt16((done + i) * 4, left[i], !bigEndian);
      view.setInt16((done + i) * 4 + 2, right[i], !bigEndian);
    }
    done += take;
    at = bits.at;
  }
  return at;
}
