<script lang="ts">
  import { onMount } from 'svelte';
  import { Spring } from 'svelte/motion';
  import { selection } from '../selection.svelte';

  const KIND = { payload: 'Satellite', rocket: 'Rocket body', debris: 'Debris' } as const;

  const current = $derived(selection.current);
  const selected = $derived(current ? current.candidates[current.index]! : null);
  const nearby = $derived(current ? current.candidates.map((candidate, index) => ({ candidate, index })).filter(({ index }) => index !== current.index) : []);

  // On a phone held upright the panel is a bottom sheet with three resting heights
  type Detent = 'peek' | 'half' | 'full';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let sheet = $state(false);
  let viewport = $state(800);
  let detent = $state<Detent>('half');
  const heights = $derived({ peek: 88, half: Math.round(viewport * 0.5), full: Math.round(viewport * 0.92) });
  const height = new Spring(0, { stiffness: 0.15, damping: 0.8 });

  onMount(() => {
    const query = matchMedia('(orientation: portrait) and (max-width: 899px)');
    const update = () => {
      sheet = query.matches;
      viewport = innerHeight;
    };
    update();
    query.addEventListener('change', update);
    addEventListener('resize', update);
    return () => {
      query.removeEventListener('change', update);
      removeEventListener('resize', update);
    };
  });

  // A new selection opens the sheet halfway; swapping between nearby objects keeps its height
  let wasOpen = false;
  $effect(() => {
    const open = !!selected;
    if (open && !wasOpen) detent = 'half';
    wasOpen = open;
  });
  $effect(() => {
    const target = selected && sheet ? heights[detent] : 0;
    void height.set(target, { instant: reducedMotion || dragging });
  });

  // Tell the globe how much of the screen the panel takes, so it can move into the space that's left.
  // A full-height sheet leaves nothing worth framing, so the globe stays where it was at half.
  let panel = $state<HTMLElement>();
  $effect(() => {
    if (!selected) {
      selection.insets = { right: 0, bottom: 0 };
    } else if (sheet) {
      selection.insets = { right: 0, bottom: heights[detent === 'full' ? 'half' : detent] };
    } else if (panel) {
      selection.insets = { right: innerWidth - panel.getBoundingClientRect().left, bottom: 0 };
    }
  });

  let dragging = $state(false);
  let drag: { y: number; height: number; time: number; lastY: number; lastTime: number } | null = null;

  function onDragStart(event: PointerEvent) {
    if (!sheet) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { y: event.clientY, height: height.current, time: event.timeStamp, lastY: event.clientY, lastTime: event.timeStamp };
    dragging = true;
  }

  function onDragMove(event: PointerEvent) {
    if (!drag) return;
    const next = Math.min(heights.full, Math.max(0, drag.height + drag.y - event.clientY));
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;
    void height.set(next, { instant: true });
  }

  function onDragEnd(event: PointerEvent) {
    if (!drag) return;
    // Where it would come to rest given how fast it was flicked
    const velocity = (drag.lastY - event.clientY) / Math.max(16, event.timeStamp - drag.lastTime + 16);
    const projected = height.current + velocity * 180;
    drag = null;
    dragging = false;
    if (projected < heights.peek * 0.6) return selection.close();
    const order: Detent[] = ['peek', 'half', 'full'];
    detent = order.reduce((best, d) => (Math.abs(heights[d] - projected) < Math.abs(heights[best] - projected) ? d : best), 'peek');
    void height.set(heights[detent]);
  }
</script>

{#if selected}
  <aside bind:this={panel} class="panel" class:sheet style:height={sheet ? `${height.current}px` : undefined} aria-labelledby="object-name">
    <header role="group" onpointerdown={onDragStart} onpointermove={onDragMove} onpointerup={onDragEnd} onpointercancel={onDragEnd}>
      {#if sheet}
        <!-- Dragging the header moves the sheet; the grip does the same from a keyboard -->
        <button
          class="grip"
          type="button"
          aria-label={detent === 'full' ? 'Show less' : 'Show more'}
          onclick={() => (detent = detent === 'full' ? 'half' : 'full')}
          onpointerdown={(e) => e.stopPropagation()}
        ></button>
      {/if}
      <p class="kind">{selected.station ? 'Space station' : KIND[selected.type]}</p>
      <h2 id="object-name">{selected.name}</h2>
      <p class="ids">NORAD <span class="figure">{selected.norad}</span></p>
      <button class="chip close" type="button" aria-label="Close" onclick={() => selection.close()} onpointerdown={(e) => e.stopPropagation()}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 2 14 13l-1 1L2 3zM13 2l1 1L3 14l-1-1z" fill="currentColor" /></svg>
      </button>
    </header>

    {#if nearby.length}
      <section class="nearby" aria-labelledby="nearby-title">
        <h3 id="nearby-title">Nearby</h3>
        <ul>
          {#each nearby as { candidate, index } (candidate.slot)}
            <li><button class="chip" type="button" onclick={() => selection.choose(index)}>{candidate.name}</button></li>
          {/each}
        </ul>
      </section>
    {/if}
    <p class="visually-hidden" aria-live="polite">{selected.name} selected</p>
  </aside>
{/if}

<style>
  /* A facet-cut --deck panel with a lit --raise facet in its upper-left corner */
  .panel {
    position: fixed;
    z-index: 3;
    top: calc(var(--space-6) + env(safe-area-inset-top));
    right: var(--gutter);
    width: min(380px, calc(100vw - 2 * var(--gutter)));
    max-height: calc(100svh - 2 * var(--space-6) - 4rem);
    overflow-y: auto;
    padding: var(--space-6);
    isolation: isolate;
    animation: arrive 0.28s cubic-bezier(0.2, 0.7, 0.2, 1);
  }

  .panel {
    background: linear-gradient(155deg, var(--raise) 0 18%, var(--deck) 18% 100%);
    clip-path: var(--facet-cut);
  }

  @keyframes arrive {
    from {
      opacity: 0;
      transform: translateX(12px);
    }
  }

  /* Upright phones: the bottom sheet, its height set by the spring */
  .panel.sheet {
    top: auto;
    right: 0;
    bottom: 0;
    left: 0;
    width: auto;
    max-height: none;
    padding: var(--space-3) var(--gutter) calc(var(--space-6) + env(safe-area-inset-bottom));
    overflow: hidden;
    animation: none;
    clip-path: polygon(var(--chamfer) 0, calc(100% - var(--chamfer)) 0, 100% var(--chamfer), 100% 100%, 0 100%, 0 var(--chamfer));
  }

  header {
    position: relative;
    padding-right: 3.25rem;
    touch-action: none;
  }

  .sheet header {
    padding-top: var(--space-4);
    cursor: grab;
  }

  .grip {
    position: absolute;
    top: calc(-1 * var(--space-3));
    left: 50%;
    width: 4rem;
    height: 28px;
    translate: -50% 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
  }

  /* The visible grip: a short flat bar with cut ends */
  .grip::before {
    content: '';
    position: absolute;
    top: 12px;
    left: 50%;
    width: 2.5rem;
    height: 4px;
    translate: -50% 0;
    background: var(--muted);
    opacity: 0.5;
    clip-path: polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%);
  }

  .kind {
    margin: 0 0 var(--space-1);
    font-size: var(--size-label);
    color: var(--muted);
  }

  h2 {
    margin: 0;
    font: 600 var(--size-title) / 1.1 var(--font-display);
    letter-spacing: -0.02em;
    overflow-wrap: anywhere;
  }

  .ids {
    margin: var(--space-2) 0 0;
    font-size: var(--size-data);
    color: var(--muted);
  }

  .figure {
    font-family: var(--font-data);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
  }

  .close {
    position: absolute;
    top: 0;
    right: 0;
    width: 44px;
    justify-content: center;
    padding: 0;
  }

  .sheet .close {
    top: var(--space-3);
  }

  .nearby {
    margin-top: var(--space-6);
    padding-top: var(--space-4);
    border-top: 1px solid var(--line);
  }

  h3 {
    margin: 0 0 var(--space-3);
    font-size: var(--size-label);
    font-weight: 600;
    color: var(--muted);
  }

  ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  ul .chip {
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
    line-height: 44px;
    font-size: var(--size-label);
  }
</style>
