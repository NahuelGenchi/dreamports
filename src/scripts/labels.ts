// The rows of labels behind the launcher (docs/LABELS.md): flush rows of 240 x 60 pictures from the bottom of the
// screen to the top, each drifting slowly the other way from the one below it. Only labels someone asked for are
// here; a place with no label is left empty. The rows that stand furthest from the game take labels first.

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
  if (!labels.length || !rowsEl) {
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
      if (!list.length) return row;
      // half the track is at least the screen's width, and the other half repeats it, so the row never ends
      const places = Math.max(across, list.length);
      const half = places * W;
      const seconds = Math.round(half / SPEED);
      const track = document.createElement('div');
      track.className = 'label-track ' + (r % 2 === 0 ? 'go-left' : 'go-right');
      track.style.width = half * 2 + 'px';
      track.style.animationDuration = seconds + 's';
      track.style.animationDelay = -((r * 29) % seconds) + 's';
      list.forEach((label, j) => {
        const at = Math.floor(((j + 0.5) * places) / list.length) * W;
        for (const left of [at, at + half]) {
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
      });
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
