export type ObjectType = 'payload' | 'rocket' | 'debris';

/**
 * Standard magnitude (1,000 km away, half lit) from radar cross-section: m = a + b·log10(RCS m²).
 * Fitted per object type against visual magnitude observations; held-out error is a median of
 * 0.56 magnitudes. The slope sits near the −2.5 you'd expect if reflected light scales with area.
 */
const FIT: Record<ObjectType, [a: number, b: number]> = {
  payload: [6.35, -2.27],
  rocket: [6.08, -2.57],
  debris: [5.95, -2.08],
};

/** When there's no measured RCS, the catalogue's size class: the fit at each class's median RCS. */
const SIZE_CLASS: Record<string, number> = { LARGE: 4.5, MEDIUM: 7.5, SMALL: 10.0 };

/** Above this the fit runs about three magnitudes too faint (the ISS and other giants), so no number is given. */
export const GIANT_RCS = 50;

export interface Brightness {
  /** Estimated standard magnitude, or null when it can't be given honestly. */
  magnitude: number | null;
  /** Too big for the fit: one of the brightest objects in orbit. */
  giant: boolean;
}

export function estimateBrightness(type: ObjectType, rcs: number | undefined, sizeClass: string | undefined): Brightness {
  if (rcs !== undefined && rcs > GIANT_RCS) return { magnitude: null, giant: true };
  if (rcs !== undefined && rcs > 0) {
    const [a, b] = FIT[type];
    return { magnitude: a + b * Math.log10(rcs), giant: false };
  }
  const fromClass = sizeClass ? SIZE_CLASS[sizeClass] : undefined;
  return { magnitude: fromClass ?? null, giant: false };
}

/** The giants: the fit at 50 m² less the three magnitudes it runs short there, so at least this bright. */
const GIANT_MAGNITUDE = -0.5;

/**
 * Light from an object at 1,000 km, half lit, relative to a magnitude-6 one: 10^(−0.4(m − 6)), and 0 when there's
 * no magnitude. The globe caps what it shows (nothing is drawn bigger past 3, or glows more past 8); the sky test
 * needs the full range to tell what can be seen by eye.
 */
export function glintIntensity({ magnitude, giant }: Brightness) {
  if (giant) return 10 ** (-0.4 * (GIANT_MAGNITUDE - 6));
  if (magnitude === null) return 0;
  return 10 ** (-0.4 * (magnitude - 6));
}

/** Measured RCS by NORAD ID, from the table packed at build time into /rcs.bin. */
export function decodeRcsTable(buffer: ArrayBuffer): Map<number, number> {
  // uint32 count | uint16 id deltas × count | uint8 q × count, with log10(RCS) = q / 40 − 4
  const view = new DataView(buffer);
  const count = view.getUint32(0, true);
  const table = new Map<number, number>();
  let id = 0;
  for (let i = 0; i < count; i++) {
    id += view.getUint16(4 + 2 * i, true);
    table.set(id, 10 ** (view.getUint8(4 + 2 * count + i) / 40 - 4));
  }
  return table;
}
