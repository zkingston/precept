### Spaces

This setting picks the color space the palette is displayed in and the metric $g$ that measures the distance between colors.
Colors are stored in Oklab, called the chart.
Each space is a map from the chart to its own coordinates, with Jacobian $J$.
The metric is $g=J^{\top}AJ$, where $A$ is the identity for every space except CIEDE2000.
The **Formulation** dialog, under Optimize, describes how the optimizer uses $g$.

#### What a color space is

The eye has three kinds of cone.
Each cone's response is the spectrum of the light weighted by that cone's sensitivity and summed over wavelength.
The eye therefore reduces every spectrum to three numbers.
Two different spectra that give the same three numbers look identical.
Such spectra are called [metamers](https://en.wikipedia.org/wiki/Metamerism_%28color%29).

The [International Commission on Illumination (CIE)](https://en.wikipedia.org/wiki/International_Commission_on_Illumination) standardized three coordinates for color in 1931.
The [tristimulus values](https://en.wikipedia.org/wiki/CIE_1931_color_space) $X$, $Y$, and $Z$ are the spectrum integrated against three color matching functions.
The matching functions are linear combinations of the cone sensitivities, chosen so that $Y$ is luminance and all three are positive everywhere.
$X$ and $Z$ have no perceptual meaning of their own.

A color space is a choice of coordinates on those three dimensions.
In XYZ, the Euclidean distance between two colors is not a measure of how different they look.
In the other spaces here, distance approximates perceived difference.
They disagree with one another.
In the equations below, $(X,Y,Z)$ are relative tristimulus values with $Y=1$ at the chart's white $(X_n,Y_n,Z_n)$.

#### CIE XYZ (1931)

XYZ is the [tristimulus values](https://en.wikipedia.org/wiki/CIE_1931_color_space) scaled by 100, so white has $Y=100$.
For a spectrum $S(\lambda)$,

$$
X=\int S(\lambda)\,\bar x(\lambda)\,d\lambda,\qquad
Y=\int S(\lambda)\,\bar y(\lambda)\,d\lambda,\qquad
Z=\int S(\lambda)\,\bar z(\lambda)\,d\lambda
$$

where $\bar x$, $\bar y$, $\bar z$ are the 1931 color matching functions.
$\bar y$ is also the luminous efficiency function, so $Y$ is luminance.

<figure style="margin:10px 0 4px">
<svg viewBox="0 0 640 250" width="100%" role="img" aria-label="CIE 1931 color matching functions" font-family="inherit" font-size="11">
<g stroke="var(--dim)" stroke-width="1" fill="none">
<path d="M34 16V218H626"/>
<path d="M63.6 218v4M137.6 218v4M211.6 218v4M285.6 218v4M359.6 218v4M433.6 218v4M507.6 218v4M581.6 218v4M34 218h-4M34 161.9h-4M34 105.8h-4M34 49.7h-4"/>
</g>
<g fill="var(--dim)" text-anchor="middle"><text x="63.6" y="233">400</text><text x="137.6" y="233">450</text><text x="211.6" y="233">500</text><text x="285.6" y="233">550</text><text x="359.6" y="233">600</text><text x="433.6" y="233">650</text><text x="507.6" y="233">700</text><text x="581.6" y="233">750</text><text x="626" y="233" text-anchor="end">nm</text></g>
<g fill="var(--dim)" text-anchor="end"><text x="27" y="222">0</text><text x="27" y="165.9">0.5</text><text x="27" y="109.8">1</text><text x="27" y="53.7">1.5</text></g>
<g fill="none" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"><path stroke="#ff6f59" d="M34 217.8L41.4 217.7L48.8 217.5L56.2 217.1L63.6 216.4L71 215.4L78.4 213.1L85.8 209.3L93.2 202.9L100.6 193.9L108 186.1L115.4 181.1L122.8 178.9L130.2 178.9L137.6 180.3L145 182.2L152.4 185.4L159.8 189.8L167.2 196.1L174.6 202.1L182 207.3L189.4 211.5L196.8 214.4L204.2 216.4L211.6 217.5L219 217.7L226.4 217L233.8 214.7L241.2 210.9L248.6 205.7L256 199.4L263.4 192.7L270.8 185.4L278.2 177.6L285.6 169.4L293 160.5L300.4 151.3L307.8 141.9L315.2 132.5L322.6 123.5L330 115.2L337.4 108.2L344.8 102.8L352.2 99.4L359.6 98.8L367 100.7L374.4 105.5L381.8 112.7L389.2 122.1L396.6 133.7L404 145.9L411.4 157.2L418.8 167.7L426.2 177.5L433.6 186.2L441 193.5L448.4 199.5L455.8 204.4L463.2 208.2L470.6 210.9L478 212.8L485.4 214.3L492.8 215.5L500.2 216.2L507.6 216.7L515 217.1L522.4 217.4L529.8 217.5L537.2 217.7L544.6 217.8L552 217.8L559.4 217.9L566.8 217.9L574.2 217.9L581.6 218L589 218L596.4 218L603.8 218L611.2 218L618.6 218L626 218"/><path stroke="#4fd18b" d="M34 218L41.4 218L48.8 218L56.2 218L63.6 218L71 217.9L78.4 217.9L85.8 217.8L93.2 217.6L100.6 217.2L108 216.7L115.4 216.1L122.8 215.4L130.2 214.7L137.6 213.7L145 212.6L152.4 211.3L159.8 209.7L167.2 207.8L174.6 205.4L182 202.4L189.4 199L196.8 194.7L204.2 189L211.6 181.8L219 172.3L226.4 161.6L233.8 149.7L241.2 138.3L248.6 129L256 121.3L263.4 115.3L270.8 110.9L278.2 108L285.6 106.3L293 105.8L300.4 106.3L307.8 108.2L315.2 111.2L322.6 115.3L330 120.4L337.4 126.4L344.8 133L352.2 140L359.6 147.2L367 154.4L374.4 161.6L381.8 168.5L389.2 175.2L396.6 182L404 188.3L411.4 193.6L418.8 198.4L426.2 202.5L433.6 206L441 208.8L448.4 211.2L455.8 213L463.2 214.4L470.6 215.4L478 216.1L485.4 216.7L492.8 217.1L500.2 217.4L507.6 217.5L515 217.7L522.4 217.8L529.8 217.8L537.2 217.9L544.6 217.9L552 217.9L559.4 218L566.8 218L574.2 218L581.6 218L589 218L596.4 218L603.8 218L611.2 218L618.6 218L626 218"/><path stroke="#7dd3fc" d="M34 217.3L41.4 216.8L48.8 215.7L56.2 213.9L63.6 210.4L71 205.6L78.4 194.7L85.8 176.3L93.2 145.5L100.6 101.4L108 62.5L115.4 35.9L122.8 21.9L130.2 18L137.6 19.1L145 22.3L152.4 30.7L159.8 46.5L167.2 73.5L174.6 101.1L182 126.8L189.4 148.8L196.8 165.8L204.2 178.4L211.6 187.5L219 194.2L226.4 200.2L233.8 205.5L241.2 209.2L248.6 211.6L256 213.3L263.4 214.7L270.8 215.7L278.2 216.5L285.6 217L293 217.4L300.4 217.6L307.8 217.7L315.2 217.8L322.6 217.8L330 217.8L337.4 217.8L344.8 217.9L352.2 217.9L359.6 217.9L367 217.9L374.4 218L381.8 218L389.2 218L396.6 218L404 218L411.4 218L418.8 218L426.2 218L433.6 218L441 218L448.4 218L455.8 218L463.2 218L470.6 218L478 218L485.4 218L492.8 218L500.2 218L507.6 218L515 218L522.4 218L529.8 218L537.2 218L544.6 218L552 218L559.4 218L566.8 218L574.2 218L581.6 218L589 218L596.4 218L603.8 218L611.2 218L618.6 218L626 218"/></g>
<g font-size="13" font-style="italic"><text fill="#ff6f59" x="369.6" y="92.8">x</text><path stroke="#ff6f59" stroke-width="2" d="M370.1 82.3h6"/><text fill="#4fd18b" x="301" y="99.8">y</text><path stroke="#4fd18b" stroke-width="2" d="M301.5 89.3h6"/><text fill="#7dd3fc" x="140.2" y="14">z</text><path stroke="#7dd3fc" stroke-width="2" d="M140.7 3.5h6"/></g>
</svg>
<figcaption style="color:var(--dim);font-size:11px;margin-top:2px">The CIE 1931 2° color matching functions at 5 nm, as tabulated by the <a href="http://cvrl.ioo.ucl.ac.uk/cmfs.htm">Colour &amp; Vision Research Laboratory</a>.</figcaption>
</figure>

Every other space here is computed from XYZ.
XYZ is linear in light: the coordinates of a mixture of two lights are the sum of their coordinates.

#### CIELAB (1976)

CIELAB is the CIE's [first uniform space](https://en.wikipedia.org/wiki/CIELAB_color_space).

$$
f(t)=\begin{cases}\sqrt[3]{t} & t>\delta^3\\ \dfrac{t}{3\delta^2}+\dfrac{4}{29} & \text{otherwise}\end{cases},\qquad \delta=\tfrac{6}{29}
$$

$$
L^*=116\,f\!\left(\tfrac{Y}{Y_n}\right)-16,\qquad
a^*=500\left[f\!\left(\tfrac{X}{X_n}\right)-f\!\left(\tfrac{Y}{Y_n}\right)\right],\qquad
b^*=200\left[f\!\left(\tfrac{Y}{Y_n}\right)-f\!\left(\tfrac{Z}{Z_n}\right)\right]
$$

$L^*$ is lightness, 0 at black and 100 at white.
$a^*$ runs green to red and $b^*$ blue to yellow.
The linear piece of $f$ below $\delta^3$ keeps the slope finite at black.
Distance is $\Delta E_{ab}^*$, the Euclidean distance in these coordinates.
CIELAB overstates differences at high chroma: a step far from the neutral axis measures larger than it looks.

#### CIELUV (1976)

[CIELUV](https://en.wikipedia.org/wiki/CIELUV) shares $L^*$ with CIELAB.
Its chromatic axes are the displacement from the white point in the $u'v'$ chromaticity diagram, scaled by $13L^*$:

$$
u'=\frac{4X}{X+15Y+3Z},\qquad v'=\frac{9Y}{X+15Y+3Z}
$$

$$
u^*=13L^*\,(u'-u'_n),\qquad v^*=13L^*\,(v'-v'_n)
$$

The factor of $L^*$ takes $u^*$ and $v^*$ to zero at black.
In the $u'v'$ diagram, a mixture of two lights lies on the straight line between them.
CIELUV overstates high-chroma differences, as CIELAB does.

#### sRGB cube (1996)

The sRGB cube is the [encoded sRGB channel values](https://en.wikipedia.org/wiki/SRGB) scaled by 100.
Linear RGB is $M^{-1}(X,Y,Z)$, where $M$ is the matrix built from the [Rec.709](https://en.wikipedia.org/wiki/Rec._709) primaries at $(0.64,0.33)$, $(0.30,0.60)$, $(0.15,0.06)$ and the D65 white at $(0.3127,0.3290)$:

$$
M=\begin{pmatrix}0.4124&0.3576&0.1805\\0.2126&0.7152&0.0722\\0.0193&0.1192&0.9505\end{pmatrix},\qquad
M^{-1}=\begin{pmatrix}3.2406&-1.5372&-0.4986\\-0.9689&1.8758&0.0415\\0.0557&-0.2040&1.0570\end{pmatrix}
$$

Each channel is then encoded:

$$
\operatorname{enc}(c)=\begin{cases}12.92\,c & c\le 0.0031308\\ 1.055\,c^{1/2.4}-0.055 & \text{otherwise}\end{cases},\qquad
(R,G,B)=100\,\operatorname{enc}\!\left(M^{-1}\,\mathrm{XYZ}\right)
$$

Each axis is the drive level of one primary.
The sRGB gamut is a cube in these coordinates, so its boundary is easy to see.
Distance in these coordinates does not correspond to perceived difference.

#### IPT (1998)

IPT is [Ebner and Fairchild's space](https://en.wikipedia.org/wiki/ICtCp#In_IPT).
ICtCp and Oklab, below, have the same structure: a matrix from XYZ to cone responses, a nonlinearity on each response, and an opponent matrix.
In IPT the nonlinearity is a $0.43$ power:

$$
\begin{pmatrix}L\\M\\S\end{pmatrix}=
\begin{pmatrix}0.4002&0.7075&-0.0807\\-0.2280&1.1500&0.0612\\0&0&0.9182\end{pmatrix}
\begin{pmatrix}X\\Y\\Z\end{pmatrix},\qquad
L'=\operatorname{sgn}(L)\left|\frac{L}{L_n}\right|^{0.43}
$$

$$
\begin{pmatrix}I\\P\\T\end{pmatrix}=100
\begin{pmatrix}0.4&0.4&0.2\\4.455&-4.851&0.396\\0.8056&0.3572&-1.1628\end{pmatrix}
\begin{pmatrix}L'\\M'\\S'\end{pmatrix}
$$

$M'$ and $S'$ are computed like $L'$.
This tool divides the cone responses by those of the chart white before the power, so that gray lies exactly on the $I$ axis.
The published space does not normalize.
$I$ is intensity.
$P$ runs green to red and $T$ blue to yellow.
In IPT, lines of constant perceived hue are straight.
IPT is a good choice when the palette's hue path matters.

#### CIEDE2000 (2001)

[CIEDE2000](https://en.wikipedia.org/wiki/Color_difference#CIEDE2000) is a distance formula on CIELAB coordinates.
This entry is CIELAB with distance measured by CIEDE2000 instead of by Euclidean distance.
For a small difference the formula

$$
\Delta E_{00}^2=\left(\frac{\Delta L}{S_L}\right)^2+\left(\frac{\Delta C'}{S_C}\right)^2
   +\left(\frac{\Delta H'}{S_H}\right)^2+R_T\,\frac{\Delta C'}{S_C}\,\frac{\Delta H'}{S_H}
$$

is a quadratic form in $(\mathrm{d}L,\ \mathrm{d}C',\ C'\mathrm{d}h')$.
Its weights depend on the point:

$$
G=\tfrac12\left(1-\sqrt{\frac{C^7}{C^7+25^7}}\right),\qquad a'=(1+G)\,a,\qquad
C'=\sqrt{a'^2+b^2},\qquad h'=\operatorname{atan2}(b,a')
$$

$$
S_L=1+\frac{0.015\,(L-50)^2}{\sqrt{20+(L-50)^2}},\qquad S_C=1+0.045\,C',\qquad S_H=1+0.015\,C'\,T
$$

$$
T=1-0.17\cos(h'-30^\circ)+0.24\cos(2h')+0.32\cos(3h'+6^\circ)-0.20\cos(4h'-63^\circ)
$$

$$
R_T=-2\sqrt{\frac{C'^7}{C'^7+25^7}}\ \sin\!\left(60^\circ\exp\!\left[-\left(\frac{h'-275^\circ}{25^\circ}\right)^2\right]\right)
$$

In the small-difference limit, $\Delta H'\to C'\mathrm{d}h'$ and the mean chroma in $G$ is the chroma at the point.
The parametric factors $k_L$, $k_C$, $k_H$ are 1.
The limit is a metric tensor, and the solver uses it like any other $g$ along paths.
Between two colors compared as a pair, the solver uses the full formula.

$S_C$ and $S_H$ grow with chroma, so the same CIELAB step measures less far from the neutral axis.
This weighting corrects CIELAB's high-chroma error.
$R_T$ couples chroma and hue.
It is active only in the blue, within about $25^\circ$ of $h'=275^\circ$.
Because of that cross term, $g$ is not $J^{\top}J$ for any map.
The coordinates are CIELAB's, so the Jacobian is CIELAB's.

#### CAM02-UCS (2006)

CAM02-UCS is a uniform space fitted on top of [CIECAM02](https://en.wikipedia.org/wiki/CIECAM02), a full color appearance model.
CIECAM02 is evaluated under the conditions the fit assumed: an average surround with $F=1$, $c=0.69$, and $N_c=1$, an adapting luminance $L_A=64/5\pi\ \mathrm{cd/m^2}$, and a background $Y_b=20$ against a white $Y_w=100$.
From those, $n=Y_b/Y_w$, $z=1.48+\sqrt n$, $N_{bb}=N_{cb}=0.725\,n^{-0.2}$, $k=1/(5L_A+1)$, and $F_L=0.2k^4(5L_A)+0.1(1-k^4)^2(5L_A)^{1/3}$.

The model adapts the cone responses toward the white and then compresses them.
With XYZ on the 0 to 100 scale,

$$
\begin{pmatrix}R\\G\\B\end{pmatrix}=
\begin{pmatrix}0.7328&0.4296&-0.1624\\-0.7036&1.6975&0.0061\\0.0030&0.0136&0.9834\end{pmatrix}
\begin{pmatrix}X\\Y\\Z\end{pmatrix},\qquad
D=F\left[1-\tfrac{1}{3.6}\,e^{-(L_A+42)/92}\right],\qquad
R_c=\left(D\,\frac{Y_w}{R_w}+1-D\right)R
$$

$$
\begin{pmatrix}R'\\G'\\B'\end{pmatrix}=
\begin{pmatrix}0.38971&0.68898&-0.07868\\-0.22981&1.18340&0.04641\\0&0&1\end{pmatrix}
M_{\mathrm{CAT02}}^{-1}
\begin{pmatrix}R_c\\G_c\\B_c\end{pmatrix},\qquad
R'_a=\frac{400\,(F_L R'/100)^{0.42}}{27.13+(F_L R'/100)^{0.42}}+0.1
$$

$G_c$, $B_c$, $G'_a$, and $B'_a$ are computed like $R_c$ and $R'_a$.
The compression is extended as an odd function to negative cone responses.
Hue, lightness, and colorfulness are

$$
a=R'_a-\tfrac{12}{11}G'_a+\tfrac{1}{11}B'_a,\qquad
b=\tfrac19\left(R'_a+G'_a-2B'_a\right),\qquad
h=\operatorname{atan2}(b,a)
$$

$$
A=\left(2R'_a+G'_a+\tfrac{1}{20}B'_a-0.305\right)N_{bb},\qquad
J=100\left(\frac{A}{A_w}\right)^{cz}
$$

$$
e_t=\tfrac14\left[\cos(h+2)+3.8\right],\qquad
t=\frac{\frac{50000}{13}\,N_c N_{cb}\,e_t\sqrt{a^2+b^2}}{R'_a+G'_a+\tfrac{21}{20}B'_a},\qquad
C=t^{0.9}\sqrt{\tfrac{J}{100}}\left(1.64-0.29^n\right)^{0.73},\qquad
M=C\,F_L^{0.25}
$$

$h$ is in radians inside $e_t$, and $A_w$ is $A$ at the white.
Luo, Cui, and Li then compress lightness and colorfulness:

$$
J'=\frac{1.7\,J}{1+0.007\,J},\qquad
M'=\frac{\ln(1+0.0228\,M)}{0.0228},\qquad
a'=M'\cos h,\qquad b'=M'\sin h
$$

The axes are $J'$, $a'$, and $b'$.
CIECAM02 gives a hue angle and a colorfulness.
$a'$ and $b'$ are that pair in Cartesian form, so that Euclidean distance applies.
It is the slowest space here to evaluate.

The compression $M'$ has the same logarithmic shape as this tool's $f$, with $s_0=1/0.0228\approx 43.9$.
Applying $f$ to a metric computed from $M'$ would compress chroma twice.
The view therefore shows $M'$, and the metric differentiates the uncompressed $M$.

#### ICtCp (BT.2100, 2016)

[ICtCp](https://en.wikipedia.org/wiki/ICtCp) is IPT reworked for high dynamic range broadcast.
The structure is the same: a matrix from XYZ to cone responses, a nonlinearity, and an opponent matrix.
The nonlinearity is the [PQ](https://en.wikipedia.org/wiki/Perceptual_quantizer) transfer function of ST 2084:

$$
\begin{pmatrix}L\\M\\S\end{pmatrix}=
\begin{pmatrix}0.3592&0.6976&-0.0358\\-0.1922&1.1004&0.0755\\0.0070&0.0749&0.8434\end{pmatrix}
\begin{pmatrix}X\\Y\\Z\end{pmatrix},\qquad
L'=\operatorname{PQ}\!\left(\frac{L}{100}\right)
$$

$$
\operatorname{PQ}(v)=\left(\frac{c_1+c_2\,v^{m_1}}{1+c_3\,v^{m_1}}\right)^{m_2},\qquad
m_1=\tfrac{2610}{16384},\quad m_2=\tfrac{2523}{32},\quad
c_1=\tfrac{3424}{4096},\quad c_2=\tfrac{2413}{128},\quad c_3=\tfrac{2392}{128}
$$

$$
\begin{pmatrix}I\\C_t\\C_p\end{pmatrix}=K
\begin{pmatrix}0.5&0.5&0\\1.6138&-3.3235&1.7097\\4.3782&-4.2456&-0.1326\end{pmatrix}
\begin{pmatrix}L'\\M'\\S'\end{pmatrix}
$$

PQ is absolute, in units of $10{,}000\ \mathrm{cd/m^2}$, and the chart is relative.
The white at $Y=1$ is placed at $100\ \mathrm{cd/m^2}$, which is the division by 100 in the formula.
That placement only scales $I$, and $K$ then rescales $I$ so that white reads 100, like every other lightness here.
$I$ is intensity, $C_t$ is tritan chroma, and $C_p$ is protan chroma, the same meanings as IPT's axes.
Lines of constant hue stay straight, as in IPT.
PQ covers a luminance range far beyond an sRGB display, so inside the sRGB gamut ICtCp is close to a rescaling of IPT.

#### Oklab (2020)

[Oklab](https://en.wikipedia.org/wiki/Oklab_color_space) is [Ottosson's](https://bottosson.github.io/posts/oklab/) space, scaled by 100.
Oklab is the chart: every color in this tool is stored in it, and the other spaces are views of it.
The structure is IPT's, with a cube root as the nonlinearity.
Both matrices are numerical fits to CAM16-UCS and IPT difference data.

$$
\begin{pmatrix}l\\m\\s\end{pmatrix}=
\begin{pmatrix}0.8189&0.3619&-0.1289\\0.0330&0.9293&0.0361\\0.0482&0.2644&0.6339\end{pmatrix}
\begin{pmatrix}X\\Y\\Z\end{pmatrix}
$$

$$
\begin{pmatrix}L\\a\\b\end{pmatrix}=100
\begin{pmatrix}0.2105&0.7936&-0.0041\\1.9780&-2.4286&0.4506\\0.0259&0.7828&-0.8087\end{pmatrix}
\begin{pmatrix}\sqrt[3]{l}\\\sqrt[3]{m}\\\sqrt[3]{s}\end{pmatrix}
$$

$L$ is lightness, $a$ runs green to red, and $b$ blue to yellow, as in CIELAB.
With Oklab as the working space, $J$ is the identity, $g=I$, and lengths are ordinary Euclidean.
Oklab is the cheapest option and the default.
It has no appearance model: unlike CIECAM02, it does not account for adapting luminance or surround.
