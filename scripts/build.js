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
// `npm run serve` serves this bundle and reruns this script on every edit.
// `node scripts/serve.js src` serves the sources untouched, for readable code with real
// names in a stack trace.
//
// docs/ is a build artifact and is not committed: the Pages workflow builds it
// on every push to main.
import { readFile, writeFile, mkdir, rm, cp, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { build } from 'esbuild';

const SRC = 'src';
const OUT = 'docs';

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'vendor'), { recursive: true });

// ─── the page's own module, lifted out so it can be bundled ─────────────────
// It is written inline, which is right for a file you open and read and wrong
// for something esbuild has to resolve imports from. So it goes to a scratch
// file beside its own sources, where './color-space.ts' and './solver.js' mean
// what they say, and comes back as one <script src>.
const RAW = await readFile(join(SRC, 'index.html'), 'utf8');
const OPEN = '<script type="module">',
  CLOSE = '</script>';
const a = RAW.indexOf(OPEN),
  b = RAW.lastIndexOf(CLOSE);
if (a < 0 || b < a) throw new Error('index.html: could not find the module script to bundle');

const ENTRY = join(SRC, '.app-entry.js');
await writeFile(ENTRY, RAW.slice(a + OPEN.length, b));

// The worker is fetched by URL rather than imported, so nothing would lead
// esbuild to it: it has to be named as a second entry point. `splitting` gives
// the two their shared code as one chunk, and each realm still evaluates its
// own instance of it, which is what the solver's two copies of S rely on.
let meta;
try {
  ({ metafile: meta } = await build({
    entryPoints: { app: ENTRY, 'solver-worker': join(SRC, 'solver-worker.js') },
    bundle: true,
    splitting: true,
    format: 'esm',
    outdir: OUT,
    minify: true,
    legalComments: 'eof', // three is MIT: keep the notice
    target: ['chrome111', 'firefox121', 'safari16.4'],
    chunkNames: 'chunk-[hash]',
    metafile: true,
  }));
} finally {
  await unlink(ENTRY).catch(() => {});
}

const shared = meta.outputs[join(OUT, 'app.js')].imports
  .filter((i) => i.kind === 'import-statement')
  .map((i) => `./${basename(i.path)}`);

// ─── the page, with every specifier pointed at something that will exist ─────
const html = (
  RAW.slice(0, a) +
  '<script type="module" src="./app.js"></script>' +
  RAW.slice(b + CLOSE.length)
)
  // every bare specifier is resolved in the bundle, so the map has nothing left
  // to answer for
  .replace(/<script type="importmap">[\s\S]*?<\/script>\n/, '')
  // the bundle, and the chunk it shares with the worker: named here so the
  // browser fetches both at once rather than finding the chunk after parsing the bundle
  .replace(
    /<link rel="modulepreload" href="\/node_modules\/three\/build\/three\.core\.js" ?\/?>/,
    ['./app.js', ...shared].map((f) => `<link rel="modulepreload" href="${f}" />`).join('\n  '),
  )
  .replaceAll('/node_modules/@fontsource/', './vendor/fontsource/');
for (const [what, pat] of [
  ['the bundle', /<script type="module" src="\.\/app\.js"><\/script>/],
  ['the preload', /"\.\/app\.js"/],
  ['fonts', /\.\/vendor\/fontsource\//],
])
  if (!pat.test(html)) throw new Error(`rewrite for ${what} did not match — check index.html`);
for (const [what, pat] of [
  ['an import map', /type="importmap"/],
  ['a node_modules path', /\/node_modules\//],
])
  if (pat.test(html)) throw new Error(`${what} survived into the built page`);
await writeFile(join(OUT, 'index.html'), html);

// ─── the interface's Fira ────────────────────────────────────────────────────
const copyInto = async (from, to) => {
  await mkdir(dirname(join(OUT, to)), { recursive: true });
  await cp(from, join(OUT, to), { recursive: true });
};
// The four faces the page's @font-face rules name, and nothing else: fontsource
// ships every weight in every subset, 252 files, and the interface uses five.
for (const f of [
  'fira-sans/files/fira-sans-latin-400-normal.woff2',
  'fira-sans/files/fira-sans-latin-700-normal.woff2',
  'fira-sans/files/fira-sans-greek-400-normal.woff2',
  'fira-mono/files/fira-mono-latin-400-normal.woff2',
])
  await copyInto(`node_modules/@fontsource/${f}`, `vendor/fontsource/${f}`);

// The three documents the dialogs fetch at run time, rendered here: markdown
// and math both, so the page ships neither renderer. See render-docs.js.
const { renderDoc } = await import('./render-docs.js');
await mkdir(join(OUT, 'text'), { recursive: true });
for (const doc of ['about', 'formulation', 'spaces'])
  await writeFile(
    join(OUT, 'text', `${doc}.html`),
    await renderDoc(await readFile(join(SRC, 'text', `${doc}.md`), 'utf8')),
  );

// Jekyll would otherwise skip anything beginning with an underscore
await writeFile(join(OUT, '.nojekyll'), '');

const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
console.log(`${OUT}/ built —`);
for (const [f, o] of Object.entries(meta.outputs).sort((x, y) => y[1].bytes - x[1].bytes))
  console.log(`  ${kb(o.bytes).padStart(8)}  ${f}`);
