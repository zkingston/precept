// The published 3x3 matrices behind the color spaces. What is derived from
// them, inverses and white-point scalings, is computed where it is used.
type M3 = number[][];

// Ottosson's Oklab, kept as the two matrices it is actually made of rather than
// the sRGB-collapsed form, so any set of primaries can feed it.
// prettier-ignore
export const LMS_XYZ: M3 = [[0.8189330101, 0.3618667424, -0.1288597137],
                            [0.0329845436, 0.9293118715, 0.0361456387],
                            [0.0482003018, 0.2643662691, 0.633851707]];
// prettier-ignore
export const LAB_LMS: M3 = [[0.2104542553, 0.793617785, -0.0040720468],
                            [1.9779984951, -2.428592205, 0.4505937099],
                            [0.0259040371, 0.7827717662, -0.808675766]];

// Bradford chromatic adaptation, for moving a gamut's white to Oklab's.
// prettier-ignore
export const BRADFORD: M3 = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];

// IPT, Ebner & Fairchild 1998. Matrices as published, D65-adapted (coloraide).
// prettier-ignore
export const IPT_LMS: M3 = [[0.40021437220265654, 0.7075074077935767, -0.0807060322407405],
                            [-0.22798649207313385, 1.1500016565804587, 0.061235922568512555],
                            [0, 0, 0.9182249511582473]];
// prettier-ignore
export const IPT_OPP: M3 = [[0.4, 0.4, 0.2], [4.455, -4.851, 0.396], [0.8056, 0.3572, -1.1628]];

// ICtCp, BT.2100.
// prettier-ignore
export const ICTCP_LMS: M3 = [[0.3592, 0.6976, -0.0358], [-0.1922, 1.1004, 0.0755], [0.0070, 0.0749, 0.8434]];
// prettier-ignore
export const ICTCP_OPP: M3 = [[0.5, 0.5, 0],
  [1.61376953125, -3.323486328125, 1.709716796875],
  [4.378173828125, -4.24560546875, -0.132568359375]];

// CIECAM02: the CAT02 adaptation matrix and the Hunt-Pointer-Estevez cone matrix.
// prettier-ignore
export const CAT02: M3 = [[0.7328, 0.4296, -0.1624], [-0.7036, 1.6975, 0.0061], [0.0030, 0.0136, 0.9834]];
// prettier-ignore
export const HPE: M3 = [[0.38971, 0.68898, -0.07868], [-0.22981, 1.18340, 0.04641], [0, 0, 1]];
