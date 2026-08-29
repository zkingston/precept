/**
 * Non-Riemannian perceptual color space.
 * Bujack, Teti, Miller, Caffrey & Turton, PNAS 2022, doi:10.1073/pnas.2119753119
 * Bujack, Stark, Turton, Miller & Rogers, CGF 2025, doi:10.1111/cgf.70136
 *
 * The space is a triple (M, g, f):
 *
 *   M   chart    Oklab scaled by 100. Points p = (L, a, b), L in [0, 100].
 *   g   metric   LOCAL structure. Riemannian, additive.
 *                arc length  s(γ) = ∫ sqrt(γ' g(γ) γ') dt
 *   f   returns  GLOBAL structure. Concave, NOT additive.
 *                perceived difference of a finite jump  D = f(s)
 *
 * The paper's result is that D is not a length metric: f(2s) < 2·f(s)
 * ("diminishing returns"), so no Riemannian metric reproduces finite color
 * differences — a geodesic distance always overestimates a large jump.
 * All of the non-Riemannian content lives in f. g stays Riemannian because
 * JND ellipsoids are a local, additive object; every experiment that breaks
 * additivity is a finite-jump experiment.
 *
 * Two properties make this convenient rather than annoying:
 *
 *   f monotone            ⇒ geodesics of g are unchanged. Plan with g.
 *   f concave, f(0) = 0   ⇒ D = f∘s is subadditive, so D is still a metric.
 *                           Just not an intrinsic one.
 *
 * The split is not just convenient, it is the one the follow-up paper argues
 * for: CGF 2025 finds no evidence that shortest paths under the true
 * non-Riemannian metric differ from those under the induced Riemannian one,
 * which "would also justify modeling the non-Riemannian metric [...] as a
 * Riemannian metric but with a dampening scaling function on top", and buys
 * back the geodesic equation instead of a general metric-space search.
 *
 * So: arc length for anything integrated ALONG a path (uniform spacing of a
 * continuous palette), D for anything compared AS a jump (separation of a
 * discrete palette). Conflating the two is the bug this file exists to stop.
 *
 * Planning view: M is the configuration space, `gamutPenalty` is the obstacle
 * field, `metric` is the cost weighting (and is where "keep lightness fixed,
 * spread hue" is expressed), `arcLength` is the trajectory cost.
 */

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];

/** Tunable knobs. Perception is not ideal on paper; expose the dials. */
export const params = {
  /**
   * Diminishing-returns knee, in chart units (~1 JND).
   * Paper Eq. 18 with Δψ normalised to [0,1] over ψ ∈ [0,100] and the fit
   * a = 5.34, b = 2.34, renormalised below so f'(0) = 1.
   */
  s0: 100 / 5.34,

  /** Which gamut counts as reachable. Key of `GAMUTS`. */
  gamut: 'srgb',

  /** Which coordinates to view and edit in. Key of `SPACES`. */
  space: 'oklab',
};

/** The six faces of the unit RGB cube, as (axis u, axis v, fixed axis, value). */
export const CUBE_FACES: [number, number, number, number][] =
  [[0, 1, 2, 0], [0, 1, 2, 1], [1, 2, 0, 0], [1, 2, 0, 1], [2, 0, 1, 0], [2, 0, 1, 1]];

// ─── f: diminishing returns ──────────────────────────────────────────────────

/**
 * f(s) = s0·ln(1 + s/s0).
 *
 * Eq. 18 is b·log(a·Δψ+1)/log(a+1). Rescaling it so f'(0) = 1 collapses both
 * fitted parameters into the single knee s0 = 100/a, and makes arc length and
 * perceived difference share one unit: below the knee differences add, above
 * it they saturate. b only set the paper's arbitrary response scale.
 */
export const perceive = (s: number) => params.s0 * Math.log1p(s / params.s0);

/** Inverse of `perceive`: perceived difference → arc length to travel. */
export const unperceive = (d: number) => params.s0 * Math.expm1(d / params.s0);

// ─── linear algebra ──────────────────────────────────────────────────────────

type M3 = number[][];
const apply = (m: M3, v: Vec3): Vec3 => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) as Vec3;
const mm = (a: M3, b: M3): M3 => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
function inv3(m: M3): M3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const [A, B, C] = [e * i - f * h, f * g - d * i, d * h - e * g];
  const det = a * A + b * B + c * C;
  return [[A, c * h - b * i, b * f - c * e], [B, a * i - c * g, c * d - a * f], [C, b * g - a * h, a * e - b * d]]
    .map((r) => r.map((v) => v / det));
}

// ─── chart: XYZ ↔ Oklab×100 ──────────────────────────────────────────────────

// Ottosson's Oklab, kept as the two matrices it is actually made of rather than
// the sRGB-collapsed form, so any set of primaries can feed it.
const LMS_XYZ: M3 = [[0.8189330101, 0.3618667424, -0.1288597137],
                     [0.0329845436, 0.9293118715, 0.0361456387],
                     [0.0482003018, 0.2643662691, 0.633851707]];
const LAB_LMS: M3 = [[0.2104542553, 0.793617785, -0.0040720468],
                     [1.9779984951, -2.428592205, 0.4505937099],
                     [0.0259040371, 0.7827717662, -0.808675766]];
const XYZ_LMS = inv3(LMS_XYZ), LMS_LAB = inv3(LAB_LMS);

/** XYZ (D65, Y=1 for white) → chart */
export const fromXYZ = (xyz: Vec3): Vec3 =>
  apply(LAB_LMS, apply(LMS_XYZ, xyz).map(Math.cbrt) as Vec3).map((v) => v * 100) as Vec3;

/** chart → XYZ (D65) */
export const toXYZ = (p: Vec3): Vec3 =>
  apply(XYZ_LMS, apply(LMS_LAB, p.map((v) => v / 100) as Vec3).map((v) => v ** 3) as Vec3);

// ─── gamuts ──────────────────────────────────────────────────────────────────

/**
 * An RGB gamut is a parallelepiped in XYZ: the image of the unit cube under the
 * matrix its primaries and white point define. Note what is NOT here — transfer
 * functions. A gamma curve is a monotone per-channel reparametrisation of that
 * same cube, so it moves no boundary and changes no answer to "is this colour
 * reachable". Primaries and white point are the whole story.
 *
 * Classical: NTSC 1953 (never actually built, phosphors could not reach it),
 * sRGB/Rec.709, Adobe RGB 1998 (opened up the cyan-green corner for print).
 * Modern: Display P3 (the DCI cinema primaries on a D65 white — what recent
 * phones and laptops ship), Rec.2020 (UHD, primaries on the spectral locus),
 * ProPhoto and ACEScg AP1, both of which use *imaginary* primaries outside the
 * locus so the encodable set can contain every real colour.
 */
export type Gamut = { name: string; p: [number, number][]; w: [number, number] };

export const GAMUTS: Record<string, Gamut> = {
  srgb: { name: 'sRGB / Rec.709', p: [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]], w: [0.3127, 0.329] },
  'display-p3': { name: 'Display P3', p: [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]], w: [0.3127, 0.329] },
  'a98-rgb': { name: 'Adobe RGB 1998', p: [[0.64, 0.33], [0.21, 0.71], [0.15, 0.06]], w: [0.3127, 0.329] },
  rec2020: { name: 'Rec. 2020', p: [[0.708, 0.292], [0.17, 0.797], [0.131, 0.046]], w: [0.3127, 0.329] },
  'prophoto-rgb': { name: 'ProPhoto RGB', p: [[0.734699, 0.265301], [0.159597, 0.840403], [0.036598, 0.000105]], w: [0.345704, 0.35854] },
  acescg: { name: 'ACEScg (AP1)', p: [[0.713, 0.293], [0.165, 0.83], [0.128, 0.044]], w: [0.32168, 0.33767] },
  ntsc1953: { name: 'NTSC 1953', p: [[0.67, 0.33], [0.21, 0.71], [0.14, 0.08]], w: [0.31, 0.316] },
};

const XYZ_OF = ([x, y]: [number, number]): Vec3 => [x / y, 1, (1 - x - y) / y];
const BRADFORD: M3 = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];

// Adapt to the white the CHART itself considers neutral, recovered by asking it,
// rather than to a hand-typed D65. Oklab was fit to a particular D65 and a
// rounded (0.3127, 0.3290) is not quite that one — close enough to look right
// and not close enough to leave grey achromatic. This way every gamut's white
// lands on [100, 0, 0] exactly, by construction.
const CHART_WHITE = toXYZ([100, 0, 0]);

/** von Kries in Bradford cone space. ProPhoto is D50, ACEScg ~D60, NTSC is C. */
function adapt(w: [number, number]): M3 {
  const [s, d] = [apply(BRADFORD, XYZ_OF(w)), apply(BRADFORD, CHART_WHITE)];
  return mm(inv3(BRADFORD), mm([[d[0] / s[0], 0, 0], [0, d[1] / s[1], 0], [0, 0, d[2] / s[2]]], BRADFORD));
}

/** Derive linear-RGB → XYZ(D65) from primaries. Deriving beats transcribing nine
 *  digits per space, and it makes a wrong primary a visible error, not a subtle one. */
function build(g: Gamut): M3 {
  const P = g.p.map(XYZ_OF);
  const M: M3 = [0, 1, 2].map((i) => P.map((c) => c[i]));      // primaries as columns
  const s = apply(inv3(M), XYZ_OF(g.w));                       // scale each so they sum to white
  return mm(adapt(g.w), M.map((r) => r.map((v, j) => v * s[j])));
}

const MATS: Record<string, { to: M3; from: M3 }> = {};
const mats = (k: string) => (MATS[k] ??= { to: build(GAMUTS[k]), from: inv3(build(GAMUTS[k])) });

/** linear RGB in `g` → chart */
export const fromLinear = (rgb: Vec3, g = params.gamut): Vec3 => fromXYZ(apply(mats(g).to, rgb));

/** chart → linear RGB in `g` (may fall outside [0,1]: see `inGamut`) */
export const toLinear = (p: Vec3, g = params.gamut): Vec3 => apply(mats(g).from, toXYZ(p));

const enc = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const dec = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** gamma-encoded sRGB in [0,1] → chart. Inverse of `toSRGB`. Always sRGB: hex
 *  and CSS byte triples mean sRGB no matter which gamut you are designing for. */
export const fromSRGB = (c: Vec3): Vec3 => fromLinear(c.map(dec) as Vec3, 'srgb');

export const fromHex = (hex: string): Vec3 => {
  const n = parseInt(hex.replace('#', ''), 16);
  return fromSRGB([((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]);
};

/** chart → gamma-encoded sRGB, per channel in [0,1] if and only if in gamut. */
export const toSRGB = (p: Vec3): Vec3 => toLinear(p, 'srgb').map(enc) as Vec3;

/** Gamut-mapped hex, for anything that cannot take a CSS color function. */
export const toHex = (p: Vec3): string =>
  '#' + toSRGB(toGamut(p, 'srgb')).map((c) => Math.round(255 * Math.min(1, Math.max(0, c))).toString(16).padStart(2, '0')).join('');

/** Native CSS. Lets the browser do the gamut mapping on wide-gamut displays. */
export const css = ([L, a, b]: Vec3): string => `oklab(${L}% ${a / 100} ${b / 100})`;

/** Designers think in cylinders. h in degrees. */
export const toLCh = ([L, a, b]: Vec3): Vec3 => [L, Math.hypot(a, b), (Math.atan2(b, a) * 180) / Math.PI];
export const fromLCh = ([L, C, h]: Vec3): Vec3 => [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)];

// ─── gamut: the obstacle field ───────────────────────────────────────────────

export const inGamut = (p: Vec3, g = params.gamut, eps = 1e-4) =>
  toLinear(p, g).every((c) => c >= -eps && c <= 1 + eps);

/** Smooth, ≥0, zero inside the gamut. Penalty term for a trajectory optimizer. */
export const gamutPenalty = (p: Vec3): number =>
  toLinear(p).reduce((acc, c) => acc + (c < 0 ? c * c : c > 1 ? (c - 1) ** 2 : 0), 0);

/**
 * A region to keep out of: every color within `r` of `c`. Radius is in
 * PERCEIVED units, so "stay 15 away from the background" means what it says,
 * and the ball is geometrically bigger than r once r passes the knee.
 */
export type Ball = { c: Vec3; r: number };

/**
 * Same shape as `gamutPenalty` — obstacles are just more of the obstacle field.
 * The optional view measures the keep-out as a given observer would: a sphere
 * you clear for normal vision may still be sitting on top of you in protanopia.
 */
export const obstaclePenalty = (p: Vec3, obs: Ball[], g: Metric = EUCLIDEAN, v: View = (q) => q): number =>
  obs.reduce((acc, o) => acc + Math.max(0, o.r - delta(v(p), v(o.c), g)) ** 2, 0);

/** Nearest in-gamut point at fixed L and hue: bisect chroma (CSS Color 4 style). */
export function toGamut(p: Vec3, g = params.gamut): Vec3 {
  if (inGamut(p, g)) return p;
  const L = Math.min(100, Math.max(0, p[0]));
  let lo = 0, hi = 1; // gray is always in gamut, so the bracket is valid
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2;
    inGamut([L, p[1] * t, p[2] * t], g) ? (lo = t) : (hi = t);
  }
  return [L, p[1] * lo, p[2] * lo];
}

// ─── working spaces ──────────────────────────────────────────────────────────

/**
 * Coordinates to view and edit in. Changing space is a CHANGE OF CHART, not a
 * change of geometry: points are stored in the chart above, so every distance,
 * every spline and every metric below is untouched by what you are looking at.
 * A palette must not silently change because you switched to CIELAB.
 *
 * Classic: CIE XYZ (1931, the substrate everything else is defined against),
 * sRGB (the device cube — Euclidean distance in it means nothing perceptually,
 * which is the point of being able to see it), CIELAB and CIELUV (1976, the
 * first two perceptual attempts — CIELAB for surfaces, CIELUV for emissive
 * displays and additive mixing).
 * Modern: IPT (Ebner & Fairchild 1998, the first opponent space built for hue
 * linearity and the ancestor of everything after it) and Oklab (Ottosson 2020).
 *
 * Deliberately absent: CAM16-UCS, which needs viewing conditions this tool does
 * not model, and ICtCp/Jzazbz, which are keyed to absolute luminance in nits.
 * Both would need a scene-referred story the rest of this file does not have.
 */
export type Space = { name: string; axes: [string, string, string]; from: (xyz: Vec3) => Vec3; to: (c: Vec3) => Vec3 };

const D = 6 / 29;
const labf = (t: number) => (t > D ** 3 ? Math.cbrt(t) : t / (3 * D * D) + 4 / 29);
const labfi = (t: number) => (t > D ? t ** 3 : 3 * D * D * (t - 4 / 29));
const spow = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** e;

// IPT, Ebner & Fairchild 1998. Matrices as published, D65-adapted (coloraide).
const IPT_LMS: M3 = [[0.40021437220265654, 0.7075074077935767, -0.0807060322407405],
                     [-0.22798649207313385, 1.1500016565804587, 0.061235922568512555],
                     [0, 0, 0.9182249511582473]];
const IPT_OPP: M3 = [[0.4, 0.4, 0.2], [4.455, -4.851, 0.396], [0.8056, 0.3572, -1.1628]];
const IPT_LMS_I = inv3(IPT_LMS), IPT_OPP_I = inv3(IPT_OPP);
// Normalise cone response to the chart's white, exactly as the gamuts are
// adapted. Published IPT is keyed to a D65 a hair off Oklab's, and left alone
// that put grey 0.04 off the neutral axis — small, and wrong in the one place
// this tool cannot afford to be: the axis every lightness question hangs on.
const IPT_W = apply(IPT_LMS, CHART_WHITE);

const rgb01 = (xyz: Vec3): Vec3 => apply(mats('srgb').from, xyz).map(enc) as Vec3;
const unrgb01 = (c: Vec3): Vec3 => apply(mats('srgb').to, c.map(dec) as Vec3);

export const SPACES: Record<string, Space> = {
  oklab: { name: 'Oklab (2020)', axes: ['L', 'a', 'b'], from: fromXYZ, to: toXYZ },

  cielab: {
    name: 'CIELAB (1976)', axes: ['L*', 'a*', 'b*'],
    from: (xyz) => {
      const [fx, fy, fz] = xyz.map((v, i) => labf(v / CHART_WHITE[i]));
      return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
    },
    to: ([L, a, b]) => {
      const fy = (L + 16) / 116;
      return [labfi(fy + a / 500), labfi(fy), labfi(fy - b / 200)].map((v, i) => v * CHART_WHITE[i]) as Vec3;
    },
  },

  cieluv: {
    name: 'CIELUV (1976)', axes: ['L*', 'u*', 'v*'],
    from: (xyz) => {
      const d = xyz[0] + 15 * xyz[1] + 3 * xyz[2];
      const wd = CHART_WHITE[0] + 15 * CHART_WHITE[1] + 3 * CHART_WHITE[2];
      const L = 116 * labf(xyz[1] / CHART_WHITE[1]) - 16;
      if (d === 0) return [L, 0, 0];
      return [L, 13 * L * (4 * xyz[0] / d - 4 * CHART_WHITE[0] / wd),
                 13 * L * (9 * xyz[1] / d - 9 * CHART_WHITE[1] / wd)];
    },
    to: ([L, u, v]) => {
      if (L === 0) return [0, 0, 0];
      const wd = CHART_WHITE[0] + 15 * CHART_WHITE[1] + 3 * CHART_WHITE[2];
      const up = u / (13 * L) + 4 * CHART_WHITE[0] / wd, vp = v / (13 * L) + 9 * CHART_WHITE[1] / wd;
      const Y = labfi((L + 16) / 116) * CHART_WHITE[1];
      return [(Y * 9 * up) / (4 * vp), Y, (Y * (12 - 3 * up - 20 * vp)) / (4 * vp)];
    },
  },

  ipt: {
    name: 'IPT (1998)', axes: ['I', 'P', 'T'],
    from: (xyz) => apply(IPT_OPP, apply(IPT_LMS, xyz).map((v, i) => spow(v / IPT_W[i], 0.43)) as Vec3).map((v) => v * 100) as Vec3,
    to: (c) => apply(IPT_LMS_I, apply(IPT_OPP_I, c.map((v) => v / 100) as Vec3).map((v, i) => spow(v, 1 / 0.43) * IPT_W[i]) as Vec3),
  },

  xyz: {
    name: 'CIE XYZ (1931)', axes: ['X', 'Y', 'Z'],
    from: (xyz) => xyz.map((v) => v * 100) as Vec3,
    to: (c) => c.map((v) => v / 100) as Vec3,
  },

  srgb: {
    name: 'sRGB cube', axes: ['R', 'G', 'B'],
    from: (xyz) => rgb01(xyz).map((v) => v * 100) as Vec3,
    to: (c) => unrgb01(c.map((v) => v / 100) as Vec3),
  },

};

/** chart ↔ the active working space */
export const toSpace = (p: Vec3, k = params.space): Vec3 => SPACES[k].from(toXYZ(p));
export const fromSpace = (c: Vec3, k = params.space): Vec3 => fromXYZ(SPACES[k].to(c));

/**
 * The box a gamut occupies in a space's coordinates. Sampling the RGB cube's
 * surface beats hand-typing twenty-one axis ranges, and it re-fits itself when
 * either the space or the gamut changes rather than going quietly stale.
 */
export function spaceExtent(k = params.space, g = params.gamut): { lo: Vec3; hi: Vec3 } {
  const sp = SPACES[k], N = 14;
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const [u, v, w, f] of CUBE_FACES)
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const c: number[] = []; c[u] = (i / N) ** 2.2; c[v] = (j / N) ** 2.2; c[w] = f;
      const q = sp.from(apply(mats(g).to, c as Vec3));
      for (let d2 = 0; d2 < 3; d2++) { lo[d2] = Math.min(lo[d2], q[d2]); hi[d2] = Math.max(hi[d2], q[d2]); }
    }
  return { lo, hi };
}

// ─── g: the local metric ─────────────────────────────────────────────────────

export type Metric = (p: Vec3) => Mat3;

/** Oklab is already an approximately uniform chart, so identity is the default. */
export const EUCLIDEAN: Metric = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/**
 * Anisotropic metric in the (lightness, chroma, hue) frame at each point.
 * This is where a design intent becomes geometry: wL = 4 makes lightness
 * changes four times as expensive, so geodesics and dispersion both prefer to
 * vary hue and chroma instead.
 */
export function weighted(wL = 1, wC = 1, wH = 1): Metric {
  return ([, a, b]) => {
    const C = Math.hypot(a, b);
    if (C < 1e-9) return [[wL ** 2, 0, 0], [0, wC ** 2, 0], [0, 0, wC ** 2]]; // every direction is radial
    const [u, v] = [a / C, b / C];
    const [cc, hh] = [wC ** 2, wH ** 2];
    return [
      [wL ** 2, 0, 0],
      [0, cc * u * u + hh * v * v, (cc - hh) * u * v],
      [0, (cc - hh) * u * v, cc * v * v + hh * u * u],
    ];
  };
}

/**
 * The metric the active space induces, written in chart coordinates: g = JᵀJ
 * for J = ∂(space)/∂(chart). Measuring a curve with this asks "how long would
 * the space you are looking at call this?" — the right question once the curve
 * is drawn and edited there. The points themselves never leave the chart.
 *
 * Scaled so the neutral axis still runs 0→100 from black to white in every
 * space. Without that, arc length would change units with the view and
 * `perceive`, whose knee sits at a fixed ~18.7, would quietly start meaning
 * something else. One scalar per space, measured rather than assumed.
 */
const NEUTRAL_SCALE: Record<string, number> = {};
function neutralScale(k: string): number {
  if (NEUTRAL_SCALE[k] === undefined) {
    let len = 0;
    for (let i = 0; i < 128; i++) {
      const a = toSpace([(i * 100) / 128, 0, 0], k), b = toSpace([((i + 1) * 100) / 128, 0, 0], k);
      len += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    NEUTRAL_SCALE[k] = 100 / len;
  }
  return NEUTRAL_SCALE[k];
}

export function spaceMetric(k = params.space): Metric {
  if (k === 'oklab') return EUCLIDEAN;                 // the chart is its own space
  const w = neutralScale(k) ** 2, h = 0.05;
  return (p) => {
    const col: Vec3[] = [];
    for (let i = 0; i < 3; i++) {                      // central differences: J's columns
      const a = [...p] as Vec3, b = [...p] as Vec3;
      a[i] -= h; b[i] += h;
      const [sa, sb] = [toSpace(a, k), toSpace(b, k)];
      col.push(sb.map((v, j) => (v - sa[j]) / (2 * h)) as Vec3);
    }
    return [0, 1, 2].map((i) => [0, 1, 2].map((j) =>
      w * (col[i][0] * col[j][0] + col[i][1] * col[j][1] + col[i][2] * col[j][2]))) as Mat3;
  };
}

const quad = (g: Mat3, d: Vec3) =>
  d.reduce((acc, di, i) => acc + di * d.reduce((s, dj, j) => s + g[i][j] * dj, 0), 0);

// ─── lengths and distances ───────────────────────────────────────────────────

const lerp = (p: Vec3, q: Vec3, t: number): Vec3 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];

/** Midpoint-rule length of one segment. */
export function segLength(p: Vec3, q: Vec3, g: Metric = EUCLIDEAN): number {
  const d: Vec3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  return Math.sqrt(quad(g(lerp(p, q, 0.5)), d));
}

/** Additive. The trajectory cost, and the thing you divide up for even spacing. */
export const arcLength = (path: Vec3[], g: Metric = EUCLIDEAN): number =>
  path.slice(1).reduce((acc, q, i) => acc + segLength(path[i], q, g), 0);

/**
 * Perceived difference between two colors — the non-Riemannian one.
 * Uses the straight chord, which upper-bounds the geodesic; equality holds for
 * EUCLIDEAN.
 * ponytail: chord, not geodesic. Swap in the planner's path when there is one.
 * CGF 2025 §4 wants the geodesic here specifically to capture Bezold-Brücke —
 * straight lines in the chart are the wrong path for a hue-preserving ramp.
 */
export const delta = (p: Vec3, q: Vec3, g: Metric = EUCLIDEAN, n = 8): number =>
  perceive(arcLength(Array.from({ length: n + 1 }, (_, i) => lerp(p, q, i / n)), g));

// ─── color vision deficiency: a projection on M ──────────────────────────────

/**
 * Brettel, Viénot & Mollon 1997. In cone space a dichromat's gamut is two
 * half-planes, so simulation is a projection: pick the half-plane by the sign
 * of a separating normal, then apply that plane's linear map. Precomputed into
 * linear sRGB, constants from libDaltonLens (public domain).
 *
 * As a map on the chart this is NOT an isometry and not linear — it collapses a
 * dimension. That is the point: it is a constraint surface, and CVD-safety is
 * the ordinary palette objective evaluated after projecting onto it.
 */
export type CVD = 'protan' | 'deutan' | 'tritan';

const BRETTEL: Record<CVD, [number[], number[], Vec3]> = {
  protan: [
    [0.1498, 1.19548, -0.34528, 0.10764, 0.84864, 0.04372, 0.00384, -0.0054, 1.00156],
    [0.1457, 1.16172, -0.30742, 0.10816, 0.85291, 0.03892, 0.00386, -0.00524, 1.00139],
    [0.00048, 0.00393, -0.00441],
  ],
  deutan: [
    [0.36477, 0.86381, -0.22858, 0.26294, 0.64245, 0.09462, -0.02006, 0.02728, 0.99278],
    [0.37298, 0.88166, -0.25464, 0.25954, 0.63506, 0.1054, -0.0198, 0.02784, 0.99196],
    [-0.00281, -0.00611, 0.00892],
  ],
  tritan: [
    [1.01277, 0.13548, -0.14826, -0.01243, 0.86812, 0.14431, 0.07589, 0.805, 0.11911],
    [0.93678, 0.18979, -0.12657, 0.06154, 0.81526, 0.1232, -0.37562, 1.12767, 0.24796],
    [0.03901, -0.02788, -0.01113],
  ],
};

/** severity 0 = normal vision, 1 = dichromacy. Anomalous trichromacy in between. */
export function simulate(type: CVD, severity = 1): View {
  const [m1, m2, n] = BRETTEL[type];
  return (p) => {
    const rgb = toLinear(p);
    const m = n[0] * rgb[0] + n[1] * rgb[1] + n[2] * rgb[2] >= 0 ? m1 : m2;
    return fromLinear(
      rgb.map((c, i) => severity * (m[3 * i] * rgb[0] + m[3 * i + 1] * rgb[1] + m[3 * i + 2] * rgb[2]) + (1 - severity) * c) as Vec3,
    );
  };
}

export type View = (p: Vec3) => Vec3;
export const NORMAL: View = (p) => p;

/** Normal vision plus all three dichromacies — the usual constraint set. */
export const ALL_VIEWS: View[] = [NORMAL, simulate('protan'), simulate('deutan'), simulate('tritan')];

// ─── palette primitives ──────────────────────────────────────────────────────

const pairs = <T,>(xs: T[]): [T, T][] => xs.flatMap((p, i) => xs.slice(i + 1).map((q) => [p, q] as [T, T]));

const dist = (p: Vec3, q: Vec3) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);

/** Barry–Goldman evaluation of one centripetal Catmull–Rom span, P[1]→P[2]. */
function span(P: Vec3[], n: number): Vec3[] {
  const t = [0];
  for (let i = 1; i < 4; i++) t.push(t[i - 1] + Math.max(1e-6, Math.sqrt(dist(P[i - 1], P[i]))));
  const mix = (a: Vec3, b: Vec3, ta: number, tb: number, x: number) => lerp(a, b, (x - ta) / (tb - ta));
  return Array.from({ length: n }, (_, k) => {
    const x = t[1] + ((t[2] - t[1]) * k) / n;
    const [a1, a2, a3] = [mix(P[0], P[1], t[0], t[1], x), mix(P[1], P[2], t[1], t[2], x), mix(P[2], P[3], t[2], t[3], x)];
    return mix(mix(a1, a2, t[0], t[2], x), mix(a2, a3, t[1], t[3], x), t[1], t[2], x);
  });
}

/**
 * The trajectory: centripetal Catmull–Rom through the control points.
 * Interpolating, so every control point is a color that actually appears —
 * which is what a designer dragging a handle expects, and what Bezier handles
 * would not give. Centripetal (α=½) rather than uniform because unevenly
 * spaced controls otherwise produce cusps and self-intersections.
 *
 * Returns a dense polyline. Hand it to `resample` for even perceptual spacing,
 * or to `arcLength` for the trajectory cost.
 */
export function spline(controls: Vec3[], perSpan = 24): Vec3[] {
  if (controls.length < 2) return controls.slice();
  const refl = (a: Vec3, b: Vec3): Vec3 => [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]];
  const P = [refl(controls[0], controls[1]), ...controls, refl(controls[controls.length - 1], controls[controls.length - 2])];
  const out: Vec3[] = [];
  for (let i = 0; i + 3 < P.length; i++) out.push(...span(P.slice(i, i + 4), perSpan));
  return [...out, controls[controls.length - 1]];
}

/**
 * Continuous palette: resample a trajectory to n colors at equal ARC LENGTH.
 * Arc length, not delta — spacing is integrated along the path, so it is the
 * additive quantity. Interpolation is linear in the chart between knots, so
 * pass a finely discretized path.
 */
export function resample(path: Vec3[], n: number, g: Metric = EUCLIDEAN): Vec3[] {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + segLength(path[i - 1], path[i], g));
  const total = cum[cum.length - 1];
  let k = 1;
  return Array.from({ length: n }, (_, i) => {
    const target = (total * i) / (n - 1);
    while (k < cum.length - 1 && cum[k] < target) k++;
    const span = cum[k] - cum[k - 1];
    return lerp(path[k - 1], path[k], span > 0 ? (target - cum[k - 1]) / span : 0);
  });
}

/**
 * Discrete palette: the objective to maximize. Uses delta, not arc length —
 * swatches are compared as finite jumps, which is exactly where diminishing
 * returns bite. Under arc length an optimizer chases a few very distant pairs;
 * under delta those pairs saturate and it spends the budget evening things out.
 *
 * Pass ALL_VIEWS to make it CVD-safe: the worst separation over normal vision
 * and the three dichromacies. A pair that collapses for a deutan observer caps
 * the score no matter how far apart it looks to you.
 */
export const minSeparation = (palette: Vec3[], g: Metric = EUCLIDEAN, views: View[] = [NORMAL]): number =>
  Math.min(...views.flatMap((v) => pairs(palette).map(([p, q]) => delta(v(p), v(q), g))));

/**
 * The other CVD ask: how much a view WARPS the palette rather than whether it
 * survives. 0 means the dichromat reads the same relationships you do.
 *
 * Minimize this if the palette encodes an ordered/structured quantity and must
 * read the same for everyone; maximize minSeparation if the categories only
 * need to stay tellable apart. They pull in different directions — a palette
 * can be perfectly distinguishable and still reorder itself under protanopia.
 */
export const distortion = (palette: Vec3[], view: View, g: Metric = EUCLIDEAN): number =>
  Math.max(...pairs(palette).map(([p, q]) => Math.abs(delta(view(p), view(q), g) - delta(p, q, g))));

// ─── self-check ──────────────────────────────────────────────────────────────

function demo() {
  const ok = (c: boolean, msg: string) => { if (!c) throw new Error(msg); };
  const close = (x: number, y: number, tol = 1e-6) => Math.abs(x - y) < tol;

  // chart round-trips
  for (const hex of ['#000000', '#ffffff', '#ff0000', '#3b7dd8', '#7f7f7f'])
    ok(toHex(fromHex(hex)) === hex, `round-trip ${hex} -> ${toHex(fromHex(hex))}`);
  ok(close(fromHex('#ffffff')[0], 100, 1e-3), 'white is L=100');
  ok(Math.hypot(...fromHex('#7f7f7f').slice(1)) < 1e-3, 'gray is achromatic');

  // f: concave, subadditive, identity in the small
  ok(close(perceive(1e-4), 1e-4, 1e-8), "f'(0) = 1");
  ok(perceive(2 * 30) < 2 * perceive(30), 'diminishing returns');
  ok(close(perceive(30) / perceive(15), 1.6252, 1e-3), 'paper ratio at ΔL*=15/30'); // additive would be 2
  for (let s = 0; s < 100; s += 7) ok(perceive(s + 5) + perceive(5) >= perceive(s + 10) - 1e-9, 'subadditive');
  ok(close(unperceive(perceive(42)), 42, 1e-9), 'f invertible');

  // g: SPD, reduces to Euclidean, weights do what they say
  const p: Vec3 = [50, 20, 0]; // chroma 20, hue 0 => +a is radial, +b is tangential
  const gw = weighted(3, 1, 2);
  ok(close(segLength(p, [51, 20, 0], gw), 3), 'wL scales lightness');
  ok(close(segLength(p, [50, 21, 0], gw), 1), 'wC scales chroma');
  ok(close(segLength(p, [50, 20, 1], gw), 2, 1e-3), 'wH scales hue');
  ok(close(segLength(p, [51, 21, 1], weighted()), segLength(p, [51, 21, 1], EUCLIDEAN)), 'unit weights = Euclidean');
  ok(quad(weighted(2, 3, 4)([50, 0, 0]), [1, 1, 1]) > 0, 'SPD on the neutral axis');

  // D is still a metric even though it is not intrinsic
  const pts: Vec3[] = [[20, 10, -30], [70, -40, 50], [50, 0, 0], [90, 5, 5]];
  for (const a of pts) for (const b of pts) for (const c of pts)
    ok(delta(a, c) <= delta(a, b) + delta(b, c) + 1e-9, 'triangle inequality');
  ok(delta([20, 0, 0], [80, 0, 0]) < arcLength([[20, 0, 0], [80, 0, 0]]), 'D underestimates arc length');

  // gamut
  const wild: Vec3 = [50, 90, 40];
  ok(!inGamut(wild) && inGamut(toGamut(wild)), 'toGamut lands in gamut');
  ok(close(toLCh(toGamut(wild))[2], toLCh(wild)[2], 1e-6), 'toGamut preserves hue');
  ok(gamutPenalty(fromHex('#3b7dd8')) === 0 && gamutPenalty(wild) > 0, 'penalty is zero iff in gamut');

  // palettes
  const ramp = resample(Array.from({ length: 65 }, (_, i) => lerp(fromHex('#001133'), fromHex('#ffdd00'), i / 64)), 9);
  const gaps = ramp.slice(1).map((q, i) => segLength(ramp[i], q));
  ok(Math.max(...gaps) - Math.min(...gaps) < 1e-6, 'resample is evenly spaced');
  ok(minSeparation([fromHex('#ff0000'), fromHex('#00ff00'), fromHex('#0000ff')]) > 20, 'RGB primaries separate');

  // CVD is a projection: severity 0 is a no-op, and projecting twice changes nothing
  const red = fromHex('#d62728'), green = fromHex('#2ca02c'), blue = fromHex('#1f77b4'), orange = fromHex('#ff7f0e');
  ok(delta(simulate('deutan', 0)(red), red) < 1e-4, 'severity 0 is identity'); // chart round-trip float error
  const deu = simulate('deutan');
  ok(delta(deu(deu(red)), deu(red)) < 0.5, 'simulation is idempotent');
  ok(delta(deu(red), deu(green)) < 0.4 * delta(red, green), 'red/green collapses for a deutan');
  ok(delta(deu(blue), deu(orange)) > 0.8 * delta(blue, orange), 'blue/orange survives');
  ok(minSeparation([red, green, blue], EUCLIDEAN, ALL_VIEWS) < minSeparation([red, green, blue]), 'CVD views cap the score');
  ok(distortion([blue, orange], deu) < distortion([red, green], deu), 'blue/orange warps less');

  // spline interpolates its controls and obstacles are balls in perceived units
  const ctrl: Vec3[] = [fromHex('#1b2a6b'), fromHex('#3aa6a0'), fromHex('#f2e85c')];
  const curve = spline(ctrl);
  ok(ctrl.every((c) => Math.min(...curve.map((q) => dist(c, q))) < 1e-6), 'spline hits every control point');
  ok(arcLength(curve) >= arcLength(ctrl) - 1e-9, 'curving is never shorter than the polyline');
  ok(resample(spline([ctrl[0], ctrl[2]]), 5).length === 5, 'two controls give a straight span');
  const ball = { c: fromHex('#7f7f7f'), r: 10 };
  ok(obstaclePenalty(ball.c, [ball]) === 100 && obstaclePenalty(fromHex('#ff0000'), [ball]) === 0, 'obstacle penalty');
  ok(close(delta(ball.c, [ball.c[0] + unperceive(ball.r), ball.c[1], ball.c[2]]), ball.r, 1e-6), 'radius is perceived units');

  // every gamut's white is the chart's white, and the gamuts nest as documented
  for (const k of Object.keys(GAMUTS)) {
    const w = fromLinear([1, 1, 1], k);
    ok(close(w[0], 100, 1e-9) && Math.hypot(w[1], w[2]) < 1e-9, `${k} white is [100,0,0]`);
    ok(inGamut(fromHex('#7f3f9f'), k), `sRGB colours are inside ${k}`);
  }
  for (const k of ['display-p3', 'a98-rgb', 'rec2020', 'prophoto-rgb', 'acescg'])
    ok([[1, 0, 0], [0, 1, 0], [0, 0, 1]].every((c) => inGamut(fromLinear(c as Vec3, 'srgb'), k)), `sRGB fits in ${k}`);
  ok(!inGamut(fromLinear([0, 1, 0], 'srgb'), 'ntsc1953'), 'sRGB green is too bright for NTSC 1953');
  // wide gamuts are not a chain: P3's red sits outside Rec.2020's red-green edge
  ok(!inGamut(fromLinear([1, 0, 0], 'display-p3'), 'srgb'), 'P3 red is outside sRGB');
  ok(!inGamut(fromLinear([1, 0, 0], 'display-p3'), 'rec2020'), 'P3 red is outside Rec.2020 too');
  ok(!inGamut(fromLinear([0, 1, 0], 'rec2020'), 'display-p3'), 'Rec.2020 green is outside P3');
  ok(gamutPenalty(fromLinear([1, 0, 0], 'rec2020')) > 0, 'penalty follows the active gamut');

  // every space round-trips, and the neutral axis is neutral in each of them
  for (const [k, sp] of Object.entries(SPACES)) {
    for (const h of ['#000000', '#3f8f8a', '#d62728', '#ffffff', '#7f7f7f']) {
      const q = fromHex(h);
      ok(Math.max(...fromSpace(toSpace(q, k), k).map((v, i) => Math.abs(v - q[i]))) < 1e-6, `${k} round-trips ${h}`);
    }
    const e = spaceExtent(k, 'srgb');
    ok(e.lo.every(Number.isFinite) && e.hi.every((v, i) => v > e.lo[i]), `${k} has a finite extent`);
    if (['oklab', 'cielab', 'cieluv', 'ipt'].includes(k)) {
      const g2 = toSpace(fromHex('#7f7f7f'), k);
      ok(Math.hypot(g2[1], g2[2]) < 1e-6, `grey is achromatic in ${k}`);
      ok(close(toSpace(fromHex('#ffffff'), k)[0], 100, 1e-6), `white is 100 in ${k}`);
    }
  }
  // the chart carries the geometry, so the DEFAULT metric never moves a distance
  const [p1, p2] = [fromHex('#22285e'), fromHex('#f0e05a')];
  const d0 = delta(p1, p2);
  for (const k of Object.keys(SPACES)) { params.space = k; ok(close(delta(p1, p2), d0, 1e-12), `delta is chart-independent (${k})`); }
  // ...and asking for a space's own metric is opt-in, calibrated on the neutral axis
  for (const k of Object.keys(SPACES)) {
    const g2 = spaceMetric(k);
    const axis = Array.from({ length: 65 }, (_, i) => [(i * 100) / 64, 0, 0] as Vec3);
    ok(close(arcLength(axis, g2), 100, 0.5), `${k} metric is neutral-calibrated`);
    const m = g2([50, 0, 0]);
    ok(quad(m, [1, 2, -3]) > 0 && close(m[0][1], m[1][0], 1e-9), `${k} metric is symmetric positive`);
  }
  ok(spaceMetric('oklab') === EUCLIDEAN, 'the chart is its own space');
  params.space = 'oklab';

  console.log('ok — white→black arc length', arcLength([fromHex('#000000'), fromHex('#ffffff')]).toFixed(1),
    '/ perceived', delta(fromHex('#000000'), fromHex('#ffffff')).toFixed(1));
  console.log('   min separation  R/G/B:', minSeparation([red, green, blue]).toFixed(1),
    '→ under CVD:', minSeparation([red, green, blue], EUCLIDEAN, ALL_VIEWS).toFixed(1));
  console.log('   min separation  B/O/gray:', minSeparation([blue, orange, fromHex('#7f7f7f')]).toFixed(1),
    '→ under CVD:', minSeparation([blue, orange, fromHex('#7f7f7f')], EUCLIDEAN, ALL_VIEWS).toFixed(1));
}

// Browsers have no `process`; this file is imported by the visualizer as-is.
if (typeof process !== 'undefined' && import.meta.filename === process.argv[1]) demo();
