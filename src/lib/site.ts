import { getCollection, type CollectionEntry } from 'astro:content';

export type Game = CollectionEntry<'games'>;
export type Kind = Game['data']['kind'];

export const SUGGEST_URL =
  'https://github.com/NahuelGenchi/dreamports/issues/new?template=work-item.yml';
export const SOURCE_URL = 'https://github.com/NahuelGenchi/dreamports';
// The README's steps for making a Dreamport, which start from one sentence pasted into a coding agent (#141).
export const MAKE_GUIDE_URL = `${SOURCE_URL}#make-a-dreamport`;
export const OWNER_URL = 'https://nahuelgenchi.com/';
// Forwards to the owner's inbox through Cloudflare Email Routing (#4).
export const CONTACT_EMAIL = 'hello@dreamports.net';
// GitHub's own way for rights holders to send a notice about a repository, such as this one.
export const GITHUB_NOTICES_URL =
  'https://docs.github.com/en/site-policy/content-removal-policies/guide-to-submitting-a-dmca-takedown-notice';

export const HOME_TITLE = 'Dreamports · Enhanced fan ports of classic games';
export const pageTitle = (title?: string): string => (title ? `${title} · Dreamports` : HOME_TITLE);

// A game's page lives at /dreamports/<its page's name>/.
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
];

export const sectionFor = (kind: Kind): Section =>
  SECTIONS.find((section) => section.kind === kind)!;

export const gameUrl = (game: Game): string =>
  `/${sectionFor(game.data.kind).path}/${game.id}/`;

// A Dreamport's Achievements page, under its own page.
export const achievementsUrl = (game: Game): string => `${gameUrl(game)}achievements/`;

// A Dreamport's page in the Make row, for the people making it (#142), named after its folder in games/.
export const makeUrl = (folder: string): string => `/make/${folder}/`;

// The launcher's filters, across the top of the menu. Each shows its games in one row. Make's row holds
// the Dreamports being made, not a kind of game, so it has no kinds.
export type FilterKey = 'dreamports' | 'make';

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
    key: 'make',
    label: 'Make',
    path: '/make/',
    title: pageTitle('Make'),
    description:
      'Every Dreamport being made, where it stands and what’s left to make. Anyone can help, with one sentence pasted into a coding agent.',
    kinds: [],
  },
];

export const filterFor = (kind: Kind): Filter =>
  FILTERS.find((filter) => filter.kinds.includes(kind))!;

// Newest first.
export async function getGames(): Promise<Game[]> {
  const games = await getCollection('games');
  return games.sort((a, b) => b.data.added.getTime() - a.data.added.getTime());
}
