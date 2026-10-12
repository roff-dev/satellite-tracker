<script lang="ts">
  import { onMount } from 'svelte';
  import { selection } from '../selection.svelte';
  import { clock } from '../../time/clock';
  import { accuracyGrade, type Grade, type OrbitClass } from '../../orbit/describe';
  import { view } from '../view.svelte';
  import { loadNames, names as shared } from '../names.svelte';
  import Sheet from './Sheet.svelte';

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
  const away = new Intl.RelativeTimeFormat('en-GB', { numeric: 'always' });
  const moment = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  function ago(ms: number) {
    const minutes = (Date.now() - ms) / 60_000;
    if (minutes < 90) return relative.format(-Math.max(1, Math.round(minutes)), 'minute');
    if (minutes < 48 * 60) return relative.format(-Math.round(minutes / 60), 'hour');
    return relative.format(-Math.round(minutes / 1440), 'day');
  }

  /** "In 3 hours", "2 days ago": how far the moment shown is from now. */
  function fromNow(offset: number) {
    const minutes = offset / 60_000;
    const text =
      Math.abs(minutes) < 90 ? away.format(Math.round(minutes), 'minute')
      : Math.abs(minutes) < 48 * 60 ? away.format(Math.round(minutes / 60), 'hour')
      : away.format(Math.round(minutes / 1440), 'day');
    return text[0]!.toUpperCase() + text.slice(1);
  }

  const names = $derived(shared.table);

  const current = $derived(selection.current);
  const selected = $derived(current ? current.candidates[current.index]! : null);
  const nearby = $derived(current ? current.candidates.map((candidate, index) => ({ candidate, index })).filter(({ index }) => index !== current.index) : []);
  // Only details for the object that's selected now, not one the worker was still answering about
  const details = $derived(selection.described && selection.described.details.norad === selected?.norad ? selection.described.details : null);
  const now = $derived(details ? selection.described!.now : null);
  const grade = $derived(details ? accuracyGrade(details.epoch, clock.time) : null);
  // The numbers are for the moment the timeline shows, which isn't always now
  const shownAt = $derived(details ? selection.described!.time : 0);
  const offset = $derived(shownAt - Date.now());

  function kindOf(station: boolean, type: keyof typeof KIND, working: boolean | null | undefined) {
    if (station) return 'Space station';
    if (type === 'payload' && working === true) return 'Working satellite';
    if (type === 'payload' && working === false) return 'Inactive satellite';
    return KIND[type];
  }

  onMount(loadNames);

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

  // A launch group belongs to the object it was shown for: any change of selection clears it
  let shownFor = -1;
  $effect(() => {
    const norad = selected?.norad ?? -1;
    if (norad !== shownFor) view.launchCount = null;
    shownFor = norad;
  });
</script>

{#if selected}
  <Sheet label="object-name" key={selected.norad} onclose={() => selection.close()}>
    {#snippet header()}
      <p class="kind">{kindOf(selected.station, selected.type, details?.working)}</p>
      <h2 id="object-name">{selected.name}</h2>
      <p class="ids">
        <span>NORAD <span class="figure">{selected.norad}</span></span>
        {#if details?.cospar}<span>International <span class="figure">{details.cospar}</span></span>{/if}
      </p>
    {/snippet}

    {#snippet corner()}
      <!-- Everything else drops away, so this one object can be watched on its own -->
      <button class="chip icon solo" type="button" aria-label="Show only this object" aria-pressed={selection.solo} title="Show only this object" onclick={() => selection.setSolo(!selection.solo)}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 2 22 12 12 22 2 12zm0 3.2L5.2 12l6.8 6.8 6.8-6.8z" fill="currentColor" fill-rule="evenodd" opacity="0.45" /><path d="M12 8.2 15.8 12 12 15.8 8.2 12z" fill="currentColor" /></svg>
      </button>
    {/snippet}

    {#snippet body()}
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
          {#if Math.abs(offset) < 30_000}
            <h3 id="now-title">Right now</h3>
          {:else}
            <h3 id="now-title"><span class="away">{fromNow(offset)}</span> {moment.format(shownAt)}</h3>
          {/if}
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

        {#if details.docked.length}
          <section aria-labelledby="docked-title">
            <h3 id="docked-title">Docked with it</h3>
            <p>{details.docked.join(', ')}</p>
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
    {/snippet}

    <p class="visually-hidden" aria-live="polite">{announcement}{copied ? '. Link copied.' : ''}</p>
  </Sheet>
{/if}

<style>
  /* On: the amber facet */
  .solo[aria-pressed='true'] {
    color: var(--void);
  }

  .solo[aria-pressed='true']::before {
    background: linear-gradient(155deg, color-mix(in oklab, var(--glint), white 22%) 0 48%, var(--glint) 48% 100%);
  }

  /* Away from now, the heading names the moment, its distance from now in amber as on the timeline */
  #now-title {
    font-variant-numeric: tabular-nums;
  }

  .away {
    color: var(--glint);
  }

  .launch {
    margin-top: var(--space-3);
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
</style>
