<script lang="ts">
  import { Tween } from 'svelte/motion';
  import { catalog } from '../catalog.svelte';

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const number = new Intl.NumberFormat();
  const plotted = new Tween(0, { duration: reducedMotion ? 0 : 450 });

  const status = $derived(catalog.status);
  $effect(() => {
    if (status) plotted.target = status.count;
  });
</script>

{#if status}
  <p class="census" aria-live="polite" aria-busy={!status.done}>
    {#if !status.done}
      Plotting <span class="figure">{number.format(Math.round(plotted.current))}</span> objects…
    {:else if status.positioned}
      <span class="figure">{number.format(status.positioned)}</span> objects:
      <span class="clause"><span class="figure lit">{number.format(status.sunlit)}</span> in sunlight,</span>
      <span class="clause"><span class="figure shade">{number.format(status.positioned - status.sunlit)}</span> in Earth’s shadow.</span>
    {:else}
      I can’t reach the orbit data right now. The globe still works; satellites will appear when it’s back.
    {/if}
  </p>
{/if}

<style>
  .census {
    margin: var(--space-6) 0 0;
    max-width: 26rem;
    font-size: var(--size-data);
    line-height: 1.5;
    color: var(--muted);
    text-wrap: pretty;
  }

  .clause {
    white-space: nowrap;
  }

  .figure {
    font-family: var(--font-data);
    /* Mono figures run large beside the sans; this matches them optically */
    font-size: 0.92em;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
  }

  /* The same two colours the points use, so the sentence is the globe's key */
  .lit {
    color: var(--glint);
  }

  .shade {
    color: var(--cool);
  }
</style>
