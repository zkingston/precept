// Dev server. The browser cannot parse TypeScript, so strip the types on the
// way out — no build step, no build artifact, edits to color-space.ts are live.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { extname, join, normalize } from 'node:path';

// Fonts need their own types AND their own bytes. Serving a woff2 as text/plain
// is survivable; reading one with the 'utf8' flag is not, because every byte
// that is not valid UTF-8 becomes U+FFFD and the file comes back near twice its
// real size. The browser then rejects the font and falls back silently, which
// on MathJax output means correct layout filled with the wrong glyphs.
const TYPE = { '.html': 'text/html', '.js': 'text/javascript', '.ts': 'text/javascript', '.css': 'text/css',
               '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff',
               '.md': 'text/markdown' };

createServer(async (req, res) => {
  const rel = normalize(decodeURI(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(import.meta.dirname, rel.endsWith('/') ? rel + 'index.html' : rel);
  try {
    const src = await readFile(file);                    // Buffer: see above
    res.writeHead(200, { 'content-type': TYPE[extname(file)] ?? 'text/plain', 'cache-control': 'no-store' });
    res.end(extname(file) === '.ts' ? stripTypeScriptTypes(src.toString('utf8')) : src);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(8080, () => console.log('http://localhost:8080'));
