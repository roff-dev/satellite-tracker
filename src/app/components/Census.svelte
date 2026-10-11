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

  // A clock for the retry countdown, ticking only while a retry is scheduled
  let now = $state(Date.now());
  $effect(() => {
    if (!status?.retryAt) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(id);
  });
  const secondsLeft = $derived(status?.retryAt ? Math.max(0, Math.ceil((status.retryAt - now) / 1000)) : null);

  const relative = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
  /** "3 days ago", "5 hours ago", "yesterday": how old the snapshot is. */
  function age(iso: string) {
    const minutes = (Date.now() - Date.parse(iso)) / 60_000;
    if (minutes < 90) return relative.format(-Math.max(1, Math.round(minutes)), 'minute');
    if (minutes < 36 * 60) return relative.format(-Math.round(minutes / 60), 'hour');
    return relative.format(-Math.round(minutes / 1440), 'day');
  }
</script>

{#if status?.unreachable}
  <div class="unreachable" role="status">
    <p class="title">I can’t reach the orbit data right now.</p>
    <p>The globe still works; satellites will appear when it’s back.</p>
    <div class="actions">
      <button class="chip" type="button" onclick={() => catalog.retry()} disabled={!status.done}>Try now</button>
      {#if !status.done}
        <span class="when">Trying again…</span>
      {:else if secondsLeft !== null}
        <span class="when">Trying again in <span class="figure">{secondsLeft}</span> s</span>
      {/if}
    </div>
  </div>
{:else if status}
  <p class="census" aria-live="polite" aria-busy={!status.done}>
    {#if !status.done}
      Plotting <span class="figure">{number.format(Math.round(plotted.current))}</span> objects…
    {:else}
      <span class="figure">{number.format(status.positioned)}</span> objects:
      <span class="clause"><span class="figure lit">{number.format(status.sunlit)}</span> in sunlight,</span>
      <span class="clause"><span class="figure shade">{number.format(status.positioned - status.sunlit)}</span> in Earth’s shadow.</span>
    {/if}
  </p>
  {#if status.done && status.stale}
    <p class="stale">
      Live orbit data is unavailable, so you’re seeing {#if status.fetchedAt}data from <strong>{age(status.fetchedAt)}</strong>{:else}an earlier copy{/if}.
      Positions are approximate.
    </p>
  {/if}
{/if}

<style>
  /* Panels are facet-cut, flat --deck with a lit --raise facet in the upper-left corner */
  .unreachable,
  .stale {
    position: relative;
    isolation: isolate;
    max-width: 26rem;
    pointer-events: auto;
  }

  .unreachable::before,
  .stale::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background: linear-gradient(155deg, var(--raise) 0 22%, var(--deck) 22% 100%);
    clip-path: var(--facet-cut);
  }

  .unreachable {
    margin-top: var(--space-6);
    padding: var(--space-4) var(--space-4) var(--space-4) var(--space-6);
    color: var(--muted);
    font-size: 0.9375rem;
  }

  .unreachable p {
    margin: 0 0 var(--space-2);
    text-wrap: pretty;
  }

  .unreachable .title {
    color: var(--ink);
    font-weight: 600;
    font-size: var(--size-body);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }

  .when {
    font-size: var(--size-label);
    color: var(--faint);
  }

  .stale {
    margin: var(--space-3) 0 0;
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
    font-size: var(--size-label);
    line-height: 1.45;
    color: var(--muted);
  }

  .stale strong {
    color: var(--ink);
    font-weight: 600;
    white-space: nowrap;
  }

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
    font-weight: 600;
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
