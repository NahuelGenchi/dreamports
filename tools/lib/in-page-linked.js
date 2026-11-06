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
  const shown = {};
  window.__linked = {
    /** Plays `frames`, each `{ players: [{ held }, …] }`, and resolves to each frame's hashes, one for each player. The
     *  first frame whose hashes aren't `expected`'s (a list of lists) keeps all the players' pictures, once. */
    async run(from, frames, expected, wanted) {
      const hashes = [];
      for (let i = 0; i < frames.length; i++) {
        await played(frames[i]);
        const pictures = dreamportsProof.pictures();
        const mine = pictures.map(hashOf);
        hashes.push(mine);
        const frame = from + i;
        if (!kept && expected[i].some((h, p) => h !== mine[p])) kept = { frame, pictures: pictures.map(coloursOf) };
        if (wanted.includes(frame)) shown[frame] = pictures.map(coloursOf);
      }
      return hashes;
    },
    shown,
    get first() { return kept; },
  };
})();
