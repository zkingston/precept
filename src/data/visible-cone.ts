import type { Vec3 } from '../color-space.ts';

/**
 * The colors a light can actually make: 27 half-planes through the origin of XYZ.
 *
 * A set of primaries is a triangle in chromaticity, and nothing says that
 * triangle has to fit inside the horseshoe. ProPhoto's does not -- a quarter of
 * its cube is chromaticities no spectrum can produce -- and ACEScg's three
 * primaries are all outside. Encoding room beyond the locus is deliberate in a
 * space meant for editing, where a value can leave the visible range and come
 * back. It is not useful here: this tool's output is a palette to be looked at,
 * and a color no light can make is not a palette entry. Left in, it was
 * something the solver could move a node to in order to win separation.
 *
 * The visible set in XYZ is the convex cone over the spectral locus, so the
 * test is a sign check against each bounding plane. Built from the CIE 1931 2
 * degree observer at 1 nm: convex hull of the locus, 161 edges, reduced to
 * 27 by dropping the half-planes whose removal grows the region least,
 * stopping at 1e-3.
 *
 * The planes are then pushed 1e-3 outward, which is the one detail that matters
 * for correctness. Rec.2020's primaries are monochromatic and Display P3's red
 * is very nearly so, meaning they sit ON the locus, and an inscribed hull would
 * have called them imaginary by 1.6e-4. The offset admits them with six times
 * the margin while still rejecting ACEScg's nearest primary at 4.3e-3 and
 * ProPhoto's at 3.2e-2.
 */
// prettier-ignore
export const VISIBLE: Vec3[] = [
  [0.0026267, -0.0016634, 0.9999952], [0.0513336, -0.0291244, 0.9982568],
  [0.1212509, -0.0557157, 0.991057], [0.2460292, -0.0905531, 0.9650232],
  [0.3211541, -0.1061766, 0.9410561], [0.4208438, -0.1211781, 0.899003],
  [0.5951693, -0.1360668, 0.7919971], [0.7154023, -0.1382471, 0.6848995],
  [0.820803, -0.13235, 0.5556671], [0.8945447, -0.1197073, 0.4306506],
  [0.9435876, -0.1020696, 0.3149989], [0.9719135, -0.0826842, 0.2203348],
  [0.9869124, -0.0636883, 0.1481478], [0.9951952, -0.0437161, 0.0876095],
  [0.99889, -0.0244685, 0.0402511], [0.9999726, -0.0063495, 0.0037959],
  [0.9982802, 0.0294802, -0.0506712], [0.9944507, 0.062556, -0.0845847],
  [0.9893398, 0.0971165, -0.1085137], [0.9831968, 0.1330281, -0.1250104],
  [0.9707591, 0.1930136, -0.1427325], [0.956294, 0.248853, -0.153538],
  [0.9114531, 0.3777282, -0.1630171], [0.8694649, 0.4662498, -0.1632233],
  [0.7335578, 0.6628289, -0.1501694], [0.6494277, 0.7478386, -0.1377719],
  [-0.3377185, 0.9388247, 0.067486],
];
