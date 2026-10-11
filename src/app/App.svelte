<script lang="ts">
  import { onMount } from 'svelte';
  import { PROFILE_URL } from '../site';
  import Logbook from './components/Logbook.svelte';
  import { catalog } from './catalog.svelte';

  let host: HTMLDivElement;
  let visible = $state(false);

  onMount(() => {
    let dispose = () => {};
    void import('../globe').then(({ startGlobe }) => {
      const app = startGlobe(host, (status) => {
        catalog.status = status;
      });
      catalog.retry = app.retryNow;
      app.globe.onInteract(() => document.documentElement.classList.add('exploring'));
      void app.globe.ready.then(() => (visible = true));
      dispose = () => app.dispose();
    });
    return () => dispose();
  });
</script>

<div class="globe" class:visible bind:this={host}></div>

<Logbook />

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
