// Dev server. Serves docs/, the built copy, and rebuilds it on every edit, so
// what you see is what Pages will ship. `node scripts/serve.js src` serves the sources
// instead: the browser cannot parse TypeScript, so the types are stripped on
// the way out, and a stack trace keeps its real names.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { extname, join, normalize } from 'node:path';

// Fonts need their own types AND their own bytes. Serving a woff2 as text/plain
// is survivable; reading one with the 'utf8' flag is not, because every byte
// that is not valid UTF-8 becomes U+FFFD and the file comes back near twice its
// real size. The browser then rejects the font and falls back silently, which
// on MathJax output means correct layout filled with the wrong glyphs.
const TYPE = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.ts': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.md': 'text/markdown',
};

const REPO = join(import.meta.dirname, '..');
const ROOT = process.argv[2] ?? 'docs';
if (ROOT === 'docs') {
  // `node --watch build.js` would watch only what build.js imports, and
  // watching . would include docs/ and the scratch entry file, so the inputs
  // are named one by one.
  const SRC = [
    'index.html',
    'scene.js',
    'color-space.ts',
    'solver.js',
    'solver-worker.js',
    'data',
    'text',
  ];
  const watch = spawn(
    process.execPath,
    [...SRC.map((f) => `--watch-path=src/${f}`), 'scripts/build.js'],
    { cwd: REPO, stdio: 'inherit' },
  );
  // so a kill of this process does not leave the watcher rebuilding forever
  for (const sig of ['SIGINT', 'SIGTERM'])
    process.on(sig, () => {
      watch.kill(sig);
      process.exit();
    });
}

createServer(async (req, res) => {
  const [path, query] = req.url.split('?');
  const rel = normalize(decodeURI(path)).replace(/^(\.\.[/\\])+/, '');
  // the page names /node_modules absolutely, which lives at the repo root, not under src/
  const base = rel.startsWith('/node_modules/') ? '' : ROOT;
  const file = join(REPO, base, rel.endsWith('/') ? rel + 'index.html' : rel);
  try {
    // serving the sources: the prose is rendered on request, as the build renders it
    const doc = ROOT !== 'docs' && /^\/text\/([\w-]+)\.html$/.exec(rel);
    if (doc) {
      const { renderDoc } = await import('./render-docs.js');
      const html = await renderDoc(
        await readFile(join(REPO, ROOT, 'text', `${doc[1]}.md`), 'utf8'),
      );
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(html);
      return;
    }
    const src = await readFile(file); // Buffer: see above
    res.writeHead(200, {
      'content-type': TYPE[extname(file)] ?? 'text/plain',
      'cache-control': 'no-store',
    });
    res.end(extname(file) === '.ts' ? stripTypeScriptTypes(src.toString('utf8')) : src);
  } catch (err) {
    // A directory asked for without its trailing slash. Redirect rather than
    // serve its index.html from here: /docs and /docs/ are different bases, and
    // from the first one every relative URL in the page — ./app.js, ./about.md —
    // resolves a level too high and 404s. This is what a static host does with
    // the same request, GitHub Pages included, so the deployed copy already
    // behaves this way and only the dev server did not.
    if (err.code === 'EISDIR') {
      res.writeHead(301, { location: path + '/' + (query ? `?${query}` : '') }).end();
      return;
    }
    res.writeHead(404).end('not found');
  }
}).listen(8080, () => console.log('http://localhost:8080'));
