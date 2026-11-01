// What the proof tools (tools/README.md) need from a game. With ?proof in the page's address, the game
// keeps no time of its own: it runs a frame only when a tool asks for one, with the buttons the tool gives, and
// hands over the frame it drew. With ?proof=record it plays as usual and keeps the buttons it read at each frame,
// which a tool can give it back with ?proof to run the same game again; a tool can also give it frames to play
// first, such as another recording's, before the player takes over. Without either, none of this runs.
//
// The game's page names its screen and the player's buttons with proof.watch(screen, input), and its clocks
// (clock.js), that player's input (input.js) and the kit's sound (sound/audio.js) do the rest. A tool reaches it on the page as `dreamportsProof`:
// - `mode`: 'play' with ?proof, 'record' with ?proof=record
// - `buttons`: the game's buttons, each { name, gba }, `gba` being the console's button it is (a name in KEY,
//   input.js), or null for one of its own, such as an extra's
// - `ready`: resolves once the game runs, which in play mode means it waits for its first frame
// - `step(frame)`: in play mode, runs one frame with the buttons in `frame.held` held and those in
//   `frame.pressed` just pressed (without `pressed`, those held now and not at the frame before), and resolves
//   to what the screen shows after it, as ImageData; a frame at a time
// - `heard`: in play mode, what the last frame sounded like: an Int16Array of its samples, left and right, at the
//   console's mix rate (65536 a second) and in its 10-bit units around the bias, or null for a game with no sound
// - `frames`: in record mode, what the game read at every frame so far, as { held, pressed }, ready for step()
// - `replay(frames)`: in record mode, before the game starts, frames for it to play first, each { held } with the
//   console's names for its buttons (or the game's own), as a recording has them; the player's buttons do nothing
//   until the last of them has run, and `frames` keeps them with the player's own
// - `replaying`: in record mode, how many of those frames are still to run

const asked = new URLSearchParams(location.search).get('proof');

/** The proof mode, or null: proof.mode is 'play' or 'record'. */
export const proof = asked === null ? null : createProof(asked === 'record' ? 'record' : 'play');

// the console's clock and a frame of it (sound/apu.js)
const CPU_HZ = 16777216, FRAME_CYCLES = 280896;

function createProof(mode) {
  let screen = null, wanted = null, running = null, drawn = null, started;
  // the game's sound, which fills two lists of samples at `rate` with what plays next, and what the last frame played
  let sound = null, rate = 0, played = 0, heard = null;
  // what the frames wait for, such as the sound engine starting (wait())
  let waiting = 0;
  const frames = [];
  let replays = [];   // in record mode, the frames a tool gave to run before the player's own (replay())
  const ready = new Promise(resolve => { started = resolve; });
  const picture = () => screen?.getContext('2d')?.getImageData(0, 0, screen.width, screen.height) ?? null;
  // a frame's sound: the samples a frame's time holds at the sound's rate, 1097 or 1098 of them at the console's mix
  // rate, kept in its 10-bit units (the sound's 1 is 512 of them), or null for a game with no sound
  const hear = () => {
    if (!sound) return null;
    const step = rate * FRAME_CYCLES / CPU_HZ;
    const count = Math.floor((played + 1) * step) - Math.floor(played * step);
    played++;
    const left = new Float32Array(count), right = new Float32Array(count), samples = new Int16Array(count * 2);
    sound(left, right);
    for (let i = 0; i < count; i++) { samples[i * 2] = Math.round(left[i] * 512); samples[i * 2 + 1] = Math.round(right[i] * 512); }
    return samples;
  };
  // a button by the game's name: the first of its buttons that is this one of the console's, or the name as it is
  const named = name => {
    const layout = state.input?.layout;
    return layout?.buttons.find(b => layout.gba?.[b] === name) ?? name;
  };
  const state = {
    mode,
    /** the player's input whose buttons the proof holds or keeps (input.js) */
    input: null,
    /** Names the game's screen and the player whose buttons a tool plays or records. */
    watch(canvas, input) {
      screen = canvas;
      state.input = input;
    },
    /** In play mode, the frames a clock runs now: the one a tool asked for, or none (clock.js). */
    take() {
      started();
      if (!wanted || waiting) return 0;
      running = wanted;
      wanted = null;
      const done = drawn;
      drawn = null;
      // once the loop that runs it has drawn it: a microtask runs when that loop's callback has returned. The sound
      // the frame queued then plays for a frame's time
      queueMicrotask(() => { heard = hear(); done(picture()); });
      return 1;
    },
    /** In play mode, names what plays the game's sound: `play(left, right)` fills both with its next samples, at
     *  `sampleRate` (sound/audio.js). */
    listen(play, sampleRate) { sound = play; rate = sampleRate; },
    /** In play mode, holds the game's frames until `promise` settles, such as the sound engine starting. */
    wait(promise) {
      waiting++;
      const go = () => { waiting--; };
      promise.then(go, go);
    },
    /** The frame running now, as a tool gave it: in play mode the one it asked for, and in record mode the next of
     *  those it gave to replay, or null once they're over (input.js). */
    get frame() {
      if (mode === 'play') return running;
      const next = replays[frames.length];
      return next ? { held: next.held.map(named) } : null;
    },
    /** In record mode, keeps what the game read at a frame (input.js). */
    record(frame) { if (mode === 'record') { frames.push(frame); started(); } },
  };
  globalThis.dreamportsProof = {
    mode,
    get buttons() {
      const layout = state.input?.layout;
      return layout ? layout.buttons.map(name => ({ name, gba: layout.gba?.[name] ?? null })) : [];
    },
    ready,
    step(frame = {}) {
      if (mode !== 'play') return Promise.reject(new Error('step() runs a frame with ?proof in the address, not ?proof=record.'));
      if (wanted || drawn) return Promise.reject(new Error('A frame is already running: wait for it before the next.'));
      wanted = { held: [...(frame.held ?? [])], ...(frame.pressed ? { pressed: [...frame.pressed] } : {}) };
      return new Promise(resolve => { drawn = resolve; });
    },
    frames,
    replay(list) {
      if (mode !== 'record') throw new Error('replay() gives frames to run first with ?proof=record in the address.');
      if (frames.length) throw new Error('The game has started: replay() gives its frames before it does.');
      replays = list.map(frame => ({ held: [...(frame.held ?? [])] }));
    },
    get replaying() { return Math.max(0, replays.length - frames.length); },
    get heard() { return heard; },
  };
  return state;
}
