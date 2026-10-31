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

/** Starts the server on a free port of 127.0.0.1: { url, close() }. */
export async function serveRepository() {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
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
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

function notFound(response) {
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('Not found');
}
