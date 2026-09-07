/**
 * The solver, off the main thread.
 *
 * It owns a whole copy of solver.js — its own module instance, its own S — and
 * the page owns another. Nothing is shared: the page sends state in, the worker
 * sends control points back. That is what makes the decoupling real rather than
 * cooperative, and it is why a 54ms step in CIEDE2000 no longer costs the
 * viewport three frames.
 *
 * The loop yields between slices even though nothing else wants this thread,
 * because a message that arrives mid-slice is only read at the yield — and one
 * of those messages is `stop`.
 */
import {
  S,
  RESTART,
  LAST,
  step,
  adamReset,
  resetTick,
  reseedJitter,
  better,
  derive,
  constrain,
  incumbent,
  tick,
} from './solver.js';
import { params, GAMUTS } from './color-space.ts';

let running = false,
  id = 0; // the page's run counter, echoed back

/**
 * The page cannot draw faster than a frame, so posting more often than this
 * would only queue points nobody displays. A single step already exceeds it in
 * every space but Oklab, which just means one step per slice there.
 */
const SLICE = 16;

/**
 * A discrete step is cheap enough that a slice held hundreds of them, and the
 * swatches jumped to the answer in a few frames with nothing to watch. One a
 * frame keeps the motion followable, and the rate slider is then the speed.
 * A continuous step costs a frame or more on its own, so there the slice is
 * the limit.
 */
const stepsPerFrame = () => (S.mode === 'discrete' ? 1 : Infinity);

function receive(m) {
  Object.assign(S, m.S);
  Object.assign(params, m.params);
  Object.assign(GAMUTS, m.gamuts); // any ICC profile the page loaded
  // this module instance has never seen a palette before, so everything it
  // keeps outside S — the knot count, the observer, the lightness floor — has
  // to be rebuilt from what just arrived
  derive();
  constrain();
  if (m.disturbed) adamReset(); // edited out from under the moments
}

/** the run's answer: the best restart, or where it ended if that was better */
const answer = () => {
  const best = incumbent();
  return S.restart && best && better(best, S.pts) ? best : S.pts;
};

const finish = () => {
  running = false;
  postMessage({ t: 'final', pts: answer(), id });
};

function loop() {
  if (!running) return;
  const until = performance.now() + SLICE;
  let alive = true,
    steps = 0;
  try {
    do {
      alive = step();
      steps++;
    } while (alive && performance.now() < until && steps < stepsPerFrame());
  } catch (err) {
    // A throw in here used to end the run without ending it. loop was never
    // rescheduled, so neither `pts` nor `final` ever arrived and the page sat
    // waiting with its button on `stop` over a solver that had stopped — which
    // is what a solver bug looked like from the outside: a freeze. Hand back
    // the points as they stand, not answer(), which is one of the things that
    // can throw. Rethrown so it still reaches the console with its stack.
    running = false;
    postMessage({ t: 'final', pts: S.pts, id });
    throw err;
  }
  postMessage({ t: 'pts', pts: S.pts, id, share: LAST.share, tick, restarts: RESTART.n });
  if (!alive) return finish(); // converged: nothing moved
  // the rest of the slice, so a cheap step runs once a frame rather than once
  // per timer tick; and a yield either way, so `stop` can be heard
  setTimeout(loop, Math.max(0, until - performance.now()));
}

onmessage = (e) => {
  const m = e.data;
  if (m.t === 'state') {
    if (running) receive(m);
    return;
  }
  if (m.t === 'stop') {
    if (running) finish();
    return;
  }
  if (m.t === 'start') {
    receive(m);
    resetTick();
    adamReset();
    reseedJitter();
    Object.assign(RESTART, { n: 0, best: null, bestScore: 0, scale: {}, flat: 0, prev: Infinity });
    id = m.id;
    // a start that arrives while the previous run is still unwinding re-seeds
    // it rather than beginning a second chain of slices alongside the first
    const idle = !running;
    running = true;
    if (idle) loop();
  }
};
