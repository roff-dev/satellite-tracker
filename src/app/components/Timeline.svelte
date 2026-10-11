<script lang="ts">
  import { onMount } from 'svelte';
  import { clock, EXTENDED_DAYS, STANDARD_DAYS } from '../../time/clock';
  import { createRibbonScale } from '../../time/ribbon-scale';
  import { catalog } from '../catalog.svelte';
  import { selection } from '../selection.svelte';
  import { view } from '../view.svelte';
  import { backToNow, stopFlyBack } from '../now';
  import { PROFILE_URL } from '../../site';

  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const SPEEDS = [1, 60, 600, 3600];
  const SPEED_NAMES: Record<number, string> = { 1: 'real time', 60: 'a minute a second', 600: 'ten minutes a second', 3600: 'an hour a second' };

  const longReadout = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  // Phones: short enough that the moment, how far away it is and the live share share one line
  const shortReadout = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  let narrow = $state(false);
  onMount(() => {
    const query = matchMedia('(max-width: 699px)');
    const update = () => (narrow = query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  });
  const readout = $derived(narrow ? shortReadout : longReadout);
  const spoken = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' });
  const hourLabel = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  const relative = new Intl.RelativeTimeFormat('en-GB', { numeric: 'always' });
  const number = new Intl.NumberFormat('en-GB');

  // The clock moves every frame; the timeline reads it once a frame while it's on screen
  let time = $state(clock.time);
  /** The moment as written out: refreshed about 15 times a second, which is as fast as anyone can read it. */
  let shown = $state(clock.time);
  let now = $state(Date.now());
  let rate = $state(clock.rate);
  let paused = $state(clock.paused);
  let reach = $state(clock.reachDays);
  onMount(() => {
    let frame = 0;
    let written = 0;
    const read = (at: number) => {
      time = clock.time;
      if (at - written > 66) {
        shown = time;
        written = at;
      }
      now = Date.now();
      rate = clock.rate;
      paused = clock.paused;
      reach = clock.reachDays;
      frame = requestAnimationFrame(read);
    };
    frame = requestAnimationFrame(read);
    return () => cancelAnimationFrame(frame);
  });

  const scale = $derived(createRibbonScale(reach));
  const offset = $derived(time - now);
  const shownOffset = $derived(shown - now);
  const position = $derived(scale.toPosition(offset));
  const atNow = $derived(Math.abs(offset) < 30_000 && rate === 1 && !paused);

  function ago(ms: number) {
    const minutes = ms / MINUTE;
    if (Math.abs(minutes) < 90) return relative.format(Math.round(minutes), 'minute');
    if (Math.abs(minutes) < 48 * 60) return relative.format(Math.round(minutes / 60), 'hour');
    return relative.format(Math.round(minutes / 1440), 'day');
  }

  // The ribbon's labels: now, an hour and six either side, then local midnights, thinned to fit.
  // They only need minute precision, so they're worked out once a minute rather than every frame
  let width = $state(600);
  const minute = $derived(Math.floor(now / MINUTE) * MINUTE);
  const ticks = $derived.by(() => {
    const now = minute;
    const out: { x: number; label: string; major: boolean }[] = [];
    const add = (t: number, label: string, major: boolean) => out.push({ x: (scale.toPosition(t - now) + 1) / 2, label, major });
    for (const h of [-6, -1, 1, 6]) add(now + h * HOUR, hourLabel.format(now + h * HOUR), false);
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    for (let d = -reach; d <= reach; d++) {
      const t = midnight.getTime() + d * DAY;
      if (Math.abs(t - now) < 7 * HOUR || Math.abs(t - now) > reach * DAY) continue;
      add(t, dayLabel.format(t), true);
    }
    // Keep labels at least 56 px apart, nearest to now first
    out.sort((a, b) => Math.abs(a.x - 0.5) - Math.abs(b.x - 0.5));
    const kept: typeof out = [];
    for (const tick of out) if (Math.abs(tick.x - 0.5) * width > 36 && kept.every((k) => Math.abs(k.x - tick.x) * width > 56)) kept.push(tick);
    return kept;
  });

  // Accuracy fades away from now: strong within a day, fading by a week
  const fade = $derived.by(() => {
    const at = (ms: number) => ((scale.toPosition(ms) + 1) / 2) * 100;
    const stops = [
      [-7 * DAY, 0],
      [-3 * DAY, 0.04],
      [-DAY, 0.1],
      [-HOUR, 0.2],
      [0, 0.26],
      [HOUR, 0.2],
      [DAY, 0.1],
      [3 * DAY, 0.04],
      [7 * DAY, 0],
    ] as const;
    return `linear-gradient(to right, ${stops.map(([ms, a]) => `color-mix(in oklab, var(--glint) ${a * 100}%, transparent) ${at(ms)}%`).join(', ')})`;
  });
  const weekEdges = $derived([(scale.toPosition(-7 * DAY) + 1) / 2, (scale.toPosition(7 * DAY) + 1) / 2]);

  // Dragging and keys
  let track = $state<HTMLElement>();
  let dragging = false;
  // Measured once per drag: reading it on every move would force a layout each time
  let rect = { left: 0, width: 1 };
  function timeAt(clientX: number) {
    return Date.now() + scale.toOffset(((clientX - rect.left) / rect.width) * 2 - 1);
  }
  function onDown(event: PointerEvent) {
    track!.setPointerCapture(event.pointerId);
    const box = track!.getBoundingClientRect();
    rect = { left: box.left, width: box.width };
    dragging = true;
    stopFlyBack();
    clock.set(timeAt(event.clientX));
  }
  function onMove(event: PointerEvent) {
    if (dragging) clock.set(timeAt(event.clientX));
  }
  function onUp() {
    dragging = false;
  }
  function onKey(event: KeyboardEvent) {
    const step = event.shiftKey ? HOUR : MINUTE;
    const moves: Record<string, () => number> = {
      ArrowRight: () => clock.time + step,
      ArrowUp: () => clock.time + step,
      ArrowLeft: () => clock.time - step,
      ArrowDown: () => clock.time - step,
      PageUp: () => clock.time + DAY,
      PageDown: () => clock.time - DAY,
      Home: () => Date.now() - reach * DAY,
      End: () => Date.now() + reach * DAY,
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    stopFlyBack();
    clock.set(move());
  }

  function play(direction: 1 | -1) {
    stopFlyBack();
    clock.setSpeed(direction * Math.abs(clock.rate));
    clock.setPaused(false);
  }
  function pause() {
    stopFlyBack();
    clock.setPaused(true);
  }
  function faster() {
    const next = SPEEDS[(SPEEDS.indexOf(Math.abs(clock.rate)) + 1) % SPEEDS.length]!;
    clock.setSpeed(Math.sign(clock.rate || 1) * next);
  }

  /** The direction playback last ran in, which a play button resumes. */
  const heading = $derived(Math.sign(rate) || 1);

  function toggleReach() {
    clock.setReach(reach === STANDARD_DAYS ? EXTENDED_DAYS : STANDARD_DAYS);
  }

  const status = $derived(catalog.status);
  const liveShare = $derived(status?.done && status.positioned ? Math.round((status.live / status.positioned) * 100) : null);
  // Sitting exactly at the edge of a week (where narrowing the range leaves it) isn't beyond it
  const beyondWeek = $derived(Math.abs(offset) > 7 * DAY + MINUTE);

  // How much of the bottom of the screen the timeline takes, for the globe's framing and the panel's height
  let bar = $state<HTMLElement>();
  $effect(() => {
    if (!bar) return;
    const observer = new ResizeObserver(() => {
      view.timelineHeight = bar!.offsetHeight;
      document.documentElement.style.setProperty('--timeline', `${bar!.offsetHeight}px`);
    });
    observer.observe(bar);
    return () => observer.disconnect();
  });
</script>

<!-- One button per direction: it plays that way, and while playing that way it's the pause button -->
{#snippet direction(dir: 1 | -1)}
  {@const running = !paused && Math.sign(rate) === dir}
  <button class="chip icon" class:on={running} class:other={dir !== heading} type="button" aria-label={running ? 'Pause' : dir < 0 ? 'Play backwards' : 'Play'} onclick={() => (running ? pause() : play(dir))}>
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {#if running}<path d="M3 2h4v12H3zM9 2h4v12H9z" fill="currentColor" />{:else if dir < 0}<path d="M12 2v12L3 8z" fill="currentColor" />{:else}<path d="M4 2v12l9-6z" fill="currentColor" />{/if}
    </svg>
  </button>
{/snippet}

<section bind:this={bar} class="timeline" class:docked={selection.sheetOpen} aria-label="Time">
  {#if beyondWeek && status?.done}
    <p class="notice illustrative">
      Beyond a week, positions are illustrative.
      {#if offset > 0}
        <span class="figure">{number.format(status.unplaceable)}</span> objects can’t be calculated this far ahead.
      {:else}
        <span class="figure">{number.format(status.unlaunched)}</span> hadn’t launched yet and <span class="figure">{number.format(status.unplaceable)}</span> can’t be calculated this far back. Satellites that have since re-entered aren’t shown.
      {/if}
    </p>
  {:else if status?.done && status.stale}
    <p class="notice stale">
      Live orbit data is unavailable, so you’re seeing {#if status.fetchedAt}data from <strong>{ago(Date.parse(status.fetchedAt) - Date.now())}</strong>{:else}an earlier copy{/if}. Positions are approximate.
    </p>
  {/if}

  <div class="readout">
    <p class="logbook"><time datetime={new Date(shown).toISOString()}>{readout.format(shown)}</time>{#if !atNow && Math.abs(shownOffset) >= 30_000}<span class="offset">{ago(shownOffset)}</span>{/if}</p>
    {#if liveShare !== null}
      <p class="live"><span class="figure">{liveShare}%</span> live</p>
    {/if}
  </div>

  <div class="controls">
    <div class="playback" role="group" aria-label="Playback">
      {@render direction(-1)}
      {@render direction(1)}
      <button class="chip speed" type="button" aria-label="Speed: {SPEED_NAMES[Math.abs(rate)]}. Change speed" onclick={faster}>
        <span class="figure">{Math.abs(rate)}×</span>
      </button>
    </div>

    <div
      bind:this={track}
      bind:clientWidth={width}
      class="ribbon"
      class:extended={reach > STANDARD_DAYS}
      role="slider"
      tabindex="0"
      aria-label="Moment shown"
      aria-valuemin={-reach * DAY}
      aria-valuemax={reach * DAY}
      aria-valuenow={Math.round(shownOffset)}
      aria-valuetext="{spoken.format(shown)}, {Math.abs(shownOffset) < 30_000 ? 'now' : ago(shownOffset)}"
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointercancel={onUp}
      onkeydown={onKey}
      style:--fade={fade}
      style:--week-start="{weekEdges[0]! * 100}%"
      style:--week-end="{weekEdges[1]! * 100}%"
    >
      <span class="now-mark" aria-hidden="true"></span>
      {#each ticks as tick (tick.label)}
        <span class="tick" class:major={tick.major} style:left="{tick.x * 100}%" aria-hidden="true">{tick.label}</span>
      {/each}
      <!-- Moved by transform on its own layer, so scrubbing never repaints the ribbon -->
      <span class="thumb-rail" style:transform="translateX({(position + 1) * 50}%)" aria-hidden="true"><span class="thumb"></span></span>
    </div>

    <div class="ends">
      <button class="chip reach" type="button" aria-pressed={reach > STANDARD_DAYS} aria-label="Reach 90 days either side" onclick={toggleReach}>90 days</button>
      {#if !atNow}
        <button class="button now" type="button" onclick={backToNow}>Now</button>
      {/if}
    </div>
  </div>

  <footer class="byline">Made by <a href={PROFILE_URL}>Kieron</a></footer>
</section>

<style>
  .timeline {
    position: fixed;
    z-index: 3;
    left: var(--gutter);
    right: var(--gutter);
    /* Above the bottom sheet when one is open */
    bottom: calc(var(--sheet, 0px) + var(--space-3) + env(safe-area-inset-bottom));
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-2) var(--space-4);
    pointer-events: none;
    transition:
      opacity 0.5s ease,
      translate 0.6s cubic-bezier(0.2, 0.7, 0.2, 1);
  }

  /* Phones: the headline has the screen first; the timeline arrives as it steps aside */
  @media (max-width: 699px), (orientation: landscape) and (max-height: 500px) {
    :global(html:not(.exploring)) .timeline {
      visibility: hidden;
      opacity: 0;
      translate: 0 0.75rem;
    }
  }

  .timeline > * {
    pointer-events: auto;
  }

  .notice {
    grid-column: 1 / -1;
    justify-self: start;
    max-width: 34rem;
    margin: 0;
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
    font-size: var(--size-label);
    line-height: 1.45;
    color: var(--muted);
    background: linear-gradient(155deg, var(--raise) 0 18%, var(--deck) 18% 100%);
    clip-path: var(--facet-cut);
  }

  .notice strong {
    color: var(--ink);
    font-weight: 600;
    white-space: nowrap;
  }

  .readout {
    grid-column: 1 / -1;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .logbook {
    margin: 0;
    font: 450 0.9375rem / 1.2 var(--font-data);
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }

  .offset {
    margin-left: var(--space-3);
    color: var(--glint);
    font-weight: 600;
    white-space: nowrap;
  }

  .live {
    margin: 0;
    font-size: var(--size-label);
    color: var(--faint);
    white-space: nowrap;
  }

  .figure {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: var(--ink);
  }

  .controls {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .playback,
  .ends {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
  }

  .icon {
    width: 44px;
    justify-content: center;
    padding: 0;
  }

  .speed {
    min-width: 60px;
    justify-content: center;
    padding: 0 var(--space-2);
  }

  /* Chosen: the amber facet */
  .chip.on,
  .chip[aria-pressed='true'] {
    color: var(--void);
  }

  .chip.on::before,
  .chip[aria-pressed='true']::before {
    background: linear-gradient(155deg, color-mix(in oklab, var(--glint), white 22%) 0 48%, var(--glint) 48% 100%);
  }

  .speed .figure {
    color: inherit;
  }

  .reach {
    font-size: var(--size-label);
    white-space: nowrap;
  }

  .now {
    margin-left: var(--space-1);
    padding: 0 var(--space-4);
  }

  /* The ribbon: a flat facet-cut band; accuracy fades away from now, and beyond a week it's hatched */
  .ribbon {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 44px;
    cursor: ew-resize;
    touch-action: none;
    background:
      var(--fade),
      linear-gradient(155deg, var(--raise) 0 35%, var(--deck) 35% 100%);
    clip-path: var(--facet-cut);
  }

  .ribbon.extended {
    background:
      var(--fade),
      repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in oklab, var(--muted), transparent 82%) 5px 6px) left / var(--week-start) 100% no-repeat,
      repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in oklab, var(--muted), transparent 82%) 5px 6px) right / calc(100% - var(--week-end)) 100% no-repeat,
      linear-gradient(155deg, var(--raise) 0 35%, var(--deck) 35% 100%);
  }

  .ribbon:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--glint);
  }

  .now-mark {
    position: absolute;
    top: 6px;
    bottom: 6px;
    left: 50%;
    width: 1px;
    background: var(--muted);
  }

  .tick {
    position: absolute;
    bottom: 5px;
    translate: -50% 0;
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
    color: var(--faint);
    white-space: nowrap;
    pointer-events: none;
  }

  .tick::before {
    content: '';
    position: absolute;
    left: 50%;
    bottom: calc(100% + 3px);
    width: 1px;
    height: 6px;
    background: var(--faint);
  }

  .tick.major {
    color: var(--muted);
  }

  .thumb-rail {
    position: absolute;
    inset: 0;
    will-change: transform;
    pointer-events: none;
  }

  /* The moment shown: an amber facet on a hairline */
  .thumb {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 2px;
    translate: -1px 0;
    background: var(--glint);
  }

  .thumb::before {
    content: '';
    position: absolute;
    top: 3px;
    left: 50%;
    width: 12px;
    height: 12px;
    translate: -50% 0;
    background: var(--glint);
    clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  }

  .byline {
    grid-column: 1 / -1;
    justify-self: end;
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

  /* Phones: the ribbon gets its own row; controls below it */
  @media (max-width: 699px) {
    .controls {
      flex-wrap: wrap;
      row-gap: var(--space-2);
    }

    .ribbon {
      order: -1;
      flex-basis: 100%;
    }

    .ends {
      margin-left: auto;
    }

    .byline {
      margin-top: calc(-1 * var(--space-1));
    }
  }

  /* Above an open bottom sheet: one row of play, the ribbon, speed and (away from now) Now, so the globe keeps its
     room. The panel heading says which moment is shown */
  .docked .notice,
  .docked .readout,
  .docked .reach,
  .docked .byline,
  .docked .other,
  .docked .ends:not(:has(.now)) {
    display: none;
  }

  .docked .controls {
    flex-wrap: nowrap;
    gap: var(--space-2);
  }

  .docked .ends {
    order: 2;
    margin-left: 0;
  }

  .docked .now {
    margin-left: 0;
  }

  .docked .playback {
    display: contents;
  }

  .docked .ribbon {
    order: 0;
    flex-basis: auto;
  }

  .docked .speed {
    order: 1;
  }
</style>
