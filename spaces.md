### Spaces

The panels are drawn in the space chosen here, and every distance is measured in it.
Changing it does not move a single color.
It changes the coordinates you see and edit, and the metric $g$ that says what a step costs.
The rest of the formulation is built on that metric.

Every space is a map out of the chart, and $g$ is that map's Jacobian squared: $g=J^{\top}AJ$, with $A$ the identity except where noted.
Four of them are differentiated analytically and the rest by central differences, which costs about three times as much per metric evaluation.
The **Formulation** dialog, under Optimize, gives the metric itself.

#### What a color space is

Light arriving at the eye is a spectrum: a power at every wavelength.
The eye does not report it.
Three kinds of cone each respond across a broad band, so what leaves the retina is three numbers, each of them that spectrum weighted by one cone's sensitivity and summed over all wavelengths.
Two lights built from quite different spectra can produce the same three numbers, and then nothing distinguishes them.
Such a pair are [metamers](https://en.wikipedia.org/wiki/Metamerism_%28color%29), and they are the reason a screen with three primaries can stand in for a world of spectra.

Color is therefore three-dimensional, and the CIE fixed coordinates for it in 1931.
The [tristimulus values](https://en.wikipedia.org/wiki/CIE_1931_color_space) $X$, $Y$ and $Z$ are the spectrum integrated against three color matching functions.
Those functions are a linear recombination of the cone responses, arranged so that $Y$ comes out as luminance and none of the three ever goes negative.
Keeping them positive is what left $X$ and $Z$ answering to nothing you can see.

A color space is a set of coordinates on those same three dimensions, and the choice of coordinates is what decides whether a distance means anything.
CIELAB, Oklab and the rest were built so that the distance between two colors says something about how far apart they look.
They disagree about it, which is why this is a control and not a constant.

The ones below are listed oldest first.

#### CIE XYZ (1931)

The [tristimulus values](https://en.wikipedia.org/wiki/CIE_1931_color_space) themselves, scaled by 100.
Every other space here is defined against them.
The axes are $X$, $Y$ and $Z$, and the space is linear in light: add two lights and their coordinates add, which is true here and of nothing else on this list.
$Y$ is luminance; $X$ and $Z$ have no perceptual reading at all.
Equal steps in it are nowhere near equal to look at.
Everything after it on this list exists for that reason: seeing a gamut in XYZ shows how much a uniform space is correcting.
Its Jacobian is a constant, so it is the cheapest space after the chart itself.

#### CIELAB (1976)

The CIE's [first uniform space](https://en.wikipedia.org/wiki/CIELAB_color_space) and still the reference for industrial color difference.
The axes are $L^*$ from 0 at black to 100 at white, $a^*$ running green to red, and $b^*$ running blue to yellow, the two opponent pairs the visual system is built on.
$L^*$ is a cube root of luminance relative to white, with a linear toe below $(6/29)^3$ so the slope stays finite at black; $a^*$ and $b^*$ are differences of the same cube root along the other two axes, scaled by 500 and 200.
Distance is $\Delta E_{ab}^*$, the plain Euclidean one.
Its known failure is chroma: a step far from the neutral axis reads as much larger than it looks.
Every formula after it was written to repair that defect.
Differentiated analytically.

#### CIELUV (1976)

[CIELAB's twin](https://en.wikipedia.org/wiki/CIELUV), recommended in the same year and kept for additive mixture.
It shares $L^*$ exactly and replaces the opponent axes with $u^*$ and $v^*$, each $13L^*$ times how far the color's chromaticity sits from the white point's in the $u'v'$ diagram.
So the two chromatic axes are a scaled displacement rather than a cone difference, and they collapse to zero at black with $L^*$.
A mixture of two lights lies on the straight line between them there, which is true of displays and not true in CIELAB.
Its chroma behaviour is no better than CIELAB's.
Differentiated by central differences.

#### sRGB cube (1996)

The [encoded channel values](https://en.wikipedia.org/wiki/SRGB), scaled by 100, gamma and all.
The axes are $R$, $G$ and $B$, each running 0 to 1 before that scaling, and none of them means anything on its own beyond how hard one phosphor is driven.
Rec.709 primaries and the piecewise transfer that is linear below 0.0031308 and a $1/2.4$ power above it, from the [HP and Microsoft proposal](https://www.w3.org/Graphics/Color/sRGB.html) later standardised as IEC 61966-2-1.
The gamut is a cube by construction, which makes it the one space where the boundary is trivial to see and the distances mean nothing.
Distance here is what a tool measures when it interpolates between two hex codes.
Differentiated analytically.

#### IPT (1998)

Ebner and Fairchild, and the ancestor of every opponent space after it.
Wikipedia folds it into the [ICtCp](https://en.wikipedia.org/wiki/ICtCp#In_IPT) article, its own descendant.
Cone responses, a $0.43$ power on each, then a fixed opponent matrix.
The axes are named for what they carry: $I$ is intensity, $P$ is the protan axis from green to red, and $T$ is the tritan axis from blue to yellow, each named for the deficiency that loses it.
It was built for one property: lines of constant hue stay straight, where CIELAB bends them most visibly in the blues, so a ramp at fixed hue angle there drifts toward purple.
Worth choosing when you are controlling hue.
Differentiated analytically.

#### CIEDE2000 (2001)

CIELAB's coordinates, measured with [CIEDE2000](https://en.wikipedia.org/wiki/Color_difference#CIEDE2000) rather than the straight line.
It weights CIELAB differences; it is not a space to convert into.
For a small difference its formula

$$
\Delta E_{00}^2=\left(\frac{\Delta L}{S_L}\right)^2+\left(\frac{\Delta C'}{S_C}\right)^2
   +\left(\frac{\Delta H'}{S_H}\right)^2+R_T\,\frac{\Delta C'}{S_C}\,\frac{\Delta H'}{S_H}
$$

is a quadratic form on $(\mathrm{d}L,\ \mathrm{d}C',\ C'\mathrm{d}h')$.
The weights are functions of the point, and $\Delta H'\to C'\mathrm{d}h'$ as the pair closes up.
$\Delta E_{00}^2$ is therefore a metric tensor, and goes through the same code as the other spaces.

$S_C=1+0.045C'$ and $S_H=1+0.015C'T$ grow with chroma, which is the repair of CIELAB: the same step costs less the further out it happens.
$R_T$ rotates between chroma and hue and is active only in the blue, within about $25^\circ$ of $h'=275^\circ$, where CIELAB's error is worst.
That cross term also stops $g$ being $J^{\top}J$ for any map, so CIEDE2000 is the one space here whose $A$ is not the identity.
The coordinates are CIELAB's, so it reuses that analytic Jacobian.

#### CAM02-UCS (2006)

The most elaborate of them, a full [appearance model](https://en.wikipedia.org/wiki/CIECAM02) with a uniform space fitted on top of it.
CIECAM02 is evaluated under the average surround the fit was made for, which fixes the adapting luminance and the background.
Luo, Cui and Li then compress its lightness and colourfulness into $J'$ and $M'$.
The axes are $J'$ and the pair $a'=M'\cos h$, $b'=M'\sin h$, so the plane is polar underneath: CIECAM02 produces a hue angle and a colourfulness, and the Cartesian form is laid over them to make a distance.
It performs best of these on the difference data, and it is the slowest, at about five times CIELAB per metric evaluation with no analytic Jacobian to fall back on.
CAM02-UCS and CIEDE2000 are the two entries here that agree: viridis measures 154 under one and 160 under the other, where the rest of the list spans 67 to 257.

The $M'=\ln(1+0.0228M)/0.0228$ compression is the same logarithmic shape as this tool's own $f$, with $s_0=1/0.0228\approx 43.9$.
Pulling a metric back through it and then handing the result to $f$ would compress chroma twice, so the view keeps $M'$ and the metric differentiates the uncompressed $M$.

#### ICtCp (BT.2100, 2016)

The [broadcast space](https://en.wikipedia.org/wiki/ICtCp), IPT reworked for high dynamic range.
The axes keep IPT's meanings under new names: $I$ is intensity, $C_t$ is the tritan chroma, and $C_p$ is the protan chroma.
Cone responses again, but through the [PQ](https://en.wikipedia.org/wiki/Perceptual_quantizer) transfer function of ST 2084 rather than a power, then a fixed opponent matrix.
$I$ is scaled here so white reads 100, like every other lightness on this list.
It keeps IPT's straight hue lines.
But PQ is scaled for a luminance range an sRGB gamut never approaches, so inside that gamut it is mostly rescaling what IPT already says: viridis measures 116 here against IPT's 134.
Differentiated by central differences.

#### Oklab (2020)

[Ottosson's](https://bottosson.github.io/posts/oklab/) space ([Wikipedia](https://en.wikipedia.org/wiki/Oklab_color_space)), scaled by 100, and the chart every color in this tool is stored in.
Cone responses, a cube root, then an opponent matrix, with the matrices fitted to the CAM16-UCS and IPT difference data rather than derived.
The axes are $L$, $a$ and $b$, meaning what CIELAB's do: lightness, green to red, and blue to yellow.
They sit on a cube root of cone response where CIELAB's sit on a cube root of luminance.
Choosing it makes $J$ the identity, so the metric is $I$ and lengths are ordinary Euclidean ones.
Oklab is the cheapest option and the default.
It is also a fair stand-in for the rest of this list, since it was fitted to much the same data they were.
It has no appearance model: no adapting luminance, no surround, and nothing to say how a color shifts when the room does.
CAM02-UCS is the entry here that does.
