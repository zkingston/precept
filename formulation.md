### Formulation

#### Space

A color is a point $p=(L,a,b)$ of $M=\mathbb{R}^3$, in [Oklab](https://en.wikipedia.org/wiki/Oklab_color_space) coordinates scaled by 100.
Its lightness is $L\in[0,100]$, its chroma $C(p)=\sqrt{a^2+b^2}$, and its hue $h(p)=\operatorname{atan2}(b,a)$.

A metric $g(p)$, a symmetric positive definite $3\times3$ matrix, sets the cost of a short step at $p$.
A segment's length uses $g$ at its midpoint.
A path's length is the sum of its segments' lengths:

$$
\ell_g(p,q)=\sqrt{(q-p)^{\top}g\!\left(\tfrac{p+q}{2}\right)(q-p)},\qquad
   \ell_g(\gamma)=\sum_{k}\ell_g(\gamma_k,\gamma_{k+1})
$$

$g=J^{\top}AJ$.
$J$ is the Jacobian at $p$ of the map from $M$ to the working space chosen in the panel, and $A$ is the quadratic form that space uses for a small difference.
$g$ is scaled so that the gray axis from black to white measures 100 in every space.
With Oklab as the working space, $g=I$ and length is Euclidean, written $\ell_I$.

$A$ is the identity for every space except CIEDE2000.
CIEDE2000 weights CIELAB differences and has a cross term between chroma and hue, so its $g$ is not $J^{\top}J$ for any $J$.
The **Spaces** dialog, beside the space dropdown, describes each space.

Perceived difference $d$ is a concave function of length:

$$
d(p,q)=f\bigl(\ell_g(p,q)\bigr),\qquad f(s)=s_0\ln\left(1+\frac{s}{s_0}\right),\qquad
   s_0=\frac{100}{5.34}\approx 18.7,\qquad f'(0)=1
$$

Because $f$ is concave, $d$ is [subadditive](https://en.wikipedia.org/wiki/Subadditivity): $d(p,r)\le d(p,q)+d(q,r)$, and usually strictly.
Lengths along a path are added with $\ell_g$.
Two colors are compared with $d$.
$d_I$ is $d$ with $g=I$.
For CIEDE2000, $\ell_g(p,q)$ inside $d$ is the full $\Delta E_{00}$ formula between the two colors, scaled like $g$.
The tensor $g$ is its small-difference limit and is used along paths.

#### Variables

The variables are the control points $P=(p_1,\dots,p_n)\in M^n$.
Pinned points, indexed by $\mathcal{P}\subseteq\{1,\dots,n\}$, do not move.

The points are partitioned into runs.
Each point has at most two neighbors, so a run is a path or a cycle.
$P$ lists each run's points consecutively.
$\mathcal{R}$ is the set of runs, $|r|$ the number of points in run $r$, and $\mathcal{C}\subseteq\mathcal{R}$ the closed runs.

In continuous mode each run $r$ has a spline $\gamma_r$: the
[centripetal Catmull–Rom spline](https://en.wikipedia.org/wiki/Centripetal_Catmull%E2%80%93Rom_spline)
through its points, closed if the run is closed.
Its length is $\ell_r=\ell_g(\gamma_r)$.
The run's $|r|$ swatches are resampled from $\gamma_r$ at equal $g$-arc length, so the palette $\Pi(P)=(\pi_1,\dots,\pi_n)$ has one swatch per control point.
In discrete mode there are no curves and $\Pi(P)=P$.

$t_i=(i-1)/(n-1)$ is the position of swatch $i$ along the palette.
$Q$ is the set of points where constraints and contrast are checked: every curve sample in continuous mode, and the swatches in discrete mode.

#### Feasible set

$$
\mathcal{F}=G\cap V\cap\Lambda\cap X\cap H\cap\textstyle\bigcap_j B_j^{\,c}\cap\bigcap_m E_m
$$

<dl>
  <dt>$G=\{p:\operatorname{rgb}_\Gamma(p)\in[0,1]^3\}$</dt><dd><a href="https://en.wikipedia.org/wiki/Gamut">gamut</a> of primaries $\Gamma$</dd>
  <dt>$V=\{p:n_i^{\top}\mathrm{XYZ}(p)\ge 0\ \forall i\}$</dt><dd>physically realizable, 27 planes</dd>
  <dt>$\Lambda=\{p: L_-\le L\le L_+\}$</dt><dd>lightness band</dd>
  <dt>$X=\{p: C_-\le C(p)\le C_+\}$</dt><dd>chroma band</dd>
  <dt>$H=\{p: C(p)<1 \ \vee\ h(p)\in[h_-,h_+]\}$</dt><dd>hue arc, mod $360$</dd>
  <dt>$B_j=\{p: d(p,c_j)<r_j\}$</dt><dd>excluded balls, radius in perceived units</dd>
  <dt>$E_m=\{p: n_m^{\top}\sigma(p)\le d_m\}$</dt><dd>halfplanes, $\sigma$ the map to the working space</dd>
</dl>

The violation $c(p)$ is how far $p$ is outside $\mathcal{F}$.
It is zero inside $\mathcal{F}$ and differentiable outside.
Each $\phi$ is a squared distance to its set, so each square root is a length in units of $M$.
$\phi_G$ is the sum of the squared distances outside each face of the gamut cube and outside each of the 27 planes of $V$.
$\Delta h$ is the angle from $h(p)$ to the nearest end of the hue arc.
With $[x]_+=\max(x,0)$,

$$
c(p)=\sqrt{\phi_G(p)}+[L_--L]_++[L-L_+]_++[C_--C]_++[C-C_+]_+
      +\frac{\pi}{180}\,C\,\Delta h(p)+\sqrt{\phi_B(p)}+\sqrt{\phi_E(p)}
$$

$V$ is the set of colors some physical light can produce: the convex cone over the spectral locus.
If a gamut's primaries are real colors, $G$ is already inside $V$ and the constraint is inactive.
ProPhoto and ACEScg have imaginary primaries, so for those gamuts part of $G$ lies outside $V$ and the constraint is active.

A control point outside $\mathcal{F}$ is projected back, $p_i\leftarrow\Pi_{\mathcal{F}}(p_i)$, onto $G\cap V$, $\Lambda$, $X$, $H$, $E$, and $B$ in turn.
The projection onto $G\cap V$ reduces chroma at fixed lightness until the point is inside both the gamut and $V$.
This repeats until $c(p_i)<10^{-4}$ or twelve rounds have run.
$\mathcal{F}$ is not convex, so the result is not always the nearest point of $\mathcal{F}$.

#### Objectives

Each term below is a function of the palette $\Pi(P)$ and a row in the Optimize panel, under the same name.
The observer set $\mathcal{O}$ is the identity alone, or the identity plus the three
[color vision deficiencies](https://en.wikipedia.org/wiki/Color_blindness).
Each $v\in\mathcal{O}$ is a map on $M$.

{.terms}
- **repulsion** <span class="d">separates every pair</span>

  $$
  F_{\text{rep}}=\sum_{v\in\mathcal{O}}\ \sum_{i<j}\ \frac{1}{\max\left(\tfrac12,\ d(v\pi_i,\,v\pi_j)\right)}
  $$

  The floor of $\tfrac12$ keeps the sum finite when two colors coincide.
  $d$ saturates, so far pairs contribute little and near pairs dominate.
  The panel has two rows for this term: one for the observer on screen and one for all four observers.

- **arc length** <span class="d">total length of the ramp</span>

  $$
  F_{\text{arc}}=\sum_{r\in\mathcal{R}}\ell_r
  $$

- **bending** <span class="d">how sharply the ramp curves</span>

  $$
  F_{\text{bend}}=\frac1{|\mathcal{R}|}\sum_{r\in\mathcal{R}}
     \frac{\ell_I(\gamma_r)}{4\pi^2}\int_{\gamma_r}\kappa^2\,ds
  $$

  $\kappa$ is the [curvature](https://en.wikipedia.org/wiki/Curvature) of the run and the integral is its [bending energy](https://en.wikipedia.org/wiki/Elastica_theory).
  Curvature and length in this term are measured in Oklab, with $g=I$, whatever the working space.
  On the sampled curve, the integral is approximated by the sum over samples of the squared turning angle $\theta_i$ divided by the arc length that sample covers.
  This sum converges to $\int\kappa^2\,ds$ as the sampling is refined, and adding a control point does not change it.
  The factor $\ell_r/4\pi^2$ makes the term dimensionless: a circle scores 1 at any radius and a straight ramp scores 0.

  Curvature is squared so that a sharp turn costs more than a gradual one.

- **lightness profile** and **hue profile** <span class="d">distance from the curves drawn in the plots</span>

  $$
  F_{\text{lramp}}=\frac1n\sum_i\bigl(L(\pi_i)-\widehat L(t_i)\bigr)^2
  $$

  $$
  F_{\text{hue}}=\frac1n\sum_{i\,:\,C_i\ge 1}\left(\frac{\pi}{180}\,C_i\,
     \delta\bigl(h_i,\ \widehat h(t_i)\bigr)\right)^2
  $$

  $\widehat L$ and $\widehat h$ are the curves drawn in the two plots.
  Each term is the mean squared distance from the swatches to its curve.
  For lightness the distance is the difference $L(\pi_i)-\widehat L(t_i)$.
  For hue, $\delta$ is the shortest signed angle between the two.
  The hue error is weighted by chroma.
  Swatches below chroma 1 have no usable hue and are skipped.

- **chroma target** <span class="d">aims at the middle of the chroma band</span>

  $$
  F_{\text{chr}}=\frac1n\sum_i\left(C(\pi_i)-\frac{C_-+C_+}{2}\right)^2
  $$

  Each swatch is pulled toward the center of the chroma band.

- **control point spacing** <span class="d">keeps consecutive control points evenly spaced</span>

  $$
  F_{\text{sp}}=\sum_{i=1}^{m}\frac{\bar\ell}{\ell_i}-m,\qquad
     \ell_i=\max\left(\tfrac{1}{20},\ \ell_g(\cdot,\cdot)\right),\qquad
     \bar\ell=\frac1m\sum_i\ell_i
  $$

  The $\ell_i$ are the gaps between neighboring control points in every run, and $m$ is the number of gaps.

  The term is the ratio of the arithmetic mean of the gaps to their harmonic mean, minus one.
  It is zero when the gaps are equal and grows without bound as any gap shrinks toward zero.
  It is scale invariant, so shrinking every gap by the same factor leaves it unchanged, and it does not set the size of the ramp.
  The size is set by pinned control points, or by leaving **arc length** off so that no term shrinks the ramp.

- **pairwise uniformity** <span class="d">equal perceived steps, corrected for saturation</span>

  $$
  F_{\text{pair}}=\frac{1}{|\mathcal{K}|}\sum_{(i,j)\in\mathcal{K}}
     \bigl(d_I(\pi_i,\pi_j)-\tau_{ij}\bigr)^2,\qquad
     \tau_{ij}=f\left(\frac{s_{ij}}{S_r}\,\ell_r\right)
  $$

  $\mathcal{K}$ is the set of swatch pairs in the same continuous run.
  In an open run, swatches $i$ and $j$ are $s_{ij}=j-i$ steps apart out of $S_r=|r|-1$.
  In a closed run the count is the shorter way around, $s_{ij}=\min(j-i,\,|r|-(j-i))$ out of $S_r=|r|$.
  $\tau_{ij}$ is the perceived difference of two points $s_{ij}$ uniform steps apart along the run, which is $f$ of that fraction of the arc length.
  Distance and arc length both use $g=I$, the metric $f$ was calibrated for.

- **diverging symmetry** <span class="d">the two arms mirror each other in lightness</span>

  $$
  F_{\text{sym}}=\frac{1}{|\mathcal{S}|}\sum_{(i,j)\in\mathcal{S}}\bigl(L(\pi_i)-L(\pi_j)\bigr)^2
  $$

  $\mathcal{S}$ pairs swatch $k$ of an open run with swatch $|r|-1-k$, its mirror image about the center.
  Only lightness is compared.

- **contrast floor** <span class="d">every swatch readable against a chosen background</span>

  $$
  F_{\text{con}}=\sum_{q\in Q}\bigl[\kappa_{\min}-\kappa(q,\beta)\bigr]_+^2
  $$

  $\kappa$ is the [WCAG 2](https://en.wikipedia.org/wiki/Web_Content_Accessibility_Guidelines) contrast ratio against the background $\beta$, and $\kappa_{\min}$ is the target ratio.
  The hinge $[\cdot]_+$ makes the term zero once every probe meets the floor, so it has no effect on the other terms after that.

- **lightness spread** <span class="d">every pair separable in grayscale</span>

  $$
  F_{\text{lsep}}=\sum_{i<j}\bigl[\Delta_L-|L_i-L_j|\bigr]_+^2,\qquad
     \Delta_L=\frac{L_+-L_-}{n-1}
  $$

  This term is also a hinge.
  $\Delta_L$ is the largest spacing $n$ swatches can have in the lightness band, so the term is zero only when they are spread evenly over the whole band.

#### Optimization

$$
\min_{P}\ \sum_k w_k F_k(P)\qquad\text{s.t.}\qquad p_i\in\mathcal{F}\ \ \forall i,
   \qquad \gamma_r(t)\in\mathcal{F}\ \ \forall r\in\mathcal{R},\ \forall t
$$

The solver uses an [augmented Lagrangian](https://en.wikipedia.org/wiki/Augmented_Lagrangian_method) method.
The curve constraint becomes one more term in the objective.
With $c_k=c(\gamma_k)$ at the $K$ curve samples and multipliers $\lambda\in\mathbb{R}_{\ge0}^{K}$,

$$
F_{\text{feas}}=\sum_k\left(\lambda_k c_k+\tfrac12 c_k^2\right),\qquad
   \lambda_k\leftarrow\min(\lambda_{\max},\ \lambda_k+\rho\,c_k)
$$

The multipliers absorb the violation that remains at a given $\rho$, so a finite $\rho$ is enough.
They update every $T=25$ iterations.
$\rho$ doubles whenever $\max_k c_k$ has not fallen to $\tfrac34$ of its previous value.
Both $\rho$ and $\lambda$ are capped.

Gradients are central differences over the $3n$ coordinates, skipping pinned ones.
Each term's gradient is normalized to unit max norm before weighting:

$$
\widehat G_k=\frac{\nabla F_k}{\lVert\nabla F_k\rVert_\infty},\qquad
   D=\sum_k u_k\,\widehat G_k,\qquad
   u_k=\begin{cases}\rho\,w_k & k=\text{feas}\\ w_k & \text{otherwise}\end{cases}
$$

The terms span four orders of magnitude, so without normalization the largest would dominate.
With normalization, each $w_k$ is a relative weight: weight 2 pulls twice as hard as weight 1, whatever the terms measure.
The feasibility term is multiplied by $\rho$ here rather than inside $F_{\text{feas}}$, because normalization would otherwise divide $\rho$ back out.

[Adam](https://en.wikipedia.org/wiki/Stochastic_gradient_descent#Adam) steps along $D$ with $\beta_1=0.9$, $\beta_2=0.999$, and step size $\eta=1.2\,r$, where $r$ is the rate slider.
The normalizer depends on $P$, so $D$ is not the gradient of any fixed function and there is no descent guarantee.

Restarts are optional.
A stall is an improvement of less than $5\times10^{-4}$ over $8T=200$ iterations.
On a stall, every free coordinate gets uniform noise on $[-5,5]$ and the run continues.
The noise is seeded and reset at the start of each run, so the same scene optimizes to the same palette every time, and a shared link reproduces its palette.
The best iterate is kept, ordered first by $\max_k c_k$ and then by $\sum_k w_k F_k$, so a feasible palette always beats an infeasible one.
