// What a Dreamport's page and its place in the launcher's row show from its entry, games/<game>/entry.md, and its
// proof/ folder: the game's box, and the progress box with its two numbers, code ported and gameplay proven, and
// what proves them. games/README.md describes the entry.
import { PLAYABLE } from './players';
import { mapOf, proofOf } from './entries.mjs';
import { progressMap } from './progress-map.mjs';
import { SOURCE_URL, type Game } from './site';

export type Dreamport = Extract<Game['data'], { kind: 'dreamport' }>;

// A line in a game's box: text, a link, the ways to play as icons, or a list of links, each with a note.
export interface Fact {
  label: string;
  value?: string;
  href?: string;
  note?: string;
  controls?: ('keyboard' | 'controller' | 'touch')[];
  items?: { value: string; href?: string; note?: string }[];
}

// Read as the site is built, so the page always shows what's in the folders.
const PROOF = import.meta.glob<unknown>('/games/*/proof/{original,code-map,progress,port-map,parts}.json', { eager: true, import: 'default' });
const RECORDINGS = import.meta.glob<unknown>('/games/*/proof/recordings/*.json', { eager: true, import: 'default' });
const KITS = import.meta.glob<string>('/kit/*/README.md', { eager: true, query: '?raw', import: 'default' });
const LISTS = import.meta.glob<readonly unknown[]>('/games/**/list.js', { import: 'ACHIEVEMENTS' });

const proofFile = (game: string, name: string) => PROOF[`/games/${game}/proof/${name}.json`] as never;
const proofLink = (game: string, path: string) => `${SOURCE_URL}/blob/main/games/${game}/proof/${path}`;

type Proof = NonNullable<ReturnType<typeof proofOf>>;

// a game's proof files, as proofOf takes them
function proofFiles(game: string) {
  const prefix = `/games/${game}/proof/recordings/`;
  const recordings = Object.fromEntries(
    Object.entries(RECORDINGS)
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, recording]) => [path.slice(prefix.length, -'.json'.length), recording]),
  );
  return {
    original: proofFile(game, 'original'),
    map: proofFile(game, 'code-map'),
    progress: proofFile(game, 'progress'),
    portMap: proofFile(game, 'port-map'),
    parts: proofFile(game, 'parts'),
    recordings: recordings as never,
  };
}

// what the proof tools measured for a game, checked as the site is built
const proofFor = (game: string): Proof | null => proofOf(game, proofFiles(game));

/**
 * A Dreamport's progress map (src/lib/progress-map.mjs), drawn from its proof files as the site is built. Every
 * Dreamport has one from its first day, since its whole original is mapped before anything else
 * (docs/STANDARD.md#how-progress-is-measured), so the build stops when it can't be drawn.
 */
export function progressMapOf(data: Dreamport) {
  const map = progressMap(data.game, proofFiles(data.game), data.title);
  if (!map) {
    throw new Error(`games/${data.game}/proof/ has no code map yet. A Dreamport maps every function of the original first, `
      + `with npm run dp -- codemap ${data.game}, so its progress map shows the whole game from the start (docs/STANDARD.md#how-progress-is-measured).`);
  }
  return map;
}

// A % as short as the site shows it: whole, such as 38%, but never 0% or 100% unless it's exactly that, so a little
// progress still shows and nearly done isn't done. The README and the proof files keep it to two decimals.
function shortPercent(percent: number | null | undefined): string | null {
  if (percent === null || percent === undefined) return null;
  if (percent > 0 && percent < 1) return '<1%';
  if (percent > 99 && percent < 100) return '99%';
  return `${Math.round(percent)}%`;
}

/** A Dreamport's two numbers as text, such as "Code ported 38% · Gameplay proven 3%", for its place in the row. */
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

// A part of the game, as the progress box lists it: proven, with its recording and frames, or not yet.
export interface PartView {
  name: string;
  proven: boolean;
  note: string | null;
  href: string | null;
}

// The progress map under the two numbers: where it's served, what it shows in words, its size, and the height of
// the badges at its top, which repeat the two numbers.
export interface MapView {
  src: string;
  alt: string;
  width: number;
  height: number;
  badges: number;
}

export interface DreamportView {
  game: Fact[];
  ported: Measure;
  gameplay: Measure;
  map: MapView;
  // the game's parts and where the evidence for both numbers is, folded away under the numbers
  parts: PartView[];
  evidence: { value: string; href: string }[];
  progress: Fact[];
}

// what each part shows: for a part with a recording, its frames and what they found
function partsOf(game: string, gameplay: Proof['gameplay']): PartView[] {
  return (gameplay?.parts ?? []).map((part) => {
    if (!part.recording || !part.frames) return { name: part.name, proven: false, note: null, href: null };
    const [from, to] = part.frames;
    const found = part.proven
      ? 'every one matching'
      : part.difference !== null
        ? `frame ${part.difference} differs`
        : `the Dreamport lacks frames before ${part.gap}`;
    return {
      name: part.name,
      proven: part.proven,
      note: `Frames ${from} to ${to} of ${part.recording}, ${found}`,
      href: proofLink(game, `recordings/${part.recording}.json`),
    };
  });
}

export async function dreamportView(data: Dreamport): Promise<DreamportView> {
  const { game } = data;
  const proof = proofFor(game);
  if (proof && !data.needs.includes(proof.copy)) {
    throw new Error(`games/${game}/entry.md needs ${data.needs}, but its proof uses ${proof.copy}: "needs" names the same copy.`);
  }
  const achievements = await achievementsOf(game);
  const { ported, gameplay } = proof ?? { ported: null, gameplay: null };
  const { alt, width, height, badges } = progressMapOf(data);
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
    map: { src: mapOf(game), alt, width, height, badges },
    parts: partsOf(game, gameplay),
    evidence: [
      ...(ported ? [{ value: 'The port map', href: proofLink(game, 'port-map.json') }] : []),
      ...(gameplay ? [{ value: 'The recordings', href: `${SOURCE_URL}/tree/main/games/${game}/proof/recordings` }] : []),
      { value: 'How it’s measured', href: `${SOURCE_URL}/blob/main/docs/STANDARD.md#how-progress-is-measured` },
    ],
    progress: [
      // where to follow the game and help with it: its progress thread, opened the first time someone shares it
      data.thread ? { label: 'Game thread', value: 'Contribute', href: data.thread } : { label: 'Game thread', value: 'Not opened yet' },
      ...(data.preview
        ? [{ label: 'Team preview', value: 'The team’s newest work', href: data.preview, note: `Not reviewed yet: play it only if you trust ${data.lead}.` }]
        : []),
      {
        label: 'Built with',
        items: [
          { value: `The ${kitName(data.kit)}`, href: `${SOURCE_URL}/tree/main/kit/${data.kit}` },
          ...data.sources.map((source) => ({
            value: source.name,
            href: source.href,
            note: `${source.use === 'guide' ? 'Read as a guide' : 'Code brought in'}, ${source.license === 'none' ? 'no license' : source.license}`,
          })),
        ],
      },
      { label: 'Source code', value: 'On GitHub', href: `${SOURCE_URL}/tree/main/games/${game}` },
    ],
  };
}
