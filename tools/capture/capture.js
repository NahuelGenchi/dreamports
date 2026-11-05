// The window of npm run dp -- capture (tools/capture.mjs): the person plays their copy of the original, which the
// tool runs on this computer a frame at a time, with their buttons from here and its pictures and sound back, then
// chooses among the best moments of what they played. The tool then asks it to encode the one they chose.

import { connectedPads, createInput, holdsSettingsCombo } from '../../kit/gba/input.js';
import { layoutOf } from '../../kit/consoles.js';

// the game's console
const machine = await (await fetch('/capture/console')).json();
const [WIDTH, HEIGHT] = machine.screen, PICTURE = WIDTH * HEIGHT * 2;
// how many times its size a moment is kept
const scaleOf = moment => (moment.width > 320 ? 1 : 2);
const FRAME_MS = 1000 * machine.frame[0] / machine.frame[1];
const SOUND_RATE = machine.sound;

const $ = id => document.getElementById(id);
const LAYOUT = {
  buttons: ['up', 'down', 'left', 'right', 'a', 'b', 'l', 'r', 'start', 'select'],
  gba: { up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', a: 'A', b: 'B', l: 'L', r: 'R', start: 'START', select: 'SELECT' },
  keys: { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyZ: 'a', KeyX: 'b', KeyA: 'l', KeyS: 'r', Enter: 'start', Backspace: 'select' },
  pad: { a: [0], b: [1], l: [4], r: [5], select: [8], start: [9], up: [12], down: [13], left: [14], right: [15] },
};
const layout = machine.id === 'gba' ? LAYOUT : layoutOf(machine.id);
const input = createInput(layout);
input.enabled = true;
// the buttons held, as the bits the tool plays the original with
const heldBits = () => (machine.id === 'gba' ? input.gbaKeys() : layout.buttons.reduce((bits, button) => (input[button] ? bits | (machine.keys[layout.console[button]] ?? 0) : bits), 0));
const YES = machine.keys.A ?? machine.keys.CROSS, NO = machine.keys.B ?? machine.keys.CIRCLE;
if (machine.id !== 'gba') {
  const named = key => key.replace(/^Key|^Arrow/, '');
  document.querySelector('.keys').replaceChildren(...Object.entries(layout.keys).map(([key, button]) => {
    const line = document.createElement('span'), cap = document.createElement('kbd');
    cap.textContent = named(key);
    line.append(cap, ` ${layout.console[button]}`);
    return line;
  }));
}

// each 15-bit colour as the browser draws it
const RGBA = new Uint32Array(32768);
for (let c = 0; c < 32768; c++) {
  const r = c & 31, g = c >> 5 & 31, b = c >> 10 & 31;
  RGBA[c] = (0xFF << 24 | (b << 3 | b >> 2) << 16 | (g << 3 | g >> 2) << 8 | r << 3 | r >> 2) >>> 0;
}
$('screen').width = WIDTH;
$('screen').height = HEIGHT;
const image = new ImageData(WIDTH, HEIGHT);
const pixels = new Uint32Array(image.data.buffer);
function draw(context, picture, at = 0) {
  for (let i = 0; i < pixels.length; i++) pixels[i] = RGBA[picture[at + i]];
  context.putImageData(image, 0, 0);
}

let phase = 'play';
function show(view, words) {
  phase = view;
  for (const id of ['play', 'choose', 'wait']) $(id).hidden = id !== view;
  if (view === 'wait') $('waiting').textContent = words;
  fit();
}

// the screen at a whole step, as big as the window has room for
function fit() {
  if (phase === 'play') {
    const scale = Math.max(1, Math.floor(Math.min((innerWidth - 40) / WIDTH, (innerHeight - 190) / HEIGHT)));
    $('screen').style.width = `${WIDTH * scale}px`;
    $('screen').style.height = `${HEIGHT * scale}px`;
  } else if (phase === 'choose' && moments.length) {
    const columns = Math.min(3, moments.length), rows = Math.ceil(moments.length / columns);
    // each is its own size, so the tallest for its width decides
    const tallest = Math.max(...moments.map(({ canvas }) => canvas.height / canvas.width));
    const width = Math.floor(Math.min((innerWidth - 40 - (columns - 1) * 14) / columns, ((innerHeight - 170 - (rows - 1) * 14) / rows) / tallest));
    $('moments').style.gridTemplateColumns = `repeat(${columns}, ${width}px)`;
    for (const { canvas } of moments) {
      canvas.style.width = `${width}px`;
      canvas.style.height = `${Math.round(width * canvas.height / canvas.width)}px`;
    }
  }
}
addEventListener('resize', fit);

// playing

const screen = $('screen').getContext('2d');
const sound = new AudioContext({ sampleRate: SOUND_RATE, latencyHint: 'interactive' });
let soundAt = 0;
function hear(bytes) {
  const samples = new Int16Array(bytes), count = samples.length / 2;
  if (!count) return;
  const buffer = sound.createBuffer(2, count, SOUND_RATE);
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  for (let i = 0; i < count; i++) {
    left[i] = samples[i * 2] / 512;    // the console's 10-bit units around the bias
    right[i] = samples[i * 2 + 1] / 512;
  }
  const source = sound.createBufferSource();
  source.buffer = buffer;
  source.connect(sound.destination);
  const now = sound.currentTime;
  if (soundAt < now + 0.02 || soundAt > now + 0.25) soundAt = now + 0.05;
  source.start(soundAt);
  soundAt += count / SOUND_RATE;
}

let next = 0, busy = false, played = 0;
async function playFrames() {
  if (busy) return;
  busy = true;
  try {
    while (phase === 'play') {
      const now = performance.now();
      if (now < next) break;
      // a long wait isn't caught up on
      next = Math.max(next + FRAME_MS, now - FRAME_MS * 3);
      input.poll();
      if (connectedPads().some(holdsSettingsCombo)) {
        finish();
        break;
      }
      const response = await fetch(`/capture/frame?buttons=${heldBits()}`);
      if (!response.ok) throw new Error(await response.text());
      const bytes = await response.arrayBuffer();
      draw(screen, new Uint16Array(bytes, 0, PICTURE / 2));
      hear(bytes.slice(PICTURE));
      played++;
    }
  } catch (error) {
    show('wait', `The game stopped: ${error.message}`);
  }
  busy = false;
}

async function finish() {
  if (phase !== 'play') return;
  input.release();
  show('wait', 'Finding the best moments…');
  while (busy) await new Promise(resolve => setTimeout(resolve, 5));
  await showMoments(await (await fetch('/capture/finish', { method: 'POST' })).json());
}
$('finish').addEventListener('click', finish);

// choosing

let moments = [], at = 0, shownAt = 0, last = 0;

// each moment's frames and size. Its pictures have room for the game's largest, and its canvas shows only its own
async function showMoments(found) {
  $('moments').replaceChildren();
  moments = [];
  if (!found.length) {
    $('said').textContent = 'Nothing to choose from yet. Play longer, moving around, then finish again.';
    next = performance.now();
    show('play');
    return;
  }
  show('wait', 'Getting them ready…');
  for (let i = 0; i < found.length; i++) {
    const { frames: length, size: [width, height] } = found[i];
    const button = document.createElement('button'), canvas = document.createElement('canvas');
    button.className = 'moment';
    button.type = 'button';
    button.setAttribute('aria-label', `Moment ${i + 1}, ${(length * FRAME_MS / 1000).toFixed(1)} seconds`);
    canvas.width = width;
    canvas.height = height;
    button.append(canvas);
    button.addEventListener('click', () => pick(i));
    button.addEventListener('pointerenter', () => select(i));
    $('moments').append(button);
    const bytes = await (await fetch(`/capture/moment/${i}`)).arrayBuffer();
    moments.push({ button, canvas, context: canvas.getContext('2d'), length, width, height, pictures: new Uint16Array(bytes) });
  }
  shownAt = performance.now();
  select(0);
  show('choose');
}

function select(i) {
  at = i;
  moments.forEach((moment, k) => moment.button.classList.toggle('at', k === i));
}

async function pick(i) {
  if (phase !== 'choose') return;
  show('wait', 'Keeping it…');
  await fetch(`/capture/choose/${i}`, { method: 'POST' });
}

function keepPlaying() {
  if (phase !== 'choose' || $('more').hidden) return;
  $('said').textContent = 'Play on, then finish again. The list comes from all of it.';
  next = performance.now();
  show('play');
}
$('more').addEventListener('click', keepPlaying);

// every moment moving together, and the buttons that move among them, seen once each press
function chooseFrames() {
  const frame = Math.floor((performance.now() - shownAt) / FRAME_MS);
  for (const { context, length, pictures } of moments) draw(context, pictures, frame % length * WIDTH * HEIGHT);
  input.poll();
  const now = heldBits(), pressed = now & ~last;
  last = now;
  const columns = Math.min(3, moments.length), to = i => Math.max(0, Math.min(moments.length - 1, i));
  if (pressed & machine.keys.RIGHT) select(to(at + 1));
  if (pressed & machine.keys.LEFT) select(to(at - 1));
  if (pressed & machine.keys.UP) select(to(at - columns));
  if (pressed & machine.keys.DOWN) select(to(at + columns));
  if (pressed & (YES | machine.keys.START)) pick(at);
  if (pressed & NO) keepPlaying();
}

addEventListener('keydown', e => {
  if (e.key !== 'Escape' || e.repeat) return;
  if (phase === 'play') finish();
  else keepPlaying();
});

// the window can stay open as long as a game takes to make, so with nobody playing it rests, drawing and playing nothing
// and using next to nothing, until a button is pressed
const RESTS_AFTER_MS = 30_000, LOOKS_EVERY_MS = 100;
let touched = performance.now(), phaseBefore = phase, resting = false;
const touch = () => { touched = performance.now(); };
for (const type of ['keydown', 'pointerdown', 'pointermove', 'wheel']) addEventListener(type, touch, { passive: true, capture: true });

function rest(on) {
  if (on === resting) return;
  resting = on;
  document.body.classList.toggle('resting', on);
  if (on) sound.suspend();
  else {
    sound.resume();
    soundAt = 0;
  }
}

(function tick() {
  if (resting) input.poll();
  // a button held down is someone playing, and a new screen hasn't been looked at yet
  if (heldBits() || phase !== phaseBefore) touch();
  phaseBefore = phase;
  rest(phase !== 'wait' && performance.now() - touched > RESTS_AFTER_MS);
  if (resting) {
    setTimeout(tick, LOOKS_EVERY_MS);
    return;
  }
  requestAnimationFrame(tick);
  if (phase === 'play') playFrames();
  else if (phase === 'choose') chooseFrames();
})();

// what the tool asks for once the person has chosen

const toBase64 = bytes => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(text);
};
const small = new OffscreenCanvas(WIDTH, HEIGHT);
const smallContext = small.getContext('2d');
// frame `frame` of a moment, drawn at a whole step on a canvas
function paint(canvas, moment, frame, x, y, scale) {
  draw(smallContext, moment.pictures, frame * WIDTH * HEIGHT);
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.drawImage(small, 0, 0, moment.width, moment.height, x, y, moment.width * scale, moment.height * scale);
}
const blobBase64 = async blob => toBase64(new Uint8Array(await blob.arrayBuffer()));

const CODECS = {
  h264: { codec: 'avc1.42E01F', avc: { format: 'avc' } },   // Constrained Baseline: every phone and browser plays it
  av1: { codec: 'av01.0.04M.08' },
};

window.__capture = {
  /** The moment encoded: { width, height, description, frames: [{ key, data }] }, in base64. */
  async encode(i, codec, bitrate) {
    const moment = moments[i], scale = scaleOf(moment);
    const canvas = new OffscreenCanvas(moment.width * scale, moment.height * scale);
    const chunks = [];
    let description = null, failure = null;
    const encoder = new VideoEncoder({
      output(chunk, metadata) {
        const config = metadata?.decoderConfig?.description;
        if (config) description = new Uint8Array(ArrayBuffer.isView(config) ? config.buffer.slice(config.byteOffset, config.byteOffset + config.byteLength) : config.slice(0));
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks.push({ key: chunk.type === 'key', data });
      },
      error(error) { failure = error; },
    });
    const config = { ...CODECS[codec], width: canvas.width, height: canvas.height, bitrate, framerate: 1000 / FRAME_MS };
    if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error(`This browser can't encode ${codec === 'av1' ? 'AV1' : 'H.264'} video, which the site needs: Chrome can.`);
    encoder.configure(config);
    for (let f = 0; f < moment.length && !failure; f++) {
      paint(canvas, moment, f, 0, 0, scale);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(f * FRAME_MS * 1000), duration: Math.round(FRAME_MS * 1000) });
      encoder.encode(frame, { keyFrame: f % 120 === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4 && !failure) await new Promise(resolve => encoder.addEventListener('dequeue', resolve, { once: true }));
    }
    if (!failure) await encoder.flush();
    encoder.close();
    if (failure) throw failure;
    return { width: canvas.width, height: canvas.height, description: description && toBase64(description), frames: chunks.map(c => ({ key: c.key, data: toBase64(c.data) })) };
  },

  /** The moment's first frame as a WebP picture, in base64. */
  async still(i) {
    const moment = moments[i], scale = scaleOf(moment);
    const canvas = new OffscreenCanvas(moment.width * scale, moment.height * scale);
    paint(canvas, moment, 0, 0, 0, scale);
    return blobBase64(await canvas.convertToBlob({ type: 'image/webp', quality: 1 }));
  },

  /** What chat apps and social sites show: the still three times the size, on the site's navy, as a PNG in base64. */
  async share(i) {
    const canvas = new OffscreenCanvas(1200, 630);
    const context = canvas.getContext('2d');
    context.fillStyle = '#050a24';
    context.fillRect(0, 0, canvas.width, canvas.height);
    paint(canvas, moments[i], 0, (canvas.width - moments[i].width * 3) / 2, (canvas.height - moments[i].height * 3) / 2, 3);
    return blobBase64(await canvas.convertToBlob({ type: 'image/png' }));
  },

  kept() { show('wait', 'Kept. This window closes by itself.'); },
};

// with --choose the moments are ready, and there's no playing
const about = await (await fetch('/capture/about')).json();
document.title = `Capture ${about.name}`;
if (about.choosing) {
  $('more').hidden = true;
  await showMoments(await (await fetch('/capture/moments')).json());
  window.__capture.loaded = true;
} else {
  show('play');
}
