// Profiles: signing in with an account the player already has, picking a name the first time, the
// player's own profile, and other players' public ones. The launcher (launcher.ts) opens and closes their views and tells each one when it
// opens, with a `view-open` event; this fills them from the site's API (worker/index.ts).

import { NAME_PATTERN, PLAYABLE, WAYS, isWay, type Way } from '../lib/players';
import { showTitle } from '../lib/title';
import { control } from './controls';

interface Profile {
  name: string;
  public: boolean;
  since: number;
  // the accounts that sign in to it
  ways: Way[];
  // the time each achievement was earned, by game and then id
  achievements: Record<string, Record<string, number>>;
}
interface Achievement {
  id: string;
  title: string;
  description: string;
}
type Games = Record<string, { title: string; href: string }>;

// the player's name, noted in this browser while they're signed in, so /dreamports.js knows whether
// to send achievements
const PLAYER = 'dreamports:player';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

async function api<T = Record<string, unknown>>(path: string, method = 'GET', body?: unknown) {
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'The site couldn’t be reached. Check your connection and try again.' } as T & { error?: string } };
  }
}

function playerNoted() {
  try {
    return !!localStorage.getItem(PLAYER);
  } catch {
    return false;
  }
}

function notePlayer(name: string | null) {
  try {
    if (name) localStorage.setItem(PLAYER, name);
    else localStorage.removeItem(PLAYER);
  } catch {}
}

// ---------- Achievements ----------

// each game's own list of achievements, from the game itself, loaded once. Without it (the game
// isn't there, as on a computer with no internet) achievements show by their ids.
const lists = new Map<string, Promise<Achievement[]>>();
function listOf(game: string) {
  let list = lists.get(game);
  if (!list) {
    list = import(/* @vite-ignore */ PLAYABLE[game].list)
      .then((module: { ACHIEVEMENTS?: Achievement[] }) => (Array.isArray(module.ACHIEVEMENTS) ? module.ACHIEVEMENTS : []))
      .catch(() => []);
    lists.set(game, list);
  }
  return list;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const STAR =
  'M5 20H8V22H3V16H5V20ZM21 22H16V20H19V16H21V22ZM10 20H8V18H10V20ZM16 20H14V18H16V20ZM14 18H10V16H14V18ZM7 16H5V13H7V16ZM19 16H17V13H19V16ZM5 13H3V11H5V13ZM21 13H19V11H21V13ZM9 9H3V11H1V7H9V9ZM23 11H21V9H15V7H23V11ZM11 7H9V3H11V7ZM15 7H13V3H15V7ZM13 3H11V1H13V3Z';
function star() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'px-icon pf-star');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('shape-rendering', 'crispEdges');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', STAR);
  svg.append(path);
  return svg;
}

// one box per game: its name and how many of its achievements are earned, then each earned one,
// newest first. The player's own profile shows every game; a public one, the games played.
async function showGames(box: HTMLElement, games: Games, earned: Profile['achievements'], own: boolean) {
  const blocks: HTMLElement[] = [];
  for (const [game, info] of Object.entries(games)) {
    const got = earned[game] ?? {};
    if (!own && !Object.keys(got).length) continue;
    const list = await listOf(game);
    const byIdList = new Map(list.map((a) => [a.id, a]));
    const ids = Object.keys(got)
      .filter((id) => !list.length || byIdList.has(id))
      .sort((a, b) => got[b] - got[a]);

    const block = el('section', 'set-list pf-game');
    const head = el('div', 'set-row pf-game-head');
    const name = el('a', 'set-label');
    showTitle(name, info.title);
    control(name, info.href);
    head.append(name);
    if (list.length) head.append(el('span', 'pf-count', `${ids.length} of ${list.length}`));
    block.append(head);
    if (!ids.length) {
      block.append(el('p', 'set-row pf-none', own ? `None yet. Play ${info.title} while you’re signed in, and they’ll show up here.` : 'None yet.'));
    } else {
      const ul = el('ul', 'pf-list');
      for (const id of ids) {
        const a = byIdList.get(id);
        const li = el('li', 'set-row pf-ach');
        const text = el('span', 'set-text');
        text.append(el('span', 'set-label', a?.title ?? id));
        if (a?.description) text.append(el('span', 'set-desc', a.description));
        const when = el('time', 'pf-when', day.format(got[id]));
        when.setAttribute('datetime', new Date(got[id]).toISOString());
        li.append(star(), text, when);
        ul.append(li);
      }
      block.append(ul);
    }
    blocks.push(block);
  }
  box.replaceChildren(...blocks);
}

// what this device's games earned before anyone signed in, claimed for the player who just did
async function claimDevice() {
  for (const [game, { device }] of Object.entries(PLAYABLE)) {
    let earned: unknown = null;
    try {
      earned = JSON.parse(localStorage.getItem(device) ?? 'null');
    } catch {}
    if (earned && typeof earned === 'object' && Object.keys(earned).length) {
      await api('/api/achievements', 'POST', { game, earned });
    }
  }
}

// ---------- The player's own profile ----------

// what went wrong on an account's own page, as the worker names it in the address it sends the
// player back to
const TROUBLE: Record<string, (way: string) => string> = {
  cancelled: (way) => `${way} didn’t sign you in. Try again, or pick another account.`,
  taken: (way) => `That ${way} account already signs in to another profile.`,
  expired: () => 'That took too long. Try again.',
  failed: (way) => `Signing in with ${way} didn’t work. Try again in a moment.`,
};

type State = 'out' | 'pick' | 'in';

function startProfile(card: HTMLDialogElement) {
  const games = JSON.parse(card.dataset.games ?? '{}') as Games;
  const title = byId('profile-title');
  const status = byId('pf-status');
  const out = byId('pf-out');
  const pick = byId<HTMLFormElement>('pf-pick');
  const inside = byId('pf-in');
  const nameInput = byId<HTMLInputElement>('pf-name');
  const age = byId<HTMLInputElement>('pf-age');
  const publicSwitch = byId('pf-public');
  const confirm = byId('pf-confirm');
  const firstWay = out.querySelector<HTMLElement>('.pf-way')!;
  let me: Profile | null = null;
  let busy = false;
  // where the worker sent the player back to, after an account's own page: read once, then the
  // address goes back to plain /profile/
  let back: URLSearchParams | null = location.pathname === '/profile/' && location.search ? new URLSearchParams(location.search) : null;
  if (back) history.replaceState(history.state, '', location.pathname + location.hash);

  const say = (text: string) => {
    status.textContent = text;
  };

  function showState(state: State) {
    card.dataset.state = state;
    out.hidden = state !== 'out';
    pick.hidden = state !== 'pick';
    inside.hidden = state !== 'in';
    confirm.hidden = true;
    title.textContent = state === 'in' && me ? me.name : state === 'pick' ? 'Pick a name' : 'Sign in';
  }

  // the profile, or the name to pick for an account that's new here, or the way in
  async function show(profile: Profile | null, pending: Way | null = null, focus = false) {
    me = profile;
    notePlayer(profile?.name ?? null);
    showState(profile ? 'in' : pending ? 'pick' : 'out');
    // focus that was on a state now hidden, or on none yet, moves to the one showing
    focus ||= card.open && !document.activeElement?.closest('.pf-state:not([hidden])');
    if (profile) {
      byId('pf-since').textContent = `Since ${day.format(profile.since)}`;
      publicSwitch.setAttribute('aria-checked', String(profile.public));
      const address = `${location.host}/players/${profile.name}/`;
      const desc = byId('pf-public-desc');
      if (profile.public) {
        desc.textContent = 'Lets anyone see your name and achievements at ';
        const link = el('a', 'linkish', address);
        control(link, `/players/${profile.name}/`);
        link.dataset.player = '';
        desc.append(link, '.');
      } else {
        desc.textContent = 'Lets anyone see your name and achievements.';
      }
      for (const row of inside.querySelectorAll<HTMLElement>('.pf-link')) {
        const way = row.dataset.way as Way;
        const linked = profile.ways.includes(way);
        const only = linked && profile.ways.length === 1;
        row.querySelector('[data-desc]')!.textContent = only ? 'It’s your only way in.' : '';
        row.querySelector<HTMLElement>('[data-link]')!.hidden = linked;
        row.querySelector<HTMLElement>('[data-unlink]')!.hidden = !linked || only;
      }
      await showGames(byId('pf-games'), games, profile.achievements, true);
      if (focus) publicSwitch.focus({ preventScroll: true });
    } else if (pending) {
      byId('pf-pick-lead').textContent = `You’re in with ${WAYS[pending]}.`;
      if (focus) nameInput.focus({ preventScroll: true });
    } else {
      if (focus) firstWay.focus({ preventScroll: true });
    }
  }

  async function refresh() {
    const { ok, data } = await api<{ player: Profile | null; pending: Way | null }>('/api/me');
    if (!ok) {
      say(data.error ?? 'Profiles aren’t available right now.');
      out.hidden = pick.hidden = inside.hidden = true;
      return;
    }
    const from = back;
    back = null;
    const way = from?.get('way');
    const name = isWay(way) ? WAYS[way] : 'That account';
    // just signed in: what this device earned comes along
    if (data.player && from?.has('signed-in')) {
      say(`Welcome back, ${data.player.name}.`);
      await welcome(data.player);
      return;
    }
    if (data.player && from?.has('linked')) say(`${name} signs in to your profile too.`);
    const trouble = from?.get('trouble');
    if (trouble) say((TROUBLE[trouble] ?? TROUBLE.failed)(name));
    await show(data.player, isWay(data.pending) ? data.pending : null);
  }

  // one step at a time
  async function step(work: () => Promise<void>) {
    if (busy) return;
    busy = true;
    card.setAttribute('aria-busy', 'true');
    try {
      await work();
    } finally {
      busy = false;
      card.removeAttribute('aria-busy');
    }
  }

  // signed in: claim the device's achievements, then show the profile with them
  async function welcome(profile: Profile) {
    notePlayer(profile.name);
    await claimDevice();
    const { ok, data } = await api<{ player: Profile | null }>('/api/me');
    await show(ok && data.player ? data.player : profile, null, true);
  }

  pick.addEventListener('submit', (e) => {
    e.preventDefault();
    step(async () => {
      const name = nameInput.value.trim();
      if (!NAME_PATTERN.test(name)) {
        say('Pick a name of 3 to 20 letters, numbers, dashes or underscores.');
        nameInput.focus();
        return;
      }
      if (!age.checked) {
        say('Tick the box to say you’re old enough.');
        age.focus();
        return;
      }
      const done = await api<{ player: Profile }>('/api/sign-up', 'POST', { name, age: true });
      if (!done.ok) {
        say(done.data.error ?? 'That didn’t work. Try again.');
        // the account's sign-in ran out: back to the start
        if (done.status === 410) await show(null, null, true);
        else nameInput.focus();
        return;
      }
      say(`Welcome, ${done.data.player.name}. Your profile is ready.`);
      await welcome(done.data.player);
    });
  });

  byId('pf-cancel').addEventListener('click', () =>
    step(async () => {
      await api('/api/sign-up', 'DELETE');
      say('');
      await show(null, null, true);
    }),
  );

  publicSwitch.addEventListener('click', () =>
    step(async () => {
      if (!me) return;
      const { ok, data } = await api<{ player: Profile }>('/api/me', 'PATCH', { public: !me.public });
      if (!ok) {
        say(data.error ?? 'That didn’t change. Try again.');
        return;
      }
      say(data.player.public ? 'Your profile is public.' : 'Your profile is private.');
      await show(data.player);
    }),
  );

  for (const row of inside.querySelectorAll<HTMLElement>('.pf-link')) {
    const way = row.dataset.way as Way;
    const unlink = row.querySelector<HTMLElement>('[data-unlink]')!;
    unlink.addEventListener('click', () =>
      step(async () => {
        const { ok, data } = await api<{ player: Profile }>(`/api/me/ways/${way}`, 'DELETE');
        if (!ok) {
          say((data as { error?: string }).error ?? 'That didn’t work. Try again.');
          return;
        }
        say(`${WAYS[way]} no longer signs in to your profile, and your other devices are signed out.`);
        await show(data.player);
        row.querySelector<HTMLElement>('[data-link]')!.focus({ preventScroll: true });
      }),
    );
  }

  byId('pf-sign-out').addEventListener('click', () =>
    step(async () => {
      await api('/api/sign-out', 'POST', {});
      say('You’re signed out. What you earn now stays on this device until you sign in again.');
      await show(null, null, true);
    }),
  );

  byId('pf-delete').addEventListener('click', () => {
    confirm.hidden = false;
    byId('pf-keep').focus();
  });
  byId('pf-keep').addEventListener('click', () => {
    confirm.hidden = true;
    byId('pf-delete').focus();
  });
  byId('pf-delete-yes').addEventListener('click', () =>
    step(async () => {
      const { ok, data } = await api('/api/me', 'DELETE');
      if (!ok) {
        say((data as { error?: string }).error ?? 'That didn’t work. Try again.');
        return;
      }
      say('Your profile is deleted.');
      await show(null, null, true);
    }),
  );

  card.addEventListener('view-open', () => {
    // a word from the last visit gives way
    say('');
    // signed out, as far as this browser knows: the way in shows at once
    if (!me && !playerNoted() && !back?.has('new')) showState('out');
    refresh();
  });
}

// ---------- Another player's public profile ----------

function startPlayer(card: HTMLDialogElement, games: Games) {
  const title = byId('player-title');
  const status = byId('pl-status');
  const since = byId('pl-since');
  const box = byId('pl-games');

  async function load() {
    const name = /^\/players\/([^/]+)\/$/.exec(card.dataset.path ?? location.pathname)?.[1] ?? '';
    title.textContent = NAME_PATTERN.test(name) ? name : 'Player';
    status.textContent = 'Loading…';
    since.textContent = '';
    box.replaceChildren();
    const { ok, data } = await api<{ player: { name: string; since: number; achievements: Profile['achievements'] } }>(
      `/api/players/${encodeURIComponent(name)}`,
    );
    if (!ok) {
      status.textContent = data.error ?? 'This profile couldn’t be loaded.';
      return;
    }
    const player = data.player;
    title.textContent = player.name;
    card.dataset.title = `${player.name} · Dreamports`;
    if (card.open) document.title = card.dataset.title;
    status.textContent = '';
    since.textContent = `Since ${day.format(player.since)}`;
    await showGames(box, games, player.achievements, false);
    if (!box.childElementCount) status.textContent = 'No achievements yet.';
  }

  card.addEventListener('view-open', load);
}

const profileCard = document.getElementById('card-profile') as HTMLDialogElement | null;
const playerCard = document.getElementById('card-player') as HTMLDialogElement | null;
if (profileCard) startProfile(profileCard);
if (profileCard && playerCard) startPlayer(playerCard, JSON.parse(profileCard.dataset.games ?? '{}'));
