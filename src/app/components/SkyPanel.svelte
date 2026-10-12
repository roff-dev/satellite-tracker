<script lang="ts">
  import { onMount } from 'svelte';
  import { sky, type StationPass } from '../sky.svelte';
  import { NEITHER, passLine } from '../../sky/lines';
  import { placeDetail } from '../../location/location';
  import Sheet from './Sheet.svelte';

  const number = new Intl.NumberFormat('en-GB');

  // The lines read "today at…" and "is crossing your sky now", so they're rewritten as the minutes pass
  let now = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 15_000);
    // Escape puts the sky away, as it closes an object's details
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable], [role=dialog]')) return;
      sky.hide();
    };
    addEventListener('keydown', onKey);
    return () => {
      clearInterval(timer);
      removeEventListener('keydown', onKey);
    };
  });

  const lines = $derived(sky.passes?.map((station) => ({ ...station, text: passLine(station.norad, station.pass, now, sky.place?.timeZone) })) ?? null);
</script>

{#snippet passButton(line: StationPass & { text: string })}
  <!-- The station is watched crossing the dome: the timeline jumps there and the view turns to the place -->
  <button class="pass" type="button" onclick={() => sky.watch(line.norad, line.pass.start)} onpointerdown={(e) => e.stopPropagation()}>
    <span>{line.text}</span>
    <span class="watch">Watch</span>
  </button>
{/snippet}

{#if sky.place}
  <Sheet label="sky-name" key="sky" onclose={() => sky.hide()}>
    {#snippet header()}
      <p class="kind">Your sky</p>
      <h2 id="sky-name">{sky.place!.name}</h2>
      <p class="ids">{placeDetail(sky.place!)}</p>
      <p class="count">
        {#if sky.counts}
          <span class="figure">{number.format(sky.counts.above)}</span> above you, <span class="figure lit">{number.format(sky.counts.sunlit)}</span> in sunlight.
        {:else}
          Counting what’s above you…
        {/if}
      </p>
      {#if lines === null}
        <p class="note">Looking for the space stations’ next passes…</p>
      {:else if lines.length}
        {@render passButton(lines[0]!)}
      {:else}
        <p class="note">{NEITHER}</p>
      {/if}
    {/snippet}

    {#snippet body()}
      {#if lines && lines.length > 1}
        <section aria-label="Also passing">
          {@render passButton(lines[1]!)}
        </section>
      {/if}
      <section aria-labelledby="dome-title">
        <h3 id="dome-title">What’s counted</h3>
        <p class="note">Everything at least 10° above your horizon and within 2,000 km of the ground: the dome on the globe, with each object inside it ringed.</p>
        <p class="note">Your location stays on this device.</p>
      </section>
      <div class="actions">
        <button class="chip" type="button" onclick={() => (sky.choosing = true)}>Change place</button>
      </div>
    {/snippet}
  </Sheet>
{/if}

<style>
  .count {
    margin: 0 0 var(--space-3);
  }

  .lit {
    color: var(--glint);
  }

  /* A station's next pass: a lit facet card to tap, ending in an amber "Watch" */
  .pass {
    position: relative;
    isolation: isolate;
    display: flex;
    align-items: flex-end;
    gap: var(--space-3);
    width: 100%;
    min-height: 44px;
    margin: 0 0 var(--space-4);
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
    border: 0;
    background: none;
    color: var(--ink);
    font: 450 0.9375rem / 1.4 var(--font-text);
    text-align: left;
    cursor: pointer;
  }

  .pass::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background: linear-gradient(155deg, color-mix(in oklab, var(--raise), white 9%) 0 30%, var(--raise) 30% 100%);
    clip-path: var(--facet-cut);
    transition: filter 0.2s;
  }

  .pass:hover::before {
    filter: brightness(1.15);
  }

  .watch {
    flex: none;
    padding: 0.2em 0.65em;
    font-size: var(--size-label);
    font-weight: 650;
    color: var(--void);
    background: var(--glint);
    clip-path: polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px);
  }

  section .pass {
    margin-bottom: 0;
  }
</style>
