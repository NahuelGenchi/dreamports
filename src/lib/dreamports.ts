// What a Dreamport's page and its place in the Make row show from its entry, games/<game>/entry.md, and its proof/
// folder: its details, and its progress with its two numbers, code ported and gameplay proven, what proves them, and
// what it's built with; and what its page in the Make row shows, for the people making it. games/README.md describes
// the entry.
import { hasCode as codeIn, isBeingMade, numbersText, proofOf, shortPercent } from './entries.mjs';
import { LANGUAGES, OTHER_LANGUAGES, mainLanguage, versionName } from './languages.mjs';
import { SOURCE_URL, makeUrl, type Game } from './site';
import type { Making, Step } from './making';
import { systemOf, type System } from './systems';

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
// what a version in another language keeps of its own, its numbers (src/lib/languages.mjs)
const VERSIONS = import.meta.glob<unknown>('/games/*/*/proof/{progress,port-map}.json', { eager: true, import: 'default' });
const RECORDINGS = import.meta.glob<unknown>('/games/*/proof/recordings/*.json', { eager: true, import: 'default' });
const KITS = import.meta.glob<string>('/kit/*/README.md', { eager: true, query: '?raw', import: 'default' });
const LISTS = import.meta.glob<readonly AchievementView[]>('/games/*/src/achievements/list.js', { import: 'ACHIEVEMENTS' });

const proofFile = (game: string, name: string) => PROOF[`/games/${game}/proof/${name}.json`] as never;
const versionFile = (version: string, name: string) => VERSIONS[`/games/${version}/proof/${name}.json`] as never;
const proofLink = (game: string, path: string) => `${SOURCE_URL}/blob/main/games/${game}/proof/${path}`;

type Proof = NonNullable<ReturnType<typeof proofOf>>;

/** A game's parts.json as it is, for what its pieces need (src/lib/pieces.mjs), or undefined without one. */
export const partsFile = (game: string): unknown => PROOF[`/games/${game}/proof/parts.json`];

// what the proof tools measured for a game, checked as the site is built, or with `language`, for its version in it
function proofFor(game: string, language = 'js'): Proof | null {
  const version = versionName(game, language), own = language === 'js' ? proofFile : versionFile;
  const prefix = `/games/${game}/proof/recordings/`;
  const recordings = Object.fromEntries(
    Object.entries(RECORDINGS)
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, recording]) => [path.slice(prefix.length, -'.json'.length), recording]),
  );
  return proofOf(version, {
    original: proofFile(game, 'original'),
    map: proofFile(game, 'code-map'),
    progress: own(version, 'progress'),
    portMap: own(version, 'port-map'),
    parts: proofFile(game, 'parts'),
    recordings: recordings as never,
  });
}

// the languages a game has a version in, those with numbers of their own, its main one first (src/lib/languages.mjs):
// JavaScript when it has one, or the first other, as C in a game that started in C or has no numbers yet
function languagesOf(game: string): (keyof typeof LANGUAGES)[] {
  const has = (['js', ...OTHER_LANGUAGES] as (keyof typeof LANGUAGES)[]).filter((language) =>
    ['progress', 'port-map'].some((name) => (language === 'js' ? proofFile(game, name) : versionFile(versionName(game, language), name)) !== undefined));
  const main = mainLanguage(has);
  return [main, ...has.filter((language) => language !== main)];
}

/** A game's main version's language: JavaScript, or C in a game that started in C, whose pieces wait on nothing in another language (src/lib/pieces.mjs). */
export const mainLanguageOf = (game: string): keyof typeof LANGUAGES => languagesOf(game)[0];

// what the proof tools measured for a game's main version
const mainProof = (game: string) => proofFor(game, mainLanguageOf(game));

/** A Dreamport's two numbers as text, such as "Code ported 38% · Gameplay proven 3%", for its place in the Make row. */
export const numbersOf = (data: Dreamport): string => numbersText(mainProof(data.game));

// the kit's name, from its guide's heading, such as "Game Boy Advance kit"
function kitName(kit: string): string {
  const guide = KITS[`/kit/${kit}/README.md`];
  if (guide === undefined) throw new Error(`The entry names the kit "${kit}", but kit/${kit}/ has no README.md.`);
  return /^#\s+(.+)$/m.exec(guide)?.[1].trim() ?? `${kit} kit`;
}

// whether a game keeps achievements on players' profiles, which it does by having its list (src/lib/players.ts)
export const keepsAchievements = (game: string) => Object.hasOwn(LISTS, `/games/${game}/src/achievements/list.js`);

// the achievements the game keeps on players' profiles, which are none until it keeps some
async function achievementsOf(game: string): Promise<readonly AchievementView[]> {
  return keepsAchievements(game) ? LISTS[`/games/${game}/src/achievements/list.js`]() : [];
}

// An achievement, as the game's own list names it.
export interface AchievementView {
  id: string;
  title: string;
  description: string;
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

// A version's two numbers, its parts and its evidence, as a game's are.
export interface ProgressView {
  // the language it's in, a key of LANGUAGES (src/lib/languages.mjs)
  language: keyof typeof LANGUAGES;
  ported: Measure;
  gameplay: Measure;
  // the game's parts and where the evidence for both numbers is, folded away in gameplay proven's line
  parts: PartView[];
  evidence: { value: string; href: string }[];
}

export interface DreamportView extends ProgressView {
  game: Fact[];
  achievements: readonly AchievementView[];
  // its versions in other languages, such as C, with numbers of their own, named in their labels
  versions: ProgressView[];
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
    const found = part.difference !== null ? `frame ${part.difference} differs`
      : part.gap !== null ? `the Dreamport lacks frames before ${part.gap}`
        : `where the original doesn't get to ${part.unreached}`;
    return {
      name: part.name,
      proven: part.proven,
      note: part.proven ? (part.fromStart ? 'Proven from a start point, not yet from power-on' : null) : `Frames ${from} to ${to} of ${part.recording}, ${found}`,
      href: proofLink(game, `recordings/${part.recording}.json`),
    };
  });
}

// The address a newcomer's coding agent starts from: it redirects to this repository (public/_redirects).
const CODE_URL = 'https://dreamports.net/code';

/** Whether a Dreamport has a place in the Make row: once it has a real capture for its card, until every part of it is proven. */
export const beingMade = (data: Dreamport): boolean => isBeingMade(data, mainProof(data.game));

// whether a Dreamport has code of the original's
const hasCode = (data: Dreamport): boolean => codeIn(mainProof(data.game));

/** Whether a Dreamport has its place in its row and its own page, for players. Until it has code, it's only in the Make row. */
export const released = ({ data }: Game): boolean => hasCode(data);

/** The system a Dreamport is for, its proof's console, for the launcher's row of systems (src/lib/systems.ts). */
export const systemFor = ({ data }: Game): System => systemOf((proofFile(data.game, 'original') as { console?: string } | undefined)?.console, data.game);

/**
 * Whether all of a Dreamport's code is ported, in any of its languages. Until then the Dreamports row leaves it out,
 * unless the player's Settings show unfinished Dreamports (#1154).
 */
export const fullyPorted = ({ data }: Game): boolean =>
  languagesOf(data.game).some((language) => proofFor(data.game, language)?.ported?.percent === 100);

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
  const parts = mainProof(data.game)?.gameplay?.parts ?? [];
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
        : hasCode(data)
          ? 'No pieces are free to take yet, but you can play it and say where it differs from the original.'
          : 'No pieces are free to take yet.',
      help: count ? `${pieces} free to take` : '',
    },
    steps: (github?.steps ?? []).map((step) => ({ ...step, date: dayOf(step.merged) })),
  };
}

const CODE = 'Code ported', GAMEPLAY = 'Gameplay proven';

/**
 * A version's two numbers under their plain names, with no language in them, as a game's page shows them: one version
 * at a time, the one Play opens.
 */
export const unnamed = (view: ProgressView): ProgressView => ({
  ...view,
  ported: { ...view.ported, label: CODE },
  gameplay: { ...view.gameplay, label: GAMEPLAY },
});

// a game's two numbers, or with `language`, its version's, whose labels name the language, as in "Code ported in C"
function progressView(game: string, proof: Proof | null, language = 'js'): ProgressView {
  const { ported = null, gameplay = null } = proof ?? {};
  const named = (label: string) => (language === 'js' ? label : `${label} in ${LANGUAGES[language as keyof typeof LANGUAGES].name}`);
  const version = versionName(game, language);
  return {
    language: language as keyof typeof LANGUAGES,
    ported: { label: named(CODE), percent: ported?.percent ?? null, text: shortPercent(ported?.percent) },
    gameplay: { label: named(GAMEPLAY), percent: gameplay?.percent ?? null, text: shortPercent(gameplay?.percent) },
    parts: partsOf(game, gameplay),
    evidence: [
      ...(ported ? [{ value: 'The port map', href: `${SOURCE_URL}/blob/main/games/${version}/proof/port-map.json` }] : []),
      ...(gameplay ? [{ value: 'The recordings', href: `${SOURCE_URL}/tree/main/games/${game}/proof/recordings` }] : []),
      { value: 'How it’s measured', href: `${SOURCE_URL}/blob/main/docs/STANDARD.md#how-progress-is-measured` },
    ],
  };
}

export async function dreamportView(data: Dreamport): Promise<DreamportView> {
  const { game } = data;
  const [main, ...others] = languagesOf(game);
  const proof = proofFor(game, main);
  if (proof && !data.needs.includes(proof.copy)) {
    throw new Error(`games/${game}/entry.md needs ${data.needs}, but its proof uses ${proof.copy}: "needs" names the same copy.`);
  }
  const achievements = await achievementsOf(game);
  // the whole game is mapped before anything else (docs/STANDARD.md#how-progress-is-measured)
  if (!proof?.ported) {
    throw new Error(`games/${game}/proof/ has no code map yet. A Dreamport maps every function of the original first, `
      + `with npm run dp -- codemap ${game}, so its progress map shows the whole game from the start (docs/STANDARD.md#how-progress-is-measured).`);
  }
  return {
    game: [
      { label: 'Original', value: [data.platform, data.year].filter(Boolean).join(', ') },
      { label: 'You need', value: data.needs },
      { label: 'Controls', controls: data.controls },
      ...data.facts,
    ],
    achievements,
    ...progressView(game, proof, main),
    versions: others.map((language) => progressView(game, proofFor(game, language), language)),
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
