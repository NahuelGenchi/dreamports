// The rows of labels behind the launcher (docs/LABELS.md): flush rows of 240 x 60 places from the bottom of the
// screen to the top, each drifting slowly the other way from the one below it. A label someone asked for takes a
// place, the rows furthest from the game first, and every other place shows one of the site's own pixel-art scenes
// (label-scenes/), each one different, so the rows are always full and nothing on the screen repeats.

import { SCENE_H, drawScene } from './label-scenes/index.mjs';
import { PLACE as W, kindOf, placesFor, seedOf } from './label-rows.mjs';

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
    if (!rows || !width || built === `${rows} ${width}`) return;
    built = `${rows} ${width}`;
    const mine = ++job;
    let slice = performance.now();

    // rows counted from the bottom, ordered by how far they stand from the middle, where the game is
    const order = [...Array(rows).keys()].sort((a, b) => {
      const far = (r: number) => Math.abs(height - (r + 0.5) * H - height / 2);
      return far(b) - far(a) || a - b;
    });
    const held: Label[][] = Array.from({ length: rows }, () => []);
    labels.forEach((label, i) => held[order[i % rows]].push(label));

    const made: HTMLElement[] = [];
    const fresh: string[] = [];
    for (let r = 0; r < rows; r++) {
      const list = held[r];
      const places = placesFor(width, list.length);
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

      // the labels spread evenly over the places of their size
      const sized = places.flatMap((w, k) => (w === W ? [k] : []));
      const taken = new Map<number, Label>();
      list.forEach((label, j) => taken.set(sized[Math.floor(((j + 0.5) * sized.length) / list.length)], label));

      // every place without a label, drawn once into one picture for the whole row
      const canvas = document.createElement('canvas');
      canvas.width = half;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        for (let k = 0; k < places.length; k++) {
          if (taken.has(k)) continue;
          const image = ctx.createImageData(places[k], H);
          image.data.set(drawScene(places[k], kindOf(r, k), seedOf(r, k)));
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
