// What plays between the menu and a game (#1446), in four moves the launcher calls in turn: `cover` takes the menu to
// night as Play is pressed, `reveal` takes the night off the game once it has drawn, and quitting runs `hide` and
// `uncover`, the same two the other way. Between the moves the launcher's own night stands (#game-cover), so a move
// ends, and the next starts, with the whole screen night. After `cover` the launcher calls `settle`, once its own
// night is under the layers: a game that's slow to open then waits on that night, which says what's opening.
//
// Each draws on two layers of its own, one over the game and one under it, and never keeps anything of the page's: a
// transition that's called off just takes its layers away.
import type { TransitionName } from '../lib/transitions';

const NIGHT = '#050a24';
const BLUE = '#1f5fd0';
const SKY = '#8fd1ff';

export interface Scene {
  /** The menu, which a move may fade but never hides. */
  launcher: HTMLElement;
  /** The game: its page, and the night over it. */
  box: HTMLElement;
  /** The game's picture on the menu, where it shows: what Play was pressed under. */
  picture(): HTMLElement | null;
  /** Where the game draws its screen, once it does. */
  screen(): DOMRect | null;
}

export interface Transition {
  cover(): Promise<void>;
  settle(): void;
  reveal(): Promise<void>;
  hide(): Promise<void>;
  uncover(): Promise<void>;
  /** Takes away whatever a move left on the page. */
  clear(): void;
}

type Frames = Keyframe[];
const play = (el: Element, frames: Frames, duration: number, more: KeyframeAnimationOptions = {}) =>
  el
    .animate(frames, { duration, fill: 'both', easing: 'linear', ...more })
    .finished.then(() => {})
    .catch(() => {});

// the two layers, made when a move first needs one
function layers() {
  const made: { front?: HTMLElement; back?: HTMLElement } = {};
  const layer = (name: 'front' | 'back') => {
    let el = made[name];
    if (!el) {
      el = document.createElement('div');
      el.className = `game-fx game-fx-${name}`;
      el.setAttribute('aria-hidden', 'true');
      document.body.append(el);
      made[name] = el;
    }
    return el;
  };
  const add = <K extends keyof HTMLElementTagNameMap>(name: 'front' | 'back', tag: K, className: string) => {
    const el = document.createElement(tag);
    el.className = className;
    layer(name).append(el);
    return el;
  };
  const clear = () => {
    made.front?.remove();
    made.back?.remove();
    delete made.front;
    delete made.back;
  };
  return { add, clear };
}

// ---------- A plain fade, for calm motion ----------

function fade(): Transition {
  const { add, clear } = layers();
  const night = (from: number, to: number) => {
    clear();
    return play(add('front', 'div', 'game-fx-night'), [{ opacity: from }, { opacity: to }], 180, { easing: 'ease-in-out' });
  };
  return {
    cover: () => night(0, 1),
    settle: clear,
    reveal: () => night(1, 0).then(clear),
    hide: () => night(0, 1),
    uncover: () => night(1, 0).then(clear),
    clear,
  };
}

// ---------- Pixels: big squares from one corner, sky, then blue, then night, and off again the same way ----------

function pixels(): Transition {
  const { add, clear } = layers();
  const SHADES = [SKY, BLUE, NIGHT];
  // how long one square takes to turn, as a part of the whole move, and how far its turn can stray from the sweep
  const TURN = 0.24;
  const STRAY = 0.14;
  const MOVE = 460;
  /** One sweep of the squares: `covering` builds the night up, else it comes off; `back` starts from the far corner. */
  function sweep(covering: boolean, back: boolean) {
    clear();
    const canvas = add('front', 'canvas', 'game-fx-grid');
    const cols = innerWidth < 560 ? 14 : 30;
    const cell = innerWidth / cols;
    const rows = Math.ceil(innerHeight / cell);
    canvas.width = cols;
    canvas.height = rows;
    canvas.style.height = `${rows * cell}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve();
    const starts: number[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const along = (x + y) / (cols + rows - 2);
        starts.push((back ? 1 - along : along) * (1 - TURN - STRAY) + Math.random() * STRAY);
      }
    }
    const draw = (t: number) => {
      ctx.clearRect(0, 0, cols, rows);
      for (let i = 0; i < starts.length; i++) {
        const p = Math.max(0, Math.min(1, (t - starts[i]) / TURN));
        // covering: nothing, sky, blue, night; coming off: night, blue, sky, nothing
        const shade = covering ? (p < 0.25 ? null : SHADES[Math.min(2, Math.floor(p * 4) - 1)]) : p >= 1 ? null : SHADES[2 - Math.min(2, Math.floor(p * 3))];
        if (!shade) continue;
        ctx.fillStyle = shade;
        ctx.fillRect(i % cols, Math.floor(i / cols), 1, 1);
      }
    };
    draw(0);
    return new Promise<void>((done) => {
      const from = performance.now();
      const frame = (now: number) => {
        // a move taken away meanwhile draws no more
        if (!canvas.isConnected) return done();
        const t = Math.min(1, (now - from) / MOVE);
        draw(t);
        if (t < 1) requestAnimationFrame(frame);
        else done();
      };
      requestAnimationFrame(frame);
    });
  }
  return {
    cover: () => sweep(true, false),
    settle: clear,
    reveal: () => sweep(false, false).then(clear),
    hide: () => sweep(true, true),
    uncover: () => sweep(false, true).then(clear),
    clear,
  };
}

// ---------- Power: the menu dims, and a line of light opens into the game, like a handheld switching on ----------

function power({ box }: Scene): Transition {
  const { add, clear: clearLayers } = layers();
  const DOT = 'inset(49.7% 47% 49.7% 47%)';
  const LINE = 'inset(49.7% 0 49.7% 0)';
  const OPEN = 'inset(0 0 0 0)';
  const clear = () => {
    clearLayers();
    for (const a of box.getAnimations()) a.cancel();
  };
  const night = (from: number, to: number, duration: number, easing: string) =>
    play(add('front', 'div', 'game-fx-night'), [{ opacity: from }, { opacity: to }], duration, { easing });
  return {
    cover: () => {
      clear();
      return night(0, 1, 190, 'ease-in');
    },
    settle: clear,
    async reveal() {
      clear();
      // night behind the game while it is a line
      add('back', 'div', 'game-fx-night');
      const beam = add('front', 'div', 'game-fx-beam');
      void play(beam, [{ opacity: 1, transform: 'scaleX(.06)' }, { opacity: 1, transform: 'scaleX(1)', offset: 0.3 }, { opacity: 0, transform: 'scaleX(1)' }], 520, { easing: 'ease-out' });
      await play(box, [{ clipPath: DOT, easing: 'cubic-bezier(.2, .8, .2, 1)' }, { clipPath: LINE, offset: 0.3, easing: 'cubic-bezier(.2, .7, .1, 1)' }, { clipPath: OPEN }], 520);
      clear();
    },
    async hide() {
      clear();
      add('back', 'div', 'game-fx-night');
      const beam = add('front', 'div', 'game-fx-beam');
      void play(beam, [{ opacity: 0, transform: 'scaleX(1)' }, { opacity: 1, transform: 'scaleX(1)', offset: 0.6 }, { opacity: 0, transform: 'scaleX(.06)' }], 420, { easing: 'ease-in' });
      await play(box, [{ clipPath: OPEN, easing: 'cubic-bezier(.6, 0, .9, .4)' }, { clipPath: LINE, offset: 0.62, easing: 'ease-in' }, { clipPath: DOT }], 420);
      // the game is a dot: night takes its place, in front, and the game is whole again under it
      add('front', 'div', 'game-fx-night');
      for (const a of box.getAnimations()) a.cancel();
    },
    async uncover() {
      clearLayers();
      await night(1, 0, 260, 'ease-out');
      clear();
    },
    clear,
  };
}

// ---------- Dive: the picture that was pressed glides to the middle and becomes the game's screen ----------

function dive({ launcher, picture, screen }: Scene): Transition {
  const { add, clear: clearLayers } = layers();
  const GLIDE = 'cubic-bezier(.5, 0, .12, 1)';
  const LIFT = 90;
  // the picture on the menu, put out of sight while its copy flies
  let source: HTMLElement | null = null;
  // the copy, and where it rests: over the game's screen
  let flyer: HTMLCanvasElement | null = null;
  let rest: DOMRect | null = null;
  let waiting = 0;
  const clear = () => {
    clearTimeout(waiting);
    clearLayers();
    for (const a of launcher.getAnimations()) if (a.id === 'dive') a.cancel();
    if (source) source.style.visibility = '';
    source = flyer = null;
  };
  const dim = (from: number, to: number, duration: number, delay = 0) => {
    const a = launcher.animate([{ opacity: from }, { opacity: to }], { duration, delay, fill: 'both', easing: 'ease-out' });
    a.id = 'dive';
    return a.finished.then(() => {}).catch(() => {});
  };
  // what the picture shows now: the recording's frame if it plays, else its still
  function copy(of: HTMLElement) {
    const clip = of.querySelector<HTMLVideoElement>('video.clip');
    const still = of.querySelector<HTMLImageElement>('img.still');
    const from = clip && clip.readyState >= 2 && clip.videoWidth ? clip : still?.complete && still.naturalWidth ? still : null;
    if (!from) return null;
    const canvas = add('front', 'canvas', 'game-fx-flyer');
    canvas.width = from instanceof HTMLVideoElement ? from.videoWidth : from.naturalWidth;
    canvas.height = from instanceof HTMLVideoElement ? from.videoHeight : from.naturalHeight;
    try {
      canvas.getContext('2d')?.drawImage(from, 0, 0);
    } catch {
      // a picture the browser won't hand over: none flies
      canvas.remove();
      return null;
    }
    return canvas;
  }
  // the largest box of the picture's shape that fits the screen, in the middle: where the game's screen is likely to be
  function middle(shape: number) {
    const width = Math.min(innerWidth, innerHeight * shape);
    return new DOMRect((innerWidth - width) / 2, (innerHeight - width / shape) / 2, width, width / shape);
  }
  const place = (el: HTMLElement, at: DOMRect) => Object.assign(el.style, { left: `${at.x}px`, top: `${at.y}px`, width: `${at.width}px`, height: `${at.height}px` });
  const offset = (from: DOMRect, to: DOMRect) => `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.width / to.width}, ${from.height / to.height})`;
  // with no picture to fly, as when the game opens from the browser's forward button with its card closed, night fades
  const plain = fade();
  return {
    async cover() {
      clear();
      source = picture();
      const night = add('front', 'div', 'game-fx-night');
      flyer = source && copy(source);
      if (!source || !flyer) {
        night.remove();
        return plain.cover();
      }
      const from = source.getBoundingClientRect();
      place(flyer, from);
      source.style.visibility = 'hidden';
      void dim(1, 0, 220);
      void play(night, [{ opacity: 0 }, { opacity: 1 }], 300, { delay: 60, easing: 'ease-in-out' });
      // the picture holds for a moment while the menu starts to go, which is when most games have taken their place
      // on the page: it then glides to the game's own screen, or to the middle of this one if the game isn't there yet
      await new Promise((done) => setTimeout(done, LIFT));
      if (!flyer) return;
      rest = screen() ?? middle(flyer.width / flyer.height);
      place(flyer, rest);
      await play(flyer, [{ transform: offset(from, rest) }, { transform: 'none' }], 500, { easing: GLIDE });
    },
    // only the picture stays, over the launcher's night. A game that's slow to open would leave it over the words
    // that say so, so it goes as they come, and the game then shows through a plain fade
    settle() {
      if (!flyer) return plain.settle();
      for (const el of [...(flyer.parentElement?.children ?? [])]) if (el !== flyer) el.remove();
      const gone = flyer;
      waiting = window.setTimeout(() => {
        flyer = null;
        void play(gone, [{ opacity: 1 }, { opacity: 0 }], 250).then(() => gone.remove());
      }, 500);
    },
    async reveal() {
      clearTimeout(waiting);
      if (!flyer || !rest) {
        clear();
        return plain.reveal();
      }
      // the picture settles on the game's screen as it goes
      const to = screen();
      await play(flyer, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: to ? offset(to, rest) : 'none' }], 180, { easing: 'ease-out' });
      clear();
    },
    async hide() {
      clear();
      source = picture();
      const night = add('front', 'div', 'game-fx-night');
      flyer = source && copy(source);
      if (!source || !flyer) {
        night.remove();
        return plain.hide();
      }
      rest = screen() ?? middle(flyer.width / flyer.height);
      place(flyer, rest);
      await Promise.all([play(night, [{ opacity: 0 }, { opacity: 1 }], 140), play(flyer, [{ opacity: 0 }, { opacity: 1 }], 110)]);
    },
    async uncover() {
      if (!source || !flyer || !rest) return plain.uncover();
      const [landing, flying] = [source, flyer];
      const night = flying.previousElementSibling;
      const to = landing.getBoundingClientRect();
      landing.style.visibility = 'hidden';
      void dim(0, 1, 300, 240);
      if (night) void play(night, [{ opacity: 1 }, { opacity: 0 }], 320, { delay: 200, easing: 'ease-in-out' });
      await play(flying, [{ transform: 'none' }, { transform: offset(to, rest) }], 500, { easing: GLIDE });
      // taken away meanwhile, as when another game opens before this one has landed
      if (flyer !== flying) return;
      // the menu's own picture may have gone back to its still meanwhile, so the copy fades off it
      landing.style.visibility = '';
      await play(flying, [{ opacity: 1 }, { opacity: 0 }], 180);
      if (flyer === flying) clear();
    },
    clear() {
      clear();
      plain.clear();
    },
  };
}

/** The transition `name`, or a plain fade when `calm`, for one game opened in `scene`. */
export function transitionFor(name: TransitionName, calm: boolean, scene: Scene): Transition {
  if (calm) return fade();
  return name === 'power' ? power(scene) : name === 'dive' ? dive(scene) : pixels();
}
