// What each Dreamport's page in the Make row reads from GitHub as the site is built (#143, docs/MAKE.md): its
// steps, the pull requests merged in its milestone or with its label, newest first, and how many of its pieces are
// free to take, the open sub-issues of its game's issue that nobody has claimed. GitHub answers anyone 60 times an
// hour, and 5,000 with a read-only token in GITHUB_TOKEN, which Cloudflare can keep for the site's builds. When GitHub
// doesn't answer, the build takes what dreamports.net last read, from /make/github.json. With neither, a build on
// Cloudflare stops, so dreamports.net keeps the pages it has, and a build on a contributor's computer goes on without
// steps or pieces.
import { SOURCE_URL, getGames } from './site';
import { beingMade } from './dreamports';

export interface Step {
  number: number;
  title: string;
  // when it merged, as GitHub gives it
  merged: string;
  url: string;
}

export interface Making {
  steps: Step[];
  free: number;
}

// what was read, by each game's folder
export type MakingData = Record<string, Making>;

// the build's settings, read as the site is built
const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
// another repository's, such as a test fork's, to try a change to this file
const REPOSITORY = ENV.DREAMPORTS_REPOSITORY || new URL(SOURCE_URL).pathname.slice(1);
const API = `https://api.github.com/repos/${REPOSITORY}`;
export const LIVE_DATA = 'https://dreamports.net/make/github.json';

interface Item {
  number: number;
  title: string;
  html_url: string;
  state: string;
  assignees?: unknown[];
  repository_url?: string;
  pull_request?: { merged_at: string | null };
}

async function list<T>(path: string): Promise<T[]> {
  const token = ENV.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'dreamports.net',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const all: T[] = [];
  let url: string | undefined = `${API}${path}${path.includes('?') ? '&' : '?'}per_page=100`;
  while (url) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      const limit = response.headers.get('x-ratelimit-remaining') === '0' ? ', as its hourly limit was reached' : '';
      throw new Error(`GitHub answered ${response.status} to ${path}${limit}`);
    }
    all.push(...((await response.json()) as T[]));
    url = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link') ?? '')?.[1];
  }
  return all;
}

// a pull request's title as a step: "feat: prove the title screen (#116)" is "Prove the title screen"
function stepTitle(title: string): string {
  const plain = title.replace(/^(feat|fix|enh|docs|research|ops)(\([^)]*\))?:\s*/i, '').replace(/(\s*\(#\d+\))+\s*$/, '');
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

async function fromGitHub(games: { game: string; title: string; issue: number }[]): Promise<MakingData> {
  const milestones = await list<{ number: number; title: string }>('/milestones?state=all');
  const data: MakingData = {};
  for (const { game, title, issue } of games) {
    const milestone = milestones.find((m) => m.title === title);
    const closed = [
      ...(milestone ? await list<Item>(`/issues?state=closed&milestone=${milestone.number}`) : []),
      ...(await list<Item>(`/issues?state=closed&labels=${encodeURIComponent(game)}`)),
    ];
    const steps = new Map<number, Step>();
    for (const item of closed) {
      const merged = item.pull_request?.merged_at;
      if (merged) steps.set(item.number, { number: item.number, title: stepTitle(item.title), merged, url: item.html_url });
    }
    const pieces = (await list<Item>(`/issues/${issue}/sub_issues`)).filter(
      (piece) => piece.repository_url?.toLowerCase() === API.toLowerCase(),
    );
    data[game] = {
      steps: [...steps.values()].sort((a, b) => b.merged.localeCompare(a.merged)),
      free: pieces.filter((piece) => piece.state === 'open' && !piece.assignees?.length).length,
    };
  }
  return data;
}

async function load(): Promise<MakingData | null> {
  const games = (await getGames()).flatMap((game) =>
    game.data.kind === 'dreamport' && beingMade(game.data)
      ? [{ game: game.data.game, title: game.data.title, issue: game.data.issue }]
      : [],
  );
  try {
    return await fromGitHub(games);
  } catch (error) {
    console.warn(`The Make pages couldn't read GitHub (${(error as Error).message}), so they show what dreamports.net last read.`);
  }
  try {
    const response = await fetch(LIVE_DATA, { signal: AbortSignal.timeout(20000) });
    const live = response.ok ? ((await response.json()) as MakingData | null) : null;
    if (live) return live;
    throw new Error(`dreamports.net answered ${response.status}${response.ok ? ' with nothing' : ''}`);
  } catch (error) {
    const why = `neither GitHub nor dreamports.net answered (${(error as Error).message})`;
    if (ENV.WORKERS_CI) throw new Error(`The Make pages have no steps or pieces to show: ${why}. dreamports.net keeps the pages it has.`);
    console.warn(`The Make pages are built without steps or pieces: ${why}.`);
    return null;
  }
}

let loaded: Promise<MakingData | null> | undefined;

/** What the Make pages show from GitHub, read once for the whole build, or null when it couldn't be read. */
export const making = (): Promise<MakingData | null> => (loaded ??= load());
