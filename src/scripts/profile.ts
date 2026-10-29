// Profiles: making one and signing in with a passkey, the player's own profile, and other players'
// public ones. The launcher (launcher.ts) opens and closes their views and tells each one when it
// opens, with a `view-open` event; this fills them from the site's API (worker/index.ts).

import { NAME_PATTERN, PLAYABLE } from '../lib/players';

interface Profile {
  name: string;
  public: boolean;
  since: number;
  passkeys: number;
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

const b64url = {
  encode(buffer: ArrayBuffer) {
    let text = '';
    for (const byte of new Uint8Array(buffer)) text += String.fromCharCode(byte);
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text: string) {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  },
};

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

// ---------- Passkeys ----------

const passkeysWork = () =>
  typeof window.PublicKeyCredential === 'function' && typeof navigator.credentials?.create === 'function';

type Signals = {
  signalUnknownCredential?: (o: { rpId: string; credentialId: string }) => Promise<void>;
  signalAllAcceptedCredentials?: (o: { rpId: string; userId: string; allAcceptedCredentialIds: string[] }) => Promise<void>;
};
const signals = () => window.PublicKeyCredential as unknown as Signals;

function passkeyTrouble(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError') return 'The passkey was cancelled, or took too long.';
  if (name === 'InvalidStateError') return 'This device already has a passkey for this profile.';
  if (name === 'SecurityError') return 'Passkeys don’t work on this address.';
  return 'The passkey didn’t work here. Try again, or try another device.';
}

interface CreationJSON {
  challenge: string;
  user: { id: string; name: string; displayName: string };
  excludeCredentials?: { type: 'public-key'; id: string; transports?: AuthenticatorTransport[] }[];
}

// a new passkey, from the options the API handed out, as the API wants it back
async function makePasskey(options: CreationJSON) {
  const credential = (await navigator.credentials.create({
    publicKey: {
      ...(options as unknown as PublicKeyCredentialCreationOptions),
      challenge: b64url.decode(options.challenge),
      user: { ...options.user, id: b64url.decode(options.user.id) },
      excludeCredentials: (options.excludeCredentials ?? []).map((c) => ({ ...c, id: b64url.decode(c.id) })),
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException('no passkey', 'NotAllowedError');
  const response = credential.response as AuthenticatorAttestationResponse;
  const publicKey = response.getPublicKey();
  if (!publicKey) throw new Error('this browser can’t read the passkey’s public key');
  return {
    id: b64url.encode(credential.rawId),
    clientDataJSON: b64url.encode(response.clientDataJSON),
    authenticatorData: b64url.encode(response.getAuthenticatorData()),
    publicKey: b64url.encode(publicKey),
    publicKeyAlgorithm: response.getPublicKeyAlgorithm(),
    transports: response.getTransports?.() ?? [],
  };
}

async function usePasskey(options: { challenge: string; rpId: string; userVerification: UserVerificationRequirement; timeout: number }) {
  const credential = (await navigator.credentials.get({
    publicKey: { ...options, challenge: b64url.decode(options.challenge) },
  })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException('no passkey', 'NotAllowedError');
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: b64url.encode(credential.rawId),
    clientDataJSON: b64url.encode(response.clientDataJSON),
    authenticatorData: b64url.encode(response.authenticatorData),
    signature: b64url.encode(response.signature),
    userHandle: response.userHandle ? b64url.encode(response.userHandle) : null,
  };
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
    const name = el('a', 'set-label', info.title);
    name.setAttribute('href', info.href);
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

function startProfile(card: HTMLDialogElement) {
  const games = JSON.parse(card.dataset.games ?? '{}') as Games;
  const title = byId('profile-title');
  const status = byId('pf-status');
  const out = byId('pf-out');
  const inside = byId('pf-in');
  const form = byId<HTMLFormElement>('pf-new');
  const nameInput = byId<HTMLInputElement>('pf-name');
  const age = byId<HTMLInputElement>('pf-age');
  const publicSwitch = byId('pf-public');
  const confirm = byId('pf-confirm');
  let me: Profile | null = null;
  let busy = false;

  const say = (text: string) => {
    status.textContent = text;
  };

  async function show(profile: Profile | null, focus = false) {
    me = profile;
    notePlayer(profile?.name ?? null);
    title.textContent = profile ? profile.name : 'Profile';
    out.hidden = !!profile;
    inside.hidden = !profile;
    confirm.hidden = true;
    if (profile) {
      byId('pf-since').textContent = `Since ${day.format(profile.since)}`;
      publicSwitch.setAttribute('aria-checked', String(profile.public));
      const address = `${location.host}/players/${profile.name}/`;
      const desc = byId('pf-public-desc');
      if (profile.public) {
        desc.textContent = 'On: anyone can see your name and achievements at ';
        const link = el('a', 'linkish', address);
        link.setAttribute('href', `/players/${profile.name}/`);
        link.dataset.player = '';
        desc.append(link, '.');
      } else {
        desc.textContent = 'Off: only you can see your profile. On, anyone can see your name and achievements.';
      }
      byId('pf-passkeys').textContent =
        profile.passkeys === 1
          ? 'One passkey signs in to this profile. Add another for a device that doesn’t share it.'
          : `${profile.passkeys} passkeys sign in to this profile.`;
      await showGames(byId('pf-games'), games, profile.achievements, true);
    }
    if (!passkeysWork() && !profile) say('This browser can’t use passkeys, so it can’t make a profile or sign in to one.');
    if (focus) (profile ? publicSwitch : nameInput).focus({ preventScroll: true });
  }

  async function refresh() {
    const { ok, data } = await api<{ player: Profile | null }>('/api/me');
    if (!ok) {
      say(data.error ?? 'Profiles aren’t available right now.');
      out.hidden = inside.hidden = true;
      return;
    }
    await show(data.player, card.open && !card.contains(document.activeElement));
  }

  // a passkey step: one at a time, with a word while the device asks the player
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
    await show(ok && data.player ? data.player : profile, true);
  }

  form.addEventListener('submit', (e) => {
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
      if (!passkeysWork()) return;
      const start = await api<{ options: CreationJSON }>('/api/sign-up/options', 'POST', { name, age: true });
      if (!start.ok) {
        say(start.data.error ?? 'That didn’t work. Try again.');
        nameInput.focus();
        return;
      }
      say('Make the passkey on your device…');
      let passkey;
      try {
        passkey = await makePasskey(start.data.options);
      } catch (error) {
        say(passkeyTrouble(error));
        return;
      }
      const done = await api<{ player: Profile }>('/api/sign-up', 'POST', { passkey });
      if (!done.ok) {
        say(done.data.error ?? 'That didn’t work. Try again.');
        return;
      }
      say(`Welcome, ${done.data.player.name}. Your profile is ready.`);
      await welcome(done.data.player);
    });
  });

  byId('pf-sign-in').addEventListener('click', () =>
    step(async () => {
      if (!passkeysWork()) return;
      const start = await api<{ options: Parameters<typeof usePasskey>[0] }>('/api/sign-in/options', 'POST', {});
      if (!start.ok) {
        say(start.data.error ?? 'That didn’t work. Try again.');
        return;
      }
      say('Pick your passkey on your device…');
      let passkey;
      try {
        passkey = await usePasskey(start.data.options);
      } catch (error) {
        say(passkeyTrouble(error));
        return;
      }
      const done = await api<{ player: Profile | null; unknown?: boolean }>('/api/sign-in', 'POST', { passkey });
      if (!done.ok || !done.data.player) {
        // a passkey left from a deleted profile: the device can forget it
        if (done.data.unknown) signals().signalUnknownCredential?.({ rpId: location.hostname, credentialId: passkey.id }).catch(() => {});
        say(done.data.error ?? 'That didn’t work. Try again.');
        return;
      }
      say(`Welcome back, ${done.data.player.name}.`);
      await welcome(done.data.player);
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

  byId('pf-add').addEventListener('click', () =>
    step(async () => {
      if (!passkeysWork()) return;
      const start = await api<{ options: CreationJSON }>('/api/passkeys/options', 'POST', {});
      if (!start.ok) {
        say(start.data.error ?? 'That didn’t work. Try again.');
        return;
      }
      say('Make the passkey on your device, or on your phone…');
      let passkey;
      try {
        passkey = await makePasskey(start.data.options);
      } catch (error) {
        say(passkeyTrouble(error));
        return;
      }
      const done = await api<{ player: Profile }>('/api/passkeys', 'POST', { passkey });
      if (!done.ok) {
        say(done.data.error ?? 'That didn’t work. Try again.');
        return;
      }
      say('The new passkey signs in to your profile too.');
      await show(done.data.player);
    }),
  );

  byId('pf-sign-out').addEventListener('click', () =>
    step(async () => {
      await api('/api/sign-out', 'POST', {});
      say('You’re signed out. What you earn now stays on this device until you sign in again.');
      await show(null, true);
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
      const { ok, data } = await api<{ user?: string }>('/api/me', 'DELETE');
      if (!ok) {
        say((data as { error?: string }).error ?? 'That didn’t work. Try again.');
        return;
      }
      // the passkeys for it are no use now, so the password manager can drop them
      if (data.user) {
        signals().signalAllAcceptedCredentials?.({ rpId: location.hostname, userId: data.user, allAcceptedCredentialIds: [] }).catch(() => {});
      }
      say('Your profile is deleted. If your password manager still shows its passkey, you can remove it there.');
      await show(null, true);
    }),
  );

  const signIn = byId('pf-sign-in');
  card.addEventListener('view-open', () => {
    // a word from the last visit gives way
    say('');
    // where focus starts: the name to type on a keyboard, otherwise signing in, so a phone's
    // keyboard doesn't jump up
    const keys = document.documentElement.dataset.input === 'keys';
    nameInput.autofocus = keys;
    signIn.autofocus = !keys;
    // signed out, as far as this browser knows: the way in shows at once
    if (!me && !playerNoted()) {
      out.hidden = false;
      inside.hidden = true;
    }
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
