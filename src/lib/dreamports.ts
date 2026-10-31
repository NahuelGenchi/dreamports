// What a Dreamport's page shows from its entry, games/<game>/entry.md, and its proof/ folder: the game's box,
// and the progress box with the % the proof tools measured. games/README.md describes the entry.
import { PLAYABLE } from './players';
import { percentText, proofOf } from './entries.mjs';
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
const PROOF = import.meta.glob<unknown>('/games/*/proof/{original,code-map,progress}.json', { eager: true, import: 'default' });
const KITS = import.meta.glob<string>('/kit/*/README.md', { eager: true, query: '?raw', import: 'default' });
const LISTS = import.meta.glob<readonly unknown[]>('/games/**/list.js', { import: 'ACHIEVEMENTS' });

const proofFile = (game: string, name: string) => PROOF[`/games/${game}/proof/${name}.json`] as never;
const profile = (name: string) => `https://github.com/${name}`;

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

export interface DreamportView {
  game: Fact[];
  // the % of the original's code proven in recorded play, and as text, or null when it isn't measured yet
  percent: number | null;
  percentText: string | null;
  progress: Fact[];
}

export async function dreamportView(data: Dreamport): Promise<DreamportView> {
  const { game } = data;
  const proof = proofOf(game, {
    original: proofFile(game, 'original'),
    map: proofFile(game, 'code-map'),
    progress: proofFile(game, 'progress'),
  });
  if (proof && !data.needs.includes(proof.copy)) {
    throw new Error(`games/${game}/entry.md needs ${data.needs}, but its proof uses ${proof.copy}: "needs" names the same copy.`);
  }
  const achievements = await achievementsOf(game);
  const percent = proof?.percent ?? null;
  return {
    game: [
      { label: 'Original', value: [data.platform, data.year].filter(Boolean).join(', ') },
      { label: 'You need', value: data.needs },
      { label: 'Controls', controls: data.controls },
      ...(achievements ? [{ label: 'Achievements', value: `${achievements}, kept on your profile` }] : []),
      ...data.facts,
    ],
    percent,
    percentText: percentText(percent),
    progress: [
      { label: 'Playable now', value: data.playable },
      { label: 'Lead', value: data.lead, href: profile(data.lead) },
      ...(data.team.length ? [{ label: 'Team', items: data.team.map((name) => ({ value: name, href: profile(name) })) }] : []),
      {
        label: 'Free to work on',
        value: 'Its open tasks, on GitHub',
        href: `${SOURCE_URL}/issues?q=${encodeURIComponent(`is:issue is:open label:${game}`)}`,
      },
      data.thread
        ? { label: 'Progress thread', value: 'Clips, previews and news, on GitHub', href: data.thread }
        : { label: 'Progress thread', value: 'Not opened yet' },
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
