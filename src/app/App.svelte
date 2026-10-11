<script lang="ts">
  import { onMount } from 'svelte';
  import { catalog } from './catalog.svelte';
  import { selection } from './selection.svelte';
  import ObjectPanel from './components/ObjectPanel.svelte';
  import HoverLabel from './components/HoverLabel.svelte';
  import FollowBar from './components/FollowBar.svelte';
  import TopBar from './components/TopBar.svelte';
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
        $effect(() => app.setInsets(selection.insets.right, selection.insets.bottom + view.timelineHeight, view.topInset));
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
      // On a phone the headline steps aside by itself once there's something to look at; any key does it at once,
      // so a keyboard can always reach the timeline
      const timers: ReturnType<typeof setTimeout>[] = [];
      if (matchMedia(PHONE).matches) {
        void app.globe.ready.then(() => timers.push(setTimeout(explore, HEADLINE_MAX_MS)));
        void Promise.all([app.globe.arrived, loaded]).then(() => timers.push(setTimeout(explore, HEADLINE_MS)));
        addEventListener('keydown', explore, { once: true });
      }
      dispose = () => {
        timers.forEach(clearTimeout);
        removeEventListener('keydown', explore);
        stopReady();
        stopInsets();
        app.dispose();
      };
    });
    return () => dispose();
  });
</script>

<!-- Search and view come first in the tab order, then the globe -->
<TopBar />
<div class="globe" class:visible bind:this={host}></div>

<Timeline />

<ObjectPanel />
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
