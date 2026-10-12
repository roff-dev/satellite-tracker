import type { Place } from './places';

/** Where the sky is shown from: a town from the list, or wherever the device says it is. */
export interface SkyPlace {
  name: string;
  /** Region and country for a town; empty for a located position, which shows its coordinates instead. */
  region: string;
  country: string;
  lat: number;
  lon: number;
  /** The place's own time zone, when known (towns); otherwise the device's clock is used. */
  timeZone: string;
  located: boolean;
}

const KEY = 'overhead.place';

const countries = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

/** "England, United Kingdom" for a town; for a located position, its coordinates: "51.51° N, 0.13° W". */
export function placeDetail({ region, country, lat, lon, located = false }: { region: string; country: string; lat: number; lon: number; located?: boolean }) {
  if (located) return `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
  let name = country;
  try {
    name = countries?.of(country) ?? country;
  } catch {
    // An unknown code is shown as it is
  }
  return [region, name].filter(Boolean).join(', ');
}

export function fromPlace({ name, region, country, lat, lon, timeZone }: Place): SkyPlace {
  return { name, region, country, lat, lon, timeZone, located: false };
}

/** The place last chosen, kept only in this browser. */
export function savedPlace(): SkyPlace | null {
  try {
    const place = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SkyPlace | null;
    return place && Number.isFinite(place.lat) && Number.isFinite(place.lon) && typeof place.name === 'string' ? place : null;
  } catch {
    return null;
  }
}

export function savePlace(place: SkyPlace) {
  try {
    localStorage.setItem(KEY, JSON.stringify(place));
  } catch {
    // Private browsing or storage turned off: the place just isn't remembered
  }
}

/** Forgets the place, so My sky asks again next time. */
export function forgetPlace() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage turned off: nothing was kept
  }
}

export type LocateFailure = 'denied' | 'unavailable';

/** Asks the device where it is. Only ever called from a tap, and the answer never leaves the browser. */
export function locate(): Promise<SkyPlace> {
  return new Promise((resolve, reject: (reason: LocateFailure) => void) => {
    if (!('geolocation' in navigator)) return reject('unavailable');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({
          name: 'Your location',
          region: '',
          country: '',
          // About a kilometre is plenty for the sky, and it's all that's ever stored
          lat: Math.round(coords.latitude * 100) / 100,
          lon: Math.round(coords.longitude * 100) / 100,
          timeZone: '',
          located: true,
        }),
      (error) => reject(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  });
}
