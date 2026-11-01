// The page's side of the sound: starts the AudioWorklet with a copy of the ROM and forwards the game's calls to
// it. The worklet is the kit's (worklet.js), or the game's own when it adds sounds of its own, such as an extra's
// (processor.js), which it is sent what they need (keep). Browsers keep audio paused until the page has been
// interacted with; choosing the ROM counts, and any later key press or tap resumes it too. A multiplayer game on
// one page has one engine per GBA, each GBA's game calling its own (`forGba`).
//
// While a proof tool plays the game (proof.js), the worklet's processor runs on the page instead, with no
// AudioContext: the tool runs a frame of its sound after each of the game's frames and keeps what it played, at the
// console's own mix rate (onPage).

import { proof } from '../proof.js';

const GAIN = 0.5;   // the GBA's full scale is loud next to other pages; half of it leaves headroom
// the rate the console mixes its sound at once the sound library has started: every 256 cycles (apu.js)
const PROOF_RATE = 65536;

// the worklet module's processor, made on the page: the module finds what an AudioWorklet gives it, registers its
// processor, and the page talks to it as it would to the worklet's node
let onPageProcessor = null;
async function onPage(worklet) {
  if (!onPageProcessor) {
    globalThis.sampleRate = PROOF_RATE;
    globalThis.AudioWorkletProcessor ??= class { constructor() { this.port = { onmessage: null, postMessage() {} }; } };
    globalThis.registerProcessor = (name, Processor) => { onPageProcessor = Processor; };
    await import(String(worklet));
  }
  const processor = new onPageProcessor();
  return { processor, port: { postMessage: data => processor.port.onmessage?.({ data }) } };
}

/**
 * The game's sound. `worklet` is the address of the AudioWorklet module that registers the 'gba-sound' processor:
 * the kit's by default, or the game's own (processor.js). `calls(call, send)` gives the game's own calls on each
 * GBA's sound, such as its music manager's: `call(name, ...args)` queues one for that GBA's engine or music
 * manager, and `send(message)` posts a message to the game's processor.
 */
export function createSound({ worklet = new URL('./worklet.js', import.meta.url), calls = () => ({}) } = {}) {
  let ctx = null, node = null, muted = false, held = false, songPlayers = null, count = 1;
  const waiting = [], kept = new Map();
  const post = msg => (node ? node.port.postMessage(msg) : waiting.push(msg));
  const resume = () => { if (ctx?.state === 'suspended' && !held) ctx.resume().catch(() => {}); };   // closed meanwhile: nothing to resume
  addEventListener('pointerdown', resume);
  addEventListener('keydown', resume);

  // the calls a game makes on its GBA's engine
  function gbaSound(gba) {
    const call = (name, ...args) => post({ type: 'call', name, args, gba });
    return {
      /** m4aSongNumStart */
      play(song) { call('songStart', song); },
      /** m4aSongNumStartOrChange: starts the song unless it is already playing on its player */
      playOrChange(song) { call('songStartOrChange', song); },
      /** m4aSongNumStart, then m4aMPlayImmInit and m4aMPlayPitchControl on its player (pitch in 1/256 semitones) */
      playPitched(song, pitch) {
        const p = songPlayers?.[song] ?? 0;
        call('songStart', song); call('immInit', p); call('pitchControl', p, 0xFFFF, pitch);
      },
      /** MPlayStart with the song on music player `player`, then m4aMPlayImmInit and the volume and pan controls
       *  on all its tracks (volume 256 is full; pan −64 is left, +63 right) */
      playOn(player, song, volume, pan) {
        call('playerStart', player, song); call('immInit', player);
        call('volumeControl', player, 0xFFFF, volume); call('panpotControl', player, 0xFFFF, pan);
      },
      /** m4aSongNumStop */
      stop(song) { call('songStop', song); },
      /** MPlayStart with the song on music player `player`, and nothing else */
      startOn(player, song) { call('playerStart', player, song); },
      /** MPlayStop on music player `player` */
      stopPlayer(player) { call('playerStop', player); },
      /** m4aSongNumStartOrContinue */
      startOrContinue(song) { call('songStartOrContinue', song); },
      /** m4aMPlayVolumeControl on the tracks `bits` of music player `player` */
      volume(player, bits, volume) { call('volumeControl', player, bits, volume); },
      /** m4aMPlayFadeIn on music player `player`, a step up every `speed` frames */
      fadeIn(player, speed) { call('fadeIn', player, speed); },
      /** m4aMPlayFadeOut on music player `player`, a step down every `speed` frames */
      fadeOut(player, speed) { call('fadeOut', player, speed); },
      /** m4aMPlayContinue on music player `player` */
      continuePlayer(player) { call('playerContinue', player); },
      /** m4aMPlayTempoControl on the music (0x100 is normal speed) */
      tempo(tempo) { call('tempoControl', 0, tempo); },
      /** m4aMPlayAllStop: every music player stops */
      stopAll() { call('allStop'); },
      /** m4aMPlayAllContinue: every music player goes on from where it stopped */
      continueAll() { call('allContinue'); },
      /** Queues any call for this GBA's engine, or for the game's music manager */
      call,
      ...calls(call, post),
    };
  }

  return {
    ...gbaSound(0),
    /** The sound of GBA `i` of a multiplayer game, with the same calls as this one's */
    forGba: i => gbaSound(i),

    /** Starts the engine on `romBuffer`, one for each of `gbas` GBAs (the music heard from the first). Resolves
     *  once it runs; without Web Audio the game stays silent. */
    async load(romBuffer, layout, gbas = 1) {
      count = gbas;
      await ctx?.close();
      ctx = node = null;
      const bytes = new Uint8Array(romBuffer);
      songPlayers = Array.from({ length: layout.songs }, (_, n) => bytes[layout.songTable + n * 8 + 4]);
      if (proof?.mode === 'play') {
        // the game's frames wait while the engine starts, so it starts at the same frame every time
        const started = onPage(worklet).then(made => {
          node = made;
          node.port.postMessage({ type: 'raw' });
          node.port.postMessage({ type: 'rom', rom: romBuffer, layout, count });
          for (const message of kept.values()) node.port.postMessage(message);
          for (const msg of waiting.splice(0)) node.port.postMessage(msg);
          proof.listen((left, right) => made.processor.process([], [[left, right]]), PROOF_RATE);
        });
        proof.wait(started);
        return started;
      }
      if (!globalThis.AudioWorkletNode) { waiting.length = 0; return; }
      const c = new AudioContext({ latencyHint: 'interactive' });
      ctx = c;
      await c.audioWorklet.addModule(worklet);
      if (ctx !== c) return;   // another ROM was chosen meanwhile
      node = new AudioWorkletNode(c, 'gba-sound', { numberOfInputs: 0, outputChannelCount: [2] });
      node.connect(c.destination);
      node.port.postMessage({ type: 'rom', rom: romBuffer, layout, count });
      for (const message of kept.values()) node.port.postMessage(message);
      node.port.postMessage({ type: 'gain', value: muted ? 0 : GAIN });
      for (const msg of waiting.splice(0)) node.port.postMessage(msg);
      resume();
    },
    /** Sends `message` to the game's processor now if it runs, and each time the engine starts on a ROM after,
     *  such as the data an extra's sounds need; one of the same `type` takes the place of the last. */
    keep(message) { kept.set(message.type, message); node?.port.postMessage(message); },

    get muted() { return muted; },
    set muted(value) { muted = value; post({ type: 'gain', value: muted ? 0 : GAIN }); },
    /** Stops the sound where it is while the game is held (its settings are open), and goes on with it after */
    get held() { return held; },
    set held(value) { held = value; if (held) ctx?.suspend().catch(() => {}); else resume(); },
    /** The page's AudioContext once the engine has started, for sounds of the page's own (the unlock chime) */
    get context() { return ctx; },
  };
}
