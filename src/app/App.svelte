<script lang="ts">
  import { onMount } from 'svelte';
  import { PORTFOLIO_URL } from '../site';
  import Logbook from './components/Logbook.svelte';

  let host: HTMLDivElement;
  let visible = $state(false);

  onMount(() => {
    let dispose = () => {};
    void import('../globe/renderer').then(({ createGlobe }) => {
      const globe = createGlobe(host);
      globe.onInteract(() => document.documentElement.classList.add('exploring'));
      void globe.ready.then(() => (visible = true));
      dispose = () => globe.dispose();
    });
    return () => dispose();
  });
</script>

<div class="globe" class:visible bind:this={host}></div>

<Logbook />

<footer class="byline">
  <a href={PORTFOLIO_URL}>Made by Kieron Oates</a>
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
  }

  .byline a {
    color: var(--faint);
    text-decoration: none;
    transition: color 0.2s;
  }

  .byline a:hover {
    color: var(--ink);
  }
</style>
