### Spaces

The panels are drawn in the space chosen here, and every distance is measured in it.
Changing it does not move a single color.
It changes the coordinates you see and edit, and the metric $g$ that says what a step costs, which is what the whole formulation rests on.

Each entry below says what the coordinates are and what the metric does with them.
The **Formulation** dialog, under Optimize, gives the metric itself.

#### Oklab (2020)

[Björn Ottosson's](https://bottosson.github.io/posts/oklab/) space, scaled by 100.
This is the chart every color is stored in, so choosing it makes the metric the identity and lengths ordinary Euclidean ones.
It is the cheapest option and the default, and it is a reasonable stand-in for the others: it was fitted to the same difference data they were.

#### CIELAB (1976)

The oldest of them, and still the reference for industrial color difference.
Distance here is $\Delta E_{ab}^*$, the plain Euclidean one.
Its known failure is chroma: differences far from the neutral axis read as much larger than they look, which is the defect every formula below it was written to repair.

#### CIEDE2000 (2001)

CIELAB's coordinates, measured with [CIEDE2000](https://en.wikipedia.org/wiki/Color_difference#CIEDE2000) instead of the straight line.
It is a weighting of CIELAB differences rather than a space to convert into, and for a small difference its formula

$$
\Delta E_{00}^2=\left(\frac{\Delta L}{S_L}\right)^2+\left(\frac{\Delta C'}{S_C}\right)^2
   +\left(\frac{\Delta H'}{S_H}\right)^2+R_T\,\frac{\Delta C'}{S_C}\,\frac{\Delta H'}{S_H}
$$

is a quadratic form on $(\mathrm{d}L,\ \mathrm{d}C',\ C'\mathrm{d}h')$: the three weights $S_L$, $S_C$, $S_H$ are functions of the point, and $\Delta H'\to C'\mathrm{d}h'$ as the pair closes up.
So it is a metric tensor, and it goes through the same machinery as everything else.

$S_C$ and $S_H$ grow with chroma, which is the repair of CIELAB: the same step costs less the further out it happens.
$R_T$ is a rotation between chroma and hue that only bites in the blue, around $h'=275^\circ$, where CIELAB's error is worst.
It is also what stops the metric being $J^{\top}J$ for any map, so this is the one space here whose form is not the identity.

#### CIELUV (1976)

CIELAB's contemporary, kept for additive mixture: a mixture of two lights lies on the straight line between them in the $u'v'$ chromaticity it is built on.
That is a property CIELAB does not have and displays do.
Its chroma behaviour is no better than CIELAB's.

#### IPT (1998)

Ebner and Fairchild, built so that lines of constant hue stay straight.
CIELAB bends them, most visibly in the blues, where a ramp at fixed hue angle drifts toward purple.
Worth choosing when hue is the thing you are controlling.

#### ICtCp (BT.2100)

The broadcast space, IPT reworked around the [PQ](https://en.wikipedia.org/wiki/Perceptual_quantizer) transfer function for high dynamic range.
It keeps IPT's straight hue lines and behaves over a far wider luminance range.
For an sRGB gamut that range is mostly unused, so it reads much like IPT here.

#### CAM02-UCS (2006)

The most elaborate: a full appearance model with a viewing condition, then a uniform space fitted on top of it.
It is the best-performing of these on the difference data, and the slowest, since it has no analytic Jacobian here and is differentiated by central differences.

#### CIE XYZ (1931)

The tristimulus values themselves, scaled by 100.
Not perceptual in any sense and not meant to be.
It is here because it is the space everything else is defined against, and seeing a gamut in it shows how little of a uniform space it is.

#### sRGB cube

The encoded channel values, scaled by 100, gamma and all.
The gamut is a cube by construction, which makes it the one space where the boundary is easy to see and the distances mean nothing at all.
Distance here is what a naive tool measures when it interpolates between two hex codes.
