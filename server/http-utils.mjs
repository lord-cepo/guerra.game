import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

export function cleanNickname(value) {
  const nickname = typeof value === 'string' ? value.trim() : '';
  return /^[a-zA-Z0-9_-]{2,24}$/.test(nickname) ? nickname : undefined;
}

export async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 10_000) throw new Error('Request body is too large');
  }
  return JSON.parse(body || '{}');
}

export function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function fileForRequest(root, url) {
  const pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  const relativePath = pathname === '/' ? 'hex-grid.html' : pathname.replace(/^\/+/, '');
  const filename = resolve(root, normalize(relativePath));
  return filename.startsWith(`${root}${sep}`) || filename === root ? filename : undefined;
}

export async function serveStatic(root, request, response) {
  const filename = fileForRequest(root, request.url ?? '/');
  if (!filename) {
    response.writeHead(403).end();
    return;
  }
  try {
    await access(filename);
    const info = await stat(filename);
    if (!info.isFile()) throw new Error('Not a file');
    // Avoid pinning an old client bundle while authoritative state changes.
    response.writeHead(200, {
      'content-type': mimeTypes[extname(filename)] ?? 'application/octet-stream',
      'cache-control': 'no-store'
    });
    createReadStream(filename).pipe(response);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}
