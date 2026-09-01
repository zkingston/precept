### Formulation

#### Space

Colors are the points of \(M=\mathbb{R}^3\), [Oklab](https://en.wikipedia.org/wiki/Oklab_color_space)
coordinates scaled by 100. A color is \(p=(L,a,b)\) with lightness \(L\in[0,100]\), chroma
\(C(p)=\sqrt{a^2+b^2}\), and hue \(h(p)=\operatorname{atan2}(b,a)\).

A symmetric positive definite \(g(p)\in\mathbb{R}^{3\times3}\) sets the cost of a short step at
\(p\). Segment lengths use the midpoint rule. Path length is the sum over segments:

\[ \ell_g(p,q)=\sqrt{(q-p)^{\top}g\!\left(\tfrac{p+q}{2}\right)(q-p)},\qquad
   \ell_g(\gamma)=\sum_{k}\ell_g(\gamma_k,\gamma_{k+1}) \]

\(g=J^{\top}J\), where \(J\) is the Jacobian at \(p\) of the map from \(M\) to the working space
selected in the panel, scaled so the gray axis measures 100 in every space. Choosing Oklab gives
\(g=I\) and the ordinary Euclidean length, written \(\ell_I\).

Perceived difference is a concave function of length:

\[ d(p,q)=f\bigl(\ell_g(p,q)\bigr),\qquad f(s)=s_0\ln\left(1+\frac{s}{s_0}\right),\qquad
   s_0=\frac{100}{5.34}\approx 18.7,\qquad f'(0)=1 \]

Concavity of \(f\) makes \(d\) [subadditive](https://en.wikipedia.org/wiki/Subadditivity):
\(d(p,r)\le d(p,q)+d(q,r)\), strictly in general. Accumulate along a path with \(\ell_g\); compare
two colors with \(d\). Write \(d_I\) for \(d\) taken with \(g=I\).

#### Variables

The variables are the control points \(P=(p_1,\dots,p_n)\in M^n\). The points indexed by
\(\mathcal{P}\subseteq\{1,\dots,n\}\) are held fixed.

The points are partitioned into runs. Every point has at most two neighbours, so a run is a path or
a cycle, and \(P\) is ordered with each run consecutive. Write \(\mathcal{R}\) for the runs,
\(|r|\) for the number of points in run \(r\), and \(\mathcal{C}\subseteq\mathcal{R}\) for the
closed ones.

In continuous mode each run has its own spline \(\gamma_r\), the
[centripetal Catmull–Rom spline](https://en.wikipedia.org/wiki/Centripetal_Catmull%E2%80%93Rom_spline)
through its points, closed when the run is, with length \(\ell_r=\ell_g(\gamma_r)\). Run \(r\)
contributes \(|r|\) swatches, resampled from \(\gamma_r\) at equal \(g\)-arc length, so the palette
\(\Pi(P)=(\pi_1,\dots,\pi_n)\) has one swatch per control point. In discrete mode \(\Pi(P)=P\) and
there are no curves.

Write \(t_i=(i-1)/(n-1)\) for the position of swatch \(i\) along the palette, and \(Q\) for the
probe set where constraints and contrast are evaluated: every curve sample in continuous mode, the
palette in discrete mode.

#### Feasible set

\[ \mathcal{F}=G\cap\Lambda\cap X\cap H\cap\textstyle\bigcap_j B_j^{\,c}\cap\bigcap_m E_m \]

<dl>
  <dt>\(G=\{p:\operatorname{rgb}_\Gamma(p)\in[0,1]^3\}\)</dt><dd><a href="https://en.wikipedia.org/wiki/Gamut">gamut</a> of primaries \(\Gamma\)</dd>
  <dt>\(\Lambda=\{p: L_-\le L\le L_+\}\)</dt><dd>lightness band</dd>
  <dt>\(X=\{p: C_-\le C(p)\le C_+\}\)</dt><dd>chroma band</dd>
  <dt>\(H=\{p: C(p)<1 \ \vee\ h(p)\in[h_-,h_+]\}\)</dt><dd>hue arc, mod \(360\)</dd>
  <dt>\(B_j=\{p: d(p,c_j)<r_j\}\)</dt><dd>excluded balls, radius in perceived units</dd>
  <dt>\(E_m=\{p: n_m^{\top}\sigma(p)\le d_m\}\)</dt><dd>halfplanes, \(\sigma\) the map to the working space</dd>
</dl>

The violation \(c(p)\) measures how far \(p\) lies outside \(\mathcal{F}\). It is zero on
\(\mathcal{F}\) and differentiable off it. Each \(\phi\) is a squared distance outside its set, so
each root is a length in units of \(M\). \(\Delta h\) is the angle to the nearest edge of the hue
arc. With \([x]_+=\max(x,0)\),

\[ c(p)=\sqrt{\phi_G(p)}+[L_--L]_++[L-L_+]_++[C_--C]_++[C-C_+]_+
      +\frac{\pi}{180}\,C\,\Delta h(p)+\sqrt{\phi_B(p)}+\sqrt{\phi_E(p)} \]

A control point is put back into \(\mathcal{F}\) by projection,
\(p_i\leftarrow\Pi_{\mathcal{F}}(p_i)\), onto \(G,\Lambda,X,H,E,B\) in turn, repeating until
\(c(p_i)\) falls below \(10^{-4}\) or twelve rounds pass. The projection does not return the nearest
point of \(\mathcal{F}\): the set is not convex.

#### Objectives

Each term is written for the palette \(\Pi(P)\). Each is a row in the panel behind this dialog,
under the name given here. The observer set \(V\) is the identity alone, or the identity together
with the three [color vision deficiencies](https://en.wikipedia.org/wiki/Color_blindness); every
\(v\in V\) acts on \(M\).

{.terms}
- **repulsion** <span class="d">separates every pair</span>

  \[ F_{\text{rep}}=\sum_{v\in V}\ \sum_{i<j}\ \frac{1}{\max\left(\tfrac12,\ d(v\pi_i,\,v\pi_j)\right)} \]

  The floor of \(\tfrac12\) keeps the sum finite when two colors coincide. Since \(d\) saturates,
  far pairs contribute almost nothing and the near pairs drive the step. The panel lists it twice:
  once for the observer on screen, once for all four observers together.

- **arc length**

  \[ F_{\text{arc}}=\sum_{r\in\mathcal{R}}\ell_r \]

- **bending** <span class="d">how sharply the ramp curves</span>

  \[ F_{\text{bend}}=\frac1{|\mathcal{R}|}\sum_{r\in\mathcal{R}}
     \frac{\ell_r}{4\pi^2}\int_{\gamma_r}\kappa^2\,ds \]

  \(\kappa\) is the [curvature](https://en.wikipedia.org/wiki/Curvature) of the run, and the
  integral is its [bending energy](https://en.wikipedia.org/wiki/Elastica_theory). On the sampled
  curve the turn \(\theta_i\) at a sample is divided by the arc length that sample owns, so the sum
  is \(\int\kappa^2ds\) and does not change when you add a control point. The factor
  \(\ell_r/4\pi^2\) makes it dimensionless: a circle is 1 at any radius, a straight ramp is 0.

  Squared rather than absolute. Total turning alone cannot separate a kink from a sweep: a ramp
  that turns 180° at one point and a smooth half-circle both total 180°. Squaring divides the turn
  by the length it happens over, so a tight bend costs far more than the same rotation spread out.

- **lightness profile** and **hue profile** <span class="d">distance from the curves drawn in the plots</span>

  \[ F_{\text{lramp}}=\frac1n\sum_i\bigl(L(\pi_i)-\widehat L(t_i)\bigr)^2 \]

  \[ F_{\text{hue}}=\frac1n\sum_{i\,:\,C_i\ge 1}\left(\frac{\pi}{180}\,C_i\,
     \delta\bigl(h_i,\ \widehat h(t_i)\bigr)\right)^2 \]

  Both terms are the squared distance from the swatches to a curve you draw, and \(\widehat L\) and
  \(\widehat h\) are those curves. Lightness is a plain difference. Hue is an angle, so \(\delta\)
  takes the signed shortest one and the wrap at \(0^\circ\) costs nothing, and chroma weights it
  because a \(40^\circ\) error matters at chroma 20 and not at chroma 2. Swatches below chroma 1
  have no usable hue and are skipped by the hue term.

- **chroma target** <span class="d">aims at the middle of the chroma band</span>

  \[ F_{\text{chr}}=\frac1n\sum_i\left(C(\pi_i)-\frac{C_-+C_+}{2}\right)^2 \]

- **control point spacing** <span class="d">keeps consecutive control points evenly spaced</span>

  \[ F_{\text{sp}}=\sum_{i=1}^{m}\frac{\bar\ell}{\ell_i}-m,\qquad
     \ell_i=\max\left(\tfrac{1}{20},\ \ell_g(\cdot,\cdot)\right),\qquad
     \bar\ell=\frac1m\sum_i\ell_i \]

  The \(\ell_i\) are the gaps between neighbouring control points, over every run. \(m\) is how
  many there are. A closed run has one more gap than it has points, the one that wraps. The space
  across a break is not a gap and is not counted.

  The spacing term is the ratio of the arithmetic mean of the \(\ell_i\) to their harmonic mean,
  less one. It is zero exactly when the \(\ell_i\) are equal, and grows without bound as any one of
  them shrinks toward zero. It is also scale invariant, so shrinking every segment by the same
  factor leaves it at zero. The scale comes from the pinned control points, or from leaving
  **arc length** off.

- **pairwise uniformity** <span class="d">equal perceived steps, corrected for saturation</span>

  \[ F_{\text{pair}}=\frac{1}{|\mathcal{K}|}\sum_{(i,j)\in\mathcal{K}}
     \bigl(d_I(\pi_i,\pi_j)-\tau_{ij}\bigr)^2,\qquad
     \tau_{ij}=f\left(\frac{s_{ij}}{S_r}\,\ell_r\right) \]

  \(\mathcal{K}\) is the pairs that are part of the same continuous run. Along an open run the two
  swatches are \(s_{ij}=j-i\) steps apart out of \(S_r=|r|-1\). Around a closed one the walk goes
  the short way, \(s_{ij}=\min(j-i,\,|r|-(j-i))\) out of \(S_r=|r|\): an index difference is the
  distance along an open ramp, and a loop has no such thing. \(\tau_{ij}\) is \(f\) of the arc a
  uniform traversal covers in that many steps. In an additive space the target would be
  proportional to the step count instead. Both distances are taken with \(g=I\), where \(f\) is
  calibrated.

- **diverging symmetry** <span class="d">the two arms mirror each other in lightness</span>

  \[ F_{\text{sym}}=\frac{1}{|\mathcal{S}|}\sum_{(i,j)\in\mathcal{S}}\bigl(L(\pi_i)-L(\pi_j)\bigr)^2 \]

  \(\mathcal{S}\) pairs swatch \(k\) of an open run with swatch \(|r|-1-k\) of the same one. A
  diverging map depends on that mirroring: equal magnitudes either side of the center read as
  equal. In lightness only.

- **contrast floor** <span class="d">nothing unreadable against a chosen background</span>

  \[ F_{\text{con}}=\sum_{q\in Q}\bigl[\kappa_{\min}-\kappa(q,\beta)\bigr]_+^2 \]

  \(\kappa\) is the [WCAG 2](https://en.wikipedia.org/wiki/Web_Content_Accessibility_Guidelines)
  contrast ratio against a background \(\beta\). A hinge, so the term stops once the floor is met
  rather than trading against the rest of the palette.

- **lightness spread** <span class="d">every pair separable in grayscale</span>

  \[ F_{\text{lsep}}=\sum_{i<j}\bigl[\Delta_L-|L_i-L_j|\bigr]_+^2,\qquad
     \Delta_L=\frac{L_+-L_-}{n-1} \]

  A hinge again. \(\Delta_L\) is derived rather than set by hand: \(n\) swatches spread over the
  lightness band are at best \((L_+-L_-)/(n-1)\) apart.

#### Optimization

\[ \min_{P}\ \sum_k w_k F_k(P)\qquad\text{s.t.}\qquad p_i\in\mathcal{F}\ \ \forall i,
   \qquad \gamma_r(t)\in\mathcal{F}\ \ \forall r\in\mathcal{R},\ \forall t \]

We solve using an
[augmented Lagrangian](https://en.wikipedia.org/wiki/Augmented_Lagrangian_method) formulation. The
curve enters the objective as one more term. With \(c_k=c(\gamma_k)\) and multipliers
\(\lambda\in\mathbb{R}_{\ge0}^{K}\),

\[ F_{\text{feas}}=\sum_k\left(\lambda_k c_k+\tfrac12 c_k^2\right),\qquad
   \lambda_k\leftarrow\min(\lambda_{\max},\ \lambda_k+\rho\,c_k) \]

The multipliers update every \(T=25\) inner iterations. \(\rho\) doubles whenever \(\max_k c_k\)
fails to fall below \(\tfrac34\) of its previous value. Both are capped. The multipliers absorb the
violation that persists at a given \(\rho\), so a finite \(\rho\) suffices for feasibility. A plain
penalty has only \(\rho\) to escalate. A \(\rho\) large enough to enforce the constraint also
flattens every other term.

Gradients are central differences over the \(3n\) coordinates, skipping the pinned ones. Each term
is normalized to unit max before it is weighted.

\[ \widehat G_k=\frac{\nabla F_k}{\lVert\nabla F_k\rVert_\infty},\qquad
   D=\sum_k u_k\,\widehat G_k,\qquad
   u_k=\begin{cases}\rho\,w_k & k=\text{feas}\\ w_k & \text{otherwise}\end{cases} \]

The terms span four orders of magnitude, so an unnormalized sum would be the largest term's
gradient plus rounding noise. Normalizing first makes each \(w_k\) a relative pull: weight 2
against weight 1 moves the step twice as far, whatever the two terms measure. The feasibility term
is multiplied by \(\rho\) here rather than inside \(F_{\text{feas}}\), because the normalization
would otherwise divide it back out.

[Adam](https://en.wikipedia.org/wiki/Stochastic_gradient_descent#Adam) then runs on \(D\) with
\(\beta_1=0.9\), \(\beta_2=0.999\), and step \(\eta=1.2\,r\), where \(r\) is the rate slider.

The normalizer depends on \(P\), so \(D\) is not the gradient of any fixed function. There is no
descent guarantee.

Restarts are optional. A stall is no improvement of \(5\times10^{-4}\) for \(8T=200\) iterations.
On a stall, every free coordinate takes uniform noise on \([-5,5]\) and the run continues. The
stream is seeded and reset when a run starts, so a scene optimizes to the same palette twice and a
link reproduces the one that made it. The best iterate is kept under the lexicographic order
\(\bigl(\max_k c_k,\ \sum_k w_k F_k\bigr)\), so a feasible palette always beats an infeasible one.
