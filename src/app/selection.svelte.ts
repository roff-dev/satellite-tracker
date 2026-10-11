import type { Described, Hover, Selection } from '../globe';

/** What's selected on the globe and what the pointer rests on, with the actions the panel can take. */
export const selection = $state<{
  current: Selection | null;
  /** Details and live position of the selected object, once the worker has answered. */
  described: Described | null;
  hover: Hover | null;
  /** Name of the object the camera is riding with. */
  following: string | null;
  /** The phone's bottom sheet is up, so the timeline docks to just its ribbon. */
  sheetOpen: boolean;
  choose: (index: number) => void;
  close: () => void;
  follow: () => void;
  stopFollowing: () => void;
  /** Screen space the panel covers when at rest, CSS px. */
  insets: { right: number; bottom: number };
}>({ current: null, described: null, hover: null, following: null, sheetOpen: false, choose: () => {}, close: () => {}, follow: () => {}, stopFollowing: () => {}, insets: { right: 0, bottom: 0 } });
