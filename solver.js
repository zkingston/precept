/**
 * The palette, the objective, and the descent — everything numeric, and nothing
 * that touches the DOM.
 *
 * It lives apart from the page because it also runs in a worker. A single Adam
 * step measures 22ms in CIELAB and 54ms in CIEDE2000, which is longer than a
 * frame and cannot be subdivided: the gradient is one central-difference sweep
 * over 3n coordinates and the projection that follows it is atomic. On the main
 * thread that left the viewport drawing only between steps, around 18fps in the
 * expensive spaces, and no scheduling fixes a block that will not divide. So the
 * numerics get their own thread and the page keeps its own.
 *
 * The worker holds a SECOND copy of everything here — its own module instance,
 * its own S. The page sends state in and gets control points back; neither
 * reaches into the other. See solver-worker.js.
 */
import {
  fromHex, toGamut, inGamut, fromLCh, arcLength, segLength, perceive, unperceive, resample, spline,
  gamutPenalty, obstaclePenalty, toLinear, simulate, NORMAL, ALL_VIEWS, EUCLIDEAN, toSpace, fromSpace,
  spaceMetric,
} from './color-space.ts';

export const clamp01 = (v) => Math.min(1, Math.max(0, v));

export const S = {
  mode: 'continuous', tool: 'edit', cvd: 'none', sev: 1, gray: false,
  shell: 0.8, sliceOp: 0.8, rad: 12, rate: 0.3,
  pin: [],                                       // parallel to pts: held still by the solver
  cut: [],                                       // cut[i]: no edge from pts[i] to pts[i+1]
  loop: [],                                      // loop[c]: run c closes back on itself
  marks: [],                                     // ctrl-clicked nodes, for linking
  bg: '#f0ead6', lock: true, planes3d: false,
  seed: 20260831,                                // the restart jitter, so a run repeats
  panels: true,                                  // the three cut views, or the 3D one alone
  fmt: 'matplotlib', cfmt: 'hex',                // export format, selection color format
  restart: false,                                // kick the solver out of stalls
  cbg: '#ffffff', cmin: 3,                       // contrast: against what, and how much
  tipKind: 'sineramp',                           // which test image is showing
  lprof: [],                                     // target lightness profile, evenly spaced along t
  hprof: [],                                     // target hue profile, UNWRAPPED degrees
  slice: [55, 0, 0],                             // cut planes along L, a, b
  pts: [],                                       // filled from PRESETS below
  obs: [],
  planes: [],                                    // {n, d} in SPACE coords; n·c > d is excluded
  lo: [0, 0], hi: [100, 40],                     // lightness and chroma bounds, in CHART units
  hue: [0, 360],                                 // allowed hue arc, degrees, counterclockwise lo→hi
  sel: null,                                     // {kind:'pt'|'obs'|'plane', i}
};
export let view = NORMAL;
export const setObserver = (v) => { view = v; };

export const hueOf = (p) => ((Math.atan2(p[2], p[1]) * 180) / Math.PI + 360) % 360;
export const angGap = (x, y) => { const t = Math.abs(x - y) % 360; return Math.min(t, 360 - t); };

/** Hue is a circle, so the allowed arc runs lo→hi counterclockwise and may wrap
 *  through 0°. Magma's corridor does exactly that, so a non-wrapping range
 *  would not have been able to express it. */
export const inHueArc = (h) => {
  const [lo, hi] = S.hue;
  if (hi - lo >= 360 || (lo === 0 && hi === 360)) return true;
  return lo <= hi ? h >= lo && h <= hi : h >= lo || h <= hi;
};
/** degrees off the arc; zero for near-neutrals, whose hue is not a real angle */
export const hueGap = (p) => {
  const c = Math.hypot(p[1], p[2]);
  if (c < 1) return 0;
  const h = hueOf(p);
  return inHueArc(h) ? 0 : Math.min(angGap(h, S.hue[0]), angGap(h, S.hue[1]));
};

/** on-screen appearance: gamut-map, then push through the color-vision view */

export const PER_SPAN = 24;                             // spline samples per control interval

/** The metric of the space on screen, calibrated on the neutral axis. */
export const M = () => spaceMetric();

// Interpolated in the space you are looking at, so a curve that reads straight
// in the sRGB panel IS straight there. Control points still live in the chart.
/** every run's trajectory, in order */
export const curves = () => runs().map((r) => curveOf(r.nodes.map((i) => S.pts[i]), r.closed));
/** all of them end to end, for callers that want the colors and not the order */
export const curve = () => curves().flat();
/** One swatch per control point: the count is a consequence of the trajectory,
 *  not a separate dial that could disagree with it. */
export const palette = () => (S.mode === 'discrete' || S.pts.length < 2 ? S.pts : ctxOf(S.pts).pal);

export const rnd = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/**
 * The palette is a set of runs, not one chain.
 *
 * Every node has degree at most two, so any legal state is a disjoint union of
 * paths and cycles, and any such graph can be renumbered into consecutive runs.
 * That is what lets the topology live in two small arrays beside the points
 * rather than in an adjacency list: `cut` marks where the order breaks, `loop`
 * marks which runs close. Linking two arbitrary nodes reorders the points so
 * they become neighbours, so the graph work happens once, at edit time, and
 * every reader downstream keeps its simple ordered view.
 */
export function runs() {
  const out = [];
  let run = [];
  for (let i = 0; i < S.pts.length; i++) {
    run.push(i);
    if (S.cut[i] || i === S.pts.length - 1) { out.push(run); run = []; }
  }
  return out.map((nodes, c) => ({ nodes, closed: !!S.loop[c] && nodes.length >= 3 }));
}

/** write runs back, renumbering the points and everything parallel to them */
export function setRuns(rs) {
  const order = rs.flatMap((r) => r.nodes);
  const at = new Map(order.map((from, to) => [from, to]));
  S.pts = order.map((i) => S.pts[i]);
  S.pin = order.map((i) => !!S.pin[i]);
  S.marks = S.marks.map((i) => at.get(i)).filter((i) => i !== undefined);
  if (S.sel?.kind === 'pt') S.sel = at.has(S.sel.i) ? { kind: 'pt', i: at.get(S.sel.i) } : null;
  S.cut = new Array(S.pts.length).fill(false);
  let k = 0;
  for (const r of rs) { k += r.nodes.length; if (k < S.pts.length) S.cut[k - 1] = true; }
  S.loop = rs.map((r) => r.closed);
}

/**
 * Are the two marked nodes already neighbours, and which way round?
 * A pair is joined either by sitting next to each other in a run, or by being
 * that run's two ends when it is closed.
 */

/** which run a node belongs to, and where in it */
export function whereIs(i) {
  const rs = runs();
  for (let c = 0; c < rs.length; c++) { const k = rs[c].nodes.indexOf(i); if (k >= 0) return { c, k, run: rs[c] }; }
  return null;
}

/** a node is free to take another edge unless it already has two */
export function degree(i) {
  const w = whereIs(i);
  if (!w) return 0;
  const n = w.run.nodes.length;
  if (w.run.closed) return 2;
  return (w.k > 0 ? 1 : 0) + (w.k < n - 1 ? 1 : 0);
}

/**
 * A run's trajectory. `prev` and `ranges` are the same reuse ctxOf does for the
 * segment lengths: a Catmull-Rom span reads four control points, so moving one
 * bends only the four spans around it and every sample outside them converts to
 * exactly the value it had. The spline itself is polynomial arithmetic and runs
 * whole either way; what this skips is fromSpace on each sample, which is a
 * full color conversion.
 *
 * The reused samples are shared with `prev`, not copied. Nothing downstream
 * writes to a curve point — resample lerps into new arrays and the terms only
 * read — so this stays sound as long as that holds.
 */
export const curveOf = (pts, closed = false, prev, ranges) => {
  if (pts.length < 2) return pts.slice();
  const s = spline(pts.map((p) => toSpace(p)), PER_SPAN, closed);
  if (!prev || prev.length !== s.length) return s.map((c) => fromSpace(c));
  const out = prev.slice();
  for (const [lo, hi] of ranges)
    for (let i = lo; i < Math.min(hi, s.length); i++) out[i] = fromSpace(s[i]);
  return out;
};

/**
 * Segment lengths along one run's curve, reusing a base curve's wherever the
 * probe cannot have moved them.
 *
 * A control point only bends the four spans around it, so within one gradient
 * every probe shares the rest of the curve with the palette it was perturbed
 * from — 58% of the segments at nine control points, 92% at forty-nine. Each
 * one is a metric evaluation, and those were 60% of the solver.
 *
 * The window is the arc term's, for the same reason: a segment moved if either
 * of its ends did, so it opens one earlier than the sample window.
 */
function segLengths(c, g, prev, ranges) {
  const n = c.length - 1;
  if (!prev || prev.length !== n) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = segLength(c[i], c[i + 1], g);
    return out;
  }
  const out = prev.slice();
  for (const [lo, hi] of ranges)
    for (let i = Math.max(0, lo - 1); i < Math.min(hi, n); i++) out[i] = segLength(c[i], c[i + 1], g);
  return out;
}

/**
 * Everything a term needs, built once per candidate point set. The spline is by
 * far the most expensive part of an objective evaluation and every term used to
 * rebuild it independently — which cost little with one term and a great deal
 * once a combined step evaluates nine of them at each of 6n perturbations.
 *
 * `reuse` is the context every probe in a gradient is a perturbation of, with
 * the window saying which of its samples and lengths are still good. Runs other
 * than the perturbed one keep all of theirs: the runs partition the points, so
 * a point in one cannot bend another.
 */
export function ctxOf(pts, reuse) {
  const continuous = S.mode === 'continuous' && pts.length >= 2;
  if (!continuous) return { pts, curves: [], pal: pts, probe: pts, seg: [] };
  const g = M();
  // one spline per run, and one swatch per control point within it, so the
  // palette still has exactly as many entries as there are points
  const rs = runs();
  // the probe window is into its own run's curve; the runs partition the
  // points, so every other run is untouched and keeps all of its samples
  const win = (k) => (k === reuse?.rng.run ? reuse.rng.ranges : []);
  const curves = rs.map((r, k) =>
    curveOf(r.nodes.map((i) => pts[i]), r.closed, reuse?.from.curves[k], win(k)));
  const seg = curves.map((c, k) => (c.length >= 2 ? segLengths(c, g, reuse?.from.seg[k], win(k)) : []));
  const pal = curves.flatMap((c, k) => (c.length >= 2 ? resample(c, rs[k].nodes.length, g, seg[k]) : c));
  return { pts, curves, pal, probe: curves.flat(), seg };
}
/** perceived chord — the cheap version of `delta` for use inside a gradient */
export const pd = (a, b, g) => perceive(segLength(a, b, g));

/**
 * The observers the discrimination terms answer to. Choosing a deficiency in
 * the Vision panel narrows them to that observer at that severity; choosing
 * none means all three, so the default stays the conservative reading rather
 * than quietly optimizing for normal vision alone.
 *
 * Only the terms about telling two colors APART take a view. Arc length,
 * bounds, monotonicity, gamut and planes are about where a color sits, not how
 * well it is distinguished, and stay in the chart where they were defined.
 */
export const primary = () => (S.cvd === 'none' ? NORMAL : view);
export const criteria = () => (S.cvd === 'none' ? ALL_VIEWS : [NORMAL, view]);
export const observer = () => (S.cvd === 'none' ? 'normal' : `${S.cvd} ${S.sev.toFixed(1)}`);

/**
 * Repulsion, not min-separation: a min over pairs is not differentiable, and a
 * gradient can only ever see the single closest pair. Summed inverse distance
 * feels every pair at once, and because it is measured with the PERCEIVED
 * distance, diminishing returns do the right thing on their own — far pairs
 * saturate and contribute almost nothing, so the step spends itself separating
 * the colors that are actually confusable.
 */
export function repulsion(P, views) {
  const g = M();
  let e = 0;
  for (const v of views)
    for (let i = 0; i < P.length; i++)
      for (let j = i + 1; j < P.length; j++) e += 1 / Math.max(0.5, pd(v(P[i]), v(P[j]), g));
  return e;                                        // the floor keeps coincident colors finite
}

export const WARN_EPS = 0.005;    // below this a `bad` term reads 0.00, so do not flag it
/**
 * Knots in the editable profile: one per swatch.
 *
 * It used to be a fixed nine, and a floor of nine was worse than either the
 * fixed count or none at all. The objective reads the profile only at the n
 * positions the swatches sit at, so any knot beyond those is decorative, and
 * whenever the count did not match the palette the fit and the read
 * interpolated the same break differently — oleron, at eight points against
 * nine knots, fitted its own ramp and then scored 114 against it. One knot per
 * swatch makes knot k the target for swatch k, which makes `fit` a copy and
 * every count exact.
 */
export let LK = 9;

/**
 * Resize the profiles when the palette does, keeping the shape they had.
 * Called from sync(), so nothing that adds or removes a point has to remember.
 */
export function syncProfiles() {
  const want = Math.max(2, S.pts.length);
  if (want === LK && S.lprof.length === LK && S.hprof.length === LK) return;
  const at = (a, k, hue) => {
    if (a.length < 2) return a[0] ?? (hue ? 0 : 50);
    const x = (k / (want - 1)) * (a.length - 1), i = Math.min(a.length - 2, Math.floor(x)), f = x - i;
    return hue ? norm360(a[i] + angDiff(a[i + 1], a[i]) * f) : a[i] * (1 - f) + a[i + 1] * f;
  };
  const [l, h] = [S.lprof, S.hprof];
  LK = want;
  S.lprof = Array.from({ length: LK }, (_, k) => at(l, k, false));
  S.hprof = Array.from({ length: LK }, (_, k) => at(h, k, true));
}

/**
 * Hue is a circle, so the profile keeps its knots in [0, 360) and puts the wrap
 * in the RULES rather than in the values.
 *
 * Storing unwrapped angles was the wrong call: an unwrapped run has an
 * arbitrary multiple of 360 in it that nothing pins down, so re-deriving it
 * each frame let it flip between turns as the palette moved, and the axis
 * flip-flopped with it. Normalized knots have exactly one representation.
 *
 * The wrap then lives in three rules. Between adjacent knots, interpolate the
 * SHORT way. Compare by shortest signed difference, so 359° and 1° are two
 * degrees apart. And when a segment crosses the seam, draw it leaving one edge
 * and re-entering the other. Nothing anywhere holds a number outside [0, 360).
 *
 * The cost is that no single knot interval may turn more than 180°. With nine
 * knots that still allows a 1440° sweep end to end, against the ~290° of the
 * widest real colormap, so it costs nothing that exists.
 */
export const norm360 = (h) => ((h % 360) + 360) % 360;
export const angDiff = (a, b) => { let d = (a - b) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };
/** total signed turn of a hue run, from steps that are each unambiguous */
export const totalTurn = (hs) => hs.slice(1).reduce((t, h, i) => t + angDiff(h, hs[i]), 0);
/** target hue at t, taking the short way between adjacent knots */
/**
 * Where the runs break, in knot units.
 *
 * The profile is read at t = i/(n-1) over the palette index, and the jump lies
 * between two swatches, so a break after swatch i sits at the midpoint of that
 * pair rather than on either of them. When
 * LK is larger than n a knot interval can straddle one of these, and a target
 * interpolated across a jump is a value the palette never takes. Both the fit
 * and the read snap to the near side instead.
 */
export function knotBreaks() {
  const n = S.mode === 'continuous' ? S.pts.length : 0;
  if (n < 2) return [];
  const out = [];
  for (let i = 0; i < n - 1; i++) if (S.cut[i]) out.push((((i + 0.5) / (n - 1)) * (LK - 1)));
  return out;
}
/** the knot pair around x, or a single knot when a break falls between them */
export function knotSpan(x) {
  const i = Math.min(LK - 2, Math.floor(x)), f = x - i;
  for (const b of knotBreaks()) if (b > i + 1e-9 && b < i + 1 - 1e-9) return { i: f < (b - i) ? i : i + 1, f: 0 };
  return { i, f };
}

export const hprofAt = (t) => {
  const { i, f } = knotSpan(Math.min(1, Math.max(0, t)) * (LK - 1));
  if (!f) return norm360(S.hprof[i]);
  return norm360(S.hprof[i] + angDiff(S.hprof[i + 1], S.hprof[i]) * f);
};

/** target lightness at position t along the ramp, piecewise linear between knots */
export const lprofAt = (t) => {
  const { i, f } = knotSpan(Math.min(1, Math.max(0, t)) * (LK - 1));
  return f ? S.lprof[i] * (1 - f) + S.lprof[i + 1] * f : S.lprof[i];
};
/**
 * The lightness the waypoints actually span — the extremes over ALL of them,
 * not just the two ends. A ramp whose middle overshoots its endpoints would
 * otherwise get a target that cannot reach where it already goes, and the
 * profile term would spend itself pulling the overshoot back in.
 */

export const hinge = (v) => (v > 0 ? v : 0);
/** gated on the mode too, so a hidden checkbox cannot quietly hold points still */
export const pinnedAt = (i) => !!S.pin[i];
/**
 * Pins are parallel to the points, so the two mutate together in addPoint and
 * removeAt. A length mismatch means something replaced the points wholesale (a
 * preset, a scene without pins), and pins that no longer refer to anything are
 * worse than none — so they go with them.
 */
export const syncPins = () => { if (S.pin.length !== S.pts.length) S.pin = S.pts.map(() => false); };
/**
 * Put the topology back in range. Cheaper to repair once per sync than to get
 * every splice right in every editing path, and it is what keeps a loaded
 * scene, a deleted node and an undone drag from disagreeing about the shape.
 */
export function syncRuns() {
  S.cut.length = S.pts.length;
  for (let i = 0; i < S.cut.length; i++) S.cut[i] = !!S.cut[i];
  if (S.pts.length) S.cut[S.pts.length - 1] = false;   // nothing follows the last point
  S.loop = runs().map((r, c) => !!S.loop[c] && r.nodes.length >= 3);
  S.marks = [...new Set(S.marks)].filter((i) => i >= 0 && i < S.pts.length);
}
/** WCAG 2 relative luminance and contrast ratio, on the sRGB the viewer gets */
export const wcagY = (p) => {
  const [r, g, b] = toLinear(toGamut(p, 'srgb'), 'srgb').map(clamp01);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrastRatio = (a, b) => {
  const [hi, lo] = [wcagY(a), wcagY(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * APCA Lc, the perceptual contrast measure meant to replace the WCAG 2 ratio.
 *
 * Constants are SA98G / G-4g from apca-w3 0.1.9, the beta the W3C silver task
 * force works from. Copied from the package source rather than recalled.
 *
 * Two ways this is not the ratio above, both deliberate:
 *
 *   Lc is not symmetric. Dark on light and light on dark are different
 *   exponents, so swapping the two colors changes the answer -- which is the
 *   point, since the eye does too. The sign says which case you are in:
 *   positive is dark text on a light ground, negative is the reverse.
 *
 *   It linearizes with a plain 2.4 power, NOT the piecewise sRGB curve wcagY
 *   uses. APCA chose that deliberately, to model what a display emits rather
 *   than what the encoding says, so it needs its own luminance. Reusing
 *   wcagY here would be wrong by a few percent.
 *
 * For scale, from the package's own notes: Lc 60 is "sort of like" WCAG 2's
 * 4.5:1, below Lc 30 is non-text only, and below Lc 15 is unusable.
 *
 * Reported, not enforced. The floor the solver descends on is still the
 * ratio, which is what the standards require today.
 */
export const apcaY = (p) => {
  const [r, g, b] = toGamut(p, 'srgb').map(clamp01);
  const e = (c) => c ** 2.4;
  return 0.2126729 * e(r) + 0.7151522 * e(g) + 0.0721750 * e(b);
};
export const apcaLc = (text, bg) => {
  const clamp = (y) => (y > 0.022 ? y : y + (0.022 - y) ** 1.414);
  const [t, b] = [apcaY(text), apcaY(bg)].map(clamp);
  if (Math.abs(b - t) < 0.0005) return 0;
  const [sapc, off] = b > t
    ? [(b ** 0.56 - t ** 0.57) * 1.14, -0.027]           // dark on light
    : [(b ** 0.65 - t ** 0.62) * 1.14, 0.027];           // light on dark
  return Math.abs(sapc) < 0.1 ? 0 : (sapc + off) * 100;  // low clip
};

/**
 * The floor the lightness-spread term aims at: the lightness range the palette
 * is allowed, over the gaps its swatches have to fill. Even steps, in other
 * words, which is what reads as separable in grayscale.
 *
 * Two cleverer versions did worse. Measuring each swatch's reach at its own
 * chroma and taking the union is too generous — one near-neutral swatch
 * reaching the whole scale makes it look like they all can, and tab10 has a
 * grey. Holding chroma fixed and asking whether n points can be scheduled d
 * apart in their bands is too mean, because the optimizer is free to give up
 * chroma to move in lightness, which is exactly what it does. The range is the
 * bounds, and tightening them is how you ask for less.
 */
export let LSEP = 0;
export function autoLsep() {
  const P = palette();
  if (S.mode !== 'discrete' || P.length < 2) return 0;
  return Math.max(0, S.hi[0] - S.lo[0]) / (P.length - 1);
}

/**
 * Halfplanes are placed in the ACTIVE SPACE's coordinates — an axis-aligned cut
 * in CIELAB is a different constraint from the same cut in sRGB, which is free
 * generality from the space selector. The bounds below are the opposite choice:
 * they are read off the CHART, because "lightness" and "chroma" should mean the
 * perceptual ones no matter which coordinates you happen to be looking at.
 */
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const planePenalty = (p) => {
  if (!S.planes.length) return 0;
  const c = toSpace(p);
  return S.planes.reduce((a, pl) => a + hinge(dot3(pl.n, c) - pl.d) ** 2, 0);
};


export const OBJ = [
  { key: 'rep', label: () => `repulsion · ${observer()}`, f: (x) => repulsion(x.pal, [primary()]) },
  { key: 'repcvd', label: () => `repulsion · ${S.cvd === 'none' ? 'all' : '+' + S.cvd}`,
    f: (x) => repulsion(x.pal, criteria()) },
  /**
   * Both of these are sums of numbers ctxOf is already holding.
   *
   * It had to measure every segment to place the swatches by arc length, and
   * this term is that same measurement — so asking for it again was a second
   * metric evaluation per segment, and in a space that differentiates by
   * central differences that is six color conversions each. It was a quarter
   * of the solver at nine control points. Now it costs no metric evaluations.
   *
   * The window is the one ctxOf reuses by: a segment counts if either of its
   * ends moved, so it opens one earlier than the sample window.
   */
  { key: 'arc', label: 'arc length', mode: 'continuous',
    f: (x) => x.seg.reduce((a, s) => a + s.reduce((b, v) => b + v, 0), 0),
    part: (x, w) => {
      const s = x.seg[w.run];
      let a = 0;
      for (const [lo, hi] of w.ranges)
        for (let i = Math.max(0, lo - 1); i < Math.min(hi, s.length); i++) a += s[i];
      return a;
    } },
  /**
   * Perceptual uniformity: equal perceived steps between consecutive swatches.
   * Measured with the CHART metric, deliberately, not the active space's — the
   * question is whether the ramp is perceptually even, not whether it is even
   * in whatever coordinates you happen to be viewing. So this reads non-zero
   * exactly when resampling in a non-perceptual space has bunched the steps,
   * and when curvature makes chords shorter than the arcs they subtend.
   */
  /**
   * Distance from the lightness profile drawn in the plot. Lightness against
   * position is the one curve these colormaps are really designed around —
   * turbo's is a deliberate arc rather than a line — so it is the one curve
   * worth being able to draw by hand and hand to the solver.
   *
   * This subsumes a separate monotonicity term: draw a profile that only rises
   * and matching it enforces monotonicity, and it does so with a target for
   * every position rather than merely a sign constraint on each step. A ramp
   * can be monotone and still stall and lurch; it cannot do that and track a
   * drawn line. Which is why there is no `lightness monotone` any more.
   */
  { key: 'lramp', label: 'lightness profile', bad: true, mode: 'continuous',
    f: (x) => {
      const P = x.pal, n = P.length;
      if (n < 2) return 0;
      return P.reduce((e, p, i) => e + (p[0] - lprofAt(i / (n - 1))) ** 2, 0) / n;
    } },
  /**
   * Chroma aims at the middle of the band rather than climbing as high as the
   * gamut allows. Maximizing was measurably the wrong prior: viridis's chroma
   * DIPS through the middle of the ramp (14→8→19) while a maximizer pushes it
   * up (14→22→19). A target plus the gamut penalty reproduces a dip or an arc
   * on its own, because the reachable chroma varies with lightness and hue —
   * the profile falls out of the constraint rather than being asked for.
   */
  { key: 'chroma', label: 'chroma target',
    f: (x) => {
      const t = (S.lo[1] + S.hi[1]) / 2;
      return x.pal.reduce((e, p) => e + (Math.hypot(p[1], p[2]) - t) ** 2, 0) / x.pal.length;
    } },
  /**
   * Distance from the hue profile drawn in the plot, chroma-weighted so it is a
   * distance in the chart rather than an angle — being 40° off matters at chroma
   * 20 and not at chroma 2, where hue is not a real quantity. Compared by
   * shortest signed difference, so the seam at 0° costs nothing.
   */
  { key: 'hprof', label: 'hue profile', bad: true, mode: 'continuous',
    f: (x) => {
      const P = x.pal, n = P.length;
      if (n < 2 || !S.hprof.length) return 0;
      let e = 0;
      for (let i = 0; i < n; i++) {
        const c = Math.hypot(P[i][1], P[i][2]);
        if (c < 1) continue;                          // no meaningful hue to chase
        e += ((c * angDiff(hueOf(P[i]), hprofAt(i / (n - 1))) * Math.PI) / 180) ** 2;
      }
      return e / n;
    } },
  /**
   * Keeps consecutive control points evenly spaced, and repels them apart when
   * they bunch. Σ(d̄/dᵢ) − n, not the variance of the segment lengths: variance
   * is minimized by every segment being equal AND ZERO, so it would happily
   * collapse the whole trajectory onto a point. The ratio form is minimized at
   * even spacing by AM–HM, blows up as any single segment closes, and is scale
   * invariant — so it fights bunching without also fighting `arc length` over
   * how long the ramp should be. Zero exactly when the waypoints are even.
   *
   * ponytail: scale invariance cuts both ways. It cannot see a UNIFORM collapse
   * — every segment shrinking together leaves the ratios at 1 and the term at
   * zero — so the overall scale has to be held by something else: pinned
   * endpoints, or simply not descending arc length. It stops relative bunching,
   * which is the failure this term exists for, and nothing more.
   */
  { key: 'space', label: 'control point spacing', mode: 'continuous',
    f: (x) => {
      const g = M(), d = [];
      // per run: the gap across a break is not a gap, and a closed run has one
      // more of them than it has points, the one that wraps
      for (const r of runs()) {
        const P = r.nodes.map((i) => x.pts[i]), m = P.length;
        if (m < 3) continue;
        for (let i = 0; i + 1 < m; i++) d.push(Math.max(0.05, segLength(P[i], P[i + 1], g)));
        if (r.closed) d.push(Math.max(0.05, segLength(P[m - 1], P[0], g)));
      }
      if (d.length < 2) return 0;
      const mean = d.reduce((a2, b) => a2 + b, 0) / d.length;
      return d.reduce((a2, b) => a2 + mean / b, 0) - d.length;
    } },
  /**
   * The curve, not the nodes. Projection makes a NODE feasible exactly, but the
   * spline between two feasible nodes can still bulge out of the gamut, cut a
   * keep-out ball or cross a halfplane — the feasible set is not convex, so
   * feasible endpoints guarantee nothing in between. This is waypoint checking
   * versus checking along the path, and the answer is the same one motion
   * planning reaches for: an augmented Lagrangian.
   *
   * λ·c + ½|c|², with a multiplier per curve sample. The multipliers are what
   * separate this from a plain penalty: they absorb the violation that persists
   * at a given weight, so the curve can be driven feasible at a FINITE weight
   * instead of needing one large enough to flatten every other term with it.
   * AL.rho is the penalty parameter and is applied in gradientOf, because the
   * per-term gradient normalization there would otherwise divide it straight
   * back out.
   */
  { key: 'feas', label: 'curve feasibility', mode: 'continuous', bad: true,
    f: (x) => violations(x.probe).reduce((a, c, i) => a + (AL.lam[i] ?? 0) * c + 0.5 * c * c, 0),
    // The same sum over part of the probe. A central difference on one control
    // point cancels every sample the point did not move, so the gradient only
    // ever needed the spans around it — see probeRanges.
    part: (x, w) => {
      const g = M(), v = primary();
      let a = 0;
      for (const [lo, hi] of w.ranges)
        for (let j = lo; j < hi; j++) {
          const i = w.off + j;                     // AL.lam is indexed on the whole probe
          const c = violation(x.probe[i], g, v);
          a += (AL.lam[i] ?? 0) * c + 0.5 * c * c;
        }
      return a;
    } },
  /**
   * Uniformity over every PAIR, corrected for diminishing returns.
   *
   * The neighbor form below assumes the space is additive: equal steps compose
   * into a difference proportional to how far apart two swatches are. Bujack et
   * al. (PNAS 2022) is the result that it does not — perceived difference grows
   * sublinearly, so what a uniform ramp should deliver between samples i and j
   * is perceive(arc · |i−j|/(n−1)), not something proportional to |i−j|. This
   * measures the residual from that, which is what "perceptually uniform" means
   * once additivity is off the table. Chart metric, because perceive() is
   * calibrated there.
   */
  { key: 'pair', label: 'pairwise uniformity', mode: 'continuous', bad: true,
    f: (x) => {
      const v = primary();
      let e = 0, k = 0, at = 0;
      // Within a run only. Across a break there is no traversal, so the target
      // this term measures a residual against does not exist there.
      const rs = runs();
      x.curves.forEach((c, ci) => {
        const m = rs[ci].nodes.length, closed = rs[ci].closed, P = x.pal.slice(at, at + m);
        at += m;
        if (m < 3) return;
        const total = arcLength(c, EUCLIDEAN);
        // On a closed run the walk between two swatches goes the short way
        // round, over m steps rather than m-1: an index difference is the
        // distance along an open ramp and there is no such thing on a loop.
        const steps = closed ? m : m - 1;
        for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
          const apart = closed ? Math.min(j - i, m - (j - i)) : j - i;
          e += (pd(v(P[i]), v(P[j]), EUCLIDEAN) - perceive((total * apart) / steps)) ** 2;
          k++;
        }
      });
      return k ? e / k : 0;
    } },
  /**
   * Bending, measured on the curve rather than on the points that generate it.
   *
   * The elastic energy of a wire, the integral of squared curvature along the
   * ramp. Discretely, the turn at a sample divided by the arc length that
   * sample owns: theta^2 / l summed over the curve is a Riemann sum for
   * integral k^2 ds, and it converges -- on a circle of radius R at any sample
   * count it gives exactly 2*pi/R, which is what the integral is.
   *
   * Squared, not absolute, and that is the whole reason to prefer it. Total
   * turning alone cannot tell a kink from a sweep: a ramp that turns 180
   * degrees at one point and a smooth half-circle both total 180. Squaring
   * weights the turn by how little length it happens over, so a tight bend
   * costs far more than the same rotation spread out -- which is the ColorMaker
   * two-scale intent (Salvi et al., CHI 2024) falling out of one term instead
   * of two passes at different decimations.
   *
   * Reported as L * integral k^2 ds over 4*pi^2, which is dimensionless and
   * scale invariant: a circle reads 1 at any radius, a straight ramp 0. The
   * number then depends on the shape alone, and unlike the control-polygon
   * version it does not move when you add a point.
   */
  { key: 'bend', label: 'bending', mode: 'continuous', bad: true,
    f: (x) => {
      let tot = 0, k = 0;
      x.curves.forEach((C, ci) => {
        // spline() ends a closed curve back on its start; drop the repeat so
        // the seam is one vertex and not two
        const closed = runs()[ci].closed;
        const P = closed && C.length > 1 ? C.slice(0, -1) : C;
        const m = P.length;
        if (m < 3) return;
        const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        let E = 0, L = 0;
        for (let i = closed ? 0 : 1; i < (closed ? m : m - 1); i++) {
          const u = sub3(P[i], P[(i - 1 + m) % m]), v = sub3(P[(i + 1) % m], P[i]);
          const nu = Math.hypot(...u), nv = Math.hypot(...v);
          if (nu < 1e-12 || nv < 1e-12) continue;
          // atan2 of |u x v| against u.v — accurate for the small angles that
          // dominate a finely sampled curve, where acos loses most of its digits
          const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
          const th = Math.atan2(Math.hypot(...cr), u[0] * v[0] + u[1] * v[1] + u[2] * v[2]);
          E += (th * th) / ((nu + nv) / 2);       // k^2 times the length this sample owns
        }
        for (let i = 0; i + 1 < (closed ? m + 1 : m); i++) L += Math.hypot(...sub3(P[(i + 1) % m], P[i]));
        tot += (L * E) / (4 * Math.PI ** 2);
        k++;
      });
      return k ? tot / k : 0;
    } },
  /**
   * What makes a diverging map diverging: the two arms are mirror images in
   * LIGHTNESS about the middle. Not in hue or chroma — the arms being different
   * hues is the entire point, and a term that pulled them together would undo
   * the map. Symmetric lightness is what lets a reader see equal magnitudes on
   * either side of the center as equal.
   *
   * Open runs only. A loop has no middle to be symmetric about.
   */
  { key: 'sym', label: 'diverging symmetry', mode: 'continuous', bad: true,
    f: (x) => {
      let e = 0, k = 0, at = 0;
      for (const r of runs()) {
        const m = r.nodes.length, P = x.pal.slice(at, at + m);
        at += m;
        if (r.closed || m < 3) continue;
        for (let i = 0; i < m >> 1; i++) { e += (P[i][0] - P[m - 1 - i][0]) ** 2; k++; }
      }
      return k ? e / k : 0;
    } },
  /**
   * Contrast against a chosen ground, as a hinge rather than something to
   * maximize. Maximizing it would drive every swatch to one lightness — the
   * ratio is a function of luminance alone — which is the opposite of what a
   * categorical palette needs. A floor asks only that nothing is unreadable and
   * leaves the rest of the palette alone once it is met.
   */
  /**
   * A floor on the worst swatch against the ground the palette will sit on.
   *
   * Discrete only. A ramp is read as a surface, and every level of it has to be
   * there — including the dark end, which is exactly what a contrast floor
   * removes. Holding one over a continuous map either compresses the range that
   * carries the data or does nothing, and neither is what a colormap is for.
   * Swatches are read as marks against a page, and there the floor is the
   * question.
   */
  { key: 'contr', label: 'contrast floor', bad: true, mode: 'discrete',
    f: (x) => { const bg = fromHex(S.cbg);
      return x.probe.reduce((a, p) => a + hinge(S.cmin - contrastRatio(p, bg)) ** 2, 0); } },
  /**
   * Lightness spread, for a categorical set.
   *
   * `min Δ` is satisfied by swatches that differ in hue alone, and those become
   * one color the moment the figure is printed, photocopied, or read by anyone
   * whose vision collapses that hue axis. This asks that every PAIR differ in
   * lightness by at least a floor, which is what survives all three.
   *
   * A floor and not a spread: n swatches can only be span/(n-1) apart at best,
   * so a term that always pushed for more would fight chroma and the palette's
   * own repulsion forever. Once every pair clears the floor it stops.
   *
   * The floor is derived, not typed, because a typed one can be impossible:
   * eight Set2 swatches at their chroma span 51 lightness, so a floor of 8
   * asks for 56 and the term pushes forever against a wall. LSEP measures what
   * the palette can actually reach and divides by the gaps it has to fill.
   */
  { key: 'lsep', label: 'lightness spread', mode: 'discrete', bad: true,
    f: (x) => {
      const P = x.pal;
      let e = 0;
      for (let i = 0; i < P.length; i++)
        for (let j = i + 1; j < P.length; j++) e += hinge(LSEP - Math.abs(P[i][0] - P[j][0])) ** 2;
      return e;
    } },

];

/** Terms included in the combined step. Constraints on, shaping opt-in. */
// Shaping terms that fight the rest of the palette unless you ask for them.
export const OPT_IN = ['repcvd', 'contr', 'lsep', 'sym', 'bend'];
S.on = Object.fromEntries(OBJ.map((o) => [o.key, !OPT_IN.includes(o.key)]));
/**
 * Relative pull of each term in the combined step.
 *
 * The two drawn profiles carry more than the rest. They are targets someone set
 * deliberately, where the others are standing preferences that are always on,
 * so parity with eight of those understates what asking for a profile means.
 *
 * Arc length and bending pull the other way: both of them are satisfied by a
 * shorter, straighter path, which is a path that has given up chroma and hue
 * range to get there. At parity they flatten what the rest of the terms are
 * trying to shape, so they come in at half and a quarter.
 */
export const W_DEFAULT = { lramp: 1.5, hprof: 1.5, arc: 0.5, bend: 0.25 };
S.w = Object.fromEntries(OBJ.map((o) => [o.key, W_DEFAULT[o.key] ?? 1]));

/**
 * Central differences over the 3n control coordinates, for several terms at
 * once. Each perturbation builds ONE context and every term reads it, so a
 * combined step costs barely more than a single-term one.
 *
 * Each term's gradient is normalized to unit max and then scaled by its weight
 * before the terms are summed. The normalization is deliberate and this is not
 * the gradient of Σ wᵢfᵢ: these objectives span four orders of magnitude, so an
 * honest sum is simply the plane-cost gradient with rounding noise attached.
 * Normalizing first puts every term on the same footing; the weight then says
 * how hard each one pulls, in units anyone can reason about — weight 2 against
 * weight 1 is twice the pull, whatever the term happens to measure in.
 *
 * A pinned endpoint is a variable removed from the problem, not a move undone
 * afterwards: its gradient is never formed, so it cannot skew the normalization
 * that sets the step size for everything else.
 */
/**
 * Which probe samples a control point can move, as [lo, hi) ranges.
 *
 * A Catmull-Rom span is a function of four consecutive control points, so
 * moving point k changes spans k-2 through k+1 and nothing else. Everything
 * outside that is identical in the two perturbed configurations of a central
 * difference and cancels exactly, so a term summed over the probe only has to
 * look at this window. It is exact, not an approximation.
 *
 * The window covers the phantom endpoints too: an open spline reflects its ends
 * from the first and last two controls, and those reflections live in the spans
 * this range already includes.
 *
 * Returns null when the point cannot be located, which makes the caller fall
 * back to the whole probe rather than silently drop a term.
 */
export function probeRanges(i) {
  let off = 0;
  for (const [ri, r] of runs().entries()) {
    const m = r.nodes.length;
    const len = m < 2 ? m : (r.closed ? m : m - 1) * PER_SPAN + 1;
    const k = r.nodes.indexOf(i);
    if (k < 0) { off += len; continue; }
    if (m < 2) return { run: ri, off, len, ranges: [[0, len]] };
    const spans = r.closed ? m : m - 1;
    const hit = new Array(spans).fill(false);
    for (let d = -2; d <= 1; d++) {
      let j = k + d;
      if (r.closed) j = ((j % spans) + spans) % spans;
      else if (j < 0 || j >= spans) continue;
      hit[j] = true;
    }
    const ranges = [];
    for (let j = 0, a = -1; j <= spans; j++) {
      if (j < spans && hit[j]) { if (a < 0) a = j; }
      else if (a >= 0) { ranges.push([a * PER_SPAN, j * PER_SPAN + 1]); a = -1; }
    }
    return { run: ri, off, len, ranges };
  }
  return null;
}

export function gradientOf(terms) {
  const base = S.pts.map((p) => [...p]);
  const h = 0.25;
  // gated on the mode too, so a hidden checkbox cannot quietly hold points still
  const pinned = pinnedAt;
  const per = terms.map(() => base.map(() => [0, 0, 0]));
  // the palette every probe is a perturbation of: its segment lengths are the
  // ones each probe gets to keep, so this pays for itself 6n times over
  const from = ctxOf(base);
  for (let i = 0; i < base.length; i++) {
    if (pinned(i)) continue;
    const rng = probeRanges(i);
    const reuse = rng && from.seg.length ? { from, rng } : null;
    for (let k = 0; k < 3; k++) {
      const lo = base.map((q) => [...q]), hi = base.map((q) => [...q]);
      lo[i][k] -= h; hi[i][k] += h;
      const [cl, ch] = [ctxOf(lo, reuse), ctxOf(hi, reuse)];
      terms.forEach((t, m) => {
        const ev = t.part && rng ? (x) => t.part(x, rng) : t.f;
        per[m][i][k] = (ev(ch) - ev(cl)) / (2 * h);
      });
    }
  }
  const total = base.map(() => [0, 0, 0]);
  per.forEach((g, m) => {
    const mx = Math.max(...g.flat().map(Math.abs));
    if (!Number.isFinite(mx) || mx === 0) return;            // flat term: no opinion
    const w = (S.w[terms[m].key] * (terms[m].key === 'feas' ? AL.rho : 1)) / mx;
    g.forEach((row, i) => row.forEach((v, k) => { total[i][k] += v * w; }));
  });
  return { base, total };
}

/** dir +1 descends, -1 ascends. */

/**
 * Adam over the control points. `gradientOf` already returns the weighted sum
 * of unit-normalized term gradients, so what Adam adds on top is per-coordinate
 * step sizing — which is precisely what the fixed-rate stepper lacked: a heavily
 * weighted term used to bulldoze the others, because every coordinate moved by
 * the same amount regardless of how confident the gradient was there.
 *
 * Moments are reset whenever the problem changes shape under them (a point
 * added or removed), since a stale moment for a coordinate that no longer means
 * the same thing is worse than no moment at all.
 */
export const ADAM = { b1: 0.9, b2: 0.999, eps: 1e-8, lr: 1.2 };
export let adam = null;
export const adamReset = () => {
  adam = { m: S.pts.map(() => [0, 0, 0]), v: S.pts.map(() => [0, 0, 0]), t: 0 };
  AL.lam = []; AL.rho = 1; AL.prev = Infinity;
};

/**
 * The augmented Lagrangian's OUTER iteration, run every AL_EVERY inner steps —
 * multipliers are meant to update after an approximate minimization, not after
 * every gradient step, or they chase the iterate instead of the constraint.
 *
 * rho only escalates when the multipliers alone are not closing the violation,
 * which is the whole point of carrying them: a plain penalty has nothing to
 * escalate BUT rho, and rho large enough to enforce a constraint is also large
 * enough to drown out everything the palette is otherwise trying to be.
 */
export const AL = { lam: [], rho: 1, prev: Infinity };
export const AL_EVERY = 25, AL_RHO_MAX = 4096, AL_LAM_MAX = 1e4;

export function alStep() {
  const c = violations(ctxOf(S.pts).probe);
  if (AL.lam.length !== c.length) AL.lam = c.map(() => 0);
  const worst = c.length ? Math.max(...c) : 0;
  AL.lam = AL.lam.map((l, i) => Math.min(AL_LAM_MAX, l + AL.rho * c[i]));
  if (worst > 1e-6 && worst > 0.75 * AL.prev) AL.rho = Math.min(AL_RHO_MAX, AL.rho * 2);
  AL.prev = worst;
  return worst;
}

export function adamStep() {
  const terms = activeTerms();
  if (!terms.length || !S.pts.length) return false;
  if (!adam || adam.m.length !== S.pts.length) adamReset();
  const { base, total } = gradientOf(terms);
  adam.t++;
  const lr = S.rate * ADAM.lr;
  let moved = 0;
  S.pts = base.map((p, i) => p.map((val, k) => {
    const g = total[i][k];
    adam.m[i][k] = ADAM.b1 * adam.m[i][k] + (1 - ADAM.b1) * g;
    adam.v[i][k] = ADAM.b2 * adam.v[i][k] + (1 - ADAM.b2) * g * g;
    const mh = adam.m[i][k] / (1 - ADAM.b1 ** adam.t);
    const vh = adam.v[i][k] / (1 - ADAM.b2 ** adam.t);
    const d = (lr * mh) / (Math.sqrt(vh) + ADAM.eps);
    moved = Math.max(moved, Math.abs(d));
    return val - d;
  }));
  return moved;
}

/**
 * Random restarts. Adam is a local method and this problem is not convex — the
 * gamut is concave in places, a keep-out ball's complement never is, and the
 * hue arc wraps — so where it lands is decided by where it started. On a stall
 * this jolts the free control points and runs again, keeping the best result
 * seen rather than the last one.
 *
 * "Best" needs a scalar and there is no obvious one: gradientOf descends a sum
 * of UNIT-normalized term gradients, and the normalizer moves with x, so no
 * fixed function is being minimized. The comparator here is each term over the
 * largest value that term has taken this run, weighted — bounded, comparable
 * across terms spanning four orders of magnitude, and zero for a term that has
 * never been anything but zero.
 */
export const RESTART = { n: 0, best: null, bestScore: 0, scale: {}, sd: 5, flat: 0, prev: Infinity,
                  // measured against an easy and a multi-modal instance: 4 restarts too
                  // eagerly and gives up budget, 12 barely fires. 8 x AL_EVERY = 200
                  // iterations of no improvement before it calls a run converged.
                  patience: 8, gain: 5e-4 };

/**
 * Score point sets against each other on a shared running scale. Comparing on
 * a scale that has grown since the incumbent was measured would let a worse
 * result win, so every candidate in a comparison is measured together.
 */
export function scores(sets) {
  const terms = activeTerms().filter((o) => o.key !== 'feas');   // handled lexicographically
  const vals = sets.map((p) => { const cx = ctxOf(p); return terms.map((o) => o.f(cx)); });
  terms.forEach((o, i) => {
    RESTART.scale[o.key] = Math.max(RESTART.scale[o.key] ?? 0, ...vals.map((v) => v[i]));
  });
  return vals.map((v) => terms.reduce((s, o, i) => {
    const k = RESTART.scale[o.key];
    return s + (k > 0 ? (S.w[o.key] * v[i]) / k : 0);
  }, 0));
}

/** worst violation anywhere on the curve a set of points generates */
export const worstViol = (pts) => {
  const cv = curveOf(pts);
  return cv.length ? Math.max(0, ...violations(cv)) : 0;
};

/**
 * Feasibility first, then the objective. Scoring the constraint as one more
 * weighted term let a restart win by trading it away: the run that "improved"
 * ended with the curve 0.07 outside the feasible set, which is not a better
 * palette, it is not a palette. Only when two candidates are equally feasible
 * does the rest of the objective decide.
 */
export function better(a, b) {
  const [va, vb] = [worstViol(a), worstViol(b)];
  if (Math.abs(va - vb) > 1e-4) return va < vb;
  const [sa, sb] = scores([a, b]);
  return sa < sb;
}

/**
 * The solver's only source of randomness, and the reason it has a seed.
 *
 * A restart jolts the free points and tries again, so a run with restarts on
 * was not reproducible: the same scene optimized twice gave two palettes, and a
 * shared link did not reproduce the one that made it. For a tool whose output
 * ends up in a figure that is a correctness problem rather than a nicety. The
 * stream is reset at the start of every run, so pressing run twice from the
 * same state gives the same answer, and the seed rides along in the scene.
 */
export let jitter = rnd(S.seed);
export const reseedJitter = () => { jitter = rnd(S.seed); };

/** chart units, so the jolt means the same thing whichever space is on screen */
export function jolt() {
  const n = S.pts.length;
  S.pts = S.pts.map((p, i) => (pinnedAt(i) ? p
    : p.map((v) => v + RESTART.sd * (jitter() * 2 - 1))));
}

/**
 * Convergence is the score going flat, NOT the step going small: Adam holds a
 * roughly constant step until the gradient actually vanishes, so a step-size
 * stall test never fires here. Runs on the AL cadence, so `patience` rounds is
 * patience x AL_EVERY iterations of no improvement.
 */
export function restartTick() {
  // The incumbent is recorded on EVERY check, not only when a restart fires.
  // Sampling it at restarts alone means a better state passed through in
  // between is never kept, and the run can end worse than plain Adam would.
  const here = S.pts.map((p) => [...p]);
  const [score] = scores([here]);
  if (!RESTART.best || better(here, RESTART.best)) RESTART.best = here;
  RESTART.bestScore = scores([RESTART.best])[0];
  if (score < RESTART.prev - RESTART.gain) { RESTART.prev = score; RESTART.flat = 0; return; }
  if (++RESTART.flat < RESTART.patience) return;
  RESTART.flat = 0; RESTART.prev = Infinity; RESTART.n++;
  jolt(); adamReset();
}

export let tick = 0;
export const resetTick = () => { tick = 0; };

/**
 * One step: the gradient move, the projection back into the feasible set, and
 * the outer iteration on its own cadence. The projection belongs here and not
 * in sync(), because a projected gradient method projects after every step,
 * not after every drawn frame.
 */
export function step() {
  const moved = adamStep();
  if (moved === false) return false;
  constrain();
  if (tick % AL_EVERY === AL_EVERY - 1) { alStep(); if (S.restart) restartTick(); }
  tick++;
  return true;
}

/**
 * Steps are batched into a frame rather than run one per frame.
 *
 * sync() rebuilds the tube and the point meshes from scratch, which measures
 * 3.6ms against a 4.2ms gradient at nine points in Oklab. Running it once per
 * STEP spent nearly half the solver's budget on geometry nobody saw: only the
 * last rebuild of a frame is ever displayed. So take steps until the budget is
 * gone, then draw once.
 *
 * The budget leaves most of a 60Hz frame to everything else, and the loop runs
 * at least once, so a step that is already over budget on its own — CIELAB at
 * nine points measures 23ms — behaves exactly as it did before.
 *
 * STEP_CAP is not a tuning knob, it is the exit that does not depend on a
 * clock. A headless browser driven with --virtual-time-budget freezes
 * performance.now() until a timer fires, so a budget alone is an infinite loop
 * there, and any test that starts the solver hangs instead of failing.
 */

export const activeTerms = () => OBJ.filter((o) => S.on[o.key] && S.w[o.key] > 0 && (!o.mode || o.mode === S.mode));

/**
 * The feasibility constraint, applied where state becomes geometry. Every path
 * that writes a node — drag, hex field, preset load, gradient step,
 * gamut switch — already routes through sync(), so projecting here makes an
 * out-of-gamut node impossible rather than merely unlikely.
 *
 * toGamut bisects chroma at fixed lightness, so this is NOT the Euclidean
 * nearest feasible point; it is the nearest one of the same hue and lightness,
 * which is the projection worth having for color. Paired with the gradient
 * buttons it makes those steps ordinary projected gradient descent.
 *
 * Note this constrains the NODES. A spline through feasible nodes can still
 * bulge outside — the gamut solid is not convex — which is why the gamut
 * penalty term still has work to do on the curve samples.
 */
export const constrain = () => { S.pts = S.pts.map(feasify); };

// ─── the feasible set ────────────────────────────────────────────────────────
// The gamut, the lightness and chroma bands, the hue arc, the keep-out spheres
// and the halfplanes. These describe a feasible set rather than a preference,
// so they are enforced by projection rather than weighted against the rest: a
// palette outside them is not a worse palette, it is not a palette.

/** how far outside the feasible set, in chart units; 0 means feasible */
export function infeasibility(q) {
  const c = Math.hypot(q[1], q[2]);
  return Math.max(
    inGamut(q) ? 0 : 1,
    hinge(S.lo[0] - q[0]), hinge(q[0] - S.hi[0]),
    hinge(S.lo[1] - c), hinge(c - S.hi[1]),
    (c * hueGap(q) * Math.PI) / 180,
    Math.sqrt(obstaclePenalty(q, S.obs, M(), primary())),
    Math.sqrt(planePenalty(q)));
}

/**
 * The same set, measured smoothly. infeasibility() is for deciding whether a
 * NODE is done being projected, so a binary gamut test is fine there. A curve
 * sample is not projected — it is a function of the nodes — so its violation
 * has to be differentiable, which means the distance outside the gamut rather
 * than the fact of being outside, and a sum rather than a max.
 */
export const violation = (p, g = M(), v = primary()) => {
  const c = Math.hypot(p[1], p[2]);
  return Math.sqrt(gamutPenalty(p))
    + hinge(S.lo[0] - p[0]) + hinge(p[0] - S.hi[0])
    + hinge(S.lo[1] - c) + hinge(c - S.hi[1])
    + (c * hueGap(p) * Math.PI) / 180
    + (S.obs.length ? Math.sqrt(obstaclePenalty(p, S.obs, g, v)) : 0)
    + (S.planes.length ? Math.sqrt(planePenalty(p)) : 0);
};
/** the metric and the observer are the same for every sample, so derive once */
export const violations = (pts) => { const g = M(), v = primary(); return pts.map((p) => violation(p, g, v)); };

export const clampL = ([L, a, b]) => [Math.min(S.hi[0], Math.max(S.lo[0], L)), a, b];

export const clampC = ([L, a, b]) => {
  const c = Math.hypot(a, b), t = Math.min(S.hi[1], Math.max(S.lo[1], c));
  if (t === c) return [L, a, b];
  // at the neutral axis there is no hue to preserve, so leave along the middle
  // of the allowed arc — the one direction that cannot then violate the hue arc
  if (c < 1e-9) return fromLCh([L, t, S.hue[0] + norm360(S.hue[1] - S.hue[0]) / 2]);
  return [L, (a * t) / c, (b * t) / c];
};

export const clampH = (q) => {
  const c = Math.hypot(q[1], q[2]);
  if (c < 1 || hueGap(q) === 0) return q;            // hue is not a real quantity near the axis
  const h = hueOf(q);
  return fromLCh([q[0], c, angGap(h, S.hue[0]) <= angGap(h, S.hue[1]) ? S.hue[0] : S.hue[1]]);
};

/** planes live in SPACE coords and n is unit, so this is the exact projection */
export const clampPlanes = (q) => {
  if (!S.planes.length) return q;
  let c = toSpace(q);
  for (const pl of S.planes) {
    const v = dot3(pl.n, c) - pl.d;
    if (v > 0) c = c.map((x, j) => x - v * pl.n[j]);
  }
  return fromSpace(c);
};

/**
 * Out of every keep-out ball, along the ray from its center. The ball is round
 * in PERCEIVED distance under the active metric and color-vision view, which
 * is not a sphere in the chart, so the exit point is found by bisection rather
 * than by adding a radius. obstaclePenalty is (r - d)² when inside and 0 when
 * out, which is all the test this needs.
 */
export function clampObs(q) {
  const g = M(), v = primary();
  for (const o of S.obs) {
    const inside = (x) => obstaclePenalty(x, [o], g, v) > 0;
    if (!inside(q)) continue;
    let u = [0, 1, 2].map((k) => q[k] - o.c[k]);
    let n = Math.hypot(...u);
    if (n < 1e-9) { u = [0, 1, 0]; n = 1; }          // dead center: any direction will do
    u = u.map((x) => x / n);
    const at = (t) => o.c.map((cc, k) => cc + t * u[k]);
    let hi = Math.max(1e-3, unperceive(o.r));
    for (let k = 0; k < 40 && inside(at(hi)); k++) hi *= 1.6;
    let lo = 0;
    for (let k = 0; k < 30; k++) { const t = (lo + hi) / 2; inside(at(t)) ? (lo = t) : (hi = t); }
    q = at(hi);
  }
  return q;
}

/**
 * Nearest feasible node. The sets are not all convex — the gamut has the
 * blue-cyan concavity and a keep-out ball's complement never is — so this is
 * alternating projection rather than anything with a convergence proof: it
 * finds A feasible point near the input, which is what a projected gradient
 * step needs, not the metrically nearest one.
 *
 */
export function feasify(p) {
  let q = toGamut(p);
  for (let it = 0; it < 12 && infeasibility(q) > 1e-4; it++)
    q = toGamut(clampObs(clampPlanes(clampH(clampC(clampL(q))))));
  return q;
}
/**
 * Hand edits make the accumulated moments meaningless.
 *
 * The flag is how that reaches the worker. The page's own `adam` is never the
 * one descending, so dropping it here and stopping would be a no-op that left a
 * stale moment pulling against a palette it no longer fits.
 */
export let disturbed = false;
export const disturb = () => { adam = null; disturbed = true; };
export const takeDisturbed = () => { const d = disturbed; disturbed = false; return d; };

/**
 * Everything module-level that is really a function of S, recomputed together.
 *
 * The page and the worker each hold their own copy of this module, so anything
 * derived that only one of them refreshed would quietly differ between the
 * palette you see and the one being optimized. Both were live bugs the moment
 * the solver moved off-thread: LSEP left at 0 makes the lightness-spread term
 * identically zero, and a stale `view` optimizes for normal vision while the
 * Vision panel says protanopia. Deriving them in one place, called from both,
 * is what keeps that from being possible rather than merely unlikely.
 */
export function derive() {
  syncPins(); syncRuns(); syncProfiles();
  setObserver(S.cvd === 'none' ? NORMAL : simulate(S.cvd, S.sev));
  LSEP = autoLsep();
}
