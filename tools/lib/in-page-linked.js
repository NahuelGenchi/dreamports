// What prove runs inside a page that has several players' GBAs on one link (kit/gba/proof.js, watch(canvas, input, slot)).
// It plays the page a frame at a time with every player's buttons, and hashes each player's picture as the original's are
// hashed (tools/gba/original.c). The first frame whose picture differs from the original's keeps every player's picture.
(() => {
  const asked = new Map(), stopShowing = cancelAnimationFrame.bind(window);
  let askedId = 2 ** 30;
  window.requestAnimationFrame = callback => { asked.set(++askedId, callback); return askedId; };
  window.cancelAnimationFrame = id => { if (!asked.delete(id)) stopShowing(id); };
  document.documentElement.style.display = 'none';
  const channel = new MessageChannel();
  let nextTask = null;
  channel.port1.onmessage = () => nextTask?.();
  const aTask = () => new Promise(resolve => { nextTask = resolve; channel.port2.postMessage(0); });

  async function played(frame) {
    let ended = false, failed = null;
    dreamportsProof.step(frame).then(() => { ended = true; }, error => { failed = error; ended = true; });
    for (let idle = 0; !ended; idle++) {
      const now = performance.now(), callbacks = [...asked.values()];
      asked.clear();
      for (const callback of callbacks) {
        callback(now);
        await null;
      }
      await aTask();
      if (!ended && idle > 1) await new Promise(resolve => setTimeout(resolve, 1));
    }
    if (failed) throw failed;
  }

  function hashOf({ data }) {
    let hash = 0x811C9DC5;
    for (let i = 0; i < data.length; i += 4) {
      const colour = data[i] >> 3 | (data[i + 1] >> 3) << 5 | (data[i + 2] >> 3) << 10;
      hash = Math.imul(hash ^ colour, 0x01000193);
    }
    return hash >>> 0;
  }
  const coloursOf = ({ data }) => {
    const out = new Array(data.length / 4);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) out[p] = data[i] >> 3 | (data[i + 1] >> 3) << 5 | (data[i + 2] >> 3) << 10;
    return out;
  };

  let kept = null;
  const shown = {}, clip = new Map();
  const FRAME_US = 1e6 * 280896 / 16777216;   // a frame of the console's, in microseconds
  const toBase64 = bytes => {
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
  };
  window.__linked = {
    /** Plays `frames`, each `{ players: [{ held }, …] }`, and resolves to each frame's hashes, one for each player. The
     *  first frame whose hashes aren't `expected`'s (a list of lists) keeps all the players' pictures, once. */
    async run(from, frames, expected, wanted, clipped = []) {
      const hashes = [];
      for (let i = 0; i < frames.length; i++) {
        await played(frames[i]);
        const pictures = dreamportsProof.pictures();
        const mine = pictures.map(hashOf);
        hashes.push(mine);
        const frame = from + i;
        if (!kept && expected[i].some((h, p) => h !== mine[p])) kept = { frame, pictures: pictures.map(coloursOf) };
        if (wanted.includes(frame)) shown[frame] = pictures.map(coloursOf);
        if (clipped.includes(frame)) clip.set(frame, pictures.map(({ data }) => Uint16Array.from({ length: data.length / 4 }, (_, i) => data[i * 4] >> 3 | (data[i * 4 + 1] >> 3) << 5 | (data[i * 4 + 2] >> 3) << 10)));
      }
      return hashes;
    },
    shown,
    /** The clip of these frames, as H.264: the Dreamport's pictures above, and below them the original's, which are
     *  fetched from `address` (every frame's, player after player, in 15-bit colour). `apart` counts the frames where a
     *  player's picture differs from the original's in more than half its pixels, as two different places do. */
    async video(frames, address, bitrate) {
      const all = new Uint16Array(await (await fetch(address)).arrayBuffer());
      const players = clip.get(frames[0]).length, W = 240, H = 160, PIXELS = W * H;
      const canvas = new OffscreenCanvas(W * players, H * 2), context = canvas.getContext('2d');
      const image = context.createImageData(W * players, H * 2), pixels = new Uint32Array(image.data.buffer);
      const put = (colours, row, p) => {
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const c = colours[y * W + x], r = (c & 31) << 3 | (c & 31) >> 2, g = (c >> 5 & 31) << 3 | (c >> 5 & 31) >> 2, b = (c >> 10 & 31) << 3 | (c >> 10 & 31) >> 2;
            pixels[(row * H + y) * W * players + p * W + x] = 0xFF000000 | b << 16 | g << 8 | r;
          }
        }
      };
      const differing = (ours, theirs) => {
        let n = 0;
        for (let p = 0; p < PIXELS; p++) if ((ours[p] & 0x7FFF) !== (theirs[p] & 0x7FFF)) n++;
        return n;
      };
      const chunks = [];
      let description = null, failure = null, apart = 0;
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
      const config = { codec: 'avc1.42E01F', width: canvas.width, height: canvas.height, bitrate, framerate: 1e6 / FRAME_US, avc: { format: 'avc' } };
      const software = { ...config, hardwareAcceleration: 'prefer-software' };
      encoder.configure((await VideoEncoder.isConfigSupported(software)).supported ? software : config);
      for (let i = 0; i < frames.length && !failure; i++) {
        const ours = clip.get(frames[i]);
        let away = false;
        for (let p = 0; p < players; p++) {
          const theirs = all.subarray((i * players + p) * PIXELS, (i * players + p + 1) * PIXELS);
          put(ours[p], 0, p);
          put(theirs, 1, p);
          away ||= differing(ours[p], theirs) > PIXELS / 2;
        }
        if (away) apart++;
        context.putImageData(image, 0, 0);
        const frame = new VideoFrame(canvas, { timestamp: Math.round(i * FRAME_US), duration: Math.round(FRAME_US) });
        encoder.encode(frame, { keyFrame: i % 300 === 0 });
        frame.close();
        while (encoder.encodeQueueSize > 4 && !failure) await new Promise(resolve => encoder.addEventListener('dequeue', resolve, { once: true }));
      }
      if (!failure) await encoder.flush();
      encoder.close();
      if (failure) throw failure;
      return { width: canvas.width, height: canvas.height, description: toBase64(description), frames: chunks.map(c => ({ key: c.key, data: toBase64(c.data) })), apart };
    },
    get first() { return kept; },
  };
})();
