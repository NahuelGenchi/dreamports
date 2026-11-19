// Deflate, undone (RFC 1951), for a CHD's and a CSO's compressed pieces in a browser, where nothing else undoes a raw
// stream that has bytes after its end, as a CSO's padded blocks do. The tools on a computer use Node's own zlib.

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// a code from its lengths: a table from the next `bits` bits (lowest first, as deflate reads them) to the symbol and
// its length, the code's own bits reversed into it
function table(lengths, count) {
  let bits = 0;
  for (let i = 0; i < count; i++) bits = Math.max(bits, lengths[i]);
  const lookup = new Int32Array(1 << Math.max(bits, 1)).fill(-1);
  const histogram = new Uint16Array(16), next = new Uint16Array(16);
  for (let i = 0; i < count; i++) histogram[lengths[i]]++;
  histogram[0] = 0;
  for (let length = 1, code = 0; length < 16; length++) {
    code = (code + histogram[length - 1]) << 1;
    next[length] = code;
  }
  for (let symbol = 0; symbol < count; symbol++) {
    const length = lengths[symbol];
    if (!length) continue;
    let code = next[length]++, reversed = 0;
    for (let i = 0; i < length; i++) { reversed = (reversed << 1) | (code & 1); code >>= 1; }
    for (let at = reversed; at < lookup.length; at += 1 << length) lookup[at] = symbol << 4 | length;
  }
  return { lookup, bits };
}

const FIXED_LENGTHS = new Uint8Array(288).fill(8, 0, 144).fill(9, 144, 256).fill(7, 256, 280).fill(8, 280, 288);
const FIXED = [table(FIXED_LENGTHS, 288), table(new Uint8Array(30).fill(5), 30)];

/** The `size` bytes a raw deflate stream in `input` (from `at` to `end`) holds. Bytes after its end are left alone. */
export function inflateRaw(input, size, { at = 0, end = input.length } = {}) {
  const out = new Uint8Array(size);
  let pos = at, buffer = 0, count = 0, n = 0;
  const need = bits => {
    while (count < bits) {
      if (pos >= end) throw new Error('A deflate stream in the copy ends early.');
      buffer |= input[pos++] << count;
      count += 8;
    }
  };
  const read = bits => {
    need(bits);
    const value = buffer & ((1 << bits) - 1);
    buffer >>>= bits;
    count -= bits;
    return value;
  };
  const symbol = ({ lookup, bits }) => {
    // near the stream's end there may be fewer bits than the longest code: what there is
    while (count < bits && pos < end) { buffer |= input[pos++] << count; count += 8; }
    const entry = lookup[buffer & ((1 << bits) - 1)];
    if (entry < 0 || (entry & 15) > count) throw new Error('A deflate stream in the copy has a code it never set.');
    buffer >>>= entry & 15;
    count -= entry & 15;
    return entry >> 4;
  };
  let last = 0;
  while (!last) {
    last = read(1);
    const type = read(2);
    if (type === 0) {
      buffer = 0;
      count = 0;
      if (pos + 4 > end) throw new Error('A deflate stream in the copy ends early.');
      const length = input[pos] | input[pos + 1] << 8;
      pos += 4;
      if (pos + length > end || n + length > size) throw new Error('A deflate stream in the copy holds more than it should.');
      out.set(input.subarray(pos, pos + length), n);
      pos += length;
      n += length;
      continue;
    }
    let codes;
    if (type === 1) codes = FIXED;
    else if (type === 2) {
      const literals = read(5) + 257, distances = read(5) + 1, lengthCodes = read(4) + 4;
      const order = new Uint8Array(19);
      for (let i = 0; i < lengthCodes; i++) order[ORDER[i]] = read(3);
      const lengthTable = table(order, 19), lengths = new Uint8Array(literals + distances);
      for (let i = 0; i < literals + distances;) {
        const s = symbol(lengthTable);
        if (s < 16) lengths[i++] = s;
        else {
          const [repeat, value] = s === 16 ? [3 + read(2), i ? lengths[i - 1] : -1] : s === 17 ? [3 + read(3), 0] : [11 + read(7), 0];
          if (value < 0 || i + repeat > lengths.length) throw new Error('A deflate stream in the copy repeats a length wrongly.');
          lengths.fill(value, i, i + repeat);
          i += repeat;
        }
      }
      codes = [table(lengths, literals), table(lengths.subarray(literals), distances)];
    } else throw new Error('A deflate stream in the copy has a block of a kind that doesn\'t exist.');
    for (;;) {
      const s = symbol(codes[0]);
      if (s < 256) {
        if (n >= size) throw new Error('A deflate stream in the copy holds more than it should.');
        out[n++] = s;
      } else if (s === 256) break;
      else {
        const l = s - 257, length = LENGTH_BASE[l] + read(LENGTH_EXTRA[l]);
        const d = symbol(codes[1]), distance = DISTANCE_BASE[d] + read(DISTANCE_EXTRA[d]);
        if (distance > n || n + length > size) throw new Error('A deflate stream in the copy reaches outside what it holds.');
        for (let i = 0; i < length; i++, n++) out[n] = out[n - distance];
      }
    }
  }
  if (n !== size) throw new Error(`A deflate stream in the copy held ${n} bytes where ${size} were wanted.`);
  return out;
}
