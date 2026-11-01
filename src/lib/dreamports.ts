// What a Dreamport's page and its place in the Make row show from its entry, games/<game>/entry.md, and its proof/
// folder: its details, and its progress with its two numbers, code ported and gameplay proven, what proves them, and
// what it's built with; and what its page in the Make row shows, for the people making it. games/README.md describes
// the entry.
import { PLAYABLE } from './players';
import { proofOf } from './entries.mjs';
import { SOURCE_URL, makeUrl, type Game } from './site';
import type { Making, Step } from './making';

export type Dreamport = Extract<Game['data'], { kind: 'dreamport' }>;

// A line in a game's details: text, the ways to play as icons, or with an href, a link of its own, named by its label,
// and maybe a note.
export interface Fact {
  label: string;
  value?: string;
  href?: string;
  note?: string;
  controls?: ('keyboard' | 'controller' | 'touch')[];
}

// Read as the site is built, so the page always shows what's in the folders.
const PROOF = import.meta.glob<unknown>('/games/*/proof/{original,code-map,progress,port-map,parts}.json', { eager: true, import: 'default' });
const RECORDINGS = import.meta.glob<unknown>('/games/*/proof/recordings/*.json', { eager: true, import: 'default' });
const KITS = import.meta.glob<string>('/kit/*/README.md', { eager: true, query: '?raw', import: 'default' });
const LISTS = import.meta.glob<readonly unknown[]>('/games/**/list.js', { import: 'ACHIEVEMENTS' });

const proofFile = (game: string, name: string) => PROOF[`/games/${game}/proof/${name}.json`] as never;
const proofLink = (game: string, path: string) => `${SOURCE_URL}/blob/main/games/${game}/proof/${path}`;

type Proof = NonNullable<ReturnType<typeof proofOf>>;

// what the proof tools measured for a game, checked as the site is built
function proofFor(game: string): Proof | null {
  const prefix = `/games/${game}/proof/recordings/`;
  const recordings = Object.fromEntries(
    Object.entries(RECORDINGS)
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, recording]) => [path.slice(prefix.length, -'.json'.length), recording]),
  );
  return proofOf(game, {
    original: proofFile(game, 'original'),
    map: proofFile(game, 'code-map'),
    progress: proofFile(game, 'progress'),
    portMap: proofFile(game, 'port-map'),
    parts: proofFile(game, 'parts'),
    recordings: recordings as never,
  });
}

// A % as short as the site shows it: whole, such as 38%, but never 0% or 100% unless it's exactly that, so a little
// progress still shows and nearly done isn't done. The README and the proof files keep it to two decimals.
function shortPercent(percent: number | null | undefined): string | null {
  if (percent === null || percent === undefined) return null;
  if (percent > 0 && percent < 1) return '<1%';
  if (percent > 99 && percent < 100) return '99%';
  return `${Math.round(percent)}%`;
}

/** A Dreamport's two numbers as text, such as "Code ported 38% · Gameplay proven 3%", for its place in the Make row. */
export function numbersOf(data: Dreamport): string {
  const proof = proofFor(data.game);
  return [
    `Code ported ${shortPercent(proof?.ported?.percent) ?? 'not measured yet'}`,
    `Gameplay proven ${shortPercent(proof?.gameplay?.percent) ?? 'not measured yet'}`,
  ].join(' · ');
}

// the kit's name, from its guide's heading, such as "Game Boy Advance kit"
function kitName(kit: string): string {
  const guide = KITS[`/kit/${kit}/README.md`];
  if (guide === undefined) throw new Error(`The entry names the kit "${kit}", but kit/${kit}/ has no README.md.`);
  return /^#\s+(.+)$/m.exec(guide)?.[1].trim() ?? `${kit} kit`;
}

// how many achievements the game keeps on players' profiles, or null when it keeps none (src/lib/players.ts)
async function achievementsOf(game: string): Promise<number | null> {
  const list = PLAYABLE[game]?.list;
  if (!list) return null;
  const load = LISTS[`/games/${list.replace(/^\/play\//, '')}`];
  if (!load) throw new Error(`src/lib/players.ts names ${list} as ${game}’s achievements, but it isn’t in games/.`);
  return (await load()).length;
}

// One of the two numbers: its name, its %, and the % as the page shows it. `percent` is null when it isn't measured yet.
export interface Measure {
  label: string;
  percent: number | null;
  text: string | null;
}

// A part of the game, as its progress lists it: proven, with a link to its recording, or not yet, with what it found.
export interface PartView {
  name: string;
  proven: boolean;
  note: string | null;
  href: string | null;
}

export interface DreamportView {
  game: Fact[];
  ported: Measure;
  gameplay: Measure;
  // the game's parts and where the evidence for both numbers is, folded away in gameplay proven's line
  parts: PartView[];
  evidence: { value: string; href: string }[];
  // the links under the numbers: where to help make it, and the lead's team preview
  progress: Fact[];
  // what it's built with, every source of its code, and its source code, folded away at the end (docs/STANDARD.md)
  built: { value: string; href: string; note?: string }[];
  source: string;
}

// what each part shows: for a part with a recording, a link to it, and until it's proven, what its frames found
function partsOf(game: string, gameplay: Proof['gameplay']): PartView[] {
  return (gameplay?.parts ?? []).map((part) => {
    if (!part.recording || !part.frames) return { name: part.name, proven: false, note: null, href: null };
    const [from, to] = part.frames;
    const found = part.difference !== null ? `frame ${part.difference} differs` : `the Dreamport lacks frames before ${part.gap}`;
    return {
      name: part.name,
      proven: part.proven,
      note: part.proven ? null : `Frames ${from} to ${to} of ${part.recording}, ${found}`,
      href: proofLink(game, `recordings/${part.recording}.json`),
    };
  });
}

// The address a newcomer's coding agent starts from: it redirects to this repository (public/_redirects).
const CODE_URL = 'https://dreamports.net/code';

/** Whether a Dreamport is still being made, so it has a place in the Make row: until every part of it is proven. */
export const beingMade = (data: Dreamport): boolean => proofFor(data.game)?.gameplay?.percent !== 100;

// What a Dreamport's page in the Make row shows besides its two bars (#142): one line on where it stands, the sentence
// that gets a newcomer's coding agent ready to help (#141), and its game's issue, where it's talked about; and from
// GitHub (#143, src/lib/making.ts), how many pieces are free to take and its steps, the latest first. Who leads it,
// what waits for review and the code map stay on GitHub.
export interface MakeView {
  summary: string;
  prompt: string;
  talk: string;
  // nothing when GitHub couldn't be read for this build; its place in the row says nothing while no piece is free
  free?: { line: string; help: string };
  steps: (Step & { date: string })[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayOf = (iso: string) => {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

export function makeView(data: Dreamport, github?: Making): MakeView {
  const parts = proofFor(data.game)?.gameplay?.parts ?? [];
  const proven = parts.filter((part) => part.proven).length;
  const next = parts.find((part) => !part.proven);
  const summary = [
    parts.length ? `${proven} of ${parts.length} parts proven.` : 'No parts listed yet.',
    next ? ` Up next: ${next.name}.` : '',
  ].join('');
  const count = github?.free ?? 0;
  const pieces = `${count} ${count === 1 ? 'piece' : 'pieces'}`;
  return {
    summary,
    prompt: `Set up ${CODE_URL} and help me make ${data.title}.`,
    talk: `${SOURCE_URL}/issues/${data.issue}`,
    free: github && {
      line: count
        ? `${pieces} ${count === 1 ? 'is' : 'are'} free to take.`
        : 'No pieces are free to take yet, but you can play it and say where it differs from the original.',
      help: count ? `${pieces} free to take` : '',
    },
    steps: (github?.steps ?? []).map((step) => ({ ...step, date: dayOf(step.merged) })),
  };
}

export async function dreamportView(data: Dreamport): Promise<DreamportView> {
  const { game } = data;
  const proof = proofFor(game);
  if (proof && !data.needs.includes(proof.copy)) {
    throw new Error(`games/${game}/entry.md needs ${data.needs}, but its proof uses ${proof.copy}: "needs" names the same copy.`);
  }
  const achievements = await achievementsOf(game);
  // the whole game is mapped before anything else (docs/STANDARD.md#how-progress-is-measured)
  if (!proof?.ported) {
    throw new Error(`games/${game}/proof/ has no code map yet. A Dreamport maps every function of the original first, `
      + `with npm run dp -- codemap ${game}, so its progress map shows the whole game from the start (docs/STANDARD.md#how-progress-is-measured).`);
  }
  const { ported, gameplay } = proof;
  return {
    game: [
      { label: 'Original', value: [data.platform, data.year].filter(Boolean).join(', ') },
      { label: 'You need', value: data.needs },
      { label: 'Controls', controls: data.controls },
      ...(achievements ? [{ label: 'Achievements', value: `${achievements}, kept on your profile` }] : []),
      ...data.facts,
    ],
    ported: { label: 'Code ported', percent: ported?.percent ?? null, text: shortPercent(ported?.percent) },
    gameplay: { label: 'Gameplay proven', percent: gameplay?.percent ?? null, text: shortPercent(gameplay?.percent) },
    parts: partsOf(game, gameplay),
    evidence: [
      ...(ported ? [{ value: 'The port map', href: proofLink(game, 'port-map.json') }] : []),
      ...(gameplay ? [{ value: 'The recordings', href: `${SOURCE_URL}/tree/main/games/${game}/proof/recordings` }] : []),
      { value: 'How it’s measured', href: `${SOURCE_URL}/blob/main/docs/STANDARD.md#how-progress-is-measured` },
    ],
    progress: [
      // where to help make it, while it's being made: its page in the Make row, with its steps and free pieces
      ...(beingMade(data) ? [{ label: 'Help make it', href: makeUrl(data.game) }] : []),
      ...(data.preview ? [{ label: 'Team preview', href: data.preview, note: `Not reviewed yet: play it only if you trust ${data.lead}.` }] : []),
    ],
    built: [
      { value: `The ${kitName(data.kit)}`, href: `${SOURCE_URL}/tree/main/kit/${data.kit}` },
      ...data.sources.map((source) => ({
        value: source.name,
        href: source.href,
        note: `${source.use === 'guide' ? 'Read as a guide' : 'Code brought in'}, ${source.license === 'none' ? 'no license' : source.license}`,
      })),
    ],
    source: `${SOURCE_URL}/tree/main/games/${game}`,
  };
}
