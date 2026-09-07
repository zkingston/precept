// Primaries and white point of each built-in gamut, as CIE 1931 xy.
import type { Gamut } from '../color-space.ts';
// prettier-ignore
export const GAMUTS: Record<string, Gamut> = {
  srgb: { name: 'sRGB / Rec.709', p: [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]], w: [0.3127, 0.329] },
  'display-p3': { name: 'Display P3', p: [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]], w: [0.3127, 0.329] },
  'a98-rgb': { name: 'Adobe RGB 1998', p: [[0.64, 0.33], [0.21, 0.71], [0.15, 0.06]], w: [0.3127, 0.329] },
  rec2020: { name: 'Rec. 2020', p: [[0.708, 0.292], [0.17, 0.797], [0.131, 0.046]], w: [0.3127, 0.329] },
  'prophoto-rgb': { name: 'ProPhoto RGB', p: [[0.734699, 0.265301], [0.159597, 0.840403], [0.036598, 0.000105]], w: [0.345704, 0.35854] },
  acescg: { name: 'ACEScg (AP1)', p: [[0.713, 0.293], [0.165, 0.83], [0.128, 0.044]], w: [0.32168, 0.33767] },
  ntsc1953: { name: 'NTSC 1953', p: [[0.67, 0.33], [0.21, 0.71], [0.14, 0.08]], w: [0.31, 0.316] },
};
