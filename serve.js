// Dev server. The browser cannot parse TypeScript, so strip the types on the
// way out — no build step, no build artifact, edits to color-space.ts are live.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { extname, join, normalize } from 'node:path';

const TYPE = { '.html': 'text/html', '.js': 'text/javascript', '.ts': 'text/javascript', '.css': 'text/css' };

createServer(async (req, res) => {
  const rel = normalize(decodeURI(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(import.meta.dirname, rel.endsWith('/') ? rel + 'index.html' : rel);
  try {
    const src = await readFile(file, 'utf8');
    res.writeHead(200, { 'content-type': TYPE[extname(file)] ?? 'text/plain', 'cache-control': 'no-store' });
    res.end(extname(file) === '.ts' ? stripTypeScriptTypes(src) : src);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(8080, () => console.log('http://localhost:8080'));
