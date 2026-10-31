// What the proof tools (tools/README.md) need from a game. With ?proof in the page's address, the game
// keeps no time of its own: it runs a frame only when a tool asks for one, with the buttons the tool gives, and
// hands over the frame it drew. With ?proof=record it plays as usual and keeps the buttons it read at each frame,
// which a tool can give it back with ?proof to run the same game again. Without either, none of this runs.
//
// The game's page names its screen and the player's buttons with proof.watch(screen, input), and its clocks
// (clock.js) and that player's input (input.js) do the rest. A tool reaches it on the page as `dreamportsProof`:
// - `mode`: 'play' with ?proof, 'record' with ?proof=record
// - `buttons`: the game's buttons, each { name, gba }, `gba` being the console's button it is (a name in KEY,
//   input.js), or null for one of its own, such as an extra's
// - `ready`: resolves once the game runs, which in play mode means it waits for its first frame
// - `step(frame)`: in play mode, runs one frame with the buttons in `frame.held` held and those in
//   `frame.pressed` just pressed (without `pressed`, those held now and not at the frame before), and resolves
//   to what the screen shows after it, as ImageData; a frame at a time
// - `frames`: in record mode, what the game read at every frame so far, as { held, pressed }, ready for step()

const asked = new URLSearchParams(location.search).get('proof');

/** The proof mode, or null: proof.mode is 'play' or 'record'. */
export const proof = asked === null ? null : createProof(asked === 'record' ? 'record' : 'play');

function createProof(mode) {
  let screen = null, wanted = null, running = null, drawn = null, started;
  const frames = [];
  const ready = new Promise(resolve => { started = resolve; });
  const picture = () => screen?.getContext('2d')?.getImageData(0, 0, screen.width, screen.height) ?? null;
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
      if (!wanted) return 0;
      running = wanted;
      wanted = null;
      const done = drawn;
      drawn = null;
      // once the loop that runs it has drawn it: a microtask runs when that loop's callback has returned
      queueMicrotask(() => done(picture()));
      return 1;
    },
    /** In play mode, the frame running now, as a tool gave it (input.js). */
    get frame() { return running; },
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
  };
  return state;
}
