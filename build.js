// Builds docs/ for GitHub Pages.
//
// Two things make the dev setup non-static, and this undoes both. The browser
// cannot parse TypeScript, so `serve.js` strips types on the way out — here
// they are stripped once, to a file. And the import map points at absolute
// /node_modules paths, which resolve to the DOMAIN root on a project Pages
// site, not the project root — so the vendored copies are addressed relatively.
//
// docs/ is a build artifact but is committed, because Pages serves from the
// repo. Rebuild before pushing; `node serve.js` still runs from source.
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, posix } from 'node:path';

const OUT = 'docs';
const JSM = 'node_modules/three/examples/jsm';

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'vendor/jsm'), { recursive: true });

// ─── the module the browser could not have parsed ────────────────────────────
const ts = await readFile('color-space.ts', 'utf8');
await writeFile(join(OUT, 'color-space.js'), stripTypeScriptTypes(ts));

// ─── the page, with every specifier pointed at something that will exist ─────
const html = (await readFile('index.html', 'utf8'))
  .replace("'./color-space.ts'", "'./color-space.js'")
  .replace('"/node_modules/three/build/three.module.js"', '"./vendor/three.module.js"')
  .replace('"/node_modules/three/examples/jsm/"', '"./vendor/jsm/"');
for (const [what, pat] of [['color-space.js', /'\.\/color-space\.js'/], ['three', /"\.\/vendor\/three\.module\.js"/],
                           ['three/addons', /"\.\/vendor\/jsm\/"/]])
  if (!pat.test(html)) throw new Error(`rewrite for ${what} did not match — check index.html`);
await writeFile(join(OUT, 'index.html'), html);

// ─── three and its addons, by following imports rather than guessing ────────
// three.module.js is a shim that re-exports three.core.js, and an addon can
// pull in siblings, so copying just the two files the page names leaves a 404
// that only shows up once the page is served statically. Walk the graph.
const copied = new Set();
const queue = [
  { root: 'node_modules/three/build', rel: 'three.module.js', out: 'vendor' },
  ...[...html.matchAll(/from\s+'three\/addons\/([^']+)'/g)].map((m) => ({ root: JSM, rel: m[1], out: 'vendor/jsm' })),
];
while (queue.length) {
  const { root, rel, out } = queue.shift();
  const key = `${out}/${rel}`;
  if (copied.has(key)) continue;
  copied.add(key);
  const src = await readFile(join(root, rel), 'utf8');
  await mkdir(dirname(join(OUT, out, rel)), { recursive: true });
  await writeFile(join(OUT, out, rel), src);
  for (const m of src.matchAll(/from\s+'(\.[^']+|three\/addons\/[^']+)'/g))
    queue.push(m[1].startsWith('three/addons/')
      ? { root: JSM, rel: m[1].slice(13), out: 'vendor/jsm' }
      : { root, rel: posix.normalize(posix.join(posix.dirname(rel), m[1])), out });
}

// Jekyll would otherwise skip anything beginning with an underscore
await writeFile(join(OUT, '.nojekyll'), '');

console.log(`${OUT}/ built — index.html, color-space.js, and ${copied.size} vendored module(s):`);
for (const f of copied) console.log(`  ${f}`);
