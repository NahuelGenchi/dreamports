// The rows of labels behind the launcher (docs/LABELS.md): flush rows of 240 x 60 places from the bottom of the
// screen to the top, each drifting slowly the other way from the one below it. A label someone asked for takes a
// place, the rows furthest from the game first, and every other place shows one of the site's own pixel-art scenes
// (label-scenes/), each one different, so the rows are always full and nothing on the screen repeats. A few places
// hold the site's own invitation instead, saying they could hold someone's art or brand.

import { SCENE_H, drawScene } from './label-scenes/index.mjs';
import { drawInvite } from './label-scenes/invite.mjs';
import { steady } from './label-scenes/steady.mjs';
import { PLACE as W, kindOf, layout, seedOf } from './label-rows.mjs';

interface Label {
  src: string;
  start: string;
}

const H = SCENE_H;
const DAYS = 30;
// pixels a second
const SPEED = 6;
const DAY = 24 * 60 * 60 * 1000;
// how long the scenes may draw before the page gets a turn, in milliseconds
const SLICE = 8;

const box = document.querySelector<HTMLElement>('.launcher > .labels');
const launcher = box?.closest<HTMLElement>('.launcher');
if (box && launcher) {
  try {
    run(box, launcher);
  } catch (error) {
    // the rows are only a background: if they break, the launcher goes on without them
    box.remove();
    console.error(error);
  }
}

function run(box: HTMLElement, launcher: HTMLElement) {
  const now = Date.now();
  // a page built before a label's 30 days ended still leaves it out
  const labels = (JSON.parse(box.dataset.labels || '[]') as Label[]).filter((label) => {
    const from = Date.parse(label.start + 'T00:00:00Z');
    return from <= now && now < from + DAYS * DAY;
  });
  const rowsEl = box.querySelector<HTMLElement>('.label-rows');
  if (!rowsEl) {
    box.remove();
    return;
  }

  let built = '';
  let job = 0;
  let urls: string[] = [];

  // gives the page a turn between slices of drawing, so it never stutters while the rows are made
  const pause = () => new Promise<void>((done) => setTimeout(done, 0));

  // one picture of a row's scenes, shown twice: as an image when the browser can make one, so its pixels are kept once
  const picture = (canvas: HTMLCanvasElement) =>
    new Promise<string>((done) => {
      try {
        canvas.toBlob((blob) => done(blob ? URL.createObjectURL(blob) : ''), 'image/png');
      } catch {
        done('');
      }
    });

  async function build() {
    const width = launcher.clientWidth;
    const height = launcher.clientHeight;
    const rows = Math.ceil(height / H);
    const density = window.devicePixelRatio || 1;
    if (!rows || !width || built === `${rows} ${width} ${density}`) return;
    built = `${rows} ${width} ${density}`;
    // where a scene's pixel is less than two of the screen's, its flickering details are softened as it's drawn
    const settle = density < 2;
    const mine = ++job;
    let slice = performance.now();

    // rows counted from the bottom: their places, their labels and where an invitation goes
    const plan = layout(width, height, labels.length, H);

    const made: HTMLElement[] = [];
    const fresh: string[] = [];
    for (let r = 0; r < rows; r++) {
      const { places, invite } = plan[r];
      const lefts = places.map((_, k) => places.slice(0, k).reduce((a, b) => a + b, 0));
      // Half the track is the row's places and the other half repeats them, so the row never ends.
      const half = lefts[places.length - 1] + places[places.length - 1];
      const seconds = half / SPEED;

      const row = document.createElement('div');
      row.className = 'label-row';
      row.style.bottom = r * H + 'px';
      const track = document.createElement('div');
      track.className = 'label-track ' + (r % 2 === 0 ? 'go-left' : 'go-right');
      track.style.width = half * 2 + 'px';
      track.style.animationDuration = seconds.toFixed(2) + 's';
      track.style.animationDelay = (-((r * 29) % seconds)).toFixed(2) + 's';

      const taken = new Map<number, Label>(plan[r].labels.map(({ index, place }) => [place, labels[index]]));

      // every place without a label, drawn once into one picture for the whole row
      const canvas = document.createElement('canvas');
      canvas.width = half;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        for (let k = 0; k < places.length; k++) {
          if (taken.has(k)) continue;
          const image = ctx.createImageData(places[k], H);
          const pixels = invite?.place === k ? drawInvite(invite.words, seedOf(r, k)) : drawScene(places[k], kindOf(r, k), seedOf(r, k));
          image.data.set(settle ? steady(pixels, places[k]) : pixels);
          ctx.putImageData(image, lefts[k], 0);
          if (performance.now() - slice > SLICE) {
            await pause();
            // a newer size started over
            if (mine !== job) return;
            slice = performance.now();
          }
        }
      }
      const url = ctx ? await picture(canvas) : '';
      if (mine !== job) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      for (const left of [0, half]) {
        let scenes: HTMLImageElement | HTMLCanvasElement;
        if (url) {
          const img = document.createElement('img');
          img.src = url;
          img.alt = '';
          img.decoding = 'async';
          img.draggable = false;
          scenes = img;
        } else {
          // no image: the canvas itself, and a copy of it for the repeat
          scenes = left ? document.createElement('canvas') : canvas;
          if (left && ctx) {
            (scenes as HTMLCanvasElement).width = half;
            (scenes as HTMLCanvasElement).height = H;
            (scenes as HTMLCanvasElement).getContext('2d')?.drawImage(canvas, 0, 0);
          }
        }
        scenes.className = 'label-scenes';
        scenes.style.left = left + 'px';
        scenes.style.width = half + 'px';
        track.append(scenes);
      }
      if (url) {
        fresh.push(url);
        canvas.width = canvas.height = 0;
      }

      for (const [k, label] of taken) {
        for (const left of [lefts[k], lefts[k] + half]) {
          const img = document.createElement('img');
          img.src = label.src;
          img.alt = '';
          img.width = W;
          img.height = H;
          img.decoding = 'async';
          img.draggable = false;
          img.style.left = left + 'px';
          track.append(img);
        }
      }
      row.append(track);
      made.push(row);
    }

    // the rows come in together once their pictures are ready, never one picture at a time
    const imgs = made.flatMap((row) => [...row.querySelectorAll('img')]);
    await Promise.race([Promise.all(imgs.map((img) => img.decode().catch(() => {}))), new Promise((done) => setTimeout(done, 4000))]);
    if (mine !== job) {
      fresh.forEach((url) => URL.revokeObjectURL(url));
      return;
    }
    rowsEl!.replaceChildren(...made);
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls = fresh;
    box.classList.add('is-ready');
    launcher.classList.add('has-labels');
  }

  // a window moved to a screen of another density draws its rows again for it
  const watchDensity = () =>
    matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener(
      'change',
      () => {
        build().catch((error) => console.error(error));
        watchDensity();
      },
      { once: true },
    );
  watchDensity();

  build().catch((error) => {
    box.remove();
    console.error(error);
  });
  // a new size rebuilds the rows once it settles
  let wait = 0;
  new ResizeObserver(() => {
    clearTimeout(wait);
    wait = window.setTimeout(() => build().catch((error) => console.error(error)), built ? 250 : 0);
  }).observe(launcher);
}
