<script lang="ts">
  import { onMount } from 'svelte';
  import { Spring } from 'svelte/motion';
  import { selection } from '../selection.svelte';
  import { clock } from '../../time/clock';
  import { accuracyGrade, type Grade, type OrbitClass } from '../../orbit/describe';
  import { view } from '../view.svelte';
  import { loadNames, names as shared } from '../names.svelte';

  const KIND = { payload: 'Satellite', rocket: 'Rocket body', debris: 'Debris' } as const;
  const CLASS: Record<OrbitClass, string> = {
    leo: 'Low Earth orbit',
    meo: 'Medium Earth orbit',
    geo: 'Geosynchronous orbit',
    heo: 'Highly elliptical orbit',
  };
  const GRADE: Record<Grade, [label: string, copy: string]> = {
    live: ['Live', 'Accurate to within a few km.'],
    good: ['Good', 'Accurate to within tens of km.'],
    approximate: ['Approximate', 'Its position along its orbit is approximate.'],
    low: ['Rough', 'This far from its last measurement, treat its position as a rough guide.'],
  };

  const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
  const one = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const two = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const relative = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });

  function ago(ms: number) {
    const minutes = (Date.now() - ms) / 60_000;
    if (minutes < 90) return relative.format(-Math.max(1, Math.round(minutes)), 'minute');
    if (minutes < 48 * 60) return relative.format(-Math.round(minutes / 60), 'hour');
    return relative.format(-Math.round(minutes / 1440), 'day');
  }

  const names = $derived(shared.table);

  const current = $derived(selection.current);
  const selected = $derived(current ? current.candidates[current.index]! : null);
  const nearby = $derived(current ? current.candidates.map((candidate, index) => ({ candidate, index })).filter(({ index }) => index !== current.index) : []);
  // Only details for the object that's selected now, not one the worker was still answering about
  const details = $derived(selection.described && selection.described.details.norad === selected?.norad ? selection.described.details : null);
  const now = $derived(details ? selection.described!.now : null);
  const grade = $derived(details ? accuracyGrade(details.epoch, clock.time) : null);

  function kindOf(station: boolean, type: keyof typeof KIND, working: boolean | null | undefined) {
    if (station) return 'Space station';
    if (type === 'payload' && working === true) return 'Working satellite';
    if (type === 'payload' && working === false) return 'Inactive satellite';
    return KIND[type];
  }

  // Said once per selection, when its position is first known
  let announcement = $state('');
  let announced = -1;
  $effect(() => {
    if (!details || details.norad === announced) return;
    announced = details.norad;
    announcement = now ? `${details.name} selected, altitude ${number.format(now.altitudeKm)} kilometres` : `${details.name} selected`;
  });

  let copied = $state(false);
  async function share(name: string, norad: number) {
    const url = new URL('/', location.origin);
    url.searchParams.set('sat', String(norad));
    if (Math.abs(clock.time - Date.now()) > 60_000) url.searchParams.set('t', new Date(clock.time).toISOString().slice(0, 19) + 'Z');
    const link = url.toString();
    // Phones get the system share sheet; elsewhere the link is copied
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: `${name} on Overhead`, url: link }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(link).catch(() => undefined);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

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

  // A launch group belongs to the object it was shown for: any change of selection clears it
  let shownFor = -1;
  $effect(() => {
    const norad = selected?.norad ?? -1;
    if (norad !== shownFor) view.launchCount = null;
    shownFor = norad;
  });

  // A new selection opens the sheet halfway; swapping between nearby objects keeps its height
  let wasOpen = false;
  $effect(() => {
    const open = !!selected;
    if (open && !wasOpen) detent = 'half';
    if (open) loadNames();
    wasOpen = open;
  });
  $effect(() => {
    const target = selected && sheet ? heights[detent] : 0;
    void height.set(target, { instant: reducedMotion || dragging });
  });

  $effect(() => {
    selection.sheetOpen = !!selected && sheet && !selection.following;
  });
  $effect(() => {
    document.documentElement.style.setProperty('--sheet', selected && sheet && !selection.following ? `${height.current}px` : '0px');
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
  let drag: { y: number; height: number; lastY: number; lastTime: number } | null = null;

  function onDragStart(event: PointerEvent) {
    if (!sheet) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { y: event.clientY, height: height.current, lastY: event.clientY, lastTime: event.timeStamp };
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

{#if selected && !selection.following}
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
      <p class="kind">{kindOf(selected.station, selected.type, details?.working)}</p>
      <h2 id="object-name">{selected.name}</h2>
      <p class="ids">
        <span>NORAD <span class="figure">{selected.norad}</span></span>
        {#if details?.cospar}<span>International <span class="figure">{details.cospar}</span></span>{/if}
      </p>
      <button class="chip close" type="button" aria-label="Close" onclick={() => selection.close()} onpointerdown={(e) => e.stopPropagation()}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 2 14 13l-1 1L2 3zM13 2l1 1L3 14l-1-1z" fill="currentColor" /></svg>
      </button>
    </header>

    <div class="body">
      {#if nearby.length}
        <section class="nearby" aria-labelledby="nearby-title">
          <h3 id="nearby-title">Also under your tap</h3>
          <ul>
            {#each nearby as { candidate, index } (candidate.slot)}
              <li><button class="chip" type="button" onclick={() => selection.choose(index)}>{candidate.name}</button></li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if details}
        <section aria-labelledby="now-title">
          <h3 id="now-title">Right now</h3>
          {#if now}
            <dl>
              <div><dt>Altitude</dt><dd><span class="figure">{number.format(now.altitudeKm)}</span> km</dd></div>
              <div><dt>Speed</dt><dd><span class="figure">{two.format(now.speedKms)}</span> km/s</dd></div>
            </dl>
            <p class="light" class:lit={now.sunlit}>{now.sunlit ? 'In sunlight' : 'In Earth’s shadow'}</p>
          {:else}
            <p class="note">No reliable position at this time.</p>
          {/if}
        </section>

        <section aria-labelledby="orbit-title">
          <h3 id="orbit-title">{CLASS[details.orbit.orbitClass]}{details.orbit.sunSynchronous ? ', Sun-synchronous' : ''}</h3>
          <dl>
            <div><dt>Once round</dt><dd><span class="figure">{one.format(details.orbit.periodMinutes)}</span> min</dd></div>
            <div><dt>Inclination</dt><dd><span class="figure">{one.format(details.orbit.inclinationDeg)}</span>°</dd></div>
            <div><dt>Highest</dt><dd><span class="figure">{number.format(details.orbit.apogeeKm)}</span> km</dd></div>
            <div><dt>Lowest</dt><dd><span class="figure">{number.format(details.orbit.perigeeKm)}</span> km</dd></div>
          </dl>
        </section>

        {#if grade}
          <section aria-labelledby="accuracy-title">
            <h3 id="accuracy-title">How accurate</h3>
            <p><span class="grade grade-{grade}">{GRADE[grade][0]}</span> {GRADE[grade][1]}</p>
            <p class="note">Orbit measured {ago(details.epoch)}.</p>
          </section>
        {/if}

        {#if details.country || details.launchDate}
          <section aria-labelledby="origin-title">
            <h3 id="origin-title">Where it came from</h3>
            <dl>
              {#if details.country}
                <div><dt>Owner</dt><dd>{names?.owners[details.country] ?? details.country}</dd></div>
              {/if}
              {#if details.launchDate}
                <div><dt>Launched</dt><dd>{day.format(new Date(details.launchDate))}</dd></div>
              {/if}
              {#if details.site}
                <div><dt>From</dt><dd>{names?.sites[details.site] ?? details.site}</dd></div>
              {/if}
            </dl>
          </section>
        {/if}

        <section aria-labelledby="brightness-title">
          <h3 id="brightness-title">How bright</h3>
          {#if details.giant}
            <p>One of the brightest objects in orbit.</p>
          {:else if details.magnitude !== null}
            <p>Estimated brightness: magnitude <span class="figure">{one.format(details.magnitude)}</span>.</p>
            <p class="note">Estimated from its radar size, so the real figure can differ by a magnitude or more.</p>
          {:else}
            <p class="note">No estimate: its radar size isn’t published.</p>
          {/if}
          <details>
            <summary>What’s this?</summary>
            <p class="note">Magnitude is astronomers’ scale of brightness: lower is brighter, and from a dark site the faintest stars you can see are about 6.</p>
          </details>
        </section>

        <div class="actions">
          <button class="button" type="button" onclick={() => selection.follow()} disabled={!now}>Follow</button>
          <button class="chip" type="button" onclick={() => share(details.name, details.norad)}>{copied ? 'Link copied' : 'Share'}</button>
          {#if view.isConstellation(details.name) && details.cospar}
            <button class="chip" type="button" aria-pressed={view.launchCount !== null} onclick={() => view.showLaunch(view.launchCount === null, details.cospar)}>
              {view.launchCount === null ? 'Show its launch' : 'Show everything'}
            </button>
          {/if}
        </div>
        {#if view.launchCount}
          <p class="note launch">{number.format(view.launchCount)} objects from the same launch, joined in order along the orbit.</p>
        {/if}
      {/if}
    </div>
    <p class="visually-hidden" aria-live="polite">{announcement}{copied ? '. Link copied.' : ''}</p>
  </aside>
{/if}

<style>
  /* A facet-cut --deck panel with a lit --raise facet in its upper-left corner */
  .panel {
    position: fixed;
    z-index: 3;
    /* Below the search and view controls */
    top: calc(var(--space-4) + env(safe-area-inset-top) + 44px + var(--space-6));
    right: var(--gutter);
    display: flex;
    flex-direction: column;
    width: min(380px, calc(100vw - 2 * var(--gutter)));
    max-height: calc(100svh - 44px - 3 * var(--space-6) - var(--timeline, 7rem));
    padding: var(--space-6) var(--space-6) 0;
    isolation: isolate;
    background: linear-gradient(155deg, var(--raise) 0 18%, var(--deck) 18% 100%);
    clip-path: var(--facet-cut);
    animation: arrive 0.28s cubic-bezier(0.2, 0.7, 0.2, 1);
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
    padding: var(--space-3) var(--gutter) 0;
    animation: none;
    clip-path: polygon(var(--chamfer) 0, calc(100% - var(--chamfer)) 0, 100% var(--chamfer), 100% 100%, 0 100%, 0 var(--chamfer));
  }

  header {
    position: relative;
    flex: none;
    padding-right: 3.25rem;
    touch-action: none;
  }

  .sheet header {
    padding-top: var(--space-4);
    cursor: grab;
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-bottom: calc(var(--space-6) + env(safe-area-inset-bottom));
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
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    margin: var(--space-2) 0 var(--space-4);
    font-size: var(--size-label);
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

  section {
    padding: var(--space-4) 0;
    border-top: 1px solid var(--line);
  }

  h3 {
    margin: 0 0 var(--space-3);
    font-size: var(--size-label);
    font-weight: 600;
    color: var(--muted);
  }

  p {
    margin: 0 0 var(--space-2);
    font-size: 0.9375rem;
    text-wrap: pretty;
  }

  .note {
    font-size: var(--size-label);
    color: var(--muted);
  }

  .launch {
    margin-top: var(--space-3);
  }

  dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3) var(--space-4);
    margin: 0;
  }

  dl div {
    min-width: 0;
  }

  dt {
    font-size: var(--size-label);
    color: var(--muted);
  }

  dd {
    margin: 0;
    font-size: 0.9375rem;
    overflow-wrap: anywhere;
  }

  /* Text that says what the point's colour says */
  .light {
    margin: var(--space-3) 0 0;
    font-size: var(--size-label);
    font-weight: 600;
    color: var(--cool);
  }

  .light.lit {
    color: var(--glint);
  }

  /* The accuracy grade as a small flat facet */
  .grade {
    display: inline-block;
    margin-right: var(--space-1);
    padding: 0.15em 0.6em;
    font-size: var(--size-label);
    font-weight: 650;
    color: var(--void);
    background: var(--glint);
    clip-path: polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px);
  }

  .grade-good {
    background: color-mix(in oklab, var(--glint), var(--cool) 45%);
  }

  .grade-approximate,
  .grade-low {
    color: var(--ink);
    background: var(--raise);
  }

  details {
    margin-top: var(--space-2);
  }

  summary {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    font-size: var(--size-label);
    font-weight: 600;
    color: var(--ink);
    text-decoration: underline;
    text-decoration-color: var(--line);
    text-underline-offset: 0.2em;
    cursor: pointer;
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  /* Nearby objects: one scrolling row, so the details stay in view */
  .nearby {
    padding-top: var(--space-3);
  }

  ul {
    display: flex;
    gap: var(--space-2);
    margin: 0 calc(-1 * var(--space-1));
    padding: 0 var(--space-1) var(--space-1);
    overflow-x: auto;
    list-style: none;
    scrollbar-width: none;
    mask-image: linear-gradient(to right, black calc(100% - 2rem), transparent);
  }

  ul::-webkit-scrollbar {
    display: none;
  }

  li {
    flex: none;
  }

  ul .chip {
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
    line-height: 44px;
    font-size: var(--size-label);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: 1px solid var(--line);
  }
</style>
