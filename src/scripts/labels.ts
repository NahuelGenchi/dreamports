// The rows of labels behind the launcher (docs/LABELS.md): flush rows of 240 x 60 places from the bottom of the
// screen to the top, each drifting slowly the other way from the one below it. A label someone asked for takes a
// place, the rows furthest from the game first, and every other place shows one of the site's own designs
// (label-designs.ts), each one different, so the rows are always full and nothing on the screen repeats.

import { DH, DW, KINDS, drawDesign } from './label-designs';

interface Label {
  src: string;
  start: string;
}

const W = 240;
const H = 60;
const DAYS = 30;
// pixels a second
const SPEED = 6;
const DAY = 24 * 60 * 60 * 1000;

// a design's own number, from its place
const seedOf = (row: number, place: number) => (Math.imul(row + 1, 73856093) ^ Math.imul(place + 1, 19349663)) >>> 0;
// which picture it is: neighbours in a row, and the places above and below, are never the same kind
const kindOf = (row: number, place: number) => (row * 7 + place * 3) % KINDS;

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

  function build() {
    const width = launcher.clientWidth;
    const height = launcher.clientHeight;
    const rows = Math.ceil(height / H);
    const across = Math.max(1, Math.ceil(width / W));
    if (!rows || built === `${rows} ${across}`) return;
    built = `${rows} ${across}`;

    // rows counted from the bottom, ordered by how far they stand from the middle, where the game is
    const order = [...Array(rows).keys()].sort((a, b) => {
      const far = (r: number) => Math.abs(height - (r + 0.5) * H - height / 2);
      return far(b) - far(a) || a - b;
    });
    const held: Label[][] = Array.from({ length: rows }, () => []);
    labels.forEach((label, i) => held[order[i % rows]].push(label));

    const made = held.map((list, r) => {
      const row = document.createElement('div');
      row.className = 'label-row';
      row.style.bottom = r * H + 'px';
      // Half the track is a place wider than the screen, and the other half repeats it, so the row never ends and
      // a place and its repeat are never on the screen at once.
      const places = Math.max(across + 1, list.length);
      const half = places * W;
      const seconds = Math.round(half / SPEED);
      const track = document.createElement('div');
      track.className = 'label-track ' + (r % 2 === 0 ? 'go-left' : 'go-right');
      track.style.width = half * 2 + 'px';
      track.style.animationDuration = seconds + 's';
      track.style.animationDelay = -((r * 29) % seconds) + 's';

      const taken = new Map<number, Label>();
      list.forEach((label, j) => taken.set(Math.floor(((j + 0.5) * places) / list.length), label));

      // every place without a label, drawn once into one picture for the whole row
      const canvas = document.createElement('canvas');
      canvas.className = 'label-designs';
      canvas.width = places * 2 * DW;
      canvas.height = DH;
      canvas.style.width = half * 2 + 'px';
      const ctx = canvas.getContext('2d');
      if (ctx) {
        for (let k = 0; k < places; k++) {
          if (taken.has(k)) continue;
          ctx.putImageData(drawDesign(ctx.createImageData(DW, DH), kindOf(r, k), seedOf(r, k)), k * DW, 0);
        }
        ctx.drawImage(canvas, 0, 0, places * DW, DH, places * DW, 0, places * DW, DH);
      }
      track.append(canvas);

      for (const [k, label] of taken) {
        for (const left of [k * W, k * W + half]) {
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
      return row;
    });
    rowsEl!.replaceChildren(...made);
    return [...rowsEl!.querySelectorAll('img')];
  }

  const imgs = build() ?? [];
  // the rows come in together once their pictures are ready, never one picture at a time
  const ready = () => {
    box.classList.add('is-ready');
    launcher.classList.add('has-labels');
  };
  Promise.race([Promise.all(imgs.map((img) => img.decode().catch(() => {}))), new Promise((done) => setTimeout(done, 4000))]).then(ready);
  new ResizeObserver(() => build()).observe(launcher);
}
