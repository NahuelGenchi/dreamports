// Serves the repository's folder to a browser on this computer only, so a game in games/ loads with its kit from
// kit/, as dreamports.net serves them at /play/<game>/ and /kit/<console>/. What the site keeps in public/, such as
// /dreamports.js, is served from there.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { REPO } from './paths.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

/**
 * Starts the server on a free port of 127.0.0.1: { url, serve(path, bytes), close() }. A tool that talks to its page
 * gives `answer`, which sees each request first, as (request, response, path), and resolves to true if it answered,
 * and `serve` holds bytes for the page to fetch, until it's given null for them.
 */
export async function serveRepository({ answer } = {}) {
  const held = new Map();
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (held.has(path)) {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(held.get(path));
      return;
    }
    if (await answer?.(request, response, path)) return;
    // nothing outside the repository, and none of its hidden folders, such as .git or .dreamports
    const parts = normalize(path).split(/[\\/]/).filter(Boolean);
    if (parts.some(p => p.startsWith('.'))) return notFound(response);
    for (const root of [REPO, join(REPO, 'public')]) {
      let file = join(root, ...parts);
      if (!file.startsWith(root.endsWith(sep) ? root : root + sep) && file !== root) continue;
      try {
        let info = await stat(file);
        if (info.isDirectory()) {
          file = join(file, 'index.html');
          info = await stat(file);
        }
        if (!info.isFile()) continue;
        response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
        createReadStream(file).pipe(response);
        return;
      } catch {
        // not in this root
      }
    }
    notFound(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    serve: (path, bytes) => { if (bytes) held.set(path, bytes); else held.delete(path); },
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

function notFound(response) {
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('Not found');
}
