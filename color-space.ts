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
   * Paper Eq. 18 with Δψ normalized to [0,1] over ψ ∈ [0,100] and the fit
   * a = 5.34, b = 2.34, renormalized below so f'(0) = 1.
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
 * functions. A gamma curve is a monotone per-channel reparametrization of that
 * same cube, so it moves no boundary and changes no answer to "is this color
 * reachable". Primaries and white point are the whole story.
 *
 * Classical: NTSC 1953 (never actually built, phosphors could not reach it),
 * sRGB/Rec.709, Adobe RGB 1998 (opened up the cyan-green corner for print).
 * Modern: Display P3 (the DCI cinema primaries on a D65 white — what recent
 * phones and laptops ship), Rec.2020 (UHD, primaries on the spectral locus),
 * ProPhoto and ACEScg AP1, both of which use *imaginary* primaries outside the
 * locus so the encodable set can contain every real color.
 */
export type Gamut = { name: string; p: [number, number][]; w: [number, number] };

/**
 * A gamut from an ICC profile.
 *
 * Only matrix/TRC RGB profiles reduce to primaries: the rXYZ, gXYZ and bXYZ
 * colorant tags ARE the primaries, already adapted to the PCS illuminant, so
 * the chromaticities fall straight out and build() adapts from there. A
 * LUT-based profile (most printer and CMYK profiles) has no such matrix and is
 * refused rather than approximated.
 *
 * Everything is big-endian; XYZ numbers are s15Fixed16.
 */
export function gamutFromICC(buf: ArrayBuffer, fallback = 'ICC profile'): Gamut {
  const d = new DataView(buf);
  const str = (o: number, n: number) =>
    Array.from({ length: n }, (_, i) => String.fromCharCode(d.getUint8(o + i))).join('');
  if (buf.byteLength < 132 || str(36, 4) !== 'acsp') throw new Error('not an ICC profile');
  if (str(16, 4) !== 'RGB ') throw new Error(`profile is ${str(16, 4).trim()}, not RGB`);

  const tags: Record<string, number> = {};
  const n = d.getUint32(128);
  if (132 + 12 * n > buf.byteLength) throw new Error('tag table runs past the end of the file');
  for (let i = 0; i < n; i++) tags[str(132 + 12 * i, 4)] = d.getUint32(132 + 12 * i + 4);

  const xyz = (t: string): Vec3 => {
    const off = tags[t];
    if (off === undefined) throw new Error(`no ${t} tag: not a matrix/TRC profile`);
    if (str(off, 4) !== 'XYZ ') throw new Error(`${t} is not an XYZType`);
    return [0, 1, 2].map((i) => d.getInt32(off + 8 + 4 * i) / 65536) as Vec3;
  };
  const xy = (v: Vec3): [number, number] => {
    const sum = v[0] + v[1] + v[2];
    if (!(Math.abs(sum) > 1e-9)) throw new Error('degenerate colorant in the profile');
    return [v[0] / sum, v[1] / sum];
  };

  /**
   * The colorants are stored adapted to the PCS illuminant, which is D50, and
   * the matrix that got them there is the `chad` tag. Reading them as-is
   * describes a gamut under the wrong white: against the built-in primaries
   * that was 10 to 16 chart units out at the cube corners, which is many JNDs.
   * Undo it, and the profile's own white is where D50 came from.
   */
  const chad = tags.chad;
  let un = (v: Vec3) => v;
  let white = xyz('wtpt');
  if (chad !== undefined && str(chad, 4) === 'sf32') {
    const m = [0, 1, 2].map((r) => [0, 1, 2].map((c) => d.getInt32(chad + 8 + 4 * (3 * r + c)) / 65536)) as M3;
    const mi = inv3(m);
    un = (v: Vec3) => apply(mi, v);
    white = un([0.9642, 1.0, 0.8249]);           // PCS D50, back through the adaptation
  }

  // 'desc' is a textDescriptionType in v2 and an mluc in v4; both start with a
  // count, and neither is worth a full parser just to title a menu entry
  let name = fallback;
  const dsc = tags.desc;
  if (dsc !== undefined) {
    if (str(dsc, 4) === 'desc') name = str(dsc + 12, Math.max(0, d.getUint32(dsc + 8) - 1)) || fallback;
    else if (str(dsc, 4) === 'mluc') {
      const len = d.getUint32(dsc + 20), off = d.getUint32(dsc + 24);
      name = Array.from({ length: len / 2 }, (_, i) => String.fromCharCode(d.getUint16(dsc + off + 2 * i))).join('');
    }
  }
  return {
    name: name.replace(/\0+$/, '').trim() || fallback,
    p: [xy(un(xyz('rXYZ'))), xy(un(xyz('gXYZ'))), xy(un(xyz('bXYZ')))],
    w: xy(white),
  };
}

export const GAMUTS: Record<string, Gamut> = {
  srgb: { name: 'sRGB / Rec.709', p: [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]], w: [0.3127, 0.329] },
  'display-p3': { name: 'Display P3', p: [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]], w: [0.3127, 0.329] },
  'a98-rgb': { name: 'Adobe RGB 1998', p: [[0.64, 0.33], [0.21, 0.71], [0.15, 0.06]], w: [0.3127, 0.329] },
  rec2020: { name: 'Rec. 2020', p: [[0.708, 0.292], [0.17, 0.797], [0.131, 0.046]], w: [0.3127, 0.329] },
  'prophoto-rgb': { name: 'ProPhoto RGB', p: [[0.734699, 0.265301], [0.159597, 0.840403], [0.036598, 0.000105]], w: [0.345704, 0.35854] },
  acescg: { name: 'ACEScg (AP1)', p: [[0.713, 0.293], [0.165, 0.83], [0.128, 0.044]], w: [0.32168, 0.33767] },
  ntsc1953: { name: 'NTSC 1953', p: [[0.67, 0.33], [0.21, 0.71], [0.14, 0.08]], w: [0.31, 0.316] },
};

/**
 * The spectral locus in CIE 1931 xy, for the chromaticity diagram.
 *
 * Chromaticities of the monochromatic stimuli from 360 to 700 nm, from the
 * CIE 1931 2 degree observer's colour matching functions as published by CVRL,
 * cross-checked against colour-science's copy at every shared wavelength (they
 * agree exactly). Sampled at 5 nm and pruned of points closer than 3e-4 in xy,
 * which drops the tail above 700 nm where the locus has collapsed to a point.
 *
 * xy rather than the functions themselves: the diagram needs the boundary and
 * nothing else, and every colour inside it comes from the gamut matrices.
 * Closing the polygon from the last point to the first IS the line of purples,
 * which is a chord and not a spectral colour.
 */
export const SPECTRAL_LOCUS: [number, number][] = [
  [0.1756,0.0053], [0.1752,0.0053], [0.1748,0.0052], [0.1741,0.0050], [0.1736,0.0049],
  [0.1730,0.0048], [0.1726,0.0048], [0.1721,0.0048], [0.1714,0.0051], [0.1703,0.0058],
  [0.1689,0.0069], [0.1669,0.0086], [0.1644,0.0109], [0.1611,0.0138], [0.1566,0.0177],
  [0.1510,0.0227], [0.1440,0.0297], [0.1355,0.0399], [0.1241,0.0578], [0.1096,0.0868],
  [0.0913,0.1327], [0.0687,0.2007], [0.0454,0.2950], [0.0235,0.4127], [0.0082,0.5384],
  [0.0039,0.6548], [0.0139,0.7502], [0.0389,0.8120], [0.0743,0.8338], [0.1142,0.8262],
  [0.1547,0.8059], [0.1929,0.7816], [0.2296,0.7543], [0.2658,0.7243], [0.3016,0.6923],
  [0.3374,0.6588], [0.3731,0.6245], [0.4087,0.5896], [0.4441,0.5547], [0.4788,0.5202],
  [0.5125,0.4866], [0.5448,0.4544], [0.5752,0.4242], [0.6029,0.3965], [0.6270,0.3725],
  [0.6482,0.3514], [0.6658,0.3340], [0.6801,0.3197], [0.6915,0.3083], [0.7006,0.2993],
  [0.7079,0.2920], [0.7140,0.2859], [0.7190,0.2809], [0.7230,0.2769], [0.7260,0.2740],
  [0.7283,0.2717], [0.7300,0.2700], [0.7311,0.2689], [0.7320,0.2680], [0.7327,0.2673],
  [0.7334,0.2666], [0.7340,0.2660], [0.7344,0.2656], [0.7347,0.2653],
];

const XYZ_OF = ([x, y]: [number, number]): Vec3 => [x / y, 1, (1 - x - y) / y];
const BRADFORD: M3 = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];

// Adapt to the white the CHART itself considers neutral, recovered by asking it,
// rather than to a hand-typed D65. Oklab was fit to a particular D65 and a
// rounded (0.3127, 0.3290) is not quite that one — close enough to look right
// and not close enough to leave gray achromatic. This way every gamut's white
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

/**
 * The tolerance absorbs round-trip float error and nothing else. Measured over
 * the cube surface that error peaks at 5e-15, so this is still a billion times
 * larger than it needs to be — and it has to stay small, because the test is
 * absolute while the channels are not. Near black every channel is ~1e-5, so a
 * loose tolerance stops being a rounding allowance and starts reporting plainly
 * negative colors as reachable: at L=2 an eps of 1e-4 claimed chroma 12 was in
 * gamut, on channels of (-9.7e-5, 7.4e-5, -5.5e-5). The slices drew it, the
 * solid could not enclose it, and the two disagreed at the bottom.
 */
export const inGamut = (p: Vec3, g = params.gamut, eps = 1e-9) =>
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
  obs.reduce((acc, o) => acc + Math.max(0, o.r - lineDelta(v(p), v(o.c), g)) ** 2, 0);

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

/**
 * The raw pieces of the model, exported so a GPU port evaluates the SAME
 * numbers rather than a transcribed copy of them. The algorithms unavoidably
 * exist twice — once here, once in GLSL — but the constants must not, or the
 * two drift and the drift is invisible until a gamut edge moves.
 * Nothing outside a shader should reach in here.
 */
export const internals = {
  LMS_XYZ, LAB_LMS, XYZ_LMS, LMS_LAB,
  get CHART_WHITE() { return CHART_WHITE; },
  get IPT() { return { LMS: IPT_LMS, OPP: IPT_OPP, LMS_I: IPT_LMS_I, OPP_I: IPT_OPP_I, W: IPT_W }; },
  cvdMatrix,
  get CAM() { return CAM; },
  get ICTCP() { return { LMS: ICTCP_LMS, LMS_I: ICTCP_LMS_I, OPP: ICTCP_OPP, OPP_I: ICTCP_OPP_I, K: ICTCP_K, PQ }; },
  rgbFromXYZ: (g = params.gamut) => mats(g).from,
  xyzFromRGB: (g = params.gamut) => mats(g).to,
};

// ─── working spaces ──────────────────────────────────────────────────────────

/**
 * Coordinates to view and edit in. Changing space is a CHANGE OF CHART, not a
 * change of geometry: points are stored in the chart above, so every distance,
 * every spline and every metric below is untouched by what you are looking at.
 * A palette must not silently change because you switched to CIELAB.
 *
 * Listed newest first, which is the order the dropdown shows and the reverse of
 * the Spaces dialog's. Oklab leads either way, being both the newest and the
 * chart itself.
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
export type Space = { name: string; axes: [string, string, string];
  from: (xyz: Vec3) => Vec3; to: (c: Vec3) => Vec3;
  /** what the METRIC differentiates, when that is not the space's own map */
  metricFrom?: (xyz: Vec3) => Vec3;
  /** quadratic form on differences IN THIS SPACE, when it is not the identity */
  form?: (c: Vec3) => Mat3 };

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
// Normalize cone response to the chart's white, exactly as the gamuts are
// adapted. Published IPT is keyed to a D65 a hair off Oklab's, and left alone
// that put gray 0.04 off the neutral axis — small, and wrong in the one place
// this tool cannot afford to be: the axis every lightness question hangs on.
const IPT_W = apply(IPT_LMS, CHART_WHITE);

// ─── ICtCp (BT.2100) ─────────────────────────────────────────────────────────
const ICTCP_LMS: M3 = [[0.3592, 0.6976, -0.0358], [-0.1922, 1.1004, 0.0755], [0.0070, 0.0749, 0.8434]];
const ICTCP_OPP: M3 = [[0.5, 0.5, 0],
  [1.61376953125, -3.323486328125, 1.709716796875],
  [4.378173828125, -4.24560546875, -0.132568359375]];
const ICTCP_LMS_I = inv3(ICTCP_LMS), ICTCP_OPP_I = inv3(ICTCP_OPP);
// ST 2084. Exact rationals, so pq(0) = 0 and pq(1) = 1 hold to float precision.
const PQ = { m1: 2610 / 16384, m2: (2523 / 4096) * 128, c1: 3424 / 4096, c2: (2413 / 4096) * 32, c3: (2392 / 4096) * 32 };
const pq = (v: number): number => {
  const y = Math.max(0, v) ** PQ.m1;
  return ((PQ.c1 + PQ.c2 * y) / (1 + PQ.c3 * y)) ** PQ.m2;
};
const pqi = (e: number): number => {
  const p = Math.max(0, e) ** (1 / PQ.m2);
  return (Math.max(0, p - PQ.c1) / (PQ.c2 - PQ.c3 * p)) ** (1 / PQ.m1);
};
const ictcpRaw = (xyz: Vec3): Vec3 => apply(ICTCP_OPP, apply(ICTCP_LMS, xyz).map((v) => pq(v / 100)) as Vec3);
const ictcpRawI = (c: Vec3): Vec3 => apply(ICTCP_LMS_I, apply(ICTCP_OPP_I, c).map((v) => pqi(v) * 100) as Vec3);
/** so I reads 100 at white, like the L of every other space here */
const ICTCP_K = 100 / ictcpRaw(CHART_WHITE)[0];

// ─── CIECAM02, average surround ──────────────────────────────────────────────
// The viewing conditions the CAM02-UCS fit was made under, so they are the ones
// that make its Euclidean distance mean what the paper says it means.
const CAM = (() => {
  const CAT02: M3 = [[0.7328, 0.4296, -0.1624], [-0.7036, 1.6975, 0.0061], [0.0030, 0.0136, 0.9834]];
  const HPE: M3 = [[0.38971, 0.68898, -0.07868], [-0.22981, 1.18340, 0.04641], [0, 0, 1]];
  const LA = 64 / Math.PI / 5, Yb = 20, F = 1, c = 0.69, Nc = 1;
  const Yw = CHART_WHITE[1] * 100;
  const n = Yb / Yw, z = 1.48 + Math.sqrt(n);
  const Nbb = 0.725 * (1 / n) ** 0.2, Ncb = Nbb;
  const k = 1 / (5 * LA + 1);
  const FL = 0.2 * k ** 4 * (5 * LA) + 0.1 * (1 - k ** 4) ** 2 * (5 * LA) ** (1 / 3);
  const rgbW = apply(CAT02, CHART_WHITE.map((v) => v * 100) as Vec3);
  const D = Math.max(0, Math.min(1, F * (1 - (1 / 3.6) * Math.exp((-LA - 42) / 92))));
  const Dr = rgbW.map((v) => D * (Yw / v) + 1 - D) as Vec3;
  const adapt = (xyz: Vec3): Vec3 => {
    const r = apply(CAT02, xyz.map((v) => v * 100) as Vec3).map((v, i) => v * Dr[i]) as Vec3;
    return apply(HPE, apply(inv3(CAT02), r));
  };
  const nl = (v: number) => {
    const t = ((FL * Math.abs(v)) / 100) ** 0.42;
    return Math.sign(v) * ((400 * t) / (27.13 + t)) + 0.1;
  };
  const nli = (v: number) => {
    const d = v - 0.1, t = (27.13 * Math.abs(d)) / (400 - Math.abs(d));
    return Math.sign(d) * (100 / FL) * t ** (1 / 0.42);
  };
  const Aw = (2 * nl(apply(HPE, apply(inv3(CAT02), apply(CAT02, CHART_WHITE.map((v) => v * 100) as Vec3)
    .map((v, i) => v * Dr[i]) as Vec3))[0]) + nl(apply(HPE, apply(inv3(CAT02),
    apply(CAT02, CHART_WHITE.map((v) => v * 100) as Vec3).map((v, i) => v * Dr[i]) as Vec3))[1]) / 20
    + nl(apply(HPE, apply(inv3(CAT02), apply(CAT02, CHART_WHITE.map((v) => v * 100) as Vec3)
      .map((v, i) => v * Dr[i]) as Vec3))[2]) / 20 - 0.305) * Nbb;
  const D2 = (d: Vec3): M3 => [[d[0], 0, 0], [0, d[1], 0], [0, 0, d[2]]];
  const FWD = mm(HPE, mm(inv3(CAT02), mm(D2(Dr), CAT02)));      // xyz*100 -> hpe cone space
  const BACK = inv3(FWD);
  return { CAT02, HPE, adapt, nl, nli, Aw, Nbb, Ncb, c, Nc, z, n, FL, Dr, Yw, FWD, BACK };
})();

function cam02Forward(xyz: Vec3): { J: number; M: number; h: number } {
  const [ra, ga, ba] = CAM.adapt(xyz).map(CAM.nl);
  const a = ra - (12 * ga) / 11 + ba / 11;
  const b = (ra + ga - 2 * ba) / 9;
  const h = (((Math.atan2(b, a) * 180) / Math.PI) + 360) % 360;
  const A = (2 * ra + ga + ba / 20 - 0.305) * CAM.Nbb;
  const J = 100 * (A / CAM.Aw) ** (CAM.c * CAM.z);
  const hr = (h * Math.PI) / 180;
  const et = 0.25 * (Math.cos(hr + 2) + 3.8);
  const t = ((50000 / 13) * CAM.Nc * CAM.Ncb * et * Math.hypot(a, b)) / (ra + ga + (21 * ba) / 20);
  const C = t ** 0.9 * Math.sqrt(J / 100) * (1.64 - 0.29 ** CAM.n) ** 0.73;
  return { J, M: C * CAM.FL ** 0.25, h };
}

function cam02Inverse(J: number, M: number, h: number): Vec3 {
  const C = M / CAM.FL ** 0.25;
  const hr = (h * Math.PI) / 180;
  const et = 0.25 * (Math.cos(hr + 2) + 3.8);
  const t = J <= 0 ? 0 : (C / (Math.sqrt(J / 100) * (1.64 - 0.29 ** CAM.n) ** 0.73)) ** (1 / 0.9);
  const A = CAM.Aw * (J / 100) ** (1 / (CAM.c * CAM.z));
  const p1 = t === 0 ? 0 : ((50000 / 13) * CAM.Nc * CAM.Ncb * et) / t;
  const p2 = A / CAM.Nbb + 0.305;
  let a = 0, b = 0;
  if (t !== 0) {
    if (Math.abs(Math.sin(hr)) >= Math.abs(Math.cos(hr))) {
      const p4 = p1 / Math.sin(hr);
      b = (p2 * (2 + 21 / 20) * (460 / 1403))
        / (p4 + (2 + 21 / 20) * (220 / 1403) * (Math.cos(hr) / Math.sin(hr)) - (27 / 1403) + (21 / 20) * (6300 / 1403));
      a = b * (Math.cos(hr) / Math.sin(hr));
    } else {
      const p5 = p1 / Math.cos(hr);
      a = (p2 * (2 + 21 / 20) * (460 / 1403))
        / (p5 + (2 + 21 / 20) * (220 / 1403) - ((27 / 1403) - (21 / 20) * (6300 / 1403)) * (Math.sin(hr) / Math.cos(hr)));
      b = a * (Math.sin(hr) / Math.cos(hr));
    }
  }
  const ra = (460 * p2 + 451 * a + 288 * b) / 1403;
  const ga = (460 * p2 - 891 * a - 261 * b) / 1403;
  const ba = (460 * p2 - 220 * a - 6300 * b) / 1403;
  const hp = [ra, ga, ba].map(CAM.nli) as Vec3;
  const r = apply(CAM.CAT02, apply(inv3(CAM.HPE), hp)).map((v, i) => v / CAM.Dr[i]) as Vec3;
  return apply(inv3(CAM.CAT02), r).map((v) => v / 100) as Vec3;
}

const rgb01 = (xyz: Vec3): Vec3 => apply(mats('srgb').from, xyz).map(enc) as Vec3;
const unrgb01 = (c: Vec3): Vec3 => apply(mats('srgb').to, c.map(dec) as Vec3);

/**
 * CIEDE2000 (CIE 142:2001) as a metric, which is what its line element is.
 *
 * The formula weights a difference already expressed in CIELAB, so it is not a
 * space to convert into. Written for two colors it is
 *
 *   dE00^2 = (dL/SL)^2 + (dC'/SC)^2 + (dH'/SH)^2 + RT (dC'/SC)(dH'/SH)
 *
 * which for a SMALL difference is a quadratic form on (dL, dC', C' dh'): the
 * three weights and the rotation term are functions of the point, and dH'
 * -> C' dh' as the pair closes up. That is a metric tensor, so it drops
 * straight into the same machinery as every other space here.
 *
 * Two details are what make it a form rather than a distance function. The
 * a-axis stretch a' = a(1+G) uses the MEAN chroma of the pair, which in the
 * limit is the chroma at the point, so it is the constant 1+G on da. And RT is
 * a genuine cross term between chroma and hue -- the reason dE00 cannot be
 * written as J'J for any map, and the reason this needs `form` at all.
 *
 * Positive definite everywhere: the 2x2 chroma-hue block has determinant
 * (1 - RT^2/4)/(SC SH)^2, and |RT| <= 2 sin(60 deg) = 1.73 by construction.
 */
const P25_7 = 25 ** 7;
const DEG = Math.PI / 180;

export const de2000Form = ([L, a, b]: Vec3): Mat3 => {
  const C7 = Math.hypot(a, b) ** 7;
  const G = 0.5 * (1 - Math.sqrt(C7 / (C7 + P25_7)));
  const k = 1 + G, ap = a * k;                         // the a-axis stretch
  const Cp = Math.hypot(ap, b);
  const hp = Cp < 1e-12 ? 0 : Math.atan2(b, ap);
  const hd = ((hp / DEG) % 360 + 360) % 360;

  const dl = L - 50;
  const SL = 1 + (0.015 * dl * dl) / Math.sqrt(20 + dl * dl);
  const SC = 1 + 0.045 * Cp;
  const T = 1 - 0.17 * Math.cos((hd - 30) * DEG) + 0.24 * Math.cos(2 * hd * DEG)
              + 0.32 * Math.cos((3 * hd + 6) * DEG) - 0.2 * Math.cos((4 * hd - 63) * DEG);
  const SH = 1 + 0.015 * Cp * T;
  const Cp7 = Cp ** 7;
  const RT = -Math.sin(2 * (30 * Math.exp(-(((hd - 275) / 25) ** 2))) * DEG)
             * 2 * Math.sqrt(Cp7 / (Cp7 + P25_7));

  // (dL, da, db) -> (dL, dC', C' dh'): stretch a, then rotate by the hue angle
  const c = Math.cos(hp), sn = Math.sin(hp);
  const R: Mat3 = [[1, 0, 0], [0, k * c, sn], [0, -k * sn, c]];
  const x = RT / (2 * SC * SH);
  const M: Mat3 = [[1 / (SL * SL), 0, 0], [0, 1 / (SC * SC), x], [0, x, 1 / (SH * SH)]];
  // R' M R
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) =>
    [0, 1, 2].reduce((acc, u) => acc + [0, 1, 2].reduce(
      (t, v) => t + R[u][i] * M[u][v] * R[v][j], 0), 0))) as Mat3;
};

export const SPACES: Record<string, Space> = {
  oklab: { name: 'Oklab (2020)', axes: ['L', 'a', 'b'], from: fromXYZ, to: toXYZ },

  ictcp: {
    name: 'ICtCp (BT.2100)', axes: ['I', 'Ct', 'Cp'],
    from: (xyz) => ictcpRaw(xyz).map((v) => v * ICTCP_K) as Vec3,
    to: (c) => ictcpRawI(c.map((v) => v / ICTCP_K) as Vec3),
  },

  /**
   * CAM02-UCS (Luo, Cui & Li 2006) over CIECAM02, average surround, adapting
   * luminance 64/pi/5 and a 20% background — the conditions the UCS was fitted
   * under. J' a' b' rather than J C h, because the UCS is the form where a
   * Euclidean distance means something.
   */

  cam02: {
    name: 'CAM02-UCS (2006)', axes: ['J′', 'a′', 'b′'],
    from: (xyz) => {
      const { J, M, h } = cam02Forward(xyz);
      const Mp = Math.log(1 + 0.0228 * M) / 0.0228, hr = (h * Math.PI) / 180;
      return [(1.7 * J) / (1 + 0.007 * J), Mp * Math.cos(hr), Mp * Math.sin(hr)];
    },
    to: ([Jp, ap, bp]) => {
      const J = Jp / (1.7 - 0.007 * Jp);
      const Mp = Math.hypot(ap, bp);
      const M = (Math.exp(0.0228 * Mp) - 1) / 0.0228;
      return cam02Inverse(J, M, (Math.atan2(bp, ap) * 180) / Math.PI);
    },
    /**
     * The metric differentiates the UNCOMPRESSED colourfulness.
     *
     * CAM02-UCS is defined with M' = ln(1 + 0.0228 M)/0.0228 — a logarithmic
     * compression of colourfulness in exactly the form of f, with s0 = 1/0.0228
     * = 43.9. Luo, Cui and Li applied diminishing returns to the chroma axis in
     * 2006. Pulling a metric back through that and then handing the arc length
     * to f compresses chroma twice and lightness once, which distorts the model
     * rather than reporting a property of the space.
     *
     * So the view keeps M', which is what CAM02-UCS is, and the metric uses M.
     */
    metricFrom: (xyz) => {
      const { J, M, h } = cam02Forward(xyz), hr = (h * Math.PI) / 180;
      return [(1.7 * J) / (1 + 0.007 * J), M * Math.cos(hr), M * Math.sin(hr)];
    },
  },

  de2000: {
    name: 'CIEDE2000 (2001)', axes: ['L*', 'a*', 'b*'],
    from: (xyz) => SPACES.cielab.from(xyz),
    to: (c) => SPACES.cielab.to(c),
    form: de2000Form,
  },

  ipt: {
    name: 'IPT (1998)', axes: ['I', 'P', 'T'],
    from: (xyz) => apply(IPT_OPP, apply(IPT_LMS, xyz).map((v, i) => spow(v / IPT_W[i], 0.43)) as Vec3).map((v) => v * 100) as Vec3,
    to: (c) => apply(IPT_LMS_I, apply(IPT_OPP_I, c.map((v) => v / 100) as Vec3).map((v, i) => spow(v, 1 / 0.43) * IPT_W[i]) as Vec3),
  },

  /**
   * ICtCp (ITU-R BT.2100). LMS crosstalk, the ST 2084 PQ curve, then an
   * opponent matrix. PQ is absolute, so the chart's Y = 1 is taken as 100 nits
   * of the 10000 the curve spans; that choice only scales I, and the chart is
   * relative colorimetry, which has no absolute level to offer.
   */

  srgb: {
    name: 'sRGB cube', axes: ['R', 'G', 'B'],
    from: (xyz) => rgb01(xyz).map((v) => v * 100) as Vec3,
    to: (c) => unrgb01(c.map((v) => v / 100) as Vec3),
  },

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

  xyz: {
    name: 'CIE XYZ (1931)', axes: ['X', 'Y', 'Z'],
    from: (xyz) => xyz.map((v) => v * 100) as Vec3,
    to: (c) => c.map((v) => v / 100) as Vec3,
  },

};

/** chart ↔ the active working space */
/**
 * Chart <-> working space. A space defined AS the chart round-trips through
 * XYZ to arrive back where it started: two matrix products and a cube each
 * way, provably the identity. Oklab is that space and it is the default, and
 * the trajectory optimizer runs this over every curve sample of every
 * perturbation, so the round trip was most of a gradient step. Detect it by
 * the conversion being the chart's own and copy instead; the copy rather than
 * the argument itself so a caller can still treat the result as its own.
 */
export const toSpace = (p: Vec3, k = params.space): Vec3 =>
  (SPACES[k].from === fromXYZ ? [p[0], p[1], p[2]] : SPACES[k].from(toXYZ(p))) as Vec3;
export const fromSpace = (c: Vec3, k = params.space): Vec3 =>
  (SPACES[k].to === toXYZ ? [c[0], c[1], c[2]] : fromXYZ(SPACES[k].to(c))) as Vec3;

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
      // cube, not a gamma: Oklab L goes as the cube root of intensity, so this
      // is what samples the surface at even lightness rather than crowding the
      // bright half and missing the dark end entirely
      const c: number[] = []; c[u] = (i / N) ** 3; c[v] = (j / N) ** 3; c[w] = f;
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
/** the map the metric differentiates, which is the space's own unless it names another */
const metricSpace = (p: Vec3, k: string): Vec3 => {
  const f = SPACES[k].metricFrom;
  return f ? f(toXYZ(p)) : toSpace(p, k);
};

const NEUTRAL_SCALE: Record<string, number> = {};
function neutralScale(k: string): number {
  if (NEUTRAL_SCALE[k] === undefined) {
    const form = SPACES[k].form;
    let len = 0;
    for (let i = 0; i < 128; i++) {
      const a = metricSpace([(i * 100) / 128, 0, 0], k), b = metricSpace([((i + 1) * 100) / 128, 0, 0], k);
      const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      // measured with the space's own form, so the gray axis is 100 under the
      // distance that space actually uses and not under a stand-in for it
      len += form ? Math.sqrt(quad(form(a.map((v, j) => (v + b[j]) / 2) as Vec3), d)) : Math.hypot(...d);
    }
    NEUTRAL_SCALE[k] = 100 / len;
  }
  return NEUTRAL_SCALE[k];
}

/**
 * ∂(XYZ)/∂(chart), the half of every Jacobian that does not depend on which
 * space is selected. toXYZ is XYZ_LMS · (LMS_LAB · p/100)³, so the derivative
 * is the same product with the cube replaced by 3l² down the diagonal.
 */
function dXyzDChart(p: Vec3): M3 {
  const l = apply(LMS_LAB, [p[0] / 100, p[1] / 100, p[2] / 100]);
  const d = l.map((v) => (3 * v * v) / 100);
  return mm(XYZ_LMS.map((r) => [r[0] * d[0], r[1] * d[1], r[2] * d[2]]), LMS_LAB);
}

const dLabf = (t: number) => (t > D ** 3 ? 1 / (3 * Math.cbrt(t) ** 2) : 1 / (3 * D * D));
const dEnc = (c: number) => (c <= 0.0031308 ? 12.92 : (1.055 / 2.4) * c ** (1 / 2.4 - 1));

/**
 * ∂(space)/∂(XYZ), for the spaces whose forward map differentiates by hand
 * without turning into CIECAM02. A space without an entry keeps the central
 * differences below, which cost six full conversions per point.
 */
const D_SPACE: Record<string, (xyz: Vec3) => M3> = {
  xyz: () => [[100, 0, 0], [0, 100, 0], [0, 0, 100]],

  srgb: (xyz) => {
    const m = mats('srgb').from, lin = apply(m, xyz), e = lin.map(dEnc);
    return m.map((r, i) => [100 * e[i] * r[0], 100 * e[i] * r[1], 100 * e[i] * r[2]]);
  },

  cielab: (xyz) => {
    // f' of each ratio, with the 1/Wn from the ratio itself folded in
    const [fx, fy, fz] = [0, 1, 2].map((i) => dLabf(xyz[i] / CHART_WHITE[i]) / CHART_WHITE[i]);
    return [[0, 116 * fy, 0], [500 * fx, -500 * fy, 0], [0, 200 * fy, -200 * fz]];
  },

  ipt: (xyz) => {
    const lms = apply(IPT_LMS, xyz);
    // spow(v, 0.43) has derivative 0.43|v|^-0.57 on both sides of zero and none
    // at it; the floor is the same one the gamut's own epsilon uses
    const d = lms.map((v, i) => (0.43 * Math.max(Math.abs(v / IPT_W[i]), 1e-9) ** (0.43 - 1)) / IPT_W[i]);
    return mm(IPT_OPP.map((r) => [100 * r[0] * d[0], 100 * r[1] * d[1], 100 * r[2] * d[2]]), IPT_LMS);
  },
};// CIEDE2000's coordinates ARE CIELAB's -- only the form on differences
// differs -- so it differentiates through the same analytic Jacobian.
D_SPACE.de2000 = D_SPACE.cielab;


export function spaceMetric(k = params.space): Metric {
  if (k === 'oklab') return EUCLIDEAN;                 // the chart is its own space
  const w = neutralScale(k) ** 2, h = 0.05;
  const form = SPACES[k].form;
  // g = w J' A J, for J the Jacobian into the space and A its form on
  // differences. A is the identity for every space whose own coordinates are
  // already what a difference is measured in, which is all of them but one.
  const gram = (col: Vec3[], A: Mat3 | null) => {
    const Ac = A ? col.map((v) => apply(A, v)) : col;
    return [0, 1, 2].map((i) => [0, 1, 2].map((j) =>
      w * (col[i][0] * Ac[j][0] + col[i][1] * Ac[j][1] + col[i][2] * Ac[j][2]))) as Mat3;
  };

  const dSpace = D_SPACE[k];
  if (dSpace) return (p) => {
    const J = mm(dSpace(toXYZ(p)), dXyzDChart(p));     // rows: space, columns: chart
    return gram([0, 1, 2].map((i) => [J[0][i], J[1][i], J[2][i]] as Vec3),
                form ? form(metricSpace(p, k)) : null);
  };

  return (p) => {
    const col: Vec3[] = [];
    for (let i = 0; i < 3; i++) {                      // central differences: J's columns
      const a = [...p] as Vec3, b = [...p] as Vec3;
      a[i] -= h; b[i] += h;
      const [sa, sb] = [metricSpace(a, k), metricSpace(b, k)];
      col.push(sb.map((v, j) => (v - sa[j]) / (2 * h)) as Vec3);
    }
    return gram(col, form ? form(metricSpace(p, k)) : null);
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
 * The shortest path between two colors under g, as a polyline.
 *
 * Straight line first, then relax the interior points by minimizing the
 * discrete energy sum (dx)' G (dx) with G taken at each segment's midpoint.
 * Setting the derivative at one point to zero gives it in closed form,
 *
 *   (Ga + Gb) x = Ga a + Gb b,
 *
 * so a sweep is one 3x3 solve per interior point rather than a search. Under a
 * constant metric Ga = Gb and the update is the plain midpoint, which leaves a
 * straight line straight — so the chart, where g is the identity, is untouched
 * and pays nothing.
 *
 * Energy rather than length for the step, because energy is the one with a
 * closed form. They do not share a minimizer here: the metric in the solve is
 * lagged a half-step behind the point it moves, so the fixed point is near the
 * shortest path rather than on it. Unguarded that produced paths up to 0.6%
 * LONGER than the straight line they started from, and more sweeps made some
 * of them worse. So each move is a proposal, kept only when the two segments
 * it joins actually get shorter, which makes a sweep monotone in total length
 * and the result never worse than the line.
 */
export function geodesic(p: Vec3, q: Vec3, g: Metric = EUCLIDEAN, n = 8, sweeps = 4): Vec3[] {
  const path = Array.from({ length: n + 1 }, (_, i) => lerp(p, q, i / n));
  if (g === EUCLIDEAN) return path;             // already the shortest one
  for (let s = 0; s < sweeps; s++)
    for (let i = 1; i < n; i++) {
      const a = path[i - 1], x = path[i], b = path[i + 1];
      const ga = g(lerp(a, x, 0.5)), gb = g(lerp(x, b, 0.5));
      const sum = ga.map((r, u) => r.map((v, w) => v + gb[u][w]));
      const y = apply(inv3(sum), [0, 1, 2].map((u) =>
        ga[u][0] * a[0] + ga[u][1] * a[1] + ga[u][2] * a[2]
        + gb[u][0] * b[0] + gb[u][1] * b[1] + gb[u][2] * b[2]) as Vec3);
      if (segLength(a, y, g) + segLength(y, b, g) < segLength(a, x, g) + segLength(x, b, g)) path[i] = y;
    }
  return path;
}

/**
 * Perceived difference between two colors — the non-Riemannian one.
 *
 * Along the geodesic, not the chord. CGF 2025 §4 wants it there specifically to
 * capture Bezold-Brücke: a straight line in the chart is the wrong path between
 * two colors of a hue-preserving ramp, and measuring along it overstates how
 * far apart they are. Under the chart's own metric the two coincide, so this
 * only bites once a working space or a weighted metric bends the geometry.
 */
export const delta = (p: Vec3, q: Vec3, g: Metric = EUCLIDEAN, n = 8): number =>
  perceive(arcLength(geodesic(p, q, g, n), g));

/**
 * The same thing along the straight line, for the inner loop.
 *
 * A geodesic costs about a hundred times a chord under a varying metric —
 * measured, 0.0018ms against 0.177ms in CIELAB — and obstaclePenalty runs once
 * per curve sample per perturbation, which at nine points is 193 x 54 per
 * gradient step. Paying for the exact path there turned 0.12ms into 30ms and
 * the step into a second and a half.
 *
 * So the keep-out radius is measured along the line and the panel reports along
 * the path. They differ by at most the 2% the two lengths differ by, and by
 * nothing at all in the chart, where the line IS the path.
 */
export const lineDelta = (p: Vec3, q: Vec3, g: Metric = EUCLIDEAN, n = 8): number =>
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

/**
 * Machado, Oliveira & Fernandes (2009), Table 1: one 3x3 per deficiency at
 * severities 0.0 to 1.0 in steps of 0.1, acting on LINEAR sRGB.
 *
 * This replaces Brettel/Vienot/Mollon, which is the better model of full
 * dichromacy but has no principled notion of a partial one — severity there
 * was a linear fade toward the projection, and most color vision deficiency is
 * anomalous trichromacy rather than dichromacy. Machado derives each severity
 * from a shift in the anomalous photopigment, so the table is the nonlinear
 * part and only the interpolation between its 0.1 steps is linear.
 *
 * Every row sums to 1, so white is preserved, and severity 0 is exactly the
 * identity. sRGB whatever the working gamut is, because that is what the
 * matrices were derived for -- and the shader already worked there, so the two
 * paths now agree where they used to differ.
 */
const MACHADO: Record<CVD, number[][]> = {
  protan: [
    [1, 0, -0, 0, 1, 0, -0, -0, 1],
    [0.856167, 0.182038, -0.038205, 0.029342, 0.955115, 0.015544, -0.00288, -0.001563, 1.00444],
    [0.734766, 0.334872, -0.069637, 0.05184, 0.919198, 0.028963, -0.004928, -0.004209, 1.00914],
    [0.630323, 0.465641, -0.095964, 0.069181, 0.890046, 0.040773, -0.006308, -0.007724, 1.01403],
    [0.539009, 0.579343, -0.118352, 0.082546, 0.866121, 0.051332, -0.007136, -0.011959, 1.0191],
    [0.458064, 0.679578, -0.137642, 0.092785, 0.846313, 0.060902, -0.007494, -0.016807, 1.0243],
    [0.38545, 0.769005, -0.154455, 0.100526, 0.829802, 0.069673, -0.007442, -0.02219, 1.02963],
    [0.319627, 0.849633, -0.169261, 0.106241, 0.815969, 0.07779, -0.007025, -0.028051, 1.03508],
    [0.259411, 0.923008, -0.18242, 0.110296, 0.80434, 0.085364, -0.006276, -0.034346, 1.04062],
    [0.203876, 0.990338, -0.194214, 0.112975, 0.794542, 0.092483, -0.005222, -0.041043, 1.04627],
    [0.152286, 1.05258, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.052],
  ],
  deutan: [
    [1, 0, -0, 0, 1, 0, -0, -0, 1],
    [0.866435, 0.177704, -0.044139, 0.049567, 0.939063, 0.01137, -0.003453, 0.007233, 0.99622],
    [0.760729, 0.319078, -0.079807, 0.090568, 0.889315, 0.020117, -0.006027, 0.013325, 0.992702],
    [0.675425, 0.43385, -0.109275, 0.125303, 0.847755, 0.026942, -0.00795, 0.018572, 0.989378],
    [0.605511, 0.52856, -0.134071, 0.155318, 0.812366, 0.032316, -0.009376, 0.023176, 0.9862],
    [0.547494, 0.607765, -0.155259, 0.181692, 0.781742, 0.036566, -0.01041, 0.027275, 0.983136],
    [0.498864, 0.674741, -0.173604, 0.205199, 0.754872, 0.039929, -0.011131, 0.030969, 0.980162],
    [0.457771, 0.731899, -0.18967, 0.226409, 0.731012, 0.042579, -0.011595, 0.034333, 0.977261],
    [0.422823, 0.781057, -0.203881, 0.245752, 0.709602, 0.044646, -0.011843, 0.037423, 0.974421],
    [0.392952, 0.82361, -0.216562, 0.263559, 0.69021, 0.046232, -0.01191, 0.040281, 0.97163],
    [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1, 0, -0, 0, 1, 0, -0, -0, 1],
    [0.92667, 0.092514, -0.019184, 0.021191, 0.964503, 0.014306, 0.008437, 0.054813, 0.93675],
    [0.89572, 0.13333, -0.02905, 0.029997, 0.9454, 0.024603, 0.013027, 0.104707, 0.882266],
    [0.905871, 0.127791, -0.033662, 0.026856, 0.941251, 0.031893, 0.01341, 0.148296, 0.838294],
    [0.948035, 0.08949, -0.037526, 0.014364, 0.946792, 0.038844, 0.010853, 0.193991, 0.795156],
    [1.01728, 0.027029, -0.044306, -0.006113, 0.958479, 0.047634, 0.006379, 0.248708, 0.744913],
    [1.105, -0.046633, -0.058363, -0.032137, 0.971635, 0.060503, 0.001336, 0.317922, 0.680742],
    [1.19321, -0.109812, -0.083402, -0.058496, 0.97941, 0.079086, -0.002346, 0.403492, 0.598854],
    [1.25773, -0.139648, -0.118081, -0.078003, 0.975409, 0.102594, -0.003316, 0.501214, 0.502102],
    [1.27886, -0.125333, -0.153531, -0.084748, 0.957674, 0.127074, -0.000989, 0.601151, 0.399838],
    [1.25553, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
  ],
};

/** severity 0 = normal vision, 1 = dichromacy. Anomalous trichromacy between. */
export function cvdMatrix(type: CVD, severity = 1): number[] {
  const t = Math.min(1, Math.max(0, severity)) * 10;
  const i = Math.min(9, Math.floor(t)), f = t - i;
  const [a, b] = [MACHADO[type][i], MACHADO[type][i + 1]];
  return a.map((v, k) => v + f * (b[k] - v));
}

export function simulate(type: CVD, severity = 1): View {
  const m = cvdMatrix(type, severity);
  return (p) => {
    const c = toLinear(p, 'srgb');
    return fromLinear([0, 1, 2].map((r) => m[3 * r] * c[0] + m[3 * r + 1] * c[1] + m[3 * r + 2] * c[2]) as Vec3, 'srgb');
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
export function spline(controls: Vec3[], perSpan = 24, closed = false): Vec3[] {
  if (controls.length < 2) return controls.slice();
  const n = controls.length;
  // Closed takes its phantom points from the far end instead of reflecting,
  // which is the whole difference: the curve then meets itself with matching
  // tangents rather than turning around. It also runs one span further, back
  // from the last control point to the first.
  const P = closed
    ? [controls[n - 1], ...controls, controls[0], controls[1]]
    : [refl(controls[0], controls[1]), ...controls, refl(controls[n - 1], controls[n - 2])];
  const out: Vec3[] = [];
  for (let i = 0; i + 3 < P.length; i++) out.push(...span(P.slice(i, i + 4), perSpan));
  return [...out, closed ? controls[0] : controls[n - 1]];
}
const refl = (a: Vec3, b: Vec3): Vec3 => [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]];

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

  // Machado is a linear map derived from the shifted photopigment, NOT a
  // projection, so it is not idempotent the way Brettel's half-plane was —
  // applying it twice would simulate a doubly deficient observer, which is not
  // a thing. What it does guarantee is that every row sums to one, so anything
  // achromatic comes through untouched, at any severity.
  const red = fromHex('#d62728'), green = fromHex('#2ca02c'), blue = fromHex('#1f77b4'), orange = fromHex('#ff7f0e');
  ok(delta(simulate('deutan', 0)(red), red) < 1e-4, 'severity 0 is identity'); // chart round-trip float error
  const deu = simulate('deutan');
  for (const t of ['protan', 'deutan', 'tritan'] as CVD[])
    for (const sev of [0.3, 0.6, 1]) {
      const gray = fromHex('#808080');
      ok(delta(simulate(t, sev)(gray), gray) < 1e-3, `${t} at ${sev} leaves gray alone`);
    }
  ok(delta(deu(red), red) > delta(simulate('deutan', 0.4)(red), red), 'severity is monotone');
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
    ok(inGamut(fromHex('#7f3f9f'), k), `sRGB colors are inside ${k}`);
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
      ok(Math.hypot(g2[1], g2[2]) < 1e-6, `gray is achromatic in ${k}`);
      ok(close(toSpace(fromHex('#ffffff'), k)[0], 100, 1e-6), `white is 100 in ${k}`);
      // white sits at the end of every lightness scale, which is exactly where a
      // chroma denominator tends to vanish — check it as well as mid gray
      const w2 = toSpace(fromHex('#ffffff'), k);
      ok(Math.hypot(w2[1], w2[2]) < 1e-4, `white is achromatic in ${k}`);
      const p2 = fromHex('#3b528b');
      ok(delta(fromSpace(toSpace(p2, k), k), p2) < 1e-6, `${k} round-trips`);
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
  // A geodesic is the shortest path, so it can never be longer than the line it
  // started from. The relaxation does not guarantee that on its own — the metric
  // in the closed-form step is lagged half a segment behind the point it moves,
  // and unguarded it produced paths 0.6% LONGER — so this is what the guard is
  // there for and the check that it is still doing its job.
  for (const k of ['cielab', 'cieluv', 'cam02', 'ipt']) {
    const g2 = spaceMetric(k);
    for (const [a, b] of [['#440154', '#fde725'], ['#e41a1c', '#377eb8'], ['#00ff00', '#ff00ff']]) {
      const [p3, q3] = [fromHex(a), fromHex(b)];
      const line = Array.from({ length: 9 }, (_, i) => lerp(p3, q3, i / 8));
      ok(arcLength(geodesic(p3, q3, g2), g2) <= arcLength(line, g2) + 1e-9,
        `${k} geodesic is no longer than the chord, ${a} to ${b}`);
    }
  }
  // and in the chart it IS the line, so nothing there changes or pays for this
  {
    const [p3, q3] = [fromHex('#440154'), fromHex('#fde725')];
    ok(geodesic(p3, q3).every((x, i) => close(x[0], lerp(p3, q3, i / 8)[0], 1e-12)),
      'the chart geodesic is the straight line');
  }
  // The analytic Jacobians have to agree with the central differences they
  // replace. Away from black they do, to five digits; at black they disagree
  // completely and the analytic one is right, because chart→XYZ cubes its
  // input and the true derivative there is zero, which no finite h can see.
  for (const k of Object.keys(D_SPACE)) {
    const ga = spaceMetric(k), h = 0.05, w = neutralScale(k) ** 2;
    for (const p of [[50, 0, 0], [72, -18, 40], [30, 25, -30], [88, 6, 12]] as Vec3[]) {
      const col: Vec3[] = [];
      for (let i = 0; i < 3; i++) {
        const a = [...p] as Vec3, b = [...p] as Vec3;
        a[i] -= h; b[i] += h;
        const [sa, sb] = [toSpace(a, k), toSpace(b, k)];
        col.push(sb.map((v, j) => (v - sa[j]) / (2 * h)) as Vec3);
      }
      const A = ga(p);
      // the reference has to carry the space's form too, or this asserts the
      // metric is J'J — true of every space until CIEDE2000, whose form is not
      // the identity and which would fail a test about the wrong thing
      const fm = SPACES[k].form;
      const Ac = fm ? col.map((v) => apply(fm(metricSpace(p, k)), v)) : col;
      let num = 0, den = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const f = w * (col[i][0] * Ac[j][0] + col[i][1] * Ac[j][1] + col[i][2] * Ac[j][2]);
        num += (A[i][j] - f) ** 2; den += f * f;
      }
      ok(Math.sqrt(num / den) < 1e-4, `${k} analytic jacobian matches central differences at ${p}`);
    }
  }
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
