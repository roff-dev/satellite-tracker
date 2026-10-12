import type { Pass } from './passes';

/** The space stations, by catalogue number, as a sentence names them. */
export const STATIONS: Record<number, string> = { 25544: 'The ISS', 48274: 'Tiangong' };
export const STATION_NORADS = [25544, 48274];

export const NEITHER = 'Neither space station is visible from here this week.';

const HEADINGS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** Which way a bearing points, in words. */
export const heading = (bearing: number) => HEADINGS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]!;

/** A calendar date as YYYY-MM-DD in a time zone, to count days between two moments the way a clock there would. */
const dateIn = (time: number, timeZone?: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(time);

/**
 * One line about a station's next visible pass, on the place's own clock:
 * "The ISS next crosses your sky on Saturday at 21:14, heading north-west, for 4 minutes."
 */
export function passLine(norad: number, pass: Pass, now: number, timeZone?: string) {
  const who = STATIONS[norad] ?? 'It';
  const zone = timeZone || undefined;
  const minutes = Math.max(1, Math.round((pass.end - Math.max(pass.start, now)) / 60_000));
  const span = minutes === 1 ? 'a minute' : `${minutes} minutes`;
  const toward = heading(pass.endAzimuth);
  if (pass.start <= now) return `${who} is crossing your sky now, heading ${toward}, for another ${span}.`;
  const days = Math.round((Date.parse(dateIn(pass.start, zone)) - Date.parse(dateIn(now, zone))) / 86_400_000);
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `on ${new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: zone }).format(pass.start)}`;
  const at = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(pass.start);
  return `${who} next crosses your sky ${day} at ${at}, heading ${toward}, for ${span}.`;
}
