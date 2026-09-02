// Builds docs/ for GitHub Pages.
//
// The dev setup is not static and this undoes that. The browser cannot parse
// TypeScript; the import map points at absolute /node_modules paths, which
// resolve to the DOMAIN root on a project Pages site rather than the project
// root; and the page's script is written inline, against a three that ships
// 2 MB of everything. esbuild answers all three at once: it reads the .ts, it
// resolves every specifier at build time so no map is needed, and it keeps
// only the parts of three the page actually reaches.
//
// The dev server serves the sources untouched, so `node serve.js` still runs
// readable code with real names in a stack trace. The bundle is for the
// deployed copy only.
//
// docs/ is a build artifact but is committed, because Pages serves from the
// repo. Rebuild before pushing.
import { readFile, writeFile, mkdir, rm, cp, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const OUT = 'docs';

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'vendor'), { recursive: true });

// ─── the page's own module, lifted out so it can be bundled ─────────────────
// It is written inline, which is right for a file you open and read and wrong
// for something esbuild has to resolve imports from. So it goes to a scratch
// file beside its own sources, where './color-space.ts' and './solver.js' mean
// what they say, and comes back as one <script src>.
const RAW = await readFile('index.html', 'utf8');
const OPEN = '<script type="module">', CLOSE = '</script>';
const a = RAW.indexOf(OPEN), b = RAW.lastIndexOf(CLOSE);
if (a < 0 || b < a) throw new Error('index.html: could not find the module script to bundle');

const ENTRY = '.app-entry.js';
// MathJax is a classic script fetched by URL at run time, so its path travels
// inside the module rather than in the markup, and has to be rewritten here.
const entry = RAW.slice(a + OPEN.length, b)
  .replaceAll('/node_modules/@mathjax/mathjax-fira-font', './vendor/mathjax-fira');
if (!entry.includes('./vendor/mathjax-fira/')) throw new Error('the MathJax rewrite did not match');
await writeFile(ENTRY, entry);

// The worker is fetched by URL rather than imported, so nothing would lead
// esbuild to it: it has to be named as a second entry point. `splitting` gives
// the two their shared code as one chunk, and each realm still evaluates its
// own instance of it, which is what the solver's two copies of S rely on.
let meta;
try {
  ({ metafile: meta } = await build({
    entryPoints: { app: ENTRY, 'solver-worker': 'solver-worker.js' },
    bundle: true, splitting: true, format: 'esm', outdir: OUT,
    minify: true, legalComments: 'eof',        // three is MIT: keep the notice
    target: ['chrome111', 'firefox121', 'safari16.4'],
    chunkNames: 'chunk-[hash]', metafile: true,
  }));
} finally {
  await unlink(ENTRY).catch(() => {});
}

// ─── the page, with every specifier pointed at something that will exist ─────
const html = (RAW.slice(0, a) + '<script type="module" src="./app.js"></script>' + RAW.slice(b + CLOSE.length))
  // every bare specifier is resolved in the bundle, so the map has nothing left
  // to answer for
  .replace(/<script type="importmap">[\s\S]*?<\/script>\n/, '')
  .replace('<link rel="modulepreload" href="/node_modules/three/build/three.core.js">',
           '<link rel="modulepreload" href="./app.js">')
  .replaceAll('/node_modules/@mathjax/mathjax-fira-font', './vendor/mathjax-fira')
  .replaceAll('/node_modules/mathjax', './vendor/mathjax')
  .replaceAll('/node_modules/@fontsource/', './vendor/fontsource/');
for (const [what, pat] of [['the bundle', /<script type="module" src="\.\/app\.js"><\/script>/],
                           ['the preload', /"\.\/app\.js"/],
                           ['the mathjax loader paths', /'\.\/vendor\/mathjax-fira'/],
                           ['the mathjax tree', /'\.\/vendor\/mathjax'/],
                           ['fonts', /\.\/vendor\/fontsource\//]])
  if (!pat.test(html)) throw new Error(`rewrite for ${what} did not match — check index.html`);
for (const [what, pat] of [['an import map', /type="importmap"/], ['a node_modules path', /\/node_modules\//]])
  if (pat.test(html)) throw new Error(`${what} survived into the built page`);
await writeFile(join(OUT, 'index.html'), html);

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

// The three documents the dialogs fetch at run time: content rather than build
// input, so they have to exist next to index.html on the deployed site. Their
// renderer is not here any more — marked is imported dynamically, so esbuild
// gives it its own chunk and the page still only pays for it on a ? click.
for (const doc of ['about.md', 'formulation.md', 'spaces.md']) await copyInto(doc, doc);

// Jekyll would otherwise skip anything beginning with an underscore
await writeFile(join(OUT, '.nojekyll'), '');

const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
console.log(`${OUT}/ built —`);
for (const [f, o] of Object.entries(meta.outputs).sort((x, y) => y[1].bytes - x[1].bytes))
  console.log(`  ${kb(o.bytes).padStart(8)}  ${f}`);
