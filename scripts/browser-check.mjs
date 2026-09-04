#!/usr/bin/env node
// Drives the page in headless Chromium over the DevTools protocol and checks
// what the self-check cannot: names on every control, the keyboard, the live
// status, contrast, target sizes, the Optimize table under a running solver,
// and the observer reaching the whole page.
//
//   node scripts/browser-check.mjs        # needs a local chromium; CHROMIUM=... to point at one
//
// Not in CI: it wants a browser with WebGL, and a run takes about a minute.
import { spawn } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { dirname, join } from 'node:path';

const REPO = join(dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9333, PAGE = 'http://localhost:8080/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pack = (scene) => Buffer.from(deflateRawSync(Buffer.from(JSON.stringify(scene)))).toString('base64url');

const server = spawn('node', ['serve.js'], { cwd: REPO, stdio: 'ignore' });
const chrome = spawn(process.env.CHROMIUM ?? 'chromium', ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--no-sandbox', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });

let ws, seq = 0, bad = 0;
const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
};
const ok = (cond, what, detail = '') => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`);
};
async function load(scene) {
  await send('Page.navigate', { url: `${PAGE}?t=${Date.now()}#s=${pack(scene)}` });
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    if (await ev(`document.querySelectorAll('#metrics tr').length > 0 && !document.getElementById('boot')?.isConnected`).catch(() => false)) break;
  }
  await sleep(800);
}
const key = async (k, code = k, mods = 0) => {
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', { type, key: k, code, text: type === 'keyDown' && k.length === 1 ? k : undefined, modifiers: mods });
  await sleep(200);
};
const click = async (selector) => {
  const r = JSON.parse(await ev(`JSON.stringify(document.querySelector('${selector}').getBoundingClientRect())`));
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x: r.x + r.width / 2, y: r.y + r.height / 2, button: 'left', clickCount: 1 });
  await sleep(300);
};
const live = () => ev(`document.getElementById('live').textContent`);
const set = (id, value, event = 'input') => ev(`{ const e = document.getElementById('${id}'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('${event}', { bubbles: true })); }`);

// the chrome colors and their contrast against the panel
const CHROME = `(() => { const cs = getComputedStyle(document.documentElement), hx = (k) => cs.getPropertyValue(k).trim();
  const lum = (x) => { const c = [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  return { bg: hx('--bg'), link: hx('--link'), dim: cr(hx('--dim'), hx('--bg')), hot: cr(hx('--hot'), hx('--bg')), linkcr: cr(hx('--link'), hx('--bg')) }; })()`;

// interactive nodes in the accessibility tree with no name
async function unnamed() {
  const { nodes } = await send('Accessibility.getFullAXTree');
  const roles = new Set(['button', 'slider', 'combobox', 'textbox', 'checkbox', 'spinbutton', 'img', 'application', 'ColorWell']);
  return nodes.filter((n) => !n.ignored && roles.has(n.role?.value) && !(n.name?.value || '').trim()).length;
}

// targets under 24px that no spacing excuses: canvases, inputs inside their
// labels, and the two thumbs of a dual slider are left out
const SIZES = `(() => {
  const sel = 'button, input:not([hidden]), select, textarea, .q, label.chk, [tabindex="0"]';
  const els = [...document.querySelectorAll(sel)].filter((e) => !(e.tagName === 'CANVAS' || (e.closest('label.chk') && e.closest('label.chk') !== e) || e.closest('.dual')))
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; });
  const rects = els.map((e) => e.getBoundingClientRect());
  return els.filter((e, i) => {
    const r = rects[i]; if ((r.width >= 24 && r.height >= 24) || e.classList.contains('q')) return false;
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    return rects.some((q, j) => j !== i && Math.hypot(Math.max(q.left - cx, 0, cx - q.right), Math.max(q.top - cy, 0, cy - q.bottom)) < 12);
  }).length; })()`;

const base = { precept: 1, gamut: 'srgb', pin: [], cut: [], loop: [], marks: [], planes: [], lprof: [], hprof: [], obs: [] };
const ramp = [[28, 8, -32], [42, -18, 6], [58, 16, 18], [74, -8, 38], [90, -12, 62]];

try {
  for (let i = 0; i < 50 && !ws; i++) {
    try {
      const page = (await (await fetch(`http://localhost:${PORT}/json`)).json()).find((t) => t.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch { /* not up yet */ }
    if (!ws) await sleep(200);
  }
  if (!ws) throw new Error('chromium did not come up on the debugging port');
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
      errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Accessibility.enable');

  // ── discrete: names, sizes, selection, arrows, the run, the observer ──
  await load({ ...base, space: 'oklab', mode: 'discrete', pts: ramp, obs: [{ c: [56, 14, -18], r: 14 }] });
  ok((await unnamed()) === 0, 'every control has a name (discrete)');
  ok((await ev(SIZES)) === 0, 'no target under 24px without spacing (discrete)');
  ok((await ev(`[...document.querySelectorAll('label.f[for]')].filter((l) => l.control).length`)) === 15, 'row labels reach their controls');
  const c0 = await ev(CHROME);
  ok(c0.dim >= 4.5 && c0.hot >= 4.5 && c0.linkcr >= 4.5, 'chrome contrast clears 4.5:1', `dim ${c0.dim.toFixed(2)} hot ${c0.hot.toFixed(2)} link ${c0.linkcr.toFixed(2)}`);
  await ev(`document.getElementById('gl').focus()`);
  await key(']', 'BracketRight');
  ok(/^selected node 1,/.test(await live()), '] selects the first node and announces it', await live());
  for (let i = 0; i < 5; i++) await key(']', 'BracketRight');
  ok(/keep-out ball 1/.test(await live()), '] walks on to the keep-out ball');
  await key('[', 'BracketLeft');
  const before = await ev(`document.getElementById('selinfo').textContent`);
  await key('ArrowRight', 'ArrowRight');
  ok(before !== (await ev(`document.getElementById('selinfo').textContent`)), 'an arrow nudges the selected node');
  ok((await ev(`document.querySelectorAll('#swatches button[aria-label]').length`)) === 5, 'swatches are named buttons');
  ok(!(await ev(`document.getElementById('undo').disabled`)), 'the nudge can be undone');

  const cells = `JSON.stringify([...document.querySelectorAll('#metrics tr:not(.plotrow)')].map((tr) => [tr.cells[1].getBoundingClientRect().left, tr.cells[1].getBoundingClientRect().right, tr.cells[2].getBoundingClientRect().left]))`;
  const geo0 = await ev(cells);
  await ev(`document.getElementById('run').click()`); await sleep(1500);
  ok((await live()) === 'Optimizer running.', 'a run is announced');
  ok((await ev(`document.querySelectorAll('#metrics .sh[data-live]').length`)) > 0, 'step shares appear during a run');
  ok((await ev(`document.getElementById('runinfo').textContent`)).startsWith('step '), 'the step count shows', await ev(`document.getElementById('runinfo').textContent`));
  ok(geo0 === (await ev(cells)), 'the Optimize table does not move during a run');
  await ev(`document.getElementById('run').click()`); await sleep(500);
  ok((await live()) === 'Optimizer stopped.', 'a stop is announced');

  await click('.sw[data-i="2"]');
  await set('cvd', 'protan', 'change'); await sleep(600);
  const c1 = await ev(CHROME);
  ok(c1.bg !== c0.bg && c1.link !== c0.link, 'the backdrop and accent follow the observer');
  ok(!(await ev(`document.getElementById('selsim').hidden`)), 'the selection shows the observer\'s view');
  await set('cvd', 'none', 'change'); await sleep(600);
  ok((await ev(CHROME)).bg === c0.bg, 'and come back with normal vision');

  // ── continuous: plots, bounds, the wheel ──
  await load({ ...base, space: 'cielab', mode: 'continuous', pts: ramp, lo: [20, 0], hi: [80, 40], hue: [30, 200] });
  ok((await unnamed()) === 0, 'every control has a name (continuous)');
  ok((await ev(SIZES)) === 0, 'no target under 24px without spacing (continuous)');
  await ev(`document.querySelector('.q[data-h]').focus()`);
  ok((await ev(`getComputedStyle(document.activeElement, '::after').content`)) !== 'none', 'a hint shows on keyboard focus');
  ok((await ev(`document.getElementById('rate').getAttribute('aria-describedby')`)) === 'q-rate', 'a control is described by its hint');
  await ev(`document.querySelectorAll('.pcanvas')[0].focus()`);
  for (let i = 0; i < 30; i++) await key('ArrowUp', 'ArrowUp', 8);
  ok(/: 80$/.test(await live()), 'a lightness knot stops at the band', await live());
  await ev(`document.querySelectorAll('.pcanvas')[1].focus()`);
  for (let i = 0; i < 30; i++) await key('ArrowUp', 'ArrowUp', 8);
  ok(/: 200°$/.test(await live()), 'a hue knot stops at the arc', await live());
  await ev(`document.getElementById('huewheel').focus()`);
  await key('ArrowRight', 'ArrowRight');
  ok(/^hue arc 32° to 200°$/.test(await live()), 'the wheel takes arrow keys', await live());
  await key('Delete', 'Delete');
  ok((await live()) === 'every hue allowed' && (await ev(`document.getElementById('gl').getAttribute('aria-label')`)).includes('5 control points'), 'Delete on the wheel resets the arc and keeps the nodes');

  ok(errors.length === 0, 'no console errors', errors.join(' | ').slice(0, 200));
} catch (err) {
  bad++;
  console.log('FAIL', err.message);
} finally {
  ws?.close(); chrome.kill(); server.kill();
}
console.log(bad ? `${bad} failed` : 'all browser checks passed');
process.exit(bad ? 1 : 0);
