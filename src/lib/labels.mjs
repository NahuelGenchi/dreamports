// The labels in the quiet rows behind the launcher (docs/LABELS.md): pictures of exactly 240 x 60 pixels that someone
// asked for, each shown for 30 days from its start. The list is public/labels/labels.json, the pictures sit beside it,
// and a label that breaks a rule stops the build, so nothing wrong reaches the site.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const WIDTH = 240;
export const HEIGHT = 60;
export const DAYS = 30;
// a label is a small picture, and every page carries the rows' list
export const MAX_BYTES = 64 * 1024;

const DAY = 24 * 60 * 60 * 1000;
const SIGNATURE = '89504e470d0a1a0a';
const FILE = /^[a-z0-9][a-z0-9-]*\.png$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// when a start date's 30 days end, as a time, or NaN when it isn't a real date
export function endOf(start) {
  if (!DATE.test(start)) return NaN;
  const time = Date.parse(start + 'T00:00:00Z');
  return new Date(time).toISOString().slice(0, 10) === start ? time + DAYS * DAY : NaN;
}

// what's wrong with a picture's bytes, or null when it's a still PNG of the right size
export function pictureProblem(bytes) {
  if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== SIGNATURE) return 'is not a PNG';
  if (bytes.length > MAX_BYTES) return `is ${Math.ceil(bytes.length / 1024)} KB, and a label can be at most ${MAX_BYTES / 1024} KB`;
  if (bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return 'is not a PNG';
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== WIDTH || height !== HEIGHT) return `is ${width} x ${height} pixels, and a label is exactly ${WIDTH} x ${HEIGHT}`;
  // an animated PNG says so in an acTL chunk before its picture
  for (let at = 8; at + 8 <= bytes.length; ) {
    const size = bytes.readUInt32BE(at);
    const type = bytes.subarray(at + 4, at + 8).toString('latin1');
    if (type === 'acTL') return 'moves, and a label is a still picture';
    if (type === 'IDAT' || type === 'IEND') break;
    at += 12 + size;
  }
  return null;
}

// Everything wrong with a list of labels, as sentences, none when every label keeps the rules. `read` gives a file's
// bytes by its name, or null when there's no such file.
export function problemsWith(list, read) {
  if (!Array.isArray(list)) return ['labels.json is not a list'];
  const problems = [];
  const seen = new Set();
  list.forEach((label, i) => {
    const name = typeof label?.file === 'string' ? label.file : `label ${i + 1}`;
    const keys = label && typeof label === 'object' ? Object.keys(label) : [];
    const extra = keys.filter((key) => key !== 'file' && key !== 'start');
    if (extra.length) problems.push(`${name} has ${extra.join(', ')}, and a label has only a file and a start`);
    if (typeof label?.file !== 'string' || !FILE.test(label.file)) {
      problems.push(`${name}'s file must be a name like studio-name.png, in small letters, numbers and dashes`);
      return;
    }
    if (seen.has(label.file)) problems.push(`${name} is listed twice`);
    seen.add(label.file);
    if (Number.isNaN(endOf(label.start))) problems.push(`${name}'s start must be a real date written like 2026-11-05`);
    const bytes = read(label.file);
    if (!bytes) problems.push(`${name} is listed, and there's no such file in public/labels/`);
    else {
      const problem = pictureProblem(bytes);
      if (problem) problems.push(`${name} ${problem}`);
    }
  });
  return problems;
}

// the labels to show around `now`: those whose 30 days haven't ended, in the list's order, each with its address
export function showing(list, now = Date.now()) {
  return list
    .filter((label) => endOf(label.start) > now)
    .map((label) => ({ src: `/labels/${label.file}`, start: label.start }));
}

let cached;

// the labels the site shows, read and checked once for every page; a broken label stops the build
export function readLabels(dir = join(process.cwd(), 'public', 'labels')) {
  if (cached && cached.dir === dir) return cached.labels;
  const list = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8'));
  const read = (file) => {
    try {
      return statSync(join(dir, file)).isFile() ? readFileSync(join(dir, file)) : null;
    } catch {
      return null;
    }
  };
  const problems = problemsWith(list, read);
  if (problems.length) throw new Error(`The labels need fixing (docs/LABELS.md):\n- ${problems.join('\n- ')}`);
  const labels = showing(list);
  cached = { dir, labels };
  return labels;
}
