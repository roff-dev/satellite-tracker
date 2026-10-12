<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { catalog } from './catalog.svelte';
  import { selection } from './selection.svelte';
  import ObjectPanel from './components/ObjectPanel.svelte';
  import SkyPanel from './components/SkyPanel.svelte';
  import { sky } from './sky.svelte';
  import { savePlace, type SkyPlace } from '../location/location';
  import { STATION_NORADS } from '../sky/lines';
  import { stationPasses } from '../sky/station-passes';
  import HoverLabel from './components/HoverLabel.svelte';
  import FollowBar from './components/FollowBar.svelte';
  import TopBar from './components/TopBar.svelte';
  import Stations from './components/Stations.svelte';
  import Timeline from './components/Timeline.svelte';
  import { clock, EXTENDED_DAYS, STANDARD_DAYS } from '../time/clock';
  import { PHONE, view } from './view.svelte';
  import { GROUPS } from '../data/groups';

  const DAY_MS = 86_400_000;
  /** How long the headline stays once the globe has landed and the catalogue is in… */
  const HEADLINE_MS = 2500;
  /** …and the longest it stays after the globe appears, however slow the data is. */
  const HEADLINE_MAX_MS = 12_000;

  /** A shared link can name an object (?sat=25544) and a moment (&t=2026-10-11T21:14:00Z). */
  function linkedStart() {
    const params = new URLSearchParams(location.search);
    const norad = Number(params.get('sat'));
    const time = Date.parse(params.get('t') ?? '');
    // A moment more than a week away needs the wider timeline
    if (Number.isFinite(time) && Math.abs(time - Date.now()) > STANDARD_DAYS * DAY_MS) clock.setReach(EXTENDED_DAYS);
    return {
      norad: Number.isInteger(norad) && norad > 0 ? norad : undefined,
      // The timeline reaches 90 days either way; anything further out is ignored
      time: Number.isFinite(time) && Math.abs(time - Date.now()) <= 90 * DAY_MS ? time : undefined,
    };
  }

  let host: HTMLDivElement;
  let visible = $state(false);
  /** A station picked to ride with, until its position is known; its panel waits rather than flashing up. */
  let boarding = $state<number | null>(null);

  onMount(() => {
    let dispose = () => {};
    void import('../globe').then(({ startGlobe }) => {
      const app = startGlobe(host, {
        onStatus(status) {
          catalog.status = status;
        },
        onSelection(current) {
          selection.current = current;
          // Showing only one object belongs to that object
          selection.solo = false;
        },
        onDescribed(described) {
          selection.described = described;
        },
        onFollow(name) {
          selection.following = name;
        },
        onHover(hover) {
          selection.hover = hover;
        },
        onSky(counts) {
          sky.counts = counts;
        },
      }, linkedStart());
      catalog.retry = app.retryNow;
      selection.choose = app.choose;
      selection.close = app.deselect;
      selection.follow = app.follow;
      selection.stopFollowing = app.stopFollowing;
      selection.setSolo = (on) => {
        app.setSolo(on);
        selection.solo = on;
      };
      view.search = app.search;
      const explore = () => {
        app.globe.explore();
        document.documentElement.classList.add('exploring');
      };
      view.explore = explore;
      view.selectFound = (candidate) => {
        app.selectFound(candidate);
        explore();
      };
      view.showStation = async (norad, follow) => {
        const found = (await app.search(String(norad))).find((result) => result.norad === norad);
        if (!found) return;
        boarding = follow ? norad : null;
        view.selectFound(found);
      };
      // Riding along starts with the station's first answer from the worker, as the panel's Follow waits for it
      const stopBoarding = $effect.root(() => {
        $effect(() => {
          const described = selection.described;
          untrack(() => {
            if (boarding === null || !described) return;
            if (described.details.norad === boarding && described.now) app.follow();
            boarding = null;
          });
        });
      });
      view.isConstellation = app.isConstellation;
      view.setColourBy = (mode) => {
        view.colourBy = mode;
        app.setColourBy(mode);
      };
      view.setKinds = (mask) => {
        view.kinds = mask;
        app.setKinds(mask);
      };
      // Counts come back from the worker; a slower answer for a group no longer chosen is dropped
      view.setGroup = (slug) => {
        view.group = slug;
        // The chip takes the headline's place
        if (slug) explore();
        void app.setGroup(slug).then((count) => {
          if (view.group === slug) view.groupCount = count;
        });
      };
      view.showLaunch = (on, cospar) => {
        view.launchCount = on ? 0 : null;
        void app.showLaunch(on, cospar).then((count) => {
          if (view.launchCount !== null) view.launchCount = count;
        });
      };
      // Created after the async import, so it needs its own root, cleaned up with the globe
      const stopInsets = $effect.root(() => {
        $effect(() => app.setInsets(selection.insets.right, selection.insets.bottom + view.timelineHeight + view.stationsHeight, view.topInset));
      });
      app.globe.onInteract(explore);
      void app.globe.ready.then(() => (visible = true));
      let catalogIn = () => {};
      const loaded = new Promise<void>((resolve) => (catalogIn = resolve));
      // A shared link can also pick out a group (?group=starlink), once the catalogue is in
      const linkedGroup = new URLSearchParams(location.search).get('group');
      const stopReady = $effect.root(() => {
        $effect(() => {
          if (!catalog.status?.done || view.ready) return;
          view.ready = true;
          catalogIn();
          if (linkedGroup && GROUPS.some((g) => g.slug === linkedGroup)) view.setGroup(linkedGroup);
        });
      });
      // My sky: the place is remembered here, the globe draws the dome, and the stations' passes are searched in
      // their own worker once the catalogue (and so their orbits) is in, again whenever the soonest has been and gone
      let passTimer: ReturnType<typeof setTimeout> | undefined;
      // Which showing of a place an answer belongs to (the state holds a proxy, so the place itself can't be compared)
      let showing = 0;
      async function findPasses(place: SkyPlace, asked: number) {
        clearTimeout(passTimer);
        await loaded;
        const orbits = await app.stationOrbits(STATION_NORADS);
        const from = Date.now();
        const next = await stationPasses({ lat: place.lat, lon: place.lon, from, to: from + 7 * DAY_MS, orbits });
        if (asked !== showing) return;
        sky.passes = next;
        if (next[0]) passTimer = setTimeout(() => asked === showing && void findPasses(place, asked), next[0].pass.end - Date.now() + 5000);
      }
      sky.show = (place) => {
        const asked = ++showing;
        savePlace(place);
        sky.place = place;
        sky.counts = null;
        sky.passes = null;
        sky.choosing = false;
        sky.showing = 'dome';
        explore();
        void app.setSky(place, 'dome');
        void findPasses(place, asked);
      };
      sky.hide = () => {
        showing++;
        clearTimeout(passTimer);
        sky.place = null;
        sky.counts = null;
        sky.passes = null;
        void app.setSky(null);
      };
      sky.setShowing = (showing) => {
        sky.showing = showing;
        app.setSkyShowing(showing);
      };
      // A pass is watched with the station on its own; its toggle brings the rest of the sky back
      sky.watch = (norad, start) => void app.watch(norad, start).then((found) => found && selection.setSolo(true));

      // On a phone the headline steps aside by itself once there's something to look at; any key does it at once,
      // so a keyboard can always reach the timeline
      const timers: ReturnType<typeof setTimeout>[] = [];
      if (matchMedia(PHONE).matches) {
        void app.globe.ready.then(() => timers.push(setTimeout(explore, HEADLINE_MAX_MS)));
        void Promise.all([app.globe.arrived, loaded]).then(() => timers.push(setTimeout(explore, HEADLINE_MS)));
        addEventListener('keydown', explore, { once: true });
      }
      dispose = () => {
        clearTimeout(passTimer);
        timers.forEach(clearTimeout);
        removeEventListener('keydown', explore);
        stopReady();
        stopInsets();
        stopBoarding();
        app.dispose();
      };
    });
    return () => dispose();
  });
</script>

<!-- Search and view come first in the tab order, then the globe -->
<TopBar />
<Stations />
<div class="globe" class:visible bind:this={host}></div>

<Timeline />

<!-- One panel at a time: an object's details, or else the sky over the chosen place -->
{#if selection.current && !selection.following}
  {#if boarding === null}<ObjectPanel />{/if}
{:else if sky.place && !selection.following}
  <SkyPanel />
{/if}
<FollowBar />
<HoverLabel />


<style>
  .globe {
    position: fixed;
    inset: 0;
    z-index: 0;
    opacity: 0;
    transition: opacity 1.2s ease-out;
  }

  .globe.visible {
    opacity: 1;
  }

  .globe :global(.globe-canvas) {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }

</style>
