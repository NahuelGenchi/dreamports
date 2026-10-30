// Signing in with an account a player already has: Google, Discord and GitHub through OAuth 2.0 with
// PKCE, and Steam through OpenID 2.0. Each service sends the player back to
// /api/oauth/<way>/callback, and all the site keeps is the account's id there, never a token, an
// email or a name. docs/ACCOUNTS.md describes each service's app and its settings.

import type { Way } from '../src/lib/players';

// each service's id for this site's app (wrangler.jsonc), and its secret (`wrangler secret put`)
export interface WayEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

// a sign-in on its way through the service's own page: the state the service must hand back, the
// proof that goes with the code it hands back, and whether it links an account to the signed-in
// player instead of signing in
export interface Flight {
  way: Way;
  state: string;
  verifier: string;
  link: boolean;
}

// the service said no, or something about its answer is wrong
export class WayError extends Error {}
// the player turned the service down
export class Cancelled extends Error {}

export function b64url(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = '';
  for (const byte of view) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text: string) {
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

const STEAM = 'https://steamcommunity.com/openid/login';
const OPENID = 'http://specs.openid.net/auth/2.0';
const USER_AGENT = 'dreamports.net';

// the app a service knows this site by; Steam needs none
function app(env: WayEnv, way: Exclude<Way, 'steam'>) {
  const id = { google: env.GOOGLE_CLIENT_ID, discord: env.DISCORD_CLIENT_ID, github: env.GITHUB_CLIENT_ID }[way];
  const secret = { google: env.GOOGLE_CLIENT_SECRET, discord: env.DISCORD_CLIENT_SECRET, github: env.GITHUB_CLIENT_SECRET }[way];
  if (!id || !secret) throw new WayError(`there's no ${way} app on this copy of the site`);
  return { id, secret };
}

// the service's own page, where the player signs in and says yes
export async function signInPage(env: WayEnv, flight: Flight, back: string, origin: string): Promise<URL> {
  if (flight.way === 'steam') {
    const page = new URL(STEAM);
    page.search = new URLSearchParams({
      'openid.ns': OPENID,
      'openid.mode': 'checkid_setup',
      'openid.return_to': `${back}?state=${flight.state}`,
      'openid.realm': origin,
      'openid.identity': `${OPENID}/identifier_select`,
      'openid.claimed_id': `${OPENID}/identifier_select`,
    }).toString();
    return page;
  }
  const { id } = app(env, flight.way);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(flight.verifier)));
  const pages = {
    // only `openid`: Google hands back the account's id and nothing about the person
    google: ['https://accounts.google.com/o/oauth2/v2/auth', { scope: 'openid', prompt: 'select_account' }],
    // `identify` without `email`; a player who said yes before isn't asked again
    discord: ['https://discord.com/oauth2/authorize', { scope: 'identify', prompt: 'none' }],
    // a GitHub App asks for no scopes, and its sign-in can read only the public profile
    github: ['https://github.com/login/oauth/authorize', { allow_signup: 'true' }],
  } as const;
  const [address, extra] = pages[flight.way];
  const page = new URL(address);
  page.search = new URLSearchParams({
    client_id: id,
    redirect_uri: back,
    response_type: 'code',
    state: flight.state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...extra,
  }).toString();
  return page;
}

async function post(address: string, form: Record<string, string>) {
  const response = await fetch(address, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
    body: new URLSearchParams(form),
  });
  const data = await response.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (!response.ok || data.error) throw new WayError(`${new URL(address).host} answered ${response.status} ${String(data.error ?? '')}`);
  return data;
}

async function get(address: string, token: unknown) {
  if (typeof token !== 'string' || !token) throw new WayError('no access token');
  const response = await fetch(address, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new WayError(`${new URL(address).host} answered ${response.status}`);
  return response.json<Record<string, unknown>>();
}

function idOf(id: unknown) {
  const text = typeof id === 'number' ? String(id) : id;
  if (typeof text !== 'string' || !/^\d{1,30}$/.test(text)) throw new WayError('no account id');
  return text;
}

// the account's id at the service, from what the service sent the player back with
export async function accountOf(env: WayEnv, flight: Flight, url: URL, back: string): Promise<string> {
  const answer = url.searchParams;
  if (flight.way === 'steam') return steamAccount(answer, back, flight.state);
  if (answer.has('error')) throw new Cancelled();
  const code = answer.get('code');
  if (!code) throw new WayError('no code');
  const { id, secret } = app(env, flight.way);
  const form = { client_id: id, client_secret: secret, code, redirect_uri: back, grant_type: 'authorization_code', code_verifier: flight.verifier };
  if (flight.way === 'google') {
    const token = await post('https://oauth2.googleapis.com/token', form);
    // the ID token came straight from Google over HTTPS, so its signature needn't be checked
    // (OpenID Connect Core 3.1.3.7), only that it names this app
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(String(token.id_token ?? '').split('.')[1] ?? ''))) as Record<string, unknown>;
    const fresh = typeof claims.exp === 'number' && claims.exp * 1000 > Date.now();
    if (!['https://accounts.google.com', 'accounts.google.com'].includes(String(claims.iss)) || claims.aud !== id || !fresh) {
      throw new WayError('the ID token is for another app');
    }
    if (typeof claims.sub !== 'string' || !/^\d{1,255}$/.test(claims.sub)) throw new WayError('no account id');
    return claims.sub;
  }
  if (flight.way === 'discord') {
    const token = await post('https://discord.com/api/oauth2/token', form);
    return idOf((await get('https://discord.com/api/users/@me', token.access_token)).id);
  }
  const token = await post('https://github.com/login/oauth/access_token', form);
  return idOf((await get('https://api.github.com/user', token.access_token)).id);
}

// Steam's answer names the player's Steam id, and Steam itself confirms it signed that answer
async function steamAccount(answer: URLSearchParams, back: string, state: string) {
  // each field once: with a field twice, the copy read here and the copy Steam confirms could differ
  const fields = new Map<string, string>();
  for (const [key, value] of answer) {
    if (!key.startsWith('openid.')) continue;
    if (fields.has(key)) throw new WayError('the Steam answer repeats a field');
    fields.set(key, value);
  }
  const field = (name: string) => fields.get(`openid.${name}`);
  if (field('mode') === 'cancel') throw new Cancelled();
  if (field('mode') !== 'id_res' || field('op_endpoint') !== STEAM || field('return_to') !== `${back}?state=${state}`) {
    throw new WayError('the Steam answer is for another sign-in');
  }
  const claimed = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(field('claimed_id') ?? '');
  const signed = new Set((field('signed') ?? '').split(','));
  if (!claimed || field('identity') !== field('claimed_id')) throw new WayError('no Steam id');
  if (!['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce'].every((name) => signed.has(name))) {
    throw new WayError('Steam didn’t sign the answer’s fields');
  }
  // Steam checks exactly the fields read above
  const check = new URLSearchParams([...fields]);
  check.set('openid.mode', 'check_authentication');
  const response = await fetch(STEAM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
    body: check,
  });
  if (!response.ok || !/^is_valid:true$/m.test(await response.text())) throw new WayError('Steam didn’t confirm the answer');
  return claimed[1];
}
