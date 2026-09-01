### Precept

<p class="lede">Palette design as trajectory optimization.</p>

A color is a point in a [color space](https://en.wikipedia.org/wiki/Color_space), which is
determined by parameters like the [red, green, and blue](https://en.wikipedia.org/wiki/RGB_color_model)
values, the [hue, saturation, and lightness](https://en.wikipedia.org/wiki/HSL_and_HSV), or
[chroma, lightness](https://en.wikipedia.org/wiki/CIELAB_color_space), etc., where the
[gamut](https://en.wikipedia.org/wiki/Gamut) is the set of representable colors (your monitor is
probably a gamut called [sRGB](https://en.wikipedia.org/wiki/SRGB)). Many people also have a
[color vision deficiency](https://en.wikipedia.org/wiki/Color_blindness), which affects the
distinctness of colors in this space. A colormap is either a continuous path through that space or
a set of points for categorical data, subject to some constraints that you'd like to enforce, like
uniform perception, maximal distinctness, and so on. This tool solves that palette generation
problem with optimization, and provides a number of metrics to help design pleasing and
scientifically validated palettes.

#### Getting around

{.how}
- Start from a published palette: **load…** opens a grid of them. Or start from the one on screen.
- Double-click empty space to add a node. In a cut panel it lands on that cut; in the 3D view it
  takes the color you clicked on. Drag a node to move it.
- Right-click a node, or press and hold on a touchscreen, to pin or delete it. A pinned node is
  held still by the solver.
- Ctrl-click nodes to mark them. Pin and delete then apply to every marked node rather than to the
  one under the cursor.
- With two marked, that menu also offers connect and disconnect. Disconnecting splits the ramp into
  separate runs; connecting the two ends of one run closes it into a loop.
- The two plots are target profiles for lightness and hue against position along the ramp. Drag a
  knot to shape one. **fit** sets the target to the ramp you already have, and the buttons beside it
  fit a straight ramp or a tent, a steady turn or two plateaus, each of which double-clicks to its
  reverse. The matching term measures the distance from the target, so drawing the curve you want is
  how you ask for it.
- The lightness and chroma sliders and the hue wheel bound the allowable colors. Double-click the
  wheel, or the arrow at its center, to allow every hue again.
- The tools switch between nodes, keep-out spheres and halfplanes. A sphere is placed by
  double-clicking a cut panel and resized by dragging the small handle beside it; a halfplane is cut
  the same way, then slid by its center or turned by its tip.
- Under **Optimize**, tick the terms to include and set how hard each one pulls in the **×**
  column. Then run Adam.
- Export as matplotlib, CSS, CSV, ParaView or JSON, or copy a link that carries the whole palette.
- Every control and every metric has a <span class="q">?</span> beside it: hover one for what it does.

#### Motivation (personal)

Color palettes have been on my mind for quite some time as someone who creates plots, charts, data
visualization, etc. for my work (normally, a figure in some paper). I recall very early on having a
discussion with a mentor (I believe it was [Mark Moll](https://moll.ai/)) who mentioned that I should
be concerned with red-green colorblindness (protanopia and deuteranopia, more precisely) after seeing
a plot I had made which had bright red and green as part of a categorical palette.

At that point in my life I was relatively unaware of the many concerns of graphic design, and after
some research on color palettes (e.g., the great
[talk on viridis for matplotlib](https://www.youtube.com/watch?v=xAoljeRJ3lU)) I was quickly sent
down a rabbit hole as I learned about color perception and how to scientifically design palettes. I
was always a bit frustrated by the lack of flexibility and visualization available in tools like
[cubehelix palettes](https://people.phy.cam.ac.uk/dag9/CUBEHELIX/) or other offerings like
[Seaborn](https://seaborn.pydata.org/tutorial/color_palettes.html). This led to a custom
viridis-like palette I used for
[many of my papers](https://kavrakilab.org/publications/kingston2019exploring-implicit-spaces-for-constrained.pdf),
and eventually this weekend project you see now.

#### Motivation (professional)

Perceptual color space is not Riemannian, i.e., a large color difference is perceived as *less* than
the sum of steps that make it up. This tool was an exercise in trajectory optimization in a
non-Riemannian space, to hopefully provide better palettes than many other colormap generating tools
do.

- Bujack, Teti, Miller, Caffrey & Turton. *The non-Riemannian nature of perceptual color space.*
  PNAS 2022. [10.1073/pnas.2119753119](https://doi.org/10.1073/pnas.2119753119)
- Bujack, Stark, Turton, Miller & Rogers. *The Geometry of Color in the Light of a
  Non-Riemannian Space.* CGF 2025. [10.1111/cgf.70136](https://doi.org/10.1111/cgf.70136)

#### Palettes

The picker contains matplotlib's ramps, Okabe and Ito's categorical set, the qualitative sets from
[ColorBrewer](https://colorbrewer2.org/) by Cynthia Brewer and Mark Harrower, four from
[seaborn](https://seaborn.pydata.org/), and
[Fabio Crameri's Scientific colour maps](https://www.fabiocrameri.ch/colourmaps/) (v8, MIT).

#### Credit

Built by Zachary Kingston, using Claude Opus 5.

[zkingston.com](https://zkingston.com) / [zkingston@purdue.edu](mailto:zkingston@purdue.edu)
