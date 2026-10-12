import type { ColourBy } from '../data/groups';
import type { Candidate, SearchResult } from '../data/protocol';

/** Phones, upright or on their side: the headline comes first, and the controls run across the top. */
export const PHONE = '(max-width: 699px), (orientation: landscape) and (max-height: 500px)';

/** How the globe is being shown, and the actions that change it. Filled in once the globe has loaded. */
export const view = $state<{
  ready: boolean;
  group: string | null;
  /** Members of the group with a position now. */
  groupCount: number;
  colourBy: ColourBy;
  /** Kinds shown, one bit per kind (working, inactive, rocket bodies, debris). */
  kinds: number;
  /** Objects from the selected satellite's launch, while they're shown. */
  launchCount: number | null;
  /** Height of the timeline along the bottom, CSS px. */
  timelineHeight: number;
  /** On phones, how far down the controls along the top reach, CSS px; 0 elsewhere. */
  topInset: number;
  /** On upright phones, the room the station row takes above the timeline, CSS px; 0 elsewhere. */
  stationsHeight: number;
  /** The View options menu is open. */
  menuOpen: boolean;
  /** Search results are showing under the field. */
  resultsOpen: boolean;
  /** The headline steps aside and the globe takes the middle, as it does the moment you touch anything. */
  explore: () => void;
  setGroup: (slug: string | null) => void;
  setColourBy: (mode: ColourBy) => void;
  setKinds: (mask: number) => void;
  search: (query: string) => Promise<SearchResult[]>;
  selectFound: (candidate: Candidate) => void;
  /** Select a station by its catalogue number, and ride along with it once its position is known. */
  showStation: (norad: number, follow: boolean) => void;
  showLaunch: (on: boolean, cospar?: string) => void;
  isConstellation: (name: string) => boolean;
}>({
  ready: false,
  group: null,
  groupCount: 0,
  colourBy: 'light',
  kinds: 0b1111,
  launchCount: null,
  timelineHeight: 0,
  topInset: 0,
  stationsHeight: 0,
  menuOpen: false,
  resultsOpen: false,
  explore: () => document.documentElement.classList.add('exploring'),
  setGroup: () => {},
  setColourBy: () => {},
  setKinds: () => {},
  search: async () => [],
  selectFound: () => {},
  showStation: () => {},
  showLaunch: () => {},
  isConstellation: () => false,
});
