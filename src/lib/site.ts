import { getCollection, type CollectionEntry } from 'astro:content';

export type Game = CollectionEntry<'games'>;
export type Kind = Game['data']['kind'];

export const SUGGEST_URL =
  'https://github.com/NahuelGenchi/dreamports/issues/new?template=work-item.yml';
export const SOURCE_URL = 'https://github.com/NahuelGenchi/dreamports';
export const OWNER_URL = 'https://nahuelgenchi.com/';
// Forwards to the owner's inbox through Cloudflare Email Routing (#4).
export const CONTACT_EMAIL = 'hello@dreamports.net';

export interface Section {
  kind: Kind;
  path: string;
  title: string;
  label: string;
  backLabel: string;
  lead: string;
}

export const SECTIONS: Section[] = [
  {
    kind: 'dreamport',
    path: 'dreamports',
    title: 'dreamports',
    label: 'dreamport',
    backLabel: 'all dreamports',
    lead: 'the port fans always dreamed of: the game you remember, with the extras you wished it had. these are made here, they are free, and each one asks you to bring your own copy of the game.',
  },
  {
    kind: 'external',
    path: 'external-ports',
    title: 'external ports',
    label: 'external port',
    backLabel: 'all external ports',
    lead: 'great ports made by other fans. this page links to their own sites and credits the people who made them, and lists only projects that ask you to bring your own legal copy of the game.',
  },
  {
    kind: 'other',
    path: 'other-games',
    title: 'other games',
    label: 'other game',
    backLabel: 'all other games',
    lead: 'fan games that aren’t ports: mods and new games made with the same care, and the same bring-your-own-game rule.',
  },
];

export const sectionFor = (kind: Kind): Section =>
  SECTIONS.find((section) => section.kind === kind)!;

export const gameUrl = (game: Game): string =>
  `/${sectionFor(game.data.kind).path}/${game.id}/`;

const kindOrder = SECTIONS.map((section) => section.kind);

// Dreamports first, then external ports, then other games; newest first within each.
export async function getGames(kind?: Kind): Promise<Game[]> {
  const games = await getCollection('games', (game) => !kind || game.data.kind === kind);
  return games.sort(
    (a, b) =>
      kindOrder.indexOf(a.data.kind) - kindOrder.indexOf(b.data.kind) ||
      b.data.added.getTime() - a.data.added.getTime(),
  );
}
