// Renders the three prose documents to HTML: markdown through marked, math
// through MathJax running here in Node, as SVG with assistive MathML. The page
// fetches the finished HTML, so it ships neither library nor the math fonts,
// and never typesets. The build writes the files; the dev server renders them
// on request when it is serving the sources.
import { join } from 'node:path';
import { marked } from 'marked';
import { init } from 'mathjax/node-main.mjs';

// TeX is full of the characters markdown spends: every subscript in $\ell_g$ is
// an emphasis marker. So each formula is lifted out for a placeholder before the
// parser runs and put back, rendered, after.
const MATH = /\$\$[\s\S]*?\$\$|\$[^$]*?\$/g;
const slot = (i) => `MJXSLOT${i}TOLSXJM`;

const MathJax = await init({
  loader: {
    load: ['input/tex', 'output/svg', 'a11y/assistive-mml'],
    paths: {
      'mathjax-fira': join(import.meta.dirname, '../node_modules/@mathjax/mathjax-fira-font'),
    },
  },
  output: { font: 'mathjax-fira' },
  svg: { fontCache: 'global' }, // one path per glyph per document, referenced by every formula
  startup: { typeset: false },
});
const { adaptor } = MathJax.startup;

/** the rules MathJax's SVG output relies on, inlined once per document that has math */
const CSS = `<style>${adaptor.textContent(MathJax.svgStylesheet())}</style>`;

let docs = 0;
/** markdown to HTML with every formula rendered; `id` keeps two documents' glyph ids apart */
export async function renderDoc(md) {
  const id = `MJX${++docs}-`;
  const math = [];
  let html = marked.parse(md.replace(MATH, (m) => slot(math.push(m) - 1)));
  // a display formula is a block of its own, not a paragraph containing one
  math.forEach((m, i) => {
    if (m.startsWith('$$')) html = html.replaceAll(`<p>${slot(i)}</p>`, slot(i));
  });
  // two conveniences on top of markdown: a {.name} on its own line puts that
  // class on the block after it, and external links open in a new tab
  html = html
    .replace(/<p>\{\.([\w-]+)\}<\/p>\s*<(\w+)/g, (_, cls, tag) => `<${tag} class="${cls}"`)
    .replace(/<a href="(https?:[^"]*)"/g, '<a href="$1" target="_blank" rel="noopener"');
  MathJax.texReset();
  const cache = MathJax.startup.output.fontCache;
  cache.clearCache();
  for (const [i, m] of math.entries()) {
    const display = m.startsWith('$$');
    // the promise form: some glyph ranges load on first use
    const node = await MathJax.tex2svgPromise(display ? m.slice(2, -2) : m.slice(1, -1), {
      display,
    });
    html = html.replaceAll(slot(i), adaptor.outerHTML(node));
  }
  if (!math.length) return html;
  const glyphs = `<svg style="display:none">${adaptor.outerHTML(cache.getCache())}</svg>`;
  return (CSS + glyphs + html).replaceAll('MJX-', id);
}
