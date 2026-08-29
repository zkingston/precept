# precept

A palette design tool built on the finding that perceptual colour space is **not
Riemannian** — large colour differences are perceived as less than the sum of
the small steps that make them up.

- Bujack, Teti, Miller, Caffrey & Turton, *The non-Riemannian nature of
  perceptual color space*, PNAS 2022, [10.1073/pnas.2119753119](https://doi.org/10.1073/pnas.2119753119)
- Bujack, Stark, Turton, Miller & Rogers, *The Geometry of Color in the Light of
  a Non-Riemannian Space*, CGF 2025, [10.1111/cgf.70136](https://doi.org/10.1111/cgf.70136)

## Run

```
npm install
node serve.js      # http://localhost:8080
node color-space.ts   # self-check
```

No build step. The dev server strips TypeScript types on the way out, so the
browser imports `color-space.ts` directly and edits are live.

## The space

`color-space.ts` is the whole model, as a triple **(M, g, f)**:

| | | |
|---|---|---|
| **M** | chart | Oklab scaled by 100 |
| **g** | metric | **local** structure, Riemannian, additive — arc length |
| **f** | returns | **global** structure, concave, **not** additive — perceived difference |

`f(s) = s₀·ln(1 + s/s₀)` with `s₀ = 100/a ≈ 18.7`, which is the paper's Eq. 18
renormalised so `f'(0) = 1`. That collapses both fitted parameters into a single
knee: below it differences add, above it they saturate.

Two properties make the split workable, and the 2025 paper argues for exactly
this construction:

- `f` monotone ⇒ geodesics of `g` are unchanged. Plan with `g`.
- `f` concave, `f(0) = 0` ⇒ `f∘s` is subadditive, so it is still a metric —
  just not an intrinsic one.

**Use arc length for anything integrated along a path** (spacing a continuous
palette) **and perceived difference for anything compared as a jump**
(separating a discrete one). Conflating the two is the bug the file exists to
prevent.

## The tool

`index.html` is a three.js viewer: one scene, four scissored viewports (three
orthographic cuts and a 3D view), so picking and dragging are a single code
path across all of them.

- **Palettes** — continuous trajectories (centripetal Catmull–Rom through
  control points) or discrete sets. matplotlib colormaps and Tableau/Okabe–Ito/
  ColorBrewer sets load as editable control points.
- **Colour vision** — Brettel 1997, all three dichromacies with severity,
  applied to the swatches *and* the gamut solid.
- **Gamuts** — sRGB, Display P3, Adobe RGB, Rec.2020, ProPhoto, ACEScg, NTSC
  1953. Derived from primaries and white point; the selector changes what is
  *reachable*, the screen stays sRGB.
- **Spaces** — Oklab, CIELAB, CIELUV, IPT, XYZ, sRGB. A change of chart: points
  live in the chart, so switching view never moves a palette.
- **Constraints** — keep-out spheres and halfplanes, lightness/chroma bounds,
  and a hard gamut projection applied wherever state becomes geometry.
- **Optimisation** — numeric gradients over the control points, per term or
  combined, with pinnable endpoints.

## Status

The optimiser takes single steps at a fixed rate; there is no line search and no
solver loop yet. Relative term weights would be the next knob.
