// What prove runs inside the Dreamport's page. It plays the game a frame at a time with the recording's buttons,
// through the kit's proof mode (kit/gba/proof.js), hashes each picture as the original's are hashed
// (tools/gba/original.c), measures each frame's sound in bands of pitches with the filter prove gives it
// (lib/sound.mjs, as __makeFilter), keeps the pictures prove asks for, and draws the stills and the clip, which the
// browser encodes as H.264. The results stay on the contributor's computer.
(() => {
  const [WIDTH, HEIGHT] = __console.screen, PIXELS = WIDTH * HEIGHT;
  // the last 400 pictures, or as many as 64 MB holds of a console with a large screen
  const RING = Math.min(400, Math.floor(0x4000000 / (PIXELS * 2)));
  // what the console holds, as lib/state.mjs reads it
  const IO_BYTES = 0x58, STATE_BYTES = 0x58 + 0x400 + 0x400 + 0x18000;
  const SCALE = 2, BAR = 20;
  const FRAME_US = 1e6 * __console.frame[0] / __console.frame[1];   // a frame of the console's, in microseconds
  // the last pictures, in one block so that playing makes no garbage (`quick` keeps none: nothing makes a clip), and
  // those kept for the results
  let ring = new Uint16Array(__quick ? PIXELS : PIXELS * RING), lastPlayed = -1;
  const kept = new Map(), originals = new Map();
  const keptStates = new Map(), wantedStates = new Set();
  // the frames whose sound differs, which the stills and the clip mark
  const soundDiffers = new Set();
  const filter = __makeFilter(__console.sound);
  // how many samples a frame with no sound stands for
  const SILENCE = Math.floor(__console.sound * __console.frame[0] / __console.frame[1]);
  let heard = false, pictureDiffered = false, ownWidth = 0, ownHeight = 0;

  // Nobody sees this page, so nothing waits for a display. The game's loops ask for the next display frame as they do
  // anywhere, and instead of 60 times a second those callbacks run as soon as a frame is wanted, and only then.
  // A task runs between frames, so timers and messages go on as they do on a display.
  const asked = new Map(), stopShowing = cancelAnimationFrame.bind(window);
  let askedId = 2 ** 30;
  if (!__paced) {
    window.requestAnimationFrame = callback => { asked.set(++askedId, callback); return askedId; };
    window.cancelAnimationFrame = id => { if (!asked.delete(id)) stopShowing(id); };
    // and nothing draws it: the canvas keeps its pixels in memory, where the game and the tools read them
    document.documentElement.style.display = 'none';
  }
  const channel = new MessageChannel();
  let nextTask = null;
  channel.port1.onmessage = () => nextTask?.();
  const aTask = () => new Promise(resolve => { nextTask = resolve; channel.port2.postMessage(0); });

  /** Runs the frame a tool has asked for, and resolves to what it drew. */
  async function played(frame) {
    if (__paced) return dreamportsProof.step(frame);
    let image = null, ended = false, failed = null;
    dreamportsProof.step(frame).then(drawn => { image = drawn; ended = true; }, error => { failed = error; ended = true; });
    for (let idle = 0; !ended; idle++) {
      const now = performance.now(), callbacks = [...asked.values()];
      asked.clear();
      // a display runs each callback on its own, with what it promised done before the next
      for (const callback of callbacks) {
        callback(now);
        await null;
      }
      await aTask();
      // the game holds its frames for what it's waiting on, such as its sound engine starting
      if (!ended && idle > 1) await new Promise(resolve => setTimeout(resolve, 1));
    }
    if (failed) throw failed;
    return image;
  }

  // a picture in the console's 15-bit colour, written to the ring, and its FNV-1a hash
  function reduce({ data, width, height }, frame) {
    const at = __quick ? 0 : (frame % RING) * PIXELS, fits = width === WIDTH && height === HEIGHT;
    let hash = 0x811C9DC5;
    // a screen of another size, as some consoles change theirs, is cut or filled with black to be kept
    if (!fits) ring.fill(0, at, at + PIXELS);
    for (let i = 0, p = at, x = 0, y = 0; i < data.length; i += 4, p++) {
      const colour = data[i] >> 3 | (data[i + 1] >> 3) << 5 | (data[i + 2] >> 3) << 10;
      if (fits) ring[p] = colour;
      else {
        if (x < WIDTH && y < HEIGHT) ring[at + y * WIDTH + x] = colour;
        if (++x === width) { x = 0; y++; }
      }
      hash = Math.imul(hash ^ colour, 0x01000193);
    }
    // the same pixels in another shape are another picture, on a console whose games choose their size (libretro/host.c)
    if (__console.id !== 'gba') hash = Math.imul(Math.imul(hash ^ width, 0x01000193) ^ height, 0x01000193);
    lastPlayed = frame;
    return hash >>> 0;
  }
  const inRing = frame => frame <= lastPlayed && frame > lastPlayed - (__quick ? 1 : RING);
  const fromRing = frame => {
    const at = __quick ? 0 : (frame % RING) * PIXELS;
    return ring.slice(at, at + PIXELS);
  };

  // what the video hardware that drew a frame holds after it, if the kit's did
  function keepState(frame) {
    const video = dreamportsProof.video;
    if (!video) return;
    const state = new Uint8Array(STATE_BYTES);
    const bytes = array => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    state.set(bytes(video.io).subarray(0, IO_BYTES), 0);
    state.set(bytes(video.pal), IO_BYTES);
    state.set(bytes(video.oam), IO_BYTES + 0x400);
    state.set(video.vram, IO_BYTES + 0x800);
    keptStates.set(frame, state);
  }

  const toBase64 = bytes => {
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(text);
  };

  // each 15-bit colour as the browser draws it
  const RGBA = new Uint32Array(32768);
  for (let c = 0; c < 32768; c++) {
    const r = c & 31, g = c >> 5 & 31, b = c >> 10 & 31;
    RGBA[c] = (0xFF << 24 | (b << 3 | b >> 2) << 16 | (g << 3 | g >> 2) << 8 | r << 3 | r >> 2) >>> 0;
  }
  // a 15-bit picture as the browser draws one
  const images = [new ImageData(WIDTH, HEIGHT), new ImageData(WIDTH, HEIGHT), new ImageData(WIDTH, HEIGHT)];
  function toImage(picture, slot) {
    const image = images[slot], pixels = new Uint32Array(image.data.buffer);
    for (let p = 0; p < PIXELS; p++) pixels[p] = RGBA[picture[p]];
    return image;
  }
  // where two pictures differ: the original dimmed, and each pixel that differs in magenta
  function differences(original, dreamport) {
    const image = images[2], data = image.data;
    let pixels = 0, left = WIDTH, top = HEIGHT, right = -1, bottom = -1;
    for (let p = 0, at = 0; p < PIXELS; p++, at += 4) {
      data[at + 3] = 255;
      if (original[p] !== dreamport[p]) {
        const x = p % WIDTH, y = p / WIDTH | 0;
        pixels++;
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
        data[at] = 255; data[at + 1] = 0; data[at + 2] = 255;
      } else {
        const c = original[p], grey = ((c & 31) * 3 + (c >> 5 & 31) * 6 + (c >> 10 & 31)) * 0.8;
        data[at] = grey; data[at + 1] = grey; data[at + 2] = grey;
      }
    }
    return { image, pixels, box: pixels ? [left, top, right, bottom] : null };
  }

  const panel = new OffscreenCanvas(WIDTH, HEIGHT);
  // the original, the Dreamport and, if asked, their differences, side by side at `scale` times the size, under a bar
  // that names them and gives the Dreamport's frame; or, `alone`, the Dreamport on its own, with nothing of the original
  function draw(canvas, frame, { difference = false, alone = false, scale = SCALE } = {}) {
    const context = canvas.getContext('2d');
    const original = alone ? null : originals.get(frame), dreamport = kept.get(frame);
    let same = true;
    if (!alone) for (let p = 0; p < PIXELS && same; p++) same = original[p] === dreamport[p];
    context.fillStyle = '#10141c';
    context.fillRect(0, 0, canvas.width, BAR);
    context.font = '12px sans-serif';
    context.textBaseline = 'middle';
    context.fillStyle = '#e8ecf4';
    if (!alone) context.fillText('Original', 8, BAR / 2);
    context.fillText('Dreamport', alone ? 8 : WIDTH * scale + 8, BAR / 2);
    context.textAlign = 'right';
    context.fillText(`frame ${frame}`, canvas.width - 8, BAR / 2);
    const loud = !alone && soundDiffers.has(frame);
    const differs = !same ? (loud ? 'differs, sound too' : 'differs') : loud ? 'sound differs' : '';
    if (differs) {
      context.fillStyle = '#ff5cf0';
      context.fillText(differs, canvas.width - 76, BAR / 2);
    }
    context.textAlign = 'left';
    context.imageSmoothingEnabled = false;
    const pictures = alone ? [toImage(dreamport, 0)] : [toImage(original, 0), toImage(dreamport, 1)];
    let found = null;
    if (difference) {
      found = differences(original, dreamport);
      pictures.push(found.image);
    }
    pictures.forEach((image, i) => {
      panel.getContext('2d').putImageData(image, 0, 0);
      context.drawImage(panel, i * WIDTH * scale, BAR, WIDTH * scale, HEIGHT * scale);
    });
    return found;
  }

  window.__proof = {
    /** Plays frames from `from`, each with its buttons held, and resolves to each picture's hash and each frame's
     *  sound, as { energies, samples }: its energy in each band of pitches and how many samples it had. It keeps what
     *  the console holds at the first frame whose picture isn't the hash in `expected`, and at those `wantStates` names.
     *  It stops after the first frame from `stopsFrom` on whose picture isn't. `after` is what the frame after the last holds. Each size the pictures changed to comes too, as [frame, width, height]. */
    async run(from, held, expected, stopsFrom = Infinity, after = null) {
      const hashes = [], sound = [], neverInPlay = [], sizes = [];
      for (let i = 0; i < held.length; i++) {
        const frame = from + i;
        dreamportsProof.video = null;   // a game can draw some screens with a renderer of its own
        dreamportsProof.neverInPlay = null;
        // `next`: what the frame after holds, which a V-blank that reads the buttons finds held (kit/gba/proof.js)
        const image = await played({ held: held[i], next: held[i + 1] ?? after ?? undefined });
        if (!image) throw new Error('The game handed over no picture.');
        if (__console.id === 'gba' && (image.width !== WIDTH || image.height !== HEIGHT)) {
          throw new Error(`The game's screen is ${image.width} x ${image.height}, not the console's ${WIDTH} x ${HEIGHT}: proof needs it as the console had it.`);
        }
        if (image.width !== ownWidth || image.height !== ownHeight) {
          [ownWidth, ownHeight] = [image.width, image.height];
          sizes.push([frame, ownWidth, ownHeight]);
        }
        const hash = reduce(image, frame), first = !pictureDiffered && hash !== expected[i];
        hashes.push(hash);
        if (first) pictureDiffered = true;
        if (first || wantedStates.has(frame)) keepState(frame);
        // a game's own word that no player could ever see this frame
        if (dreamportsProof.neverInPlay) neverInPlay.push({ frame, why: dreamportsProof.neverInPlay });
        // a game with no sound, or a kit from before the tools heard it, is silent
        const samples = dreamportsProof.heard ?? null, energies = new Float64Array(16);
        if (samples) { filter(samples, energies); heard = true; }
        sound.push({ energies: Array.from(energies), samples: samples ? samples.length / 2 : SILENCE });
        if (first) kept.set(frame, fromRing(frame));
        if (frame >= stopsFrom && hash !== expected[i]) break;
      }
      return { hashes, sound, neverInPlay, sizes };
    },

    /** The frames whose state to keep as they're played, besides the first whose picture differs. */
    wantStates(frames) { for (const frame of frames) wantedStates.add(frame); },

    /** Whether the game has made any sound so far: false for one with no sound yet. */
    get heard() { return heard; },

    /** Marks frames whose sound differs, in the stills and the clip. */
    soundDiffers(frames) { for (const frame of frames) soundDiffers.add(frame); },

    /** Keeps the pictures of these frames, from the last few hundred played. */
    keep(frames) {
      for (const frame of frames) if (!kept.has(frame) && inRing(frame)) kept.set(frame, fromRing(frame));
      return frames.filter(frame => kept.has(frame));
    },

    /** What the console held at a frame kept, in base64, or null. */
    state(frame) {
      const state = keptStates.get(frame);
      return state ? toBase64(state) : null;
    },

    /** Fetches the original's pictures of these frames, one after another in 15-bit colour, from where prove serves them. Playing is over, so the ring goes. */
    async originals(frames, address) {
      ring = null;
      const all = new Uint16Array(await (await fetch(address)).arrayBuffer());
      frames.forEach((frame, i) => originals.set(frame, all.subarray(i * PIXELS, (i + 1) * PIXELS)));
    },

    /** A still of one frame as a PNG in base64, with where it differs when `difference`, or of the Dreamport `alone`. */
    async still(frame, difference = false, alone = false) {
      const canvas = new OffscreenCanvas(WIDTH * SCALE * (alone ? 1 : difference ? 3 : 2), HEIGHT * SCALE + BAR);
      const found = draw(canvas, frame, { difference, alone });
      const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
      return { png: toBase64(png), pixels: found?.pixels ?? 0, box: found?.box ?? null };
    },

    /** The clip of these frames, encoded as H.264, of both or of the Dreamport `alone`, in the encoder's mode for `screen`s or not: { description, frames: [{ key, data }] }, in base64. */
    async video(frames, { bitrate, alone = false, screen = true }) {
      // at the console's own size: doubled, the same clip takes about twice the bytes, and more than the limit in fast play
      const canvas = new OffscreenCanvas(WIDTH * (alone ? 1 : 2), HEIGHT + BAR);
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
      // Constrained Baseline: every phone and browser plays it. The hint is the encoder's mode for screens, which keeps
      // the worst frames clear and stops at what a calm clip needs, and software leaves the graphics chip out of it
      const config = { codec: 'avc1.42E01F', width: canvas.width, height: canvas.height, bitrate, framerate: 1e6 / FRAME_US, ...(screen ? { contentHint: 'text' } : {}), avc: { format: 'avc' } };
      const software = { ...config, hardwareAcceleration: 'prefer-software' };
      const hasSoftware = (await VideoEncoder.isConfigSupported(software)).supported;
      if (!hasSoftware && !(await VideoEncoder.isConfigSupported(config)).supported) throw new Error('This browser can\'t encode H.264 video, so there\'s no clip: Chrome can.');
      encoder.configure(hasSoftware ? software : config);
      for (let i = 0; i < frames.length && !failure; i++) {
        draw(canvas, frames[i], { alone, scale: 1 });
        const frame = new VideoFrame(canvas, { timestamp: Math.round(i * FRAME_US), duration: Math.round(FRAME_US) });
        // a key frame every five seconds is enough to seek in a clip this short, and each is costly
        encoder.encode(frame, { keyFrame: i % 300 === 0 });
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
