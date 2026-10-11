<script lang="ts">
  import { onMount } from 'svelte';
  import { PROFILE_URL } from '../site';
  import Logbook from './components/Logbook.svelte';
  import { catalog } from './catalog.svelte';
  import { selection } from './selection.svelte';
  import ObjectPanel from './components/ObjectPanel.svelte';
  import HoverLabel from './components/HoverLabel.svelte';

  const DAY_MS = 86_400_000;

  /** A shared link can name an object (?sat=25544) and a moment (&t=2026-10-11T21:14:00Z). */
  function linkedStart() {
    const params = new URLSearchParams(location.search);
    const norad = Number(params.get('sat'));
    const time = Date.parse(params.get('t') ?? '');
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
        onHover(hover) {
          selection.hover = hover;
        },
      }, linkedStart());
      catalog.retry = app.retryNow;
      selection.choose = app.choose;
      selection.close = app.deselect;
      // Created after the async import, so it needs its own root, cleaned up with the globe
      const stopInsets = $effect.root(() => {
        $effect(() => app.setInsets(selection.insets.right, selection.insets.bottom));
      });
      app.globe.onInteract(() => document.documentElement.classList.add('exploring'));
      void app.globe.ready.then(() => (visible = true));
      dispose = () => {
        stopInsets();
        app.dispose();
      };
    });
    return () => dispose();
  });
</script>

<div class="globe" class:visible bind:this={host}></div>

<Logbook />

<ObjectPanel />
<HoverLabel />

<footer class="byline">
  Made by <a href={PROFILE_URL}>Kieron</a>
</footer>

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

  .byline {
    position: fixed;
    z-index: 2;
    right: var(--gutter);
    bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
    font-size: var(--size-label);
    color: var(--faint);
  }

  .byline a {
    color: var(--muted);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 0.2em;
    text-decoration-color: var(--line);
    /* A comfortable tap target without moving the line */
    padding: 0.875rem 0.375rem;
    margin: -0.875rem -0.375rem;
    transition: color 0.2s, text-decoration-color 0.2s;
  }

  .byline a:hover {
    color: var(--ink);
    text-decoration-color: currentColor;
  }
</style>
