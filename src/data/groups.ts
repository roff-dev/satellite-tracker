/**
 * Ways to pick out part of the catalogue. Most are a bit in each object's group mask; three are worked out on the
 * GPU from what each object already carries (launch date, brightness, kind), so they need no bit.
 */
export interface Group {
  slug: string;
  label: string;
  /** Bit in the object's mask, or a code for a group the shader works out itself. */
  filter: number;
}

export const FILTER = {
  none: -1,
  /** Launched in the 30 days before the moment shown. */
  recent: 100,
  /** Estimated brighter than magnitude 4.5: glint above BRIGHTEST_GLINT. */
  brightest: 101,
  debris: 102,
} as const;

/**
 * Glint 4 is magnitude 4.495, the line the glow starts at. Not 4.5 itself: that's the size-class guess every LARGE
 * object without a measured RCS gets, and there are about 15,000 of them, mostly Starlink.
 */
export const BRIGHTEST_GLINT = 4;

/** Bit for "the launch group being highlighted": objects from the same launch as the selected one. */
export const HIGHLIGHT_BIT = 23;

export const GROUPS: Group[] = [
  { slug: 'stations', label: 'Space stations', filter: 0 },
  { slug: 'starlink', label: 'Starlink', filter: 1 },
  { slug: 'oneweb', label: 'OneWeb', filter: 2 },
  { slug: 'kuiper', label: 'Kuiper', filter: 3 },
  { slug: 'qianfan', label: 'Qianfan', filter: 4 },
  { slug: 'gnss', label: 'Navigation', filter: 5 },
  { slug: 'weather', label: 'Weather', filter: 6 },
  { slug: 'science', label: 'Science', filter: 7 },
  { slug: 'geo', label: 'Geostationary', filter: 8 },
  { slug: 'recent', label: 'Recent launches', filter: FILTER.recent },
  { slug: 'brightest', label: 'Brightest', filter: FILTER.brightest },
  { slug: 'debris', label: 'Debris and rocket bodies', filter: FILTER.debris },
];

/** Constellations named by a prefix, and their bits; their launches are what "show its launch group" offers. */
export const CONSTELLATIONS: [prefix: string, bit: number][] = [
  ['STARLINK-', 1],
  ['ONEWEB-', 2],
  ['KUIPER-', 3],
  ['QIANFAN-', 4],
];

/** CelesTrak group lists joined into /api/groups, by the bit each sets. */
export const LISTED: Record<string, number> = { gnss: 5, weather: 6, science: 7 };

export const STATION_BIT = 0;
export const GEO_BIT = 8;

/** The launch an object came from, from its international designator: 2026-045A → 2026-045. */
export const launchOf = (cospar: string) => cospar.slice(0, 8);

/** How each object is coloured. */
export type ColourBy = 'light' | 'type' | 'orbit';
export const COLOUR_BY: Record<ColourBy, number> = { light: 0, type: 1, orbit: 2 };
