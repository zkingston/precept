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
npm run serve     # http://localhost:8080
npm run check     # self-check
```

No build step for development. The dev server strips TypeScript types on the way
out, so the browser imports `color-space.ts` directly and edits are live.

## Deploy

```
npm run build     # writes docs/
```

GitHub Pages is a plain static host, which the dev setup is not: browsers cannot
parse TypeScript, and the import map points at absolute `/node_modules` paths
that would resolve to the *domain* root on a project site. `build.js` undoes
both — types stripped once into `docs/color-space.js`, three and its addons
vendored into `docs/vendor/`, and every specifier rewritten relative.

It vendors by following imports rather than by naming files, because
`three.module.js` is a shim that re-exports `three.core.js`. Naming the two
files the page imports leaves a 404 that only appears once it is served
statically.

`docs/` is a build artifact but is committed, since Pages serves from the repo.
Rebuild before pushing, then point Pages at `/docs` on `main`.

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
- **Constraints** — keep-out spheres, rotatable halfplanes, lightness/chroma/hue
  bounds shaded into the views, and a hard gamut projection applied wherever
  state becomes geometry.
- **Optimisation** — Adam over the control points, one step at a time or run
  continuously, with per-term enable and weight, and pinnable endpoints.

## Status

Adam runs over the control points, either stepped or continuous. Each term's
gradient is normalised before weighting, so a weight is a relative pull rather
than a number that has to fight the term's units — these objectives span four
orders of magnitude, and an unnormalised sum is just the largest one.

Gradients are numeric (central differences over 3n coordinates), which is the
dominant cost and caps the solver at roughly ten iterations a second; analytic
gradients for the cheap terms are the obvious next win.

Reconstructing a known colormap from its endpoints reproduces every property it
was designed around — lightness linearity, monotonicity, CVD separation — but
not its hue path, which was a human choice and has to be supplied as a
constraint. With one hue arc, mean ΔE to viridis drops from 16.2 to 6.2.
