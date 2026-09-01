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
  .replace('"/node_modules/three/examples/jsm/"', '"./vendor/jsm/"')
  .replace('"/node_modules/marked/lib/marked.esm.js"', '"./vendor/marked.esm.js"')
  .replaceAll('/node_modules/@mathjax/mathjax-fira-font', './vendor/mathjax-fira')
  .replaceAll('/node_modules/mathjax', './vendor/mathjax')
  .replaceAll('/node_modules/@fontsource/', './vendor/fontsource/');
for (const [what, pat] of [['color-space.js', /'\.\/color-space\.js'/], ['three', /"\.\/vendor\/three\.module\.js"/],
                           ['three/addons', /"\.\/vendor\/jsm\/"/], ['mathjax', /\.\/vendor\/mathjax-fira\//],
                           ['marked', /"\.\/vendor\/marked\.esm\.js"/],
                           ['mathjax paths', /\.\/vendor\/mathjax'/], ['fonts', /\.\/vendor\/fontsource\//]])
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

// ─── MathJax, its Fira font, and the interface's own Fira ───────────────────
// None of this is in the import graph above: MathJax is a classic script that
// fetches the rest of itself at runtime, by the paths configured in the page.
// So the copies here have to mirror what it asks for.
//
//   mathjax-fira/  the component, plus chtml/woff2 (the faces) and
//                  chtml/dynamic (glyph tables loaded only when a page uses
//                  calligraphic or double-struck letters, which this one does)
//   mathjax/sre/   the speech worker and its character maps, which live under
//                  the engine rather than the font
//
// The woff2 and mathmaps directories are copied whole rather than by the files
// one render happened to request: which faces a formula needs depends on the
// formula, and a missing one is a silent fallback rather than an error.
const copyInto = async (from, to) => {
  await mkdir(dirname(join(OUT, to)), { recursive: true });
  await cp(from, join(OUT, to), { recursive: true });
};
const MJF = 'node_modules/@mathjax/mathjax-fira-font';
await copyInto(`${MJF}/tex-mml-chtml-mathjax-fira.js`, 'vendor/mathjax-fira/tex-mml-chtml-mathjax-fira.js');
await copyInto(`${MJF}/chtml/woff2`, 'vendor/mathjax-fira/chtml/woff2');
await copyInto(`${MJF}/chtml/dynamic`, 'vendor/mathjax-fira/chtml/dynamic');
await copyInto('node_modules/mathjax/sre/speech-worker.js', 'vendor/mathjax/sre/speech-worker.js');
// mathmaps ships sixteen locales at 4.2 MB. The page is lang="en", so the
// worker asks for base, en, and nemeth (the braille table) and never the rest.
for (const m of ['base', 'en', 'nemeth'])
  await copyInto(`node_modules/mathjax/sre/mathmaps/${m}.json`, `vendor/mathjax/sre/mathmaps/${m}.json`);

// The five faces the page's @font-face rules name, and nothing else: fontsource
// ships every weight in every subset, 252 files, and the interface uses five.
for (const f of ['fira-sans/files/fira-sans-latin-400-normal.woff2',
                 'fira-sans/files/fira-sans-latin-600-normal.woff2',
                 'fira-sans/files/fira-sans-latin-700-normal.woff2',
                 'fira-sans/files/fira-sans-greek-400-normal.woff2',
                 'fira-mono/files/fira-mono-latin-400-normal.woff2'])
  await copyInto(`node_modules/@fontsource/${f}`, `vendor/fontsource/${f}`);

// The markdown renderer, and the two documents it renders. The dialogs fetch
// these at run time, so they are content rather than build input: they have to
// exist next to index.html on the deployed site.
await copyInto('node_modules/marked/lib/marked.esm.js', 'vendor/marked.esm.js');
for (const doc of ['about.md', 'formulation.md']) await copyInto(doc, doc);

// Jekyll would otherwise skip anything beginning with an underscore
await writeFile(join(OUT, '.nojekyll'), '');

console.log(`${OUT}/ built — index.html, color-space.js, and ${copied.size} vendored module(s):`);
for (const f of copied) console.log(`  ${f}`);
