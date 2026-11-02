// Puts H.264 or AV1 frames, as the browser's encoder makes them, in an MP4 file that phones and browsers play: one video
// track, every frame the same length, and the index at the start so it plays before it has all arrived.

const box = (type, ...parts) => {
  const body = Buffer.concat(parts.map(p => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};
const full = (type, version, flags, ...parts) => {
  const vf = Buffer.alloc(4);
  vf.writeUInt32BE((version << 24 | flags) >>> 0);
  return box(type, vf, ...parts);
};
const u32 = (...values) => {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeUInt32BE(v >>> 0, i * 4));
  return b;
};
const u16 = (...values) => {
  const b = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => b.writeUInt16BE(v & 0xFFFF, i * 2));
  return b;
};
const MATRIX = u32(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000);

// AV1's frames are made of parts, each with a type, sometimes an extension, and its size in as many bytes as it needs:
// `each` is called with each part's type and where its bytes run
function eachObu(data, each) {
  for (let at = 0; at < data.length;) {
    const start = at, head = data[at++], type = head >> 3 & 15;
    if (head & 4) at++;
    let size = 0;
    for (let shift = 0, byte; ; shift += 7) {
      byte = data[at++];
      size |= (byte & 0x7F) << shift;
      if (!(byte & 0x80)) break;
    }
    at += size;
    each(type, start, at);
  }
}

/** An AV1 frame as an MP4 holds it, with no temporal delimiters, which mark where one frame ends and another starts. */
export function av1Frame(data) {
  const kept = [];
  eachObu(data, (type, start, end) => { if (type !== 2) kept.push(data.subarray(start, end)); });
  return Buffer.concat(kept);
}

/**
 * The decoder's configuration (av1C) for a stream the codec string av01.0.04M.08 describes, 4:2:0 and 8 bits, with its
 * sequence header, which comes with the first frame.
 */
export function av1Configuration(first) {
  let header = null;
  eachObu(first, (type, start, end) => { if (type === 1) header ??= first.subarray(start, end); });
  if (!header) throw new Error('The first AV1 frame has no sequence header.');
  return Buffer.concat([Buffer.from([0x81, 0x04, 0x0C, 0x00]), header]);
}

/**
 * The MP4 for `frames` ({ data, key }, in order), `description` the decoder's configuration the encoder gave (avcC, or
 * with `av1`, av1C), each frame lasting `duration` of `timescale` (the Game Boy Advance: 280896 of 16777216 a second).
 */
export function mp4({ width, height, description, frames, timescale, duration, av1 = false }) {
  const total = frames.length * duration;
  const movieScale = 1000, movieDuration = Math.round(total / timescale * movieScale);
  const sizes = frames.map(f => f.data.length);
  const keys = frames.flatMap((f, i) => (f.key ? [i + 1] : []));
  const entry = box(av1 ? 'av01' : 'avc1',
    Buffer.alloc(6), u16(1),                             // reserved, data reference 1
    u16(0, 0), u32(0, 0, 0), u16(width, height),
    u32(0x00480000, 0x00480000, 0), u16(1),              // 72 dpi, one frame per sample
    Buffer.alloc(32), u16(0x18, 0xFFFF),                 // no compressor name, colour, no colour table
    box(av1 ? 'av1C' : 'avcC', Buffer.from(description)));
  const stbl = offset => box('stbl',
    full('stsd', 0, 0, u32(1), entry),
    full('stts', 0, 0, u32(1, frames.length, duration)),
    full('stss', 0, 0, u32(keys.length, ...keys)),
    full('stsc', 0, 0, u32(1, 1, frames.length, 1)),
    full('stsz', 0, 0, u32(0, frames.length, ...sizes)),
    full('stco', 0, 0, u32(1, offset)));
  const moov = offset => box('moov',
    full('mvhd', 0, 0, u32(0, 0, movieScale, movieDuration, 0x00010000), u16(0x0100, 0), u32(0, 0), MATRIX, u32(0, 0, 0, 0, 0, 0, 2)),
    box('trak',
      full('tkhd', 0, 3, u32(0, 0, 1, 0, movieDuration, 0, 0), u16(0, 0, 0, 0), MATRIX, u32(width << 16, height << 16)),
      box('mdia',
        full('mdhd', 0, 0, u32(0, 0, timescale, total), u16(0x55C4, 0)),   // language: undetermined
        full('hdlr', 0, 0, u32(0), Buffer.from('vide'), u32(0, 0, 0), Buffer.from('Video\0')),
        box('minf',
          full('vmhd', 0, 1, u16(0, 0, 0, 0)),
          box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
          stbl(offset)))));
  const ftyp = box('ftyp', Buffer.from('isom'), u32(0x200), Buffer.from(`isomiso2${av1 ? 'av01' : 'avc1'}mp41`));
  const header = ftyp.length + moov(0).length + 8;
  const data = Buffer.concat(frames.map(f => Buffer.from(f.data)));
  const mdat = Buffer.concat([u32(8 + data.length), Buffer.from('mdat'), data]);
  return Buffer.concat([ftyp, moov(header), mdat]);
}
