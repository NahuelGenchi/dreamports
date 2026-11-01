// Temporary, for #66: an upright iPhone ignores taps on a game's page. This marks where the page thinks each
// touch lands (a red dot) and each click (a green dot), and lists what reaches the page, so a screenshot shows
// which step drops the tap. It never takes a press itself. It comes out before the fix is merged.

const panel = document.createElement('pre');
Object.assign(panel.style, {
  position: 'fixed',
  zIndex: '2147483647',
  left: '4px',
  right: '4px',
  top: '4px',
  maxHeight: '36%',
  overflow: 'hidden',
  margin: '0',
  padding: '6px 8px',
  font: '10px/1.35 ui-monospace, Menlo, monospace',
  background: 'rgba(0, 0, 0, 0.78)',
  color: '#fff',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  pointerEvents: 'none',
  userSelect: 'none',
});
// reads the safe areas the page is given
const probe = document.createElement('div');
Object.assign(probe.style, {
  position: 'fixed',
  visibility: 'hidden',
  pointerEvents: 'none',
  padding: 'env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px)',
});
document.body.append(panel, probe);

const lines: string[] = [];
let head = '';
const r = (n: number) => Math.round(n);

function describe(el: EventTarget | Element | null): string {
  if (!(el instanceof Element)) return el === window ? 'window' : el === document ? 'document' : String(el);
  let s = el.tagName.toLowerCase();
  if (el.id) s += '#' + el.id;
  const cls = [...el.classList].slice(0, 2).join('.');
  if (cls) s += '.' + cls;
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 14);
  if (text && el.children.length < 4) s += ` "${text}"`;
  return s;
}

function measure() {
  const vv = window.visualViewport;
  const safe = getComputedStyle(probe);
  const os = /OS (\d+[_\d]*)/.exec(navigator.userAgent)?.[1]?.replace(/_/g, '.') ?? '?';
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  head =
    `iOS ${os} app:${standalone ? 'yes' : 'no'} ${screen.orientation?.type ?? ''}\n` +
    `inner ${innerWidth}x${innerHeight} doc ${document.documentElement.clientWidth}x${document.documentElement.clientHeight} screen ${screen.width}x${screen.height}\n` +
    (vv ? `vv ${r(vv.width)}x${r(vv.height)} top ${r(vv.offsetTop)} page ${r(vv.pageTop)} scale ${vv.scale.toFixed(2)} scrollY ${r(scrollY)}\n` : '') +
    `safe t${parseFloat(safe.paddingTop)} r${parseFloat(safe.paddingRight)} b${parseFloat(safe.paddingBottom)} l${parseFloat(safe.paddingLeft)}`;
  draw();
}

function draw() {
  panel.textContent = head + '\n' + lines.join('\n');
}

function log(line: string) {
  lines.push(line);
  while (lines.length > 16) lines.shift();
  draw();
}

function dot(x: number, y: number, color: string) {
  const d = document.createElement('i');
  Object.assign(d.style, {
    position: 'fixed',
    zIndex: '2147483647',
    left: x - 7 + 'px',
    top: y - 7 + 'px',
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    background: color,
    outline: '2px solid #fff',
    pointerEvents: 'none',
  });
  document.body.append(d);
  setTimeout(() => d.remove(), 2500);
}

// where the open page's box to tick is, and how far its column is scrolled
function card() {
  const box = document.querySelector('dialog[open] .gate-form .check');
  const col = document.querySelector<HTMLElement>('dialog[open] .inspect');
  if (!box) return '';
  const b = box.getBoundingClientRect();
  return ` | box y${r(b.top)}-${r(b.bottom)} col ${col ? r(col.scrollTop) : '-'}`;
}

// each tap starts the list again, with its pointer and touch events in whichever order they come
let t0 = -Infinity;
const ms = () => r(performance.now() - t0);
function startTap() {
  if (performance.now() - t0 < 300) return;
  t0 = performance.now();
  lines.length = 0;
}

window.addEventListener('pointerdown', startTap, { capture: true, passive: true });
window.addEventListener(
  'touchstart',
  (e) => {
    startTap();
    const t = e.touches[0];
    if (!t) return;
    dot(t.clientX, t.clientY, '#e11');
    const at = document.elementFromPoint(t.clientX, t.clientY);
    log(`— touch ${r(t.clientX)},${r(t.clientY)} on ${describe(e.target)}` + (at !== e.target ? ` (seen ${describe(at)})` : '') + card() + (e.defaultPrevented ? ' CANCELLED' : ''));
  },
  { capture: true, passive: true },
);
window.addEventListener(
  'touchend',
  (e) => {
    const t = e.changedTouches[0];
    log(`${ms()} touchend ${t ? `${r(t.clientX)},${r(t.clientY)}` : ''}${e.defaultPrevented ? ' PREVENTED' : ''}`);
  },
  { capture: true, passive: true },
);
for (const type of ['touchcancel', 'pointercancel', 'pointerdown', 'pointerup', 'mouseover', 'mousedown', 'mouseup', 'focusin']) {
  window.addEventListener(type, (e) => log(`${ms()} ${type} ${describe(e.target)}`), { capture: true, passive: true });
}
let moved = false;
window.addEventListener('touchstart', () => (moved = false), { capture: true, passive: true });
window.addEventListener(
  'mousemove',
  (e) => {
    if (moved) return;
    moved = true;
    log(`${ms()} mousemove ${r(e.clientX)},${r(e.clientY)} ${describe(e.target)}`);
  },
  { capture: true, passive: true },
);
window.addEventListener(
  'click',
  (e) => {
    dot(e.clientX, e.clientY, '#1b2');
    log(`${ms()} CLICK ${r(e.clientX)},${r(e.clientY)} ${describe(e.target)}${e.isTrusted ? '' : ' (script)'}`);
  },
  { capture: true, passive: true },
);
window.addEventListener('change', (e) => log(`${ms()} change ${describe(e.target)} ${(e.target as HTMLInputElement).checked}`), {
  capture: true,
  passive: true,
});
// a click the page itself turned down, after every listener has had it
window.addEventListener('click', (e) => e.defaultPrevented && log(`${ms()} click was prevented`), { passive: true });

for (const type of ['resize', 'orientationchange']) window.addEventListener(type, () => setTimeout(measure, 50));
window.visualViewport?.addEventListener('resize', measure);
window.visualViewport?.addEventListener('scroll', measure);
// what the page's own scrolling does, as the phone turns too
window.addEventListener('scroll', () => {
  measure();
  log(`scroll ${r(scrollY)}`);
});
measure();
