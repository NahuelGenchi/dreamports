// The site's Worker. Cloudflare serves the built site's files by themselves; this runs only for the
// addresses wrangler.jsonc sends it: the accounts API under /api/, players' public profiles under
// /players/ and, away from dreamports.net, the games under /play/. docs/ACCOUNTS.md describes it.

import { ACHIEVEMENT_PATTERN, MINIMUM_AGE, NAME_PATTERN, PLAYABLE, isWay, type Way } from '../src/lib/players';
import { Cancelled, WayError, accountOf, b64url, signInPage, type Flight, type WayEnv } from './ways';

interface Env extends WayEnv {
  ASSETS: Fetcher;
  // the accounts' database; without it, as in a copy of the site with no database, the API says so
  DB?: D1Database;
}

const LIVE = 'dreamports.net';
// the cookies: only this site's own pages over HTTPS get them, and no script can read them. The
// session; an account that's new here, while its player picks a name; and a sign-in on its way
// through a service's own page.
const SESSION = '__Host-dreamports';
const NEWCOMER = '__Host-dreamports-new';
const FLIGHT = '__Host-dreamports-oauth';
const DAY = 86_400_000;
const SESSION_DAYS = 365;
const NEWCOMER_MS = 30 * 60_000;
const FLIGHT_MS = 10 * 60_000;
// a game can't have kept an achievement before this, or after now
const FIRST_DAY = Date.UTC(2026, 0, 1);
const MOST_PER_GAME = 500;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/oauth/')) return oauth(request, env, url);
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

function json(data: unknown, status = 200, cookies: string[] = []) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(data), { status, headers });
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

const cookie = (name: string, value: string, ms: number) =>
  `${name}=${value}; Path=/; Max-Age=${Math.floor(ms / 1000)}; Secure; HttpOnly; SameSite=Lax`;
const ended = (name: string) => cookie(name, '', 0);

function cookieValue(request: Request, name: string, pattern = /^[A-Za-z0-9_-]{43}$/) {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [key, value] = part.trim().split('=');
    if (key === name && value && pattern.test(value)) return value;
  }
  return null;
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
  // an account a player signs in with: the service, and the account's id there. One per service.
  `CREATE TABLE IF NOT EXISTS ways (
    way TEXT NOT NULL,
    account TEXT NOT NULL,
    player TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    created INTEGER NOT NULL,
    used INTEGER,
    PRIMARY KEY (way, account),
    UNIQUE (player, way)
  ) WITHOUT ROWID`,
  // a session is kept by the SHA-256 of its cookie's value, never the value itself
  `CREATE TABLE IF NOT EXISTS sessions (
    hash TEXT PRIMARY KEY,
    player TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    created INTEGER NOT NULL,
    expires INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_player ON sessions (player)`,
  `CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires)`,
  // an account that's new here, for half an hour while its player picks a name, kept by the SHA-256
  // of its cookie's value
  `CREATE TABLE IF NOT EXISTS newcomers (
    hash TEXT PRIMARY KEY,
    way TEXT NOT NULL,
    account TEXT NOT NULL,
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

const random = (bytes: number) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
const hashOf = async (token: string) => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));

interface Player {
  id: string;
  name: string;
  public: number;
  created: number;
}

async function signedIn(db: D1Database, request: Request): Promise<Player | null> {
  const token = cookieValue(request, SESSION);
  if (!token) return null;
  return db
    .prepare(
      'SELECT p.id, p.name, p.public, p.created FROM sessions s JOIN players p ON p.id = s.player WHERE s.hash = ? AND s.expires > ?',
    )
    .bind(await hashOf(token), Date.now())
    .first<Player>();
}

// a new session: the statements that keep it, and the cookie that carries it. Signing in again ends
// the session this browser had.
async function newSession(db: D1Database, request: Request, player: string) {
  const token = random(32);
  const now = Date.now();
  const statements = [
    db.prepare('INSERT INTO sessions (hash, player, created, expires) VALUES (?, ?, ?, ?)').bind(await hashOf(token), player, now, now + SESSION_DAYS * DAY),
    db.prepare('DELETE FROM sessions WHERE expires <= ?').bind(now),
  ];
  const old = cookieValue(request, SESSION);
  if (old) statements.push(db.prepare('DELETE FROM sessions WHERE hash = ?').bind(await hashOf(old)));
  return { statements, cookie: cookie(SESSION, token, SESSION_DAYS * DAY) };
}

// the account that's new here, from this browser's cookie, while it lasts
async function newcomer(db: D1Database, request: Request) {
  const token = cookieValue(request, NEWCOMER);
  if (!token) return null;
  const hash = await hashOf(token);
  const row = await db.prepare('SELECT way, account FROM newcomers WHERE hash = ? AND expires > ?').bind(hash, Date.now()).first<{ way: Way; account: string }>();
  return row && { ...row, hash };
}

const nameTaken = async (db: D1Database, name: string) =>
  !!(await db.prepare('SELECT 1 FROM players WHERE name_key = ?').bind(name.toLowerCase()).first());

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
  const { results } = await db.prepare('SELECT way FROM ways WHERE player = ? ORDER BY created').bind(player.id).all<{ way: Way }>();
  return {
    name: player.name,
    public: !!player.public,
    since: player.created,
    ways: results.map((row) => row.way),
    achievements: await earnedBy(db, player.id),
  };
}

// ---------- Signing in with an account ----------

// /api/oauth/<way>/start sends the player to the service's own page, and the service sends them back
// to /api/oauth/<way>/callback. Either way the player ends up on /profile/, whose address says how it
// went: ?signed-in, ?new (a name to pick), ?linked, or ?trouble=<what>.
async function oauth(request: Request, env: Env, url: URL): Promise<Response> {
  const match = /^\/api\/oauth\/([a-z]+)\/(start|callback)$/.exec(url.pathname);
  if (!match || !isWay(match[1]) || request.method !== 'GET') return json({ error: 'Nothing here.' }, 404);
  const way = match[1];
  const back = `${url.origin}/api/oauth/${way}/callback`;
  const home = (how: string, cookies: string[] = []) => {
    const headers = new Headers({ Location: `${url.origin}/profile/?${how}&way=${way}`, 'Cache-Control': 'no-store' });
    for (const c of [ended(FLIGHT), ...cookies]) headers.append('Set-Cookie', c);
    return new Response(null, { status: 302, headers });
  };
  const db = env.DB;
  if (!db) return home('trouble=failed');

  if (match[2] === 'start') {
    const flight: Flight = { way, state: random(24), verifier: random(32), link: url.searchParams.has('link') };
    let page: URL;
    try {
      page = await signInPage(env, flight, back, url.origin);
    } catch (error) {
      console.warn(`${way} sign-in can't start:`, String(error));
      return home('trouble=failed');
    }
    const value = [way, flight.state, flight.verifier, flight.link ? 1 : 0].join('.');
    const headers = new Headers({ Location: page.href, 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', cookie(FLIGHT, value, FLIGHT_MS));
    return new Response(null, { status: 302, headers });
  }

  // back from the service: the sign-in this browser started, with the state the service handed back
  const kept = cookieValue(request, FLIGHT, /^[a-z]+\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}\.[01]$/)?.split('.');
  if (!kept || kept[0] !== way || kept[1] !== url.searchParams.get('state')) return home('trouble=expired');
  const flight: Flight = { way, state: kept[1], verifier: kept[2], link: kept[3] === '1' };
  let account: string;
  try {
    account = await accountOf(env, flight, url, back);
  } catch (error) {
    if (error instanceof Cancelled) return home('trouble=cancelled');
    console.warn(`${way} sign-in refused:`, error instanceof WayError ? error.message : error);
    return home('trouble=failed');
  }

  try {
    await ready(db);
    const now = Date.now();
    const owner = await db.prepare('SELECT player FROM ways WHERE way = ? AND account = ?').bind(way, account).first<string>('player');
    const player = flight.link ? await signedIn(db, request) : null;
    // linking the account to the signed-in player
    if (player) {
      if (owner && owner !== player.id) return home('trouble=taken');
      if (!owner) {
        await db.batch([
          db.prepare('DELETE FROM ways WHERE player = ? AND way = ?').bind(player.id, way),
          db.prepare('INSERT INTO ways (way, account, player, created, used) VALUES (?, ?, ?, ?, ?)').bind(way, account, player.id, now, now),
        ]);
      }
      return home('linked');
    }
    // an account with a profile: signed in
    if (owner) {
      const session = await newSession(db, request, owner);
      await db.batch([db.prepare('UPDATE ways SET used = ? WHERE way = ? AND account = ?').bind(now, way, account), ...session.statements]);
      return home('signed-in', [session.cookie, ended(NEWCOMER)]);
    }
    // an account that's new here: its player picks a name next
    const token = random(32);
    await db.batch([
      db.prepare('DELETE FROM newcomers WHERE expires <= ?').bind(now),
      db.prepare('INSERT INTO newcomers (hash, way, account, expires) VALUES (?, ?, ?, ?)').bind(await hashOf(token), way, account, now + NEWCOMER_MS),
    ]);
    return home('new', [cookie(NEWCOMER, token, NEWCOMER_MS)]);
  } catch (error) {
    console.error(error);
    return home('trouble=failed');
  }
}

// ---------- The API ----------

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ error: 'Profiles aren’t available on this copy of the site.' }, 503);
  // only the site's own pages can change anything; the cookies' SameSite=Lax already keeps other
  // sites' forms out
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.headers.get('Origin') !== url.origin) {
    return json({ error: 'That came from another site.' }, 403);
  }
  try {
    await ready(db);
    const route = `${request.method} ${url.pathname}`;
    const mustSignIn = async () => {
      const player = await signedIn(db, request);
      if (!player) throw new Problem(401, 'Sign in first.');
      return player;
    };

    switch (route) {
      // the signed-in player, or else the service of an account that's new here and waits for a name
      case 'GET /api/me': {
        const player = await signedIn(db, request);
        if (player) return json({ player: await profile(db, player), pending: null });
        return json({ player: null, pending: (await newcomer(db, request))?.way ?? null });
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
          ['achievements', 'ways', 'sessions'].map((table) => db.prepare(`DELETE FROM ${table} WHERE player = ?`).bind(player.id)).concat(
            db.prepare('DELETE FROM players WHERE id = ?').bind(player.id),
          ),
        );
        return json({ deleted: true }, 200, [ended(SESSION)]);
      }

      // all the site keeps about the player, as a file
      case 'GET /api/me/data': {
        const player = await mustSignIn();
        const [ways, sessions] = await db.batch<Record<string, unknown>>([
          db.prepare('SELECT way, account, created, used FROM ways WHERE player = ? ORDER BY created').bind(player.id),
          db.prepare('SELECT created, expires FROM sessions WHERE player = ? ORDER BY created').bind(player.id),
        ]);
        const when = (ms: unknown) => (typeof ms === 'number' ? new Date(ms).toISOString() : null);
        const earned = await earnedBy(db, player.id);
        const data = {
          site: url.origin,
          exported: when(Date.now()),
          player: { name: player.name, public: !!player.public, created: when(player.created) },
          signsInWith: ways.results.map((row) => ({ service: row.way, account: row.account, linked: when(row.created), lastUsed: when(row.used) })),
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

      // the account that's new here gets its profile, by the name its player picked
      case 'POST /api/sign-up': {
        const body = await readBody(request);
        const arrival = await newcomer(db, request);
        if (!arrival) throw new Problem(410, 'That took too long. Sign in again.');
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!NAME_PATTERN.test(name)) throw new Problem(400, 'Pick a name of 3 to 20 letters, numbers, dashes or underscores.');
        if (body.age !== true) throw new Problem(400, `Profiles are for players aged ${MINIMUM_AGE} or older.`);
        if (await nameTaken(db, name)) throw new Problem(409, 'That name is taken. Try another one.');
        const player = { id: random(16), name, public: 0, created: Date.now() };
        const session = await newSession(db, request, player.id);
        try {
          await db.batch([
            db.prepare('INSERT INTO players (id, name, name_key, public, created) VALUES (?, ?, ?, 0, ?)').bind(player.id, name, name.toLowerCase(), player.created),
            db.prepare('INSERT INTO ways (way, account, player, created, used) VALUES (?, ?, ?, ?, ?)').bind(arrival.way, arrival.account, player.id, player.created, player.created),
            db.prepare('DELETE FROM newcomers WHERE hash = ?').bind(arrival.hash),
            ...session.statements,
          ]);
        } catch (error) {
          if (String(error).includes('players.name_key')) throw new Problem(409, 'Someone just took that name. Try another one.');
          if (String(error).includes('ways.')) throw new Problem(409, 'That account already has a profile. Sign in again.');
          throw error;
        }
        return json({ player: await profile(db, player) }, 200, [session.cookie, ended(NEWCOMER)]);
      }

      // the player changed their mind about the account that's new here
      case 'DELETE /api/sign-up': {
        const token = cookieValue(request, NEWCOMER);
        if (token) await db.prepare('DELETE FROM newcomers WHERE hash = ?').bind(await hashOf(token)).run();
        return json({ pending: null }, 200, [ended(NEWCOMER)]);
      }

      case 'POST /api/sign-out': {
        const token = cookieValue(request, SESSION);
        if (token) await db.prepare('DELETE FROM sessions WHERE hash = ?').bind(await hashOf(token)).run();
        return json({ player: null }, 200, [ended(SESSION)]);
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

    // an account the player no longer signs in with; the last one stays
    const unlink = /^\/api\/me\/ways\/([a-z]+)$/.exec(url.pathname);
    if (unlink && request.method === 'DELETE') {
      const player = await mustSignIn();
      const way = unlink[1];
      const ways = (await profile(db, player)).ways;
      if (!isWay(way) || !ways.includes(way)) throw new Problem(404, 'That account isn’t linked to your profile.');
      // one statement, so two at once can't both take a way and leave none
      const gone = await db
        .prepare('DELETE FROM ways WHERE player = ?1 AND way = ?2 AND (SELECT COUNT(*) FROM ways WHERE player = ?1) > 1')
        .bind(player.id, way)
        .run();
      if (!gone.meta.changes) throw new Problem(400, 'That’s your only way in, so it stays.');
      // whoever signed in through that account on another device is signed out
      const token = cookieValue(request, SESSION)!;
      await db.prepare('DELETE FROM sessions WHERE player = ? AND hash != ?').bind(player.id, await hashOf(token)).run();
      return json({ player: await profile(db, player) });
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
