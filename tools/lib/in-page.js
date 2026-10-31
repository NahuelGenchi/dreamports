// What prove runs inside the Dreamport's page. It plays the game a frame at a time with the recording's buttons,
// through the kit's proof mode (kit/gba/proof.js), hashes each picture as the original's are hashed
// (tools/gba/original.c), keeps the pictures prove asks for, and draws the stills and the clip, which the
// browser encodes as H.264. The results stay on the contributor's computer.
(() => {
  const WIDTH = 240, HEIGHT = 160, RING = 400;
  const SCALE = 2, BAR = 20;
  const FRAME_US = 1e6 * 280896 / 16777216;   // a Game Boy Advance frame, in microseconds
  // the last pictures, and those kept for the results
  const ring = new Map(), kept = new Map(), originals = new Map();

  // a picture in the console's 15-bit colour, and its FNV-1a hash
  function reduce(data) {
    const picture = new Uint16Array(WIDTH * HEIGHT);
    let hash = 0x811C9DC5;
    for (let i = 0, p = 0; p < picture.length; i += 4, p++) {
      const colour = data[i] >> 3 | (data[i + 1] >> 3) << 5 | (data[i + 2] >> 3) << 10;
      picture[p] = colour;
      hash = Math.imul(hash ^ colour, 0x01000193);
    }
    return [picture, hash >>> 0];
  }

  const toBase64 = bytes => {
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(text);
  };
  const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

  // a 15-bit picture as the browser draws one
  function toImage(picture) {
    const image = new ImageData(WIDTH, HEIGHT);
    for (let p = 0; p < picture.length; p++) {
      const c = picture[p], r = c & 31, g = c >> 5 & 31, b = c >> 10 & 31;
      image.data.set([r << 3 | r >> 2, g << 3 | g >> 2, b << 3 | b >> 2, 255], p * 4);
    }
    return image;
  }
  // where two pictures differ: the original dimmed, and each pixel that differs in magenta
  function differences(original, dreamport) {
    const image = new ImageData(WIDTH, HEIGHT);
    let pixels = 0, left = WIDTH, top = HEIGHT, right = -1, bottom = -1;
    for (let p = 0; p < original.length; p++) {
      const x = p % WIDTH, y = p / WIDTH | 0;
      if (original[p] !== dreamport[p]) {
        pixels++;
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
        image.data.set([255, 0, 255, 255], p * 4);
      } else {
        const c = original[p], grey = ((c & 31) * 3 + (c >> 5 & 31) * 6 + (c >> 10 & 31)) * 0.8;
        image.data.set([grey, grey, grey, 255], p * 4);
      }
    }
    return { image, pixels, box: pixels ? [left, top, right, bottom] : null };
  }

  const panel = new OffscreenCanvas(WIDTH, HEIGHT);
  // the original, the Dreamport and, if asked, their differences, side by side and twice the size, under a bar
  // that names them and gives the Dreamport's frame
  function draw(canvas, frame, { difference = false } = {}) {
    const context = canvas.getContext('2d');
    const original = originals.get(frame), dreamport = kept.get(frame);
    const same = original.every((c, i) => c === dreamport[i]);
    context.fillStyle = '#10141c';
    context.fillRect(0, 0, canvas.width, BAR);
    context.font = '12px sans-serif';
    context.textBaseline = 'middle';
    context.fillStyle = '#e8ecf4';
    context.fillText('Original', 8, BAR / 2);
    context.fillText('Dreamport', WIDTH * SCALE + 8, BAR / 2);
    context.textAlign = 'right';
    context.fillText(`frame ${frame}`, canvas.width - 8, BAR / 2);
    if (!same) {
      context.fillStyle = '#ff5cf0';
      context.fillText('differs', canvas.width - 80, BAR / 2);
    }
    context.textAlign = 'left';
    context.imageSmoothingEnabled = false;
    const pictures = [toImage(original), toImage(dreamport)];
    let found = null;
    if (difference) {
      found = differences(original, dreamport);
      pictures.push(found.image);
    }
    pictures.forEach((image, i) => {
      panel.getContext('2d').putImageData(image, 0, 0);
      context.drawImage(panel, i * WIDTH * SCALE, BAR, WIDTH * SCALE, HEIGHT * SCALE);
    });
    return found;
  }

  window.__proof = {
    /** Plays frames from `from`, each with its buttons held, and resolves to each picture's hash. */
    async run(from, held) {
      const hashes = [];
      for (let i = 0; i < held.length; i++) {
        const frame = from + i;
        const image = await dreamportsProof.step({ held: held[i] });
        if (!image) throw new Error('The game handed over no picture.');
        if (image.width !== WIDTH || image.height !== HEIGHT) {
          throw new Error(`The game's screen is ${image.width} x ${image.height}, not the console's ${WIDTH} x ${HEIGHT}: proof needs it as the console had it.`);
        }
        const [picture, hash] = reduce(image.data);
        hashes.push(hash);
        ring.set(frame, picture);
        ring.delete(frame - RING);
      }
      return hashes;
    },

    /** Keeps the pictures of these frames, from the last few hundred played. */
    keep(frames) {
      for (const frame of frames) if (ring.has(frame)) kept.set(frame, ring.get(frame));
      return frames.filter(frame => kept.has(frame));
    },

    /** The original's picture of a frame, 15-bit colour in base64. */
    original(frame, data) {
      const bytes = fromBase64(data);
      originals.set(frame, new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2));
    },

    /** A still of one frame as a PNG in base64, with where it differs when `difference`. */
    async still(frame, difference = false) {
      const canvas = new OffscreenCanvas(WIDTH * SCALE * (difference ? 3 : 2), HEIGHT * SCALE + BAR);
      const found = draw(canvas, frame, { difference });
      const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
      return { png: toBase64(png), pixels: found?.pixels ?? 0, box: found?.box ?? null };
    },

    /** The clip of these frames, encoded as H.264: { description, frames: [{ key, data }] }, in base64. */
    async video(frames, { bitrate }) {
      const canvas = new OffscreenCanvas(WIDTH * SCALE * 2, HEIGHT * SCALE + BAR);
      const chunks = [];
      let description = null, failure = null;
      const encoder = new VideoEncoder({
        output(chunk, metadata) {
          const config = metadata?.decoderConfig?.description;
          if (config) description = new Uint8Array(ArrayBuffer.isView(config) ? config.buffer.slice(config.byteOffset, config.byteOffset + config.byteLength) : config.slice(0));
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          chunks.push({ key: chunk.type === 'key', timestamp: chunk.timestamp, data });
        },
        error(error) { failure = error; },
      });
      // Constrained Baseline: every phone and browser plays it
      const config = { codec: 'avc1.42E01F', width: canvas.width, height: canvas.height, bitrate, framerate: 1e6 / FRAME_US, avc: { format: 'avc' } };
      if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error('This browser can\'t encode H.264 video, so there\'s no clip: Chrome can.');
      encoder.configure(config);
      for (let i = 0; i < frames.length && !failure; i++) {
        draw(canvas, frames[i]);
        const frame = new VideoFrame(canvas, { timestamp: Math.round(i * FRAME_US), duration: Math.round(FRAME_US) });
        encoder.encode(frame, { keyFrame: i % 120 === 0 });
        frame.close();
        while (encoder.encodeQueueSize > 4 && !failure) await new Promise(resolve => encoder.addEventListener('dequeue', resolve, { once: true }));
      }
      if (!failure) await encoder.flush();
      encoder.close();
      if (failure) throw failure;
      for (let i = 1; i < chunks.length; i++) {
        if (chunks[i].timestamp < chunks[i - 1].timestamp) throw new Error('The encoder reordered frames, which the clip doesn\'t handle.');
      }
      return { width: canvas.width, height: canvas.height, description: toBase64(description), frames: chunks.map(c => ({ key: c.key, data: toBase64(c.data) })) };
    },
  };
})();
