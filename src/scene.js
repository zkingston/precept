// The three.js scene: the renderer, the four cameras, the color pipeline the
// shaders share, the gamut solid and its caps, the slice planes, the frame
// box, and the trajectory, control points, keep-out spheres and halfplanes.
// It owns the chart-to-world mapping (FRAME) and everything drawn into the
// four viewports. It must not import the page: the page imports it, reads
// its state through live bindings, and calls its build and paint functions.
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  SPACES,
  fromLinear,
  fromSpace,
  internals,
  lineDelta,
  params,
  spaceExtent,
  spaceMetric,
  toGamut,
  toSRGB,
  toSpace,
  tritanMix,
  unperceive,
} from './color-space.ts';
import { S, clamp01, curves, dot3, hueAll, view } from './solver.js';

// We do every color computation ourselves and hand three gamma-encoded sRGB
// directly, so switch three's color management off rather than have it convert
// twice. Everything below is display-referred sRGB, start to finish.
T.ColorManagement.enabled = false;

const $ = (id) => document.getElementById(id);

/**
 * space coords ↔ world. Axis 0 is vertical, 1 is x, 2 is z, and the box is
 * centered on the gamut's own middle. The scale is ONE number for all three
 * axes: fitting each axis separately would fill the panels better and quietly
 * lie about every distance in them. Isometric or nothing.
 */
export let FRAME = null;
export const world = (c) =>
  new T.Vector3(
    (c[1] - FRAME.mid[1]) * FRAME.s,
    (c[0] - FRAME.mid[0]) * FRAME.s,
    (c[2] - FRAME.mid[2]) * FRAME.s,
  );
const unworld = (v) => [
  v.y / FRAME.s + FRAME.mid[0],
  v.x / FRAME.s + FRAME.mid[1],
  v.z / FRAME.s + FRAME.mid[2],
];
export const wpt = (p) => world(toSpace(p)); // chart point → world
export const cpt = (v) => fromSpace(unworld(v)); // world → chart point
/**
 * Lightness always spans 0..100; chroma spans whatever the GAMUT reaches, which
 * is not a constant — sRGB stops near 32, Rec.2020 at 47, ProPhoto past 148.
 * The shell shader cuts every fragment above the bound, and buildCaps treats a
 * bound sitting AT the ceiling as inactive, so the ceiling has to follow the
 * gamut (setChromaCeiling) or a wide gamut is sliced away and left uncapped.
 */
export const BOUND_MAX = [100, 40];

export function reframe() {
  QUADS.slice(0, 3).forEach((q) => resetView(q.cam)); // new coordinates, new view
  const { lo, hi } = spaceExtent();
  const mid = lo.map((v, i) => (v + hi[i]) / 2);
  const half = lo.map((v, i) => Math.max(1e-6, (hi[i] - v) / 2));
  FRAME = { lo, hi, mid, half, s: Math.min(50 / half[0], 36 / half[1], 36 / half[2]) };
  const { s } = FRAME;
  [
    { w: half[1], h: half[2] },
    { w: half[2], h: half[0] },
    { w: half[1], h: half[0] },
  ].forEach((c, k) => (QUADS[k].cam.userData.content = { w: c.w * s, h: c.h * s }));
  // panel k cuts along axis k, and its slider is the only thing left naming it
  const names = SPACES[params.space].axes;
  [
    ['sL', 'nL'],
    ['sA', 'nA'],
    ['sB', 'nB'],
  ].forEach(([sid, nid], k) => {
    $(nid).textContent = names[k];
    const el = $(sid);
    // step=any, not a fraction of the range: a snapping slider cannot land on
    // its own max (500 steps of range/500 overshoots it in floating point, so
    // the top reachable value is one step short) and cannot agree with a state
    // set by anything but itself.
    el.min = lo[k];
    el.max = hi[k];
    el.step = 'any';
  });
}
let capKey = null; // the bounds, space and gamut the caps were last built for
export let gamutReach = 0; // the largest chroma the gamut solid reaches, found as it is meshed
export const rgb = (p) => toSRGB(view(toGamut(p, 'srgb'))).map(clamp01);

// ─── renderer, scene, four cameras ───────────────────────────────────────────
export const canvas = $('gl');
export const renderer = new T.WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = T.LinearSRGBColorSpace; // pass our sRGB values straight through
renderer.setScissorTest(true);
export const scene = new T.Scene();

export const cam3 = new T.PerspectiveCamera(42, 1, 1, 3000);
cam3.position.set(96, 62, 118);
export const controls = new OrbitControls(cam3, canvas);
controls.enableDamping = true;

/** Ortho views. The camera placements are picked so the on-screen axes read the
 *  way each panel's tag claims — the "down L" camera sits below the solid,
 *  which is what puts +a right and +b up. */
const ortho = (pos, up, halfW, halfH) => {
  const c = new T.OrthographicCamera(-1, 1, 1, -1, 1, 3000);
  c.position.set(...pos);
  c.up.set(...up);
  c.lookAt(0, 0, 0);
  c.userData.content = { w: halfW, h: halfH }; // what has to stay on screen
  c.userData.home = c.position.clone();
  return c;
};
export const resetView = (c) => {
  c.zoom = 1;
  c.position.copy(c.userData.home);
  c.updateProjectionMatrix();
};
// content extents here are placeholders; reframe() fits them to the space
const camL = ortho([0, -900, 0], [0, 0, 1], 36, 36);
const camA = ortho([-900, 0, 0], [0, 1, 0], 36, 50);
const camB = ortho([0, 0, 900], [0, 1, 0], 36, 50);

// Layer 1 holds the gamut shell: only the 3D view enables it, or each slice
// panel would be looking at its own cross-section through a translucent solid.
cam3.layers.enable(1);
// Layer 3 carries the slice planes. Every ortho view wants them — its own plane
// face-on, the other two edge-on as crosshairs — while 3D toggles them.
for (const c of [camL, camA, camB]) c.layers.enable(3);
export const QUADS = [
  { el: $('q1'), cam: camL, axis: 0 },
  { el: $('q2'), cam: camA, axis: 1 },
  { el: $('q3'), cam: camB, axis: 2 },
  { el: $('q0'), cam: cam3 },
];

// ─── the color pipeline, shared by every shader below ─────────────────────
// The shader cannot import SPACES, so each one needs an id and a branch in
// glToXYZ below. CIEDE2000's coordinates ARE CIELAB's -- only its metric
// differs, and the metric is not something the shader knows about -- so it
// takes the same branch.
const SPACE_ID = {
  oklab: 0,
  cielab: 1,
  de2000: 1,
  cieluv: 2,
  ipt: 3,
  xyz: 4,
  srgb: 5,
  ictcp: 6,
  cam02: 8,
};
// a space with no id would paint the gamut through whichever branch undefined
// lands on: fail at startup instead
for (const k of Object.keys(SPACES))
  if (SPACE_ID[k] === undefined) throw new Error(`space ${k} has no SPACE_ID for the shader`);
export const CVD_ID = { none: 0, protan: 1, deutan: 2, tritan: 3 };
const m3 = (rows) => new T.Matrix3().set(...rows.flat()); // .set takes row-major

// Everything from "a point in the working space" to "a color on screen",
// shared verbatim by the slice planes and the gamut solid. The two differ only
// in how they arrive at that point: one interpolates uv across a cut plane, the
// other reads it off the surface it is drawing.
const COLOR_GLSL = `
precision highp float;
uniform int uSpace, uCvd, uHueAll;
uniform float uOpacity;
uniform vec3 uLo, uHi, uWhite, uIptW, uMid;
uniform float uScale;
uniform vec2 uLB, uCB, uHue;
uniform mat3 uLmsLab, uXyzLms, uLmsXyz, uLabLms;
uniform mat3 uIptOppI, uIptLmsI, uGamut, uLinSrgb, uXyzSrgb, uCvdM, uBr1, uBr2;
uniform vec3 uVis[27];
uniform vec3 uBrN;
uniform float uBrMix;
uniform mat3 uIcOppI, uIcLmsI, uCamBack;
uniform vec4 uPq;                       // m1, m2, c1 and the pair c2, c3 packed below
uniform vec2 uPq2;
uniform float uIcK;
uniform vec4 uCam;                      // Aw, Nbb, c*z, n
uniform vec2 uCam2;                     // FL, Nc*Nbb (CIECAM02 has Ncb = Nbb under these conditions)

const float D = 6.0 / 29.0;
float labfi(float t) { return t > D ? t * t * t : 3.0 * D * D * (t - 4.0 / 29.0); }
float spow(float v, float e) { return sign(v) * pow(abs(v), e); }
vec3 cbrt3(vec3 v) { return vec3(spow(v.x, 1.0/3.0), spow(v.y, 1.0/3.0), spow(v.z, 1.0/3.0)); }
float dec(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
float enc(float c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * spow(c, 1.0 / 2.4) - 0.055; }

vec3 spaceToXyz(vec3 c) {
  if (uSpace == 0) { vec3 l = uLmsLab * (c / 100.0); return uXyzLms * (l * l * l); }
  if (uSpace == 1) {
    float fy = (c.x + 16.0) / 116.0;
    return vec3(labfi(fy + c.y / 500.0), labfi(fy), labfi(fy - c.z / 200.0)) * uWhite;
  }
  if (uSpace == 2) {
    if (c.x <= 0.0) return vec3(0.0);
    float wd = uWhite.x + 15.0 * uWhite.y + 3.0 * uWhite.z;
    float up = c.y / (13.0 * c.x) + 4.0 * uWhite.x / wd;
    float vp = c.z / (13.0 * c.x) + 9.0 * uWhite.y / wd;
    float Y = labfi((c.x + 16.0) / 116.0) * uWhite.y;
    return vec3(Y * 9.0 * up / (4.0 * vp), Y, Y * (12.0 - 3.0 * up - 20.0 * vp) / (4.0 * vp));
  }
  if (uSpace == 3) {
    vec3 p = uIptOppI * (c / 100.0);
    vec3 l = vec3(spow(p.x, 1.0/0.43), spow(p.y, 1.0/0.43), spow(p.z, 1.0/0.43)) * uIptW;
    return uIptLmsI * l;
  }
  if (uSpace == 4) return c / 100.0;
  if (uSpace == 6) {                                      // ICtCp: opponent, then inverse PQ
    vec3 e = uIcOppI * (c / uIcK);
    vec3 l;
    for (int i = 0; i < 3; i++) {
      float pv = pow(max(e[i], 0.0), 1.0 / uPq.y);
      l[i] = pow(max(pv - uPq.z, 0.0) / (uPq2.x - uPq2.y * pv), 1.0 / uPq.x) * 100.0;
    }
    return uIcLmsI * l;
  }
  if (uSpace == 8) {                                      // CAM02-UCS
    float Jp = c.x, ap = c.y, bp = c.z;
    float J = Jp / (1.7 - 0.007 * Jp);
    float Mp = length(vec2(ap, bp));
    float M = (exp(0.0228 * Mp) - 1.0) / 0.0228;
    float C = M / pow(uCam2.x, 0.25);
    float hr = atan(bp, ap);
    float et = 0.25 * (cos(hr + 2.0) + 3.8);
    float t = J <= 0.0 ? 0.0 : pow(C / (sqrt(J / 100.0) * pow(1.64 - pow(0.29, uCam.w), 0.73)), 1.0 / 0.9);
    float A = uCam.x * pow(J / 100.0, 1.0 / uCam.z);
    float p2v = A / uCam.y + 0.305;
    float aa = 0.0, bb = 0.0;
    if (t != 0.0) {
      float p1 = (50000.0 / 13.0) * uCam2.y * et / t;
      if (abs(sin(hr)) >= abs(cos(hr))) {
        float p4 = p1 / sin(hr);
        bb = (p2v * (2.0 + 21.0 / 20.0) * (460.0 / 1403.0))
           / (p4 + (2.0 + 21.0 / 20.0) * (220.0 / 1403.0) * (cos(hr) / sin(hr))
              - (27.0 / 1403.0) + (21.0 / 20.0) * (6300.0 / 1403.0));
        aa = bb * (cos(hr) / sin(hr));
      } else {
        float p5 = p1 / cos(hr);
        aa = (p2v * (2.0 + 21.0 / 20.0) * (460.0 / 1403.0))
           / (p5 + (2.0 + 21.0 / 20.0) * (220.0 / 1403.0)
              - ((27.0 / 1403.0) - (21.0 / 20.0) * (6300.0 / 1403.0)) * (sin(hr) / cos(hr)));
        bb = aa * (sin(hr) / cos(hr));
      }
    }
    vec3 rgba = vec3(460.0 * p2v + 451.0 * aa + 288.0 * bb,
                     460.0 * p2v - 891.0 * aa - 261.0 * bb,
                     460.0 * p2v - 220.0 * aa - 6300.0 * bb) / 1403.0;
    vec3 hp2;
    for (int i = 0; i < 3; i++) {
      float d = rgba[i] - 0.1, ad = abs(d);
      float tt = (27.13 * ad) / max(400.0 - ad, 1e-6);
      hp2[i] = sign(d) * (100.0 / uCam2.x) * pow(tt, 1.0 / 0.42);
    }
    return (uCamBack * hp2) / 100.0;
  }
  vec3 g = c / 100.0;                                     // sRGB cube: decode, then to XYZ
  return uXyzSrgb * vec3(dec(g.x), dec(g.y), dec(g.z));
}

bool inArc(float h) {
  if (uHueAll == 1) return true;
  return uHue.x <= uHue.y ? (h >= uHue.x && h <= uHue.y) : (h >= uHue.x || h <= uHue.y);
}

/** inside the lightness / chroma / hue bounds? skip exempts one of the three: a cap satisfies its own */
bool inBounds(vec3 lab, int skip) {
  float chroma = length(lab.yz);
  float hue = degrees(atan(lab.z, lab.y));
  hue = hue < 0.0 ? hue + 360.0 : hue;
  return (skip == 0 || (lab.x >= uLB.x && lab.x <= uLB.y))
      && (skip == 1 || (chroma >= uCB.x && chroma <= uCB.y))
      && (skip == 2 || chroma < 1.0 || inArc(hue));
}

/** the convex cone over the spectral locus: colors a light can actually make */
bool visible(vec3 xyz) {
  // against the chromaticity: the planes pass through the origin so the sign is
  // scale free, but its size is not, and near black the dot products vanish with
  // the color and the sign becomes rounding noise
  // below this everything is black, whatever its chromaticity says, and the
  // cone runs so nearly tangent to the cube's surface down there that the
  // boundary between them serrated along the tessellation
  float s = xyz.x + xyz.y + xyz.z;
  if (s < 1e-5) return true;
  for (int i = 0; i < 27; i++) if (dot(uVis[i], xyz) / s < -1e-7) return false;
  return true;
}

/** inside the working gamut's RGB box */
bool inBox(vec3 xyz) {
  vec3 ling = uGamut * xyz;
  return !(any(lessThan(ling, vec3(-1e-9))) || any(greaterThan(ling, vec3(1.0 + 1e-9))));
}

/** XYZ, through the selected observer, to something a monitor can show */
vec3 shown(vec3 xyz) {
  vec3 lin = uLinSrgb * xyz;
  if (uCvd > 0) {
    vec3 a = uCvdM * lin;               // severity is already baked into the matrix
    // tritan past 0.8 blends into Brettel, which picks a half-plane per color
    if (uBrMix > 0.0)
      a = mix(a, (dot(uBrN, lin) >= 0.0 ? uBr1 : uBr2) * lin, uBrMix);
    lin = a;
  }
  return clamp(vec3(enc(lin.r), enc(lin.g), enc(lin.b)), 0.0, 1.0);
}

vec3 chartOf(vec3 xyz) { return (uLabLms * cbrt3(uLmsXyz * xyz)) * 100.0; }
`;

const SLICE_FRAG =
  COLOR_GLSL +
  `
varying vec2 vUv;
uniform int uAxis;
uniform float uT;
void main() {
  // spelled out rather than indexed: dynamic vector indexing is not worth the
  // portability question, and this mirrors AXES[k].at() line for line
  vec3 c;
  if (uAxis == 0) c = vec3(uT, mix(uLo.y, uHi.y, vUv.x), mix(uLo.z, uHi.z, vUv.y));
  else if (uAxis == 1) c = vec3(mix(uLo.x, uHi.x, vUv.y), uT, mix(uLo.z, uHi.z, vUv.x));
  else c = vec3(mix(uLo.x, uHi.x, vUv.y), mix(uLo.y, uHi.y, vUv.x), uT);

  vec3 xyz = spaceToXyz(c);
  if (!inBox(xyz)) discard;
  // out of bounds is cut away rather than dimmed: what is left is exactly the
  // set you asked for, with nothing to read past
  if (!inBounds(chartOf(xyz), -1)) discard;
  if (!visible(xyz)) discard;
  gl_FragColor = vec4(shown(xyz), uOpacity);
}`;

// The mesh IS the feasible set's boundary, so there is nothing to test — every
// fragment is on it by construction, which is the whole reason the shell is
// meshed by direction rather than as the cube's six faces. Per fragment rather
// than per vertex also means the color stops being an interpolation across
// triangles that are large where the surface curves most.
const SHELL_FRAG =
  COLOR_GLSL +
  `
varying vec3 vPos;
void main() {
  vec3 c = vec3(vPos.y / uScale + uMid.x, vPos.x / uScale + uMid.y, vPos.z / uScale + uMid.z);
  vec3 xyz = spaceToXyz(c);
  if (!inBounds(chartOf(xyz), -1)) discard;
  gl_FragColor = vec4(shown(xyz), uOpacity);
}`;

/**
 * The caps. Cutting the shell by the bounds leaves a punctured surface, not a
 * solid: the boundary of the feasible set is the in-bounds part of the gamut
 * shell PLUS the parts of the bound surfaces lying inside the gamut. Those are
 * the two lightness planes, the two chroma cylinders and the two hue
 * half-planes, each carrying the same color pipeline.
 *
 * A cap satisfies its own bound by construction, to within its tessellation,
 * so testing it again would make the surface flicker along its own edge. Each
 * cap is told which bound it is and skips exactly that test.
 */
const CAP_FRAG =
  COLOR_GLSL +
  `
varying vec3 vPos;
uniform int uCap;
void main() {
  vec3 c = vec3(vPos.y / uScale + uMid.x, vPos.x / uScale + uMid.y, vPos.z / uScale + uMid.z);
  vec3 xyz = spaceToXyz(c);
  if (!inBox(xyz)) discard;
  if (!inBounds(chartOf(xyz), uCap)) discard;
  if (!visible(xyz)) discard;
  gl_FragColor = vec4(shown(xyz), uOpacity);
}`;

const SLICE_VERT =
  'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';
const SHELL_VERT =
  'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';

const colorUniforms = () => ({
  uSpace: { value: 0 },
  uCvd: { value: 0 },
  uHueAll: { value: 1 },
  uOpacity: { value: 1 },
  uScale: { value: 1 },
  uMid: { value: new T.Vector3() },
  uLo: { value: new T.Vector3() },
  uHi: { value: new T.Vector3() },
  uWhite: { value: new T.Vector3() },
  uIptW: { value: new T.Vector3() },
  uLB: { value: new T.Vector2() },
  uCB: { value: new T.Vector2() },
  uHue: { value: new T.Vector2() },
  uLmsLab: { value: new T.Matrix3() },
  uXyzLms: { value: new T.Matrix3() },
  uLmsXyz: { value: new T.Matrix3() },
  uLabLms: { value: new T.Matrix3() },
  uIptOppI: { value: new T.Matrix3() },
  uIptLmsI: { value: new T.Matrix3() },
  uGamut: { value: new T.Matrix3() },
  uLinSrgb: { value: new T.Matrix3() },
  uVis: { value: internals.VISIBLE.map((n) => new T.Vector3(...n)) },
  uXyzSrgb: { value: new T.Matrix3() },
  uCvdM: { value: new T.Matrix3() },
  uBr1: {
    value: m3([
      internals.BRETTEL_TRITAN.h1.slice(0, 3),
      internals.BRETTEL_TRITAN.h1.slice(3, 6),
      internals.BRETTEL_TRITAN.h1.slice(6),
    ]),
  },
  uBr2: {
    value: m3([
      internals.BRETTEL_TRITAN.h2.slice(0, 3),
      internals.BRETTEL_TRITAN.h2.slice(3, 6),
      internals.BRETTEL_TRITAN.h2.slice(6),
    ]),
  },
  uBrN: { value: new T.Vector3(...internals.BRETTEL_TRITAN.n) },
  uBrMix: { value: 0 },
  uIcOppI: { value: new T.Matrix3() },
  uIcLmsI: { value: new T.Matrix3() },
  uCamBack: { value: new T.Matrix3() },
  uPq: { value: new T.Vector4() },
  uPq2: { value: new T.Vector2() },
  uIcK: { value: 1 },
  uCam: { value: new T.Vector4() },
  uCam2: { value: new T.Vector2() },
});

/** every constant the shaders need, straight from the model */
function setColorUniforms(u) {
  const I = internals;
  u.uSpace.value = SPACE_ID[params.space];
  u.uLo.value.fromArray(FRAME.lo);
  u.uHi.value.fromArray(FRAME.hi);
  u.uMid.value.fromArray(FRAME.mid);
  u.uScale.value = FRAME.s;
  u.uWhite.value.fromArray(I.CHART_WHITE);
  u.uIptW.value.fromArray(I.IPT.W);
  u.uLmsLab.value.copy(m3(I.LMS_LAB));
  u.uXyzLms.value.copy(m3(I.XYZ_LMS));
  u.uLmsXyz.value.copy(m3(I.LMS_XYZ));
  u.uLabLms.value.copy(m3(I.LAB_LMS));
  u.uIptOppI.value.copy(m3(I.IPT.OPP_I));
  u.uIptLmsI.value.copy(m3(I.IPT.LMS_I));
  u.uGamut.value.copy(m3(I.rgbFromXYZ(params.gamut)));
  u.uLinSrgb.value.copy(m3(I.rgbFromXYZ('srgb')));
  u.uXyzSrgb.value.copy(m3(I.xyzFromRGB('srgb')));
  const ic = I.ICTCP,
    cam = I.CAM;
  u.uIcOppI.value.copy(m3(ic.OPP_I));
  u.uIcLmsI.value.copy(m3(ic.LMS_I));
  u.uIcK.value = ic.K;
  u.uPq.value.set(ic.PQ.m1, ic.PQ.m2, ic.PQ.c1, 0);
  u.uPq2.value.set(ic.PQ.c2, ic.PQ.c3);
  u.uCamBack.value.copy(m3(cam.BACK));
  u.uCam.value.set(cam.Aw, cam.Nbb, cam.c * cam.z, cam.n);
  u.uCam2.value.set(cam.FL, cam.Nc * cam.Nbb);
  u.uLB.value.set(S.lo[0], S.hi[0]);
  u.uCB.value.set(S.lo[1], S.hi[1]);
  u.uHue.value.fromArray(S.hue);
  u.uHueAll.value = hueAll() ? 1 : 0;
  u.uCvd.value = CVD_ID[S.cvd];
  if (S.cvd !== 'none') {
    u.uCvdM.value.set(...I.cvdMatrix(S.cvd, S.sev));
    u.uBrMix.value = S.cvd === 'tritan' ? tritanMix(S.sev) : 0;
  }
}

// ─── the solid, as the boundary of the feasible set ──────────────────────────
/**
 * One count for both directions of the face grid, and they have to be equal.
 *
 * A polytope edge is shared by two faces, and each meshes it from its own fan:
 * for one it may be a leg, walked in s, and for the other an arc, walked in t.
 * The edge is straight in linear RGB and curved in the chart, so two different
 * samplings of it chord that curve differently and leave a crack between the
 * faces. With 24 against 12 that was six of the cube's eighteen shared edges;
 * equal, it is none of them.
 *
 * The warp does not break this. Every edge running into black is a fan leg on
 * both of its faces, since black is the darkest vertex of all three faces that
 * meet there, so both warp it identically. Every other edge has no dark apex to
 * warp toward and is uniform on both sides.
 */
const FACE_N = 24;

/** Sutherland–Hodgman against one half-space n·x >= d */
function clipPoly(poly, n, d) {
  const out = [];
  const side = (P) => n[0] * P[0] + n[1] * P[1] + n[2] * P[2] - d;
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i],
      B = poly[(i + 1) % poly.length];
    const a = side(A),
      b = side(B);
    if (a >= -1e-12) out.push(A);
    if ((a > 1e-12 && b < -1e-12) || (a < -1e-12 && b > 1e-12)) {
      const t = a / (a - b);
      out.push([0, 1, 2].map((k) => A[k] + t * (B[k] - A[k])));
    }
  }
  return out;
}

/** the half-spaces whose intersection is the feasible body, in linear RGB */
function bodyPlanes() {
  const H = [];
  for (let i = 0; i < 3; i++) {
    H.push({ n: [0, 1, 2].map((k) => (k === i ? 1 : 0)), d: 0 }); // channel >= 0
    H.push({ n: [0, 1, 2].map((k) => (k === i ? -1 : 0)), d: -1 }); // channel <= 1
  }
  // n·(M·rgb) >= 0 is (Mᵀn)·rgb >= 0
  const M = internals.xyzFromRGB(params.gamut);
  for (const v of internals.VISIBLE) {
    const g = [0, 1, 2].map((c) => M[0][c] * v[0] + M[1][c] * v[1] + M[2][c] * v[2]);
    const len = Math.hypot(...g);
    if (len > 1e-12) H.push({ n: g.map((x) => x / len), d: 0 });
  }
  return H;
}

const shellGeo = new T.BufferGeometry();
/**
 * The body is a convex POLYTOPE in linear RGB, and meshing it as one is the
 * only way its corners survive.
 *
 * Six half-spaces for the cube and one per visible plane, all of them linear in
 * linear RGB, so the boundary is a set of flat polygons meeting at straight
 * edges and sharp corners. Two earlier meshes each lost something. The cube's
 * six faces are exact only while the cone takes nothing away. A sphere of
 * directions is exact for neither: a lat/long grid cannot land on a corner
 * unless one happens to fall on a row, and for the RGB cube six of the eight do
 * not — measured, the red corner was cut by 2.56% of its radius while the faces
 * were within 0.023%. That is what truncated the cube, and no row count fixes
 * it, since acos(1/3) is not a rational part of the range.
 *
 * Clipping each plane against all the others gives the true faces. Nothing is
 * approximated: a corner is a corner because three planes meet there.
 */
export function buildShell() {
  const H = bodyPlanes();
  const pos = [],
    idx = [];
  let maxC = 0;
  for (let f = 0; f < H.length; f++) {
    const { n, d } = H[f];
    // a square in the plane, big enough to contain the body, then cut down
    const t1 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = [
      n[1] * t1[2] - n[2] * t1[1],
      n[2] * t1[0] - n[0] * t1[2],
      n[0] * t1[1] - n[1] * t1[0],
    ];
    const ul = Math.hypot(...u);
    if (ul < 1e-12) continue;
    const U = u.map((x) => x / ul);
    const V = [n[1] * U[2] - n[2] * U[1], n[2] * U[0] - n[0] * U[2], n[0] * U[1] - n[1] * U[0]];
    const R = 4,
      c = n.map((x) => x * d);
    let poly = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([a, b]) => [0, 1, 2].map((k) => c[k] + R * (a * U[k] + b * V[k])));
    for (let g = 0; g < H.length && poly.length; g++)
      if (g !== f) poly = clipPoly(poly, H[g].n, H[g].d);
    if (poly.length < 3) continue; // this plane does not bound the body

    // fan from the darkest corner, and crowd the samples toward it: chart
    // lightness goes as the cube root of intensity, so an even split in linear
    // RGB leaves the dark end a spike that fails to enclose what is in gamut
    const chart = poly.map((q) => fromLinear(q));
    let v0 = 0;
    for (let i = 1; i < poly.length; i++) if (chart[i][0] < chart[v0][0]) v0 = i;
    const warp = chart[v0][0] < 5 ? 3 : 1;
    const outward = n.map((x) => -x); // n·x >= d is the inside

    for (let k = 1; k + 1 < poly.length; k++) {
      const iA = (v0 + k) % poly.length,
        iB = (v0 + k + 1) % poly.length;
      const A = poly[iA],
        B = poly[iB];
      // The far edge gets the same treatment as a leg would, because on the
      // neighbouring face it IS a leg. Crowd it toward whichever end is dark,
      // and it matches that face's warp from the same vertex.
      const dA = chart[iA][0] < 5,
        dB = chart[iB][0] < 5;
      const tOf = (u) => (dA && !dB ? u ** 3 : dB && !dA ? 1 - (1 - u) ** 3 : u);
      const base = pos.length / 3;
      for (let a = 0; a <= FACE_N; a++) {
        const sc = (a / FACE_N) ** warp;
        for (let b = 0; b <= FACE_N; b++) {
          const t = tOf(b / FACE_N);
          const q = [0, 1, 2].map(
            (m) => poly[v0][m] + sc * ((1 - t) * (A[m] - poly[v0][m]) + t * (B[m] - poly[v0][m])),
          );
          const ch = fromLinear(q);
          maxC = Math.max(maxC, Math.hypot(ch[1], ch[2]));
          const w = wpt(ch);
          pos.push(w.x, w.y, w.z);
        }
      }
      // Winding measured, not predicted: world() is an odd permutation of the
      // chart axes and mirrors every triangle, and BackSide culls whole faces
      // away when this is wrong — the solid then shows its near surface and the
      // caps, which are only ever seen from inside, disappear.
      //
      // Measured off a REAL emitted triangle rather than off the fan's corners.
      // Deriving it looks easy and is not: for a grid point at parameter t the
      // two edges are (B-A) and (lerp(A,B,t)-O), whose cross product works out
      // to MINUS (A-O)x(B-O), so taking the corners and trusting them inverts
      // every face. Three vertices out of the buffer cannot be wrong that way.
      const mid = [0, 1, 2].map((m) => (poly[v0][m] + A[m] + B[m]) / 3);
      const wm = wpt(fromLinear(mid));
      const wo = wpt(fromLinear(mid.map((x, m) => x + 1e-3 * outward[m]))).sub(wm);
      const o0 = base + (FACE_N - 1) * (FACE_N + 1) + (FACE_N >> 1);
      const [P0, P1, P2] = [o0, o0 + 1, o0 + FACE_N + 1].map(
        (k) => new T.Vector3(pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]),
      );
      const flip = P1.sub(P0).cross(P2.sub(P0)).dot(wo) < 0;
      for (let a = 0; a < FACE_N; a++)
        for (let b = 0; b < FACE_N; b++) {
          const o = base + a * (FACE_N + 1) + b;
          idx.push(
            ...(flip
              ? [o, o + FACE_N + 1, o + 1, o + 1, o + FACE_N + 1, o + FACE_N + 2]
              : [o, o + 1, o + FACE_N + 1, o + 1, o + FACE_N + 2, o + FACE_N + 1]),
          );
        }
    }
  }
  shellGeo.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(pos), 3));
  shellGeo.setIndex(idx);
  shellGeo.computeBoundingSphere();
  gamutReach = maxC;
  capKey = null;
}

// BackSide, not DoubleSide: drawing only the far faces gives one clean layer of
// translucency instead of six stacked ones, and leaves the interior readable.
export const shell = new T.Mesh(
  shellGeo,
  new T.ShaderMaterial({
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    transparent: true,
    side: T.BackSide,
    depthWrite: false,
    uniforms: colorUniforms(),
  }),
);
shell.renderOrder = 2;
shell.layers.set(1);
scene.add(shell);

/** refresh the uniforms; the color itself is the fragment shader's */
export function paintShell() {
  setColorUniforms(shell.material.uniforms);
  shell.material.uniforms.uOpacity.value = S.shell;
  buildCaps();
  paintCaps();
}

// ─── caps: the feasible set's boundary where a bound cuts it ────────────────
export const capGroup = new T.Group();
capGroup.layers.set(1); // part of the solid, so 3D only
scene.add(capGroup);
const CAP_N = 36;
/** caps span the chroma the body reaches, with margin */
const capR = () => BOUND_MAX[1] * 1.35;

/** a point on cap `kind` at value v, parameterized over the unit square */
const capChart = (kind, v, u, w) => {
  if (kind === 0) return [v, (2 * u - 1) * capR(), (2 * w - 1) * capR()]; // L = v
  if (kind === 1) {
    const h = u * 2 * Math.PI; // chroma = v
    return [w * 100, v * Math.cos(h), v * Math.sin(h)];
  }
  const h = (v * Math.PI) / 180; // hue = v
  return [w * 100, u * capR() * Math.cos(h), u * capR() * Math.sin(h)];
};

/**
 * Which way is out of the feasible set, in the chart. `sign` is +1 for a cap
 * on an upper bound and -1 for a lower one: leaving through the top of the
 * lightness band means increasing L, leaving through the bottom means
 * decreasing it, and likewise for chroma and for the two ends of the hue arc.
 */
const capOut = (kind, q, sign) => {
  const h = Math.atan2(q[2], q[1]);
  return kind === 0
    ? [sign, 0, 0]
    : kind === 1
      ? [0, sign * Math.cos(h), sign * Math.sin(h)]
      : [0, -sign * Math.sin(h), sign * Math.cos(h)];
};

/** an indexed (nu × nv) grid over `at(u, v)`, vertices row by row in v */
function gridGeometry(nu, nv, at) {
  const pos = [],
    idx = [];
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) pos.push(...at(i / nu, j / nv).toArray());
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i,
        b = a + nu + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function buildCaps() {
  const key = `${S.lo}|${S.hi}|${S.hue}|${params.space}|${params.gamut}`;
  if (key === capKey) return;
  capKey = key;
  capGroup.clear();
  const wanted = [
    ...(S.lo[0] > 0 ? [[0, S.lo[0], -1]] : []),
    ...(S.hi[0] < 100 ? [[0, S.hi[0], 1]] : []),
    ...(S.lo[1] > 0 ? [[1, S.lo[1], -1]] : []),
    ...(S.hi[1] < BOUND_MAX[1] - 1e-9 ? [[1, S.hi[1], 1]] : []),
    ...(hueAll()
      ? []
      : [
          [2, S.hue[0], -1],
          [2, S.hue[1], 1],
        ]),
  ];
  for (const [kind, v, sign] of wanted) {
    const g = gridGeometry(CAP_N, CAP_N, (u, w) => wpt(capChart(kind, v, u, w)));
    const idx = g.index.array;
    // The grid's u×v normal points outward on one cap of each pair and inward
    // on the other, and world() mirrors it again — the same trap the shell
    // hit. So measure it rather than predict it: compare one triangle against
    // a step in the known outward direction, and reverse the winding if they
    // disagree. Consistently outward is what lets these render BackSide.
    const q = capChart(kind, v, 0.5, 0.5),
      d = capOut(kind, q, sign);
    const outward = wpt(q.map((c, i) => c + 1e-3 * d[i])).sub(wpt(q));
    const t0 = 6 * (((CAP_N / 2) | 0) * CAP_N + ((CAP_N / 2) | 0));
    const [A, B, C] = [0, 1, 2].map((k) =>
      new T.Vector3().fromBufferAttribute(g.attributes.position, idx[t0 + k]),
    );
    if (B.sub(A).cross(C.sub(A)).dot(outward) < 0)
      for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
    const m = new T.Mesh(
      g,
      new T.ShaderMaterial({
        vertexShader: SHELL_VERT,
        fragmentShader: CAP_FRAG,
        transparent: true,
        side: T.BackSide,
        depthWrite: false,
        uniforms: { ...colorUniforms(), uCap: { value: kind } },
      }),
    );
    m.layers.set(1);
    m.renderOrder = 2;
    capGroup.add(m);
  }
  paintCaps();
}

export function paintCaps() {
  for (const m of capGroup.children) {
    setColorUniforms(m.material.uniforms);
    m.material.uniforms.uOpacity.value = S.shell;
  }
}

// ─── slice planes: evaluated per fragment on the GPU ────────────────────────
// A slice texel is a pure function of (u,v): space coords → XYZ → gamut test →
// sRGB. That is a fragment shader by definition; on the CPU, as a 320²
// ImageData, it costs 60 ms per slice. Here the cut, the space, the gamut, the
// observer and the bounds are all uniforms, so moving a slider is a uniform
// write and nothing more.
//
// The algorithm exists twice, in TypeScript and in GLSL; the CONSTANTS do not.
// Every matrix below is uploaded from color-space.ts, so the two cannot drift
// numerically even though they must be kept in step logically.
const axLerp = (k, t) => FRAME.lo[k] + (FRAME.hi[k] - FRAME.lo[k]) * t;
export const AXES = [
  {
    corners: (t) => [
      [t, FRAME.lo[1], FRAME.lo[2]],
      [t, FRAME.hi[1], FRAME.lo[2]],
      [t, FRAME.hi[1], FRAME.hi[2]],
      [t, FRAME.lo[1], FRAME.hi[2]],
    ],
    at: (t, u, v) => [t, axLerp(1, u), axLerp(2, v)],
    normal: () => new T.Vector3(0, 1, 0),
  },
  {
    corners: (t) => [
      [FRAME.lo[0], t, FRAME.lo[2]],
      [FRAME.lo[0], t, FRAME.hi[2]],
      [FRAME.hi[0], t, FRAME.hi[2]],
      [FRAME.hi[0], t, FRAME.lo[2]],
    ],
    at: (t, u, v) => [axLerp(0, v), t, axLerp(2, u)],
    normal: () => new T.Vector3(1, 0, 0),
  },
  {
    corners: (t) => [
      [FRAME.lo[0], FRAME.lo[1], t],
      [FRAME.lo[0], FRAME.hi[1], t],
      [FRAME.hi[0], FRAME.hi[1], t],
      [FRAME.hi[0], FRAME.lo[1], t],
    ],
    at: (t, u, v) => [axLerp(0, v), axLerp(1, u), t],
    normal: () => new T.Vector3(0, 0, 1),
  },
];
function sliceMaterial() {
  return new T.ShaderMaterial({
    vertexShader: SLICE_VERT,
    fragmentShader: SLICE_FRAG,
    transparent: true,
    depthWrite: true,
    side: T.DoubleSide,
    uniforms: { ...colorUniforms(), uAxis: { value: 0 }, uT: { value: 0 } },
  });
}

export const slices = AXES.map((ax, k) => {
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(12), 3));
  geo.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const mesh = new T.Mesh(geo, sliceMaterial());
  const edge = new T.LineLoop(
    new T.BufferGeometry().setAttribute('position', geo.attributes.position),
    new T.LineBasicMaterial({ color: 0x33333a }),
  );
  edge.renderOrder = 1;
  mesh.layers.set(3);
  edge.layers.set(3);
  scene.add(mesh, edge);
  return { ax, k, geo, mesh, edge };
});

export function paintSlice(s) {
  const t = S.slice[s.k];
  const p = s.geo.attributes.position;
  s.ax.corners(t).forEach((c, i) => p.setXYZ(i, ...world(c).toArray()));
  p.needsUpdate = true;
  s.geo.computeBoundingSphere();

  const u = s.mesh.material.uniforms;
  setColorUniforms(u);
  u.uAxis.value = s.k;
  u.uT.value = t;
  u.uOpacity.value = S.sliceOp;
}

// ─── the frame box, on the far side only ─────────────────────────────────────
/**
 * The extent box the solid sits in, as a reference for where its axes run.
 *
 * Only the far nine of its twelve edges are drawn. The three meeting the corner
 * nearest the camera are the ones that would cross in FRONT of the solid, and
 * they are what turns a box into a cage — the same reason a 3D plot draws its
 * back panes and not its front ones. Which corner that is changes as you orbit,
 * so the choice is remade each frame; it is eight projections and 24 vertex
 * writes.
 *
 * Drawn before the shell and left out of the depth buffer's way, so where an
 * edge passes behind the solid it reads through the translucency rather than
 * over it.
 */
const BOX_EDGES = [];
for (let a = 0; a < 8; a++)
  for (const bit of [1, 2, 4]) if (!(a & bit)) BOX_EDGES.push([a, a | bit]);
const boxGeo = new T.BufferGeometry();
boxGeo.setAttribute(
  'position',
  new T.Float32BufferAttribute(new Float32Array(BOX_EDGES.length * 6), 3),
);
export const boxLines = new T.LineSegments(
  boxGeo,
  new T.LineBasicMaterial({ color: 0x3a3a42, transparent: true, opacity: 0.5, depthWrite: false }),
);
boxLines.layers.set(1); // part of the solid's view, so 3D only
boxLines.renderOrder = 0;
scene.add(boxLines);

const boxTmp = new T.Vector3();
export function updateBox() {
  if (!FRAME) return;
  const { lo, hi } = FRAME;
  const C = Array.from({ length: 8 }, (_, i) =>
    world([i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]),
  );
  // nearest corner by projected depth, which is right for either projection
  let near = 0,
    best = Infinity;
  for (let i = 0; i < 8; i++) {
    const z = boxTmp.copy(C[i]).project(cam3).z;
    if (z < best) {
      best = z;
      near = i;
    }
  }
  const pos = boxGeo.attributes.position;
  BOX_EDGES.forEach(([a, b], k) => {
    // an edge at the near corner collapses to a point rather than being culled,
    // which keeps the buffer a fixed size and the draw call a single one
    const q = a === near || b === near ? C[a] : C[b];
    pos.setXYZ(2 * k, C[a].x, C[a].y, C[a].z);
    pos.setXYZ(2 * k + 1, q.x, q.y, q.z);
  });
  pos.needsUpdate = true;
}

// ─── trajectory, control points, obstacle spheres ────────────────────────────
// transparent + depthTest off puts these in the pass that runs AFTER the slice
// planes and exempts them from its depth, so the trajectory reads over the cut
// rather than being blended into it. renderOrder does the rest of the stacking.
const overlay = (extra) =>
  new T.MeshBasicMaterial({ transparent: true, depthTest: false, ...extra });
const tube = new T.Mesh(new T.BufferGeometry(), overlay({ vertexColors: true }));
// a slightly fatter black tube, back faces only: what shows past the colored
// one is exactly an outline, and it costs no shader work
const tubeEdge = new T.Mesh(new T.BufferGeometry(), overlay({ color: 0x000000, side: T.BackSide }));
tubeEdge.renderOrder = 6;
tube.renderOrder = 7;
scene.add(tube, tubeEdge);

export function buildTube() {
  tube.geometry.dispose();
  tubeEdge.geometry.dispose();
  // The runs are drawn as one geometry each and then concatenated into the two
  // meshes, rather than as a mesh per run: the vertex colors already carry the
  // ramp, so the only thing a break has to change is that no tube spans it.
  const cs = S.mode === 'continuous' ? curves().filter((c) => c.length >= 2) : [];
  tube.visible = tubeEdge.visible = cs.length > 0;
  if (!tube.visible) {
    tube.geometry = tubeEdge.geometry = new T.BufferGeometry();
    return;
  }
  const parts = cs.map((c) => tubeOf(c));
  tube.geometry = mergeGeometries(parts.map((x) => x.body));
  tubeEdge.geometry = mergeGeometries(parts.map((x) => x.edge));
}

/**
 * The trajectory as a tube, and the outline as the same tube grown a little.
 *
 * One segment per curve point, capped: `c` is already the spline evaluated at
 * PER_SPAN points a span, and TubeGeometry's cost is linear in its segments.
 *
 * The outline is grown from the first tube rather than built as a second
 * TubeGeometry, which would repeat the arc-length reparameterisation and the
 * Frenet frames for a path already walked. A ring is `radial` vertices around
 * its centre, so the centre is their mean and every vertex moves out from it
 * by the ratio.
 */
function tubeOf(c) {
  const seg = Math.min(200, c.length),
    radial = 8;
  const path = new T.CatmullRomCurve3(c.map(wpt));
  const body = new T.TubeGeometry(path, seg, 1.3, radial, false);
  const edge = body.clone();
  {
    const bp = body.attributes.position,
      ep = edge.attributes.position,
      k = 1.75 / 1.3;
    for (let r = 0; r <= seg; r++) {
      const o = r * (radial + 1);
      let cx = 0,
        cy = 0,
        cz = 0;
      for (let j = 0; j < radial; j++) {
        cx += bp.getX(o + j);
        cy += bp.getY(o + j);
        cz += bp.getZ(o + j);
      }
      cx /= radial;
      cy /= radial;
      cz /= radial;
      for (let j = 0; j <= radial; j++)
        ep.setXYZ(
          o + j,
          cx + (bp.getX(o + j) - cx) * k,
          cy + (bp.getY(o + j) - cy) * k,
          cz + (bp.getZ(o + j) - cz) * k,
        );
    }
    ep.needsUpdate = true;
  }
  // TubeGeometry emits (seg+1) rings of (radial+1) vertices in order, so the
  // ring index recovers the curve parameter, and with it the color.
  //
  // Once per RING, not once per vertex: every vertex of a ring takes the same
  // color, and rgb() is the whole display pipeline. Per vertex it was 6.4 ms of
  // a 7.3 ms tube on a twenty-point ramp.
  const col = new Float32Array(body.attributes.position.count * 3);
  for (let r = 0; r <= seg; r++) {
    const v = rgb(c[Math.min(c.length - 1, Math.round((r / seg) * (c.length - 1)))]);
    for (let j = 0; j <= radial; j++) col.set(v, (r * (radial + 1) + j) * 3);
  }
  body.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  // the edge mesh is drawn flat, but the merge needs both to carry the same
  // attributes or the concatenated arrays do not line up
  edge.setAttribute('color', new T.Float32BufferAttribute(col.slice(), 3));
  return { body, edge };
}

export const ptGroup = new T.Group(),
  obsGroup = new T.Group(),
  planeGroup = new T.Group();
scene.add(ptGroup, obsGroup, planeGroup);
const DOT = new T.SphereGeometry(2.6, 20, 14),
  RING = new T.SphereGeometry(3.4, 20, 14);
const HALO = new T.SphereGeometry(4.6, 20, 14);
// the handle's direction from the center, in the chart: off-axis on purpose
const OBS_U = [0.5, 0.62, 0.6].map((v, _, a) => v / Math.hypot(...a));

export function buildPoints() {
  ptGroup.clear();
  S.pts.forEach((p, i) => {
    const sel = S.sel?.kind === 'pt' && S.sel.i === i;
    const marked = S.marks.includes(i);
    // a handle sitting exactly on its own cut plane would otherwise be half
    // buried in it, and a handle you cannot see is one you cannot grab
    const ring = new T.Mesh(
      RING,
      overlay({ color: marked ? 0x7dd3fc : sel ? 0xffffff : 0x0d0d10, side: T.BackSide }),
    );
    const dot = new T.Mesh(DOT, overlay({}));
    dot.material.color.setRGB(...rgb(p));
    ring.renderOrder = 8;
    dot.renderOrder = 9;
    ring.add(dot);
    if (S.pin[i]) {
      // held still: an outline behind the ring
      const halo = new T.Mesh(HALO, overlay({ color: 0xffc14d, side: T.BackSide }));
      halo.renderOrder = 7;
      ring.add(halo);
    }
    ring.position.copy(wpt(p));
    ring.userData = { kind: 'pt', i };
    ptGroup.add(ring);
  });
}

/**
 * The keep-out set is {p : lineDelta(p, c, g) < r}, measured in the chart under
 * the working space's metric. In Oklab that is a sphere of radius f⁻¹(r). In
 * every other space the metric changes along the way out from the center, so
 * the boundary is found one direction at a time: walk out from c along u until
 * the length reads f⁻¹(r), and put that point through the view. Cached on
 * everything it depends on, because sync rebuilds the group every frame.
 */
const SHELLS = new Map();
/** the point of the keep-out boundary in chart direction u from the center */
function shellPoint(o, u, g = spaceMetric()) {
  const R = unperceive(o.r);
  const at = (t) => o.c.map((cc, k) => cc + t * u[k]);
  if (!g.space) return at(R); // the chart itself: exact, no search
  let t = R;
  // the length grows about linearly in t, so scaling by the shortfall lands
  // within a tenth of a percent in two or three rounds
  for (let k = 0; k < 6; k++) {
    const len = unperceive(lineDelta(o.c, at(t), g));
    if (Math.abs(len - R) < 1e-3 * R) break;
    t *= R / len;
  }
  return at(t);
}
function obstacleShell(o) {
  const key = `${params.space}|${params.gamut}|${o.c.map((v) => v.toFixed(3))}|${o.r.toFixed(3)}`;
  let geo = SHELLS.get(key);
  if (geo) return geo;
  const g = spaceMetric();
  geo = gridGeometry(24, 16, (u, v) => {
    const th = u * 2 * Math.PI,
      ph = v * Math.PI;
    return wpt(
      shellPoint(o, [Math.cos(ph), Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th)], g),
    );
  });
  if (SHELLS.size > 64) {
    SHELLS.forEach((old) => old.dispose());
    SHELLS.clear();
  }
  SHELLS.set(key, geo);
  return geo;
}

export function buildObstacles() {
  obsGroup.clear();
  S.obs.forEach((o, i) => {
    const sel = (S.sel?.kind === 'obs' || S.sel?.kind === 'obsr') && S.sel.i === i;
    const g = obstacleShell(o); // in world coordinates already
    const m = new T.Mesh(
      g,
      new T.MeshBasicMaterial({
        color: 0xff5b5b,
        transparent: true,
        opacity: sel ? 0.26 : 0.13,
        depthWrite: false,
      }),
    );
    m.add(
      new T.Mesh(
        g,
        new T.MeshBasicMaterial({
          color: sel ? 0xffffff : 0xff5b5b,
          wireframe: true,
          transparent: true,
          opacity: 0.3,
        }),
      ),
    );
    m.userData = { kind: 'obs', i };
    // Handle on the shell, in a deliberately oblique direction: along an axis
    // it would project onto the center in whichever panel looks down that
    // axis, and a handle you cannot separate from the center is one you cannot
    // grab.
    const h = new T.Mesh(DOT, overlay({ color: sel ? 0xffd76a : 0xc94f4f }));
    h.scale.setScalar(0.7);
    h.position.copy(wpt(shellPoint(o, OBS_U)));
    h.renderOrder = 8;
    h.userData = { kind: 'obsr', i };
    obsGroup.add(m, h);
  });
}

/**
 * A halfplane is stored as an axis, a value and a side — so it draws as a quad
 * spanning the other two axes, and gets a handle at its center. That handle is
 * an ordinary pickable object, which means dragging it (slides the cut),
 * right-clicking it (deletes) and selecting it all come from machinery that
 * already exists rather than a second interaction path.
 */
// world(c) is a permutation times ONE uniform scale, so a direction in space
// coordinates maps to a world direction by the same permutation and normalizes
// out. That is what lets the gizmo basis be built in world space and read back.
const wdir = (n) => new T.Vector3(n[1], n[0], n[2]).normalize();
export const sdir = (v) => [v.y, v.x, v.z];
/** the point of the plane nearest the middle of the box */
export const planeCenter = (pl) =>
  FRAME.mid.map((m, j) => m + (pl.d - dot3(pl.n, FRAME.mid)) * pl.n[j]);

const PLANE_R = 26,
  HANDLE_R = 15;

export function buildPlanes() {
  planeGroup.clear();
  S.planes.forEach((pl, i) => {
    const sel = S.sel?.kind === 'plane' && S.sel.i === i;
    const W = world(planeCenter(pl)),
      n = wdir(pl.n);
    const u = new T.Vector3(0, 1, 0).cross(n);
    if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
    u.normalize();
    const v = new T.Vector3().crossVectors(n, u);
    // The halfplane is infinite; the quad is a fixed-size gizmo so that seeing
    // one face-on does not flood a whole panel red. A handle, not a claim.
    const quad = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([a, b]) =>
      W.clone()
        .addScaledVector(u, a * PLANE_R)
        .addScaledVector(v, b * PLANE_R),
    );
    const geo = new T.BufferGeometry().setFromPoints(quad);
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    planeGroup.add(
      new T.Mesh(
        geo,
        new T.MeshBasicMaterial({
          color: 0xff5b5b,
          transparent: true,
          opacity: sel ? 0.22 : 0.1,
          side: T.DoubleSide,
          depthWrite: false,
        }),
      ),
    );
    planeGroup.add(
      new T.LineLoop(
        new T.BufferGeometry().setAttribute('position', geo.attributes.position),
        new T.LineBasicMaterial({ color: 0xff5b5b, transparent: true, opacity: sel ? 1 : 0.6 }),
      ),
    );

    const tip = W.clone().addScaledVector(n, HANDLE_R); // points into the excluded half
    planeGroup.add(
      new T.Line(
        new T.BufferGeometry().setFromPoints([W, tip]),
        new T.LineBasicMaterial({ color: 0xff5b5b }),
      ),
    );

    const center = new T.Mesh(DOT, overlay({ color: sel ? 0xffffff : 0xff5b5b }));
    center.position.copy(W);
    center.renderOrder = 8;
    center.userData = { kind: 'plane', i };
    const rot = new T.Mesh(DOT, overlay({ color: sel ? 0xffd76a : 0xc94f4f }));
    rot.scale.setScalar(0.75);
    rot.position.copy(tip);
    rot.renderOrder = 8;
    rot.userData = { kind: 'planerot', i };
    planeGroup.add(center, rot);
  });
}

/** the caps are rebuilt on the next paint */
export function invalidateCaps() {
  capKey = null;
}
