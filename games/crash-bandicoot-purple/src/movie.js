// The game's videos, which are FLC files, the old animation format, packed with the console's LZ77 (the original's
// 0x0800D46C, which it calls from the display object in core.js). A video draws in the hidden page of mode 4,
// 0x0600A000, and its colours go to a list of its own: core.js shows them at the V-blank.

const CARTRIDGE = 0x08000000, PAGE = 0xA000, PITCH = 240;

// 0x0801A7F0's stream, read whole: flags a byte, then for each bit a byte as it is or a copy from up to 4096 back
export function unpack(bytes, at) {
  const size = bytes[at + 1] | (bytes[at + 2] << 8) | (bytes[at + 3] << 16), out = new Uint8Array(size);
  let from = at + 4, to = 0;
  while (to < size) {
    const flags = bytes[from++];
    for (let bit = 0x80; bit && to < size; bit >>= 1) {
      if (!(flags & bit)) { out[to++] = bytes[from++]; continue; }
      const pair = (bytes[from] << 8) | bytes[from + 1];
      from += 2;
      const back = (pair & 0xFFF) + 1;
      for (let n = (pair >> 12) + 3; n > 0 && to < size; n--, to++) out[to] = out[to - back];
    }
  }
  return out;
}

/** A video from the cartridge at `address`: 0x0800D46C reads its kind from its first word's high nibble. */
export function openMovie(rom, address) {
  const at = address - CARTRIDGE, kind = (rom.bytes[at] >> 4) & 0xF;
  // 0x0802C658 reads a file as it is, after its first word, and 0x0801A7F0 unpacks it
  const data = kind === 1 ? unpack(rom.bytes, at) : rom.bytes.subarray(at + 4);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    data, view, at: view.getUint32(80, true),
    frames: view.getUint16(6, true), width: view.getUint16(8, true), height: view.getUint16(10, true),
    speed: view.getUint32(16, true), second: view.getUint32(84, true),
  };
}

/** 0x0800D5D4: the next frame's chunks, drawn into the hidden page of `vram`, with its colours in `colours`. */
export function decodeFrame(movie, vram, colours) {
  const { view } = movie, chunks = view.getUint16(movie.at + 6, true);
  movie.at += 16;
  for (let n = 0; n < chunks; n++) {
    const size = view.getUint32(movie.at, true), kind = view.getUint16(movie.at + 4, true), body = movie.at + 6;
    if (kind === 4) readColours(movie, body, colours, 3);
    else if (kind === 11) readColours(movie, body, colours, 1);   // 0x0800D81C
    else if (kind === 7) drawDeltaLines(movie, body, vram);
    else if (kind === 13) vram.fill(0, PAGE, PAGE + movie.height * PITCH);
    else if (kind === 15) drawRuns(movie, body, vram);
    else if (kind === 16) drawCopy(movie, body, vram);
    movie.at += size;
  }
}

// 0x0800D6DC: packets of colours, each a number to skip and a number to read (0 for all 256), with `shift` the bits a
// channel has above the console's 5: 8 bits in one kind of chunk and 6 in the other
function readColours({ data, view }, at, colours, shift) {
  let packets = view.getUint16(at, true), index = 0;
  at += 2;
  for (; packets > 0; packets--) {
    index += data[at++];
    let count = data[at++] || 256;
    for (; count > 0; count--, at += 3) {
      colours[index++] = ((data[at] >> shift) & 0x1F) | (((data[at + 1] >> shift) & 0x1F) << 5) | (((data[at + 2] >> shift) & 0x1F) << 10);
    }
  }
}

// 0x030000D4: the lines that changed, as words: skips of lines, then packets that copy words or repeat one
function drawDeltaLines({ data, view }, at, vram) {
  let lines = view.getUint16(at, true), y = 0;
  at += 2;
  for (; lines > 0; lines--, y++) {
    let word = view.getUint16(at, true);
    at += 2;
    while ((word & 0xC000) !== 0) {
      if ((word & 0xC000) === 0xC000) y += 0x10000 - word;
      word = view.getUint16(at, true);
      at += 2;
    }
    let to = PAGE + y * PITCH;
    for (let packets = word; packets > 0; packets--) {
      to += data[at] & 0xFE;
      const count = data[at + 1];
      at += 2;
      if (count & 0x80) {
        for (let n = 256 - count; n > 0; n--, to += 2) { vram[to] = data[at]; vram[to + 1] = data[at + 1]; }
        at += 2;
      } else {
        vram.set(data.subarray(at, at + count * 2), to);
        at += count * 2;
        to += count * 2;
      }
    }
  }
}

// 0x0300028C: every line, in runs: below 0 that many bytes to copy, and from 0 up a byte to repeat that many times
function drawRuns({ data, width, height }, at, vram) {
  for (let y = 0; y < height; y++) {
    let to = PAGE + y * PITCH, left = width;
    at++;
    while (left > 0) {
      const count = (data[at++] << 24) >> 24;
      if (count < 0) {
        vram.set(data.subarray(at, at - count), to);
        at -= count;
        to -= count;
        left += count;
      } else {
        vram.fill(data[at++], to, to + count);
        to += count;
        left -= count;
      }
    }
  }
}

// 0x0800D9E4: every line as it is
function drawCopy({ data, width, height }, at, vram) {
  for (let y = 0; y < height; y++, at += width) vram.set(data.subarray(at, at + width), PAGE + y * PITCH);
}
