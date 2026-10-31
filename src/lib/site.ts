import { getCollection, type CollectionEntry } from 'astro:content';

export type Game = CollectionEntry<'games'>;
export type Kind = Game['data']['kind'];

export const SUGGEST_URL =
  'https://github.com/NahuelGenchi/dreamports/issues/new?template=work-item.yml';
export const SOURCE_URL = 'https://github.com/NahuelGenchi/dreamports';
export const OWNER_URL = 'https://nahuelgenchi.com/';
// Forwards to the owner's inbox through Cloudflare Email Routing (#4).
export const CONTACT_EMAIL = 'hello@dreamports.net';
// GitHub's own way for rights holders to send a notice about a repository, such as this one.
export const GITHUB_NOTICES_URL =
  'https://docs.github.com/en/site-policy/content-removal-policies/guide-to-submitting-a-dmca-takedown-notice';

export const HOME_TITLE = 'Dreamports · Enhanced fan ports of classic games';
export const pageTitle = (title?: string): string => (title ? `${title} · Dreamports` : HOME_TITLE);

// Each kind of game has its own part of the site's addresses: /dreamports/, /external-ports/
// and /other-games/. A game's page lives at /<path>/<file name>/.
export interface Section {
  kind: Kind;
  path: string;
  title: string;
  label: string;
  lead: string;
}

export const SECTIONS: Section[] = [
  {
    kind: 'dreamport',
    path: 'dreamports',
    title: 'Dreamports',
    label: 'Dreamport',
    lead: 'The port fans always dreamed of: the game you remember, with the extras you wished it had. These are made here, they are free, and each one asks you to bring your own copy of the game.',
  },
  {
    kind: 'external',
    path: 'external-ports',
    title: 'External ports',
    label: 'External port',
    lead: 'Great ports made by other fans. Dreamports links to their own sites and credits the people who made them, and lists only projects that ask you to bring your own legal copy of the game.',
  },
  {
    kind: 'other',
    path: 'other-games',
    title: 'Other games',
    label: 'Other game',
    lead: 'Fan games that aren’t ports: mods and new games made with the same care, and the same bring-your-own-game rule.',
  },
];

export const sectionFor = (kind: Kind): Section =>
  SECTIONS.find((section) => section.kind === kind)!;

export const gameUrl = (game: Game): string =>
  `/${sectionFor(game.data.kind).path}/${game.id}/`;

// The launcher's filters, across the top of the menu. Each shows its games in one row.
export type FilterKey = 'dreamports' | 'mash-ups';

export interface Filter {
  key: FilterKey;
  label: string;
  path: string;
  title: string;
  description: string;
  kinds: Kind[];
}

export const FILTERS: Filter[] = [
  {
    key: 'dreamports',
    label: 'Dreamports',
    path: '/',
    title: HOME_TITLE,
    description:
      'Enhanced fan ports of classic games. A Dreamport is the port fans always dreamed of: the game you remember, with the extras you wished it had.',
    kinds: ['dreamport'],
  },
  {
    key: 'mash-ups',
    label: 'Mash-ups',
    path: '/mash-ups/',
    title: pageTitle('Mash-ups'),
    description:
      'Great ports made by other fans, and fan games that aren’t ports, like Kirby’s Dead Land. Each one asks you to bring your own copy of the game.',
    kinds: ['external', 'other'],
  },
];

export const filterFor = (kind: Kind): Filter =>
  FILTERS.find((filter) => filter.kinds.includes(kind))!;

// Every row has this many places. The ones without a game stay in place, empty.
export const SLOTS = 9;

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
