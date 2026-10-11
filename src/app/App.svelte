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
  import { view } from './view.svelte';
  import { GROUPS } from '../data/groups';

  const DAY_MS = 86_400_000;

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
      view.search = app.search;
      view.selectFound = (candidate) => {
        app.selectFound(candidate);
        document.documentElement.classList.add('exploring');
      };
      view.isConstellation = app.isConstellation;
      view.setColourBy = (mode) => {
        view.colourBy = mode;
        app.setColourBy(mode);
      };
      view.setDebrisShown = (shown) => {
        view.debrisShown = shown;
        app.setDebrisShown(shown);
      };
      // Counts come back from the worker; a slower answer for a group no longer chosen is dropped
      view.setGroup = (slug) => {
        view.group = slug;
        // The chip takes the headline's place
        if (slug) document.documentElement.classList.add('exploring');
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
        $effect(() => app.setInsets(selection.insets.right, selection.insets.bottom + view.timelineHeight));
      });
      app.globe.onInteract(() => document.documentElement.classList.add('exploring'));
      void app.globe.ready.then(() => (visible = true));
      // A shared link can also pick out a group (?group=starlink), once the catalogue is in
      const linkedGroup = new URLSearchParams(location.search).get('group');
      const stopReady = $effect.root(() => {
        $effect(() => {
          if (!catalog.status?.done || view.ready) return;
          view.ready = true;
          if (linkedGroup && GROUPS.some((g) => g.slug === linkedGroup)) view.setGroup(linkedGroup);
        });
      });
      dispose = () => {
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
