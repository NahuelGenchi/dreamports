// The site's Worker. Cloudflare serves the built site's files by themselves; this runs only for the
// addresses wrangler.jsonc sends it: the accounts API under /api/, players' public profiles under
// /players/ and, away from dreamports.net, the games under /play/. docs/ACCOUNTS.md describes it.

import { ACHIEVEMENT_PATTERN, MINIMUM_AGE, NAME_PATTERN, PLAYABLE } from '../src/lib/players';
import {
  ALGORITHM_IDS,
  PasskeyError,
  b64url,
  challengeOf,
  verifyAssertion,
  verifyRegistration,
  type NewPasskey,
  type PasskeyProof,
  type StoredPasskey,
} from './passkeys';

interface Env {
  ASSETS: Fetcher;
  // the accounts' database; without it, as in a copy of the site with no database, the API says so
  DB?: D1Database;
}

const LIVE = 'dreamports.net';
// the session's cookie: only this site's own pages over HTTPS can send it, and no script can read it
const COOKIE = '__Host-dreamports';
const DAY = 86_400_000;
const SESSION_DAYS = 365;
const CHALLENGE_MS = 5 * 60_000;
// a game can't have kept an achievement before this, or after now
const FIRST_DAY = Date.UTC(2026, 0, 1);
const MOST_PER_GAME = 500;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return api(request, env, url);
    if (url.pathname.startsWith('/players/')) return playerPage(request, env, url);
    if (url.pathname.startsWith('/play/') && url.hostname !== LIVE) return fromLiveSite(request, url);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

// ---------- Responses ----------

class Problem extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 32_768) throw new Problem(413, 'That’s too much at once.');
  try {
    const body = text ? JSON.parse(text) : {};
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {}
  throw new Problem(400, 'The request wasn’t readable.');
}

// ---------- The database ----------

// The tables, made the first time each copy of the Worker uses the database. Times are milliseconds
// since 1970, and ids are base64url.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    public INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL
  )`,
  // a passkey's public key, as SPKI, with its COSE algorithm
  `CREATE TABLE IF NOT EXISTS passkeys (
    id TEXT PRIMARY KEY,
    player TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    alg INTEGER NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT NOT NULL DEFAULT '[]',
    created INTEGER NOT NULL,
    used INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS passkeys_player ON passkeys (player)`,
  // a session is kept by the SHA-256 of its cookie's value, never the value itself
  `CREATE TABLE IF NOT EXISTS sessions (
    hash TEXT PRIMARY KEY,
    player TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    created INTEGER NOT NULL,
    expires INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_player ON sessions (player)`,
  `CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires)`,
  // a challenge handed out for a passkey, used once: to sign up (with the new player's id and name),
  // to add a passkey (with the player's id) or to sign in
  `CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    player TEXT,
    name TEXT,
    expires INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS achievements (
    player TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    id TEXT NOT NULL,
    earned INTEGER NOT NULL,
    PRIMARY KEY (player, game, id)
  ) WITHOUT ROWID`,
];

let schema: Promise<unknown> | null = null;
function ready(db: D1Database) {
  schema ??= db.batch(SCHEMA.map((sql) => db.prepare(sql))).catch((error) => {
    schema = null;
    throw error;
  });
  return schema;
}

const random = (bytes: number) => b64url.encode(crypto.getRandomValues(new Uint8Array(bytes)));
const hashOf = async (token: string) => b64url.encode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));

interface Player {
  id: string;
  name: string;
  public: number;
  created: number;
}

function cookieValue(request: Request) {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [key, value] = part.trim().split('=');
    if (key === COOKIE && value && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  }
  return null;
}

async function signedIn(db: D1Database, request: Request): Promise<Player | null> {
  const token = cookieValue(request);
  if (!token) return null;
  return db
    .prepare(
      'SELECT p.id, p.name, p.public, p.created FROM sessions s JOIN players p ON p.id = s.player WHERE s.hash = ? AND s.expires > ?',
    )
    .bind(await hashOf(token), Date.now())
    .first<Player>();
}

// a new session: the statement that keeps it, and the cookie that carries it. Signing in again ends
// the session this browser had.
async function newSession(db: D1Database, request: Request, player: string) {
  const token = random(32);
  const now = Date.now();
  const statements = [
    db.prepare('INSERT INTO sessions (hash, player, created, expires) VALUES (?, ?, ?, ?)').bind(await hashOf(token), player, now, now + SESSION_DAYS * DAY),
    db.prepare('DELETE FROM sessions WHERE expires <= ?').bind(now),
  ];
  const old = cookieValue(request);
  if (old) statements.push(db.prepare('DELETE FROM sessions WHERE hash = ?').bind(await hashOf(old)));
  return { statements, cookie: `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86_400}; Secure; HttpOnly; SameSite=Lax` };
}
const ENDED = `${COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;

async function newChallenge(db: D1Database, kind: string, player: string | null = null, name: string | null = null) {
  const id = random(32);
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM challenges WHERE expires <= ?').bind(now),
    db.prepare('INSERT INTO challenges (id, kind, player, name, expires) VALUES (?, ?, ?, ?, ?)').bind(id, kind, player, name, now + CHALLENGE_MS),
  ]);
  return id;
}

// the challenge a passkey's answer names, used up whether or not the answer turns out right
async function takeChallenge(db: D1Database, answer: unknown, kind: string) {
  const id = challengeOf((answer as { clientDataJSON?: unknown } | null)?.clientDataJSON);
  const row = id
    ? await db
        .prepare('DELETE FROM challenges WHERE id = ? RETURNING kind, player, name, expires')
        .bind(id)
        .first<{ kind: string; player: string | null; name: string | null; expires: number }>()
    : null;
  if (!id || !row || row.kind !== kind || row.expires <= Date.now()) {
    throw new Problem(400, 'That took too long, or the passkey was for something else. Try again.');
  }
  return { id, player: row.player, name: row.name };
}

const nameTaken = async (db: D1Database, name: string) =>
  !!(await db.prepare('SELECT 1 FROM players WHERE name_key = ?').bind(name.toLowerCase()).first());

function addPasskey(db: D1Database, player: string, key: Awaited<ReturnType<typeof verifyRegistration>>) {
  return db
    .prepare('INSERT INTO passkeys (id, player, key, alg, counter, transports, created) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(key.id, player, key.key, key.alg, key.counter, JSON.stringify(key.transports), Date.now());
}

// what was earned, by game and then id, with the time
async function earnedBy(db: D1Database, player: string) {
  const { results } = await db
    .prepare('SELECT game, id, earned FROM achievements WHERE player = ? ORDER BY earned')
    .bind(player)
    .all<{ game: string; id: string; earned: number }>();
  const earned: Record<string, Record<string, number>> = {};
  for (const row of results) (earned[row.game] ??= {})[row.id] = row.earned;
  return earned;
}

// the signed-in player's own profile
async function profile(db: D1Database, player: Player) {
  const passkeys = await db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE player = ?').bind(player.id).first<number>('n');
  return {
    name: player.name,
    public: !!player.public,
    since: player.created,
    passkeys: passkeys ?? 0,
    achievements: await earnedBy(db, player.id),
  };
}

// ---------- The API ----------

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ error: 'Profiles aren’t available on this copy of the site.' }, 503);
  // only the site's own pages can change anything; the cookie's SameSite=Lax already keeps other
  // sites' forms out
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.headers.get('Origin') !== url.origin) {
    return json({ error: 'That came from another site.' }, 403);
  }
  // passkeys belong to the site's own host: dreamports.net, or a preview's
  const ceremony = { origin: url.origin, rpId: url.hostname };
  try {
    await ready(db);
    const route = `${request.method} ${url.pathname}`;
    const mustSignIn = async () => {
      const player = await signedIn(db, request);
      if (!player) throw new Problem(401, 'Sign in first.');
      return player;
    };

    switch (route) {
      case 'GET /api/me': {
        const player = await signedIn(db, request);
        return json({ player: player && (await profile(db, player)) });
      }

      case 'PATCH /api/me': {
        const player = await mustSignIn();
        const body = await readBody(request);
        if (typeof body.public !== 'boolean') throw new Problem(400, 'Nothing to change.');
        await db.prepare('UPDATE players SET public = ? WHERE id = ?').bind(body.public ? 1 : 0, player.id).run();
        return json({ player: await profile(db, { ...player, public: body.public ? 1 : 0 }) });
      }

      // everything about the player goes, at once
      case 'DELETE /api/me': {
        const player = await mustSignIn();
        await db.batch(
          ['achievements', 'passkeys', 'sessions', 'challenges'].map((table) => db.prepare(`DELETE FROM ${table} WHERE player = ?`).bind(player.id)).concat(
            db.prepare('DELETE FROM players WHERE id = ?').bind(player.id),
          ),
        );
        // the page tells the player's password manager the passkeys are gone, by the id they were made for
        return json({ deleted: true, user: player.id }, 200, { 'Set-Cookie': ENDED });
      }

      // all the site keeps about the player, as a file
      case 'GET /api/me/data': {
        const player = await mustSignIn();
        const [passkeys, sessions] = await db.batch<Record<string, unknown>>([
          db.prepare('SELECT alg, transports, created, used FROM passkeys WHERE player = ? ORDER BY created').bind(player.id),
          db.prepare('SELECT created, expires FROM sessions WHERE player = ? ORDER BY created').bind(player.id),
        ]);
        const when = (ms: unknown) => (typeof ms === 'number' ? new Date(ms).toISOString() : null);
        const earned = await earnedBy(db, player.id);
        const data = {
          site: url.origin,
          exported: when(Date.now()),
          player: { name: player.name, public: !!player.public, created: when(player.created) },
          passkeys: passkeys.results.map((row) => ({
            algorithm: row.alg,
            transports: JSON.parse(String(row.transports)),
            created: when(row.created),
            lastUsed: when(row.used),
          })),
          sessions: sessions.results.map((row) => ({ started: when(row.created), ends: when(row.expires) })),
          achievements: Object.entries(earned).flatMap(([game, ids]) =>
            Object.entries(ids).map(([id, at]) => ({ game, id, earned: when(at) })),
          ),
        };
        return new Response(JSON.stringify(data, null, 2), {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="dreamports-${player.name}.json"`,
            'Cache-Control': 'no-store',
          },
        });
      }

      case 'POST /api/sign-up/options': {
        const body = await readBody(request);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!NAME_PATTERN.test(name)) throw new Problem(400, 'Pick a name of 3 to 20 letters, numbers, dashes or underscores.');
        if (body.age !== true) throw new Problem(400, `Profiles are for players aged ${MINIMUM_AGE} or older.`);
        if (await nameTaken(db, name)) throw new Problem(409, 'That name is taken. Try another one.');
        const player = random(16);
        const challenge = await newChallenge(db, 'sign-up', player, name);
        return json({
          options: {
            challenge,
            rp: { id: ceremony.rpId, name: 'Dreamports' },
            user: { id: player, name, displayName: name },
            pubKeyCredParams: ALGORITHM_IDS.map((alg) => ({ type: 'public-key', alg })),
            authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
            attestation: 'none',
            timeout: CHALLENGE_MS,
          },
        });
      }

      case 'POST /api/sign-up': {
        const body = await readBody(request);
        const challenge = await takeChallenge(db, body.passkey, 'sign-up');
        const key = await verifyRegistration(body.passkey as NewPasskey, { ...ceremony, challenge: challenge.id });
        const player = { id: challenge.player!, name: challenge.name!, public: 0, created: Date.now() };
        const session = await newSession(db, request, player.id);
        try {
          await db.batch([
            db.prepare('INSERT INTO players (id, name, name_key, public, created) VALUES (?, ?, ?, 0, ?)').bind(player.id, player.name, player.name.toLowerCase(), player.created),
            addPasskey(db, player.id, key),
            ...session.statements,
          ]);
        } catch (error) {
          if (String(error).includes('players.name_key')) throw new Problem(409, 'Someone just took that name. Try another one.');
          throw error;
        }
        return json({ player: await profile(db, player) }, 200, { 'Set-Cookie': session.cookie });
      }

      case 'POST /api/sign-in/options': {
        const challenge = await newChallenge(db, 'sign-in');
        return json({ options: { challenge, rpId: ceremony.rpId, userVerification: 'preferred', timeout: CHALLENGE_MS } });
      }

      case 'POST /api/sign-in': {
        const body = await readBody(request);
        const proof = body.passkey as PasskeyProof;
        const challenge = await takeChallenge(db, proof, 'sign-in');
        const stored =
          typeof proof?.id === 'string'
            ? await db.prepare('SELECT id, player, key, alg, counter FROM passkeys WHERE id = ?').bind(proof.id).first<StoredPasskey & { player: string }>()
            : null;
        // a passkey the site doesn't know, perhaps one left from a deleted profile
        if (!stored || (proof.userHandle && proof.userHandle !== stored.player)) {
          return json({ error: 'That passkey isn’t for a profile here. Its profile may have been deleted.', unknown: true }, 401);
        }
        const counter = await verifyAssertion(proof, stored, { ...ceremony, challenge: challenge.id });
        const session = await newSession(db, request, stored.player);
        await db.batch([db.prepare('UPDATE passkeys SET counter = ?, used = ? WHERE id = ?').bind(counter, Date.now(), stored.id), ...session.statements]);
        const player = await db.prepare('SELECT id, name, public, created FROM players WHERE id = ?').bind(stored.player).first<Player>();
        return json({ player: player && (await profile(db, player)) }, 200, { 'Set-Cookie': session.cookie });
      }

      case 'POST /api/sign-out': {
        const token = cookieValue(request);
        if (token) await db.prepare('DELETE FROM sessions WHERE hash = ?').bind(await hashOf(token)).run();
        return json({ player: null }, 200, { 'Set-Cookie': ENDED });
      }

      // another passkey for the signed-in player, such as one on another device
      case 'POST /api/passkeys/options': {
        const player = await mustSignIn();
        const { results } = await db.prepare('SELECT id, transports FROM passkeys WHERE player = ?').bind(player.id).all<{ id: string; transports: string }>();
        const challenge = await newChallenge(db, 'passkey', player.id);
        return json({
          options: {
            challenge,
            rp: { id: ceremony.rpId, name: 'Dreamports' },
            user: { id: player.id, name: player.name, displayName: player.name },
            pubKeyCredParams: ALGORITHM_IDS.map((alg) => ({ type: 'public-key', alg })),
            authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
            excludeCredentials: results.map((row) => ({ type: 'public-key', id: row.id, transports: JSON.parse(row.transports) })),
            attestation: 'none',
            timeout: CHALLENGE_MS,
          },
        });
      }

      case 'POST /api/passkeys': {
        const player = await mustSignIn();
        const body = await readBody(request);
        const challenge = await takeChallenge(db, body.passkey, 'passkey');
        if (challenge.player !== player.id) throw new Problem(403, 'That passkey was started for another profile.');
        const key = await verifyRegistration(body.passkey as NewPasskey, { ...ceremony, challenge: challenge.id });
        try {
          await addPasskey(db, player.id, key).run();
        } catch (error) {
          if (String(error).includes('passkeys.id')) throw new Problem(409, 'That passkey is already on your profile.');
          throw error;
        }
        return json({ player: await profile(db, player) });
      }

      // achievements from a game: one just earned, or what a device earned before signing in. The
      // earliest time wins.
      case 'POST /api/achievements': {
        const player = await mustSignIn();
        const body = await readBody(request);
        const game = body.game;
        if (typeof game !== 'string' || !Object.hasOwn(PLAYABLE, game)) throw new Problem(400, 'That game doesn’t keep achievements here.');
        const given = body.earned;
        if (!given || typeof given !== 'object' || Array.isArray(given)) throw new Problem(400, 'No achievements were sent.');
        const now = Date.now();
        const earned: Record<string, number> = {};
        for (const [id, at] of Object.entries(given)) {
          if (!ACHIEVEMENT_PATTERN.test(id)) continue;
          earned[id] = typeof at === 'number' && at >= FIRST_DAY && at <= now ? Math.floor(at) : now;
        }
        if (!Object.keys(earned).length) return json({ saved: 0 });
        const sent = JSON.stringify(earned);
        // what the profile would keep for this game afterwards: what it has, and the ids that are new
        const total = await db
          .prepare(
            `SELECT (SELECT COUNT(*) FROM achievements WHERE player = ?1 AND game = ?2)
                  + (SELECT COUNT(*) FROM json_each(?3) WHERE key NOT IN (SELECT id FROM achievements WHERE player = ?1 AND game = ?2)) AS n`,
          )
          .bind(player.id, game, sent)
          .first<number>('n');
        if ((total ?? 0) > MOST_PER_GAME) throw new Problem(400, 'That’s more achievements than the game has.');
        const result = await db
          .prepare(
            `INSERT INTO achievements (player, game, id, earned)
             SELECT ?, ?, key, value FROM json_each(?) WHERE true
             ON CONFLICT (player, game, id) DO UPDATE SET earned = excluded.earned WHERE excluded.earned < achievements.earned`,
          )
          .bind(player.id, game, sent)
          .run();
        return json({ saved: result.meta.changes ?? 0 });
      }
    }

    // a public profile; a private one, like a missing one, isn't there
    const named = /^\/api\/players\/([^/]+)$/.exec(url.pathname);
    if (named && request.method === 'GET') {
      const name = named[1];
      const player = NAME_PATTERN.test(name)
        ? await db.prepare('SELECT id, name, created FROM players WHERE name_key = ? AND public = 1').bind(name.toLowerCase()).first<Player>()
        : null;
      if (!player) throw new Problem(404, 'There’s no public profile by that name.');
      return json({ player: { name: player.name, since: player.created, achievements: await earnedBy(db, player.id) } });
    }
    throw new Problem(404, 'Nothing here.');
  } catch (error) {
    if (error instanceof Problem) return json({ error: error.message }, error.status);
    if (error instanceof PasskeyError) {
      console.warn('passkey refused:', error.message);
      return json({ error: 'That passkey couldn’t be checked. Try again.' }, 400);
    }
    console.error(error);
    return json({ error: 'Something went wrong. Try again in a moment.' }, 500);
  }
}

// ---------- Pages ----------

// /players/<name>/ is one page for every player, the built /players/ page, which asks the API for the
// player named in its address
async function playerPage(request: Request, env: Env, url: URL) {
  if (url.pathname === '/players/') return Response.redirect(new URL('/', url).href, 302);
  const match = /^\/players\/([^/]+)(\/?)$/.exec(url.pathname);
  const name = match?.[1] ?? '';
  if (!NAME_PATTERN.test(name)) return env.ASSETS.fetch(request);
  if (!match![2]) return Response.redirect(new URL(`/players/${name}/${url.search}`, url).href, 308);
  const page = await env.ASSETS.fetch(new Request(new URL('/players/', url), request));
  return new Response(page.body, { status: page.ok ? 200 : page.status, headers: page.headers });
}

// Away from dreamports.net (a pull request's preview, or `npm run worker` on a computer), the games
// under /play/ come from the live site, so they can be tried with this copy's profiles. On
// dreamports.net each game's own Worker answers its /play/<game>/ before this one does.
async function fromLiveSite(request: Request, url: URL) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
  const live = new URL(url.pathname + url.search, `https://${LIVE}`);
  const response = await fetch(live, { method: request.method, redirect: 'manual' });
  const headers = new Headers(response.headers);
  const location = headers.get('Location');
  if (location) {
    const to = new URL(location, live);
    if (to.host === LIVE) headers.set('Location', to.pathname + to.search + to.hash);
  }
  return new Response(response.body, { status: response.status, headers });
}
