<script lang="ts" module>
  /** The panel showing now: one at a time, and one closing never clears what the next has set. */
  let owner: object | null = null;
</script>

<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { Spring } from 'svelte/motion';
  import { selection } from '../selection.svelte';
  import { view } from '../view.svelte';

  let {
    label,
    key,
    onclose,
    header,
    corner,
    body,
    children,
  }: {
    /** Id of the heading that names the panel. */
    label: string;
    /** What the panel is about; a change cancels a close that's under way but keeps the height. */
    key: unknown;
    onclose: () => void;
    header: Snippet;
    /** Buttons beside the heading, ahead of the close button. */
    corner?: Snippet;
    body: Snippet;
    children?: Snippet;
  } = $props();

  // Wide screens: a panel on the right. A phone held upright: a bottom sheet with two resting heights. It opens at
  // the lower, just tall enough for the header, so the globe stays in view; fully open, it leaves the top bar and the
  // docked timeline row above it clear
  type Detent = 'peek' | 'full';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let sheet = $state(false);
  let viewport = $state(800);
  let detent = $state<Detent>('peek');
  let headerHeight = $state(96);
  let safeBottom = $state(0);
  const heights = $derived({
    peek: Math.round(headerHeight + safeBottom) + 26,
    full: Math.round(viewport - Math.max(view.topInset, 72) - view.timelineHeight - 20),
  });
  const height = new Spring(0, { stiffness: 0.15, damping: 0.8 });

  const me = {};
  owner = me;
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
      if (owner !== me) return;
      owner = null;
      selection.sheetOpen = false;
      selection.insets = { right: 0, bottom: 0 };
      document.documentElement.style.setProperty('--sheet', '0px');
    };
  });

  // A different subject cancels a close that's under way
  let lastKey: unknown;
  $effect(() => {
    if (key !== lastKey) closing = false;
    lastKey = key;
  });

  $effect(() => {
    const target = sheet && !closing ? heights[detent] : 0;
    void height.set(target, { instant: reducedMotion || dragging });
  });

  // A sheet sent away slides down first, and closes once it's nearly gone
  let closing = $state(false);
  function closeSheet() {
    dragging = false;
    if (reducedMotion) return onclose();
    closing = true;
  }
  $effect(() => {
    if (closing && height.current < 24) {
      closing = false;
      onclose();
    }
  });

  $effect(() => {
    if (owner === me) selection.sheetOpen = sheet;
  });
  $effect(() => {
    if (owner === me) document.documentElement.style.setProperty('--sheet', sheet ? `${height.current}px` : '0px');
  });

  // Tell the globe how much of the screen the panel takes, so it can move into the space that's left.
  // A fully open sheet leaves nothing worth framing, so the globe stays where it sits above the lower height.
  let panel = $state<HTMLElement>();
  $effect(() => {
    if (owner !== me) return;
    if (sheet) selection.insets = { right: 0, bottom: heights.peek };
    else if (panel) selection.insets = { right: innerWidth - panel.getBoundingClientRect().left, bottom: 0 };
  });

  let dragging = $state(false);
  /** Finger speed in px/ms, upward positive, smoothed over the last few moves; a pause before letting go zeroes it. */
  type Motion = { lastY: number; lastTime: number; velocity: number };
  function follow(motion: Motion, y: number, time: number) {
    const dt = time - motion.lastTime;
    if (dt > 0) motion.velocity = 0.7 * ((motion.lastY - y) / dt) + 0.3 * motion.velocity;
    motion.lastY = y;
    motion.lastTime = time;
  }
  const releaseSpeed = (motion: Motion, time: number) => (time - motion.lastTime > 100 ? 0 : motion.velocity);
  const FLICK = 0.5;

  let drag: (Motion & { y: number; height: number; from: Detent }) | null = null;

  function onDragStart(event: PointerEvent) {
    if (!sheet) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { y: event.clientY, height: height.current, from: detent, lastY: event.clientY, lastTime: event.timeStamp, velocity: 0 };
    dragging = true;
  }

  function onDragMove(event: PointerEvent) {
    if (!drag) return;
    follow(drag, event.clientY, event.timeStamp);
    void height.set(Math.min(heights.full, Math.max(0, drag.height + drag.y - event.clientY)), { instant: true });
  }

  function onDragEnd(event: PointerEvent) {
    if (!drag) return;
    const velocity = releaseSpeed(drag, event.timeStamp);
    const from = drag.from;
    drag = null;
    // A flick moves one step from where the drag began: up to fully open, down to the header, then away
    if (velocity < -FLICK) {
      if (from === 'peek') return closeSheet();
      detent = 'peek';
    } else if (velocity > FLICK) {
      detent = 'full';
    } else {
      // Let go without a flick: it settles on the nearer height, or closes if lowered almost away
      if (height.current < heights.peek * 0.6) return closeSheet();
      detent = height.current > (heights.peek + heights.full) / 2 ? 'full' : 'peek';
    }
    dragging = false;
    void height.set(heights[detent]);
  }

  // Pulling the list down from its top closes the sheet, as long as the list was already resting at the top
  // when the finger went down; reaching the top while scrolling up never closes it, even with the next swipe
  const SETTLED_MS = 400;
  let list = $state<HTMLElement>();
  $effect(() => {
    const scroller = list;
    if (!scroller || !sheet) return;
    let lastScroll = 0;
    let pull: (Motion & { x: number; y: number; height: number; armed: boolean; mode: 'sheet' | 'list' | null }) | null = null;
    const onScroll = () => (lastScroll = performance.now());
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      pull =
        touch && event.touches.length === 1
          ? { x: touch.clientX, y: touch.clientY, height: height.current, armed: scroller.scrollTop <= 0 && performance.now() - lastScroll > SETTLED_MS, mode: null, lastY: touch.clientY, lastTime: event.timeStamp, velocity: 0 }
          : null;
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!pull || !touch || event.touches.length !== 1) return;
      const dx = Math.abs(touch.clientX - pull.x);
      const dy = touch.clientY - pull.y;
      if (!pull.mode) {
        // Held still until the gesture is decided, so the list doesn't start scrolling first; sideways
        // swipes (a row of chips) are left alone
        if (pull.armed && dy > dx) event.preventDefault();
        if (Math.hypot(dx, dy) < 6) return;
        pull.mode = pull.armed && dy > dx ? 'sheet' : 'list';
        if (pull.mode === 'sheet') dragging = true;
      }
      if (pull.mode !== 'sheet') return;
      event.preventDefault();
      follow(pull, touch.clientY, event.timeStamp);
      void height.set(Math.max(0, pull.height - Math.max(0, dy)), { instant: true });
    };
    const onEnd = (event: TouchEvent) => {
      if (pull?.mode === 'sheet') {
        const pulled = pull.height - height.current;
        if (pulled >= Math.max(80, pull.height * 0.2) || releaseSpeed(pull, event.timeStamp) < -FLICK) closeSheet();
        else {
          dragging = false;
          void height.set(heights[detent]);
        }
      }
      pull = null;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('touchstart', onStart, { passive: true });
    scroller.addEventListener('touchmove', onMove, { passive: false });
    scroller.addEventListener('touchend', onEnd);
    scroller.addEventListener('touchcancel', onEnd);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('touchstart', onStart);
      scroller.removeEventListener('touchmove', onMove);
      scroller.removeEventListener('touchend', onEnd);
      scroller.removeEventListener('touchcancel', onEnd);
    };
  });
</script>

<aside bind:this={panel} class="panel" class:sheet style:height={sheet ? `${height.current}px` : undefined} aria-labelledby={label}>
  <header class:paired={!!corner} role="group" bind:offsetHeight={headerHeight} onpointerdown={onDragStart} onpointermove={onDragMove} onpointerup={onDragEnd} onpointercancel={onDragEnd}>
    {#if sheet}
      <!-- Dragging the header moves the sheet; the grip does the same from a keyboard -->
      <button
        class="grip"
        type="button"
        aria-label={detent === 'full' ? 'Show less' : 'Show more'}
        onclick={() => (detent = detent === 'full' ? 'peek' : 'full')}
        onpointerdown={(e) => e.stopPropagation()}
      ></button>
    {/if}
    {@render header()}
    <div class="corner" onpointerdown={(e) => e.stopPropagation()} role="presentation">
      {@render corner?.()}
      <!-- Phones swipe the sheet away; the button stays for keyboards and screen readers, which can't -->
      <button class="chip icon close" type="button" aria-label="Close" onclick={onclose}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 2 14 13l-1 1L2 3zM13 2l1 1L3 14l-1-1z" fill="currentColor" /></svg>
      </button>
    </div>
  </header>

  <div class="body" bind:this={list}>
    {@render body()}
  </div>
  {@render children?.()}
  <!-- How much of the screen's foot the home indicator takes, so the lowest sheet clears it -->
  <span class="safe-probe" bind:clientHeight={safeBottom} aria-hidden="true"></span>
</aside>

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

  /* --corner-room keeps the heading clear of the corner buttons; content lower down may reclaim it */
  header {
    --corner-room: 3.25rem;
    position: relative;
    flex: none;
    padding-right: var(--corner-room);
  }

  header.paired {
    --corner-room: 6.5rem;
  }

  .sheet header {
    --corner-room: 0px;
    padding-top: var(--space-4);
    cursor: grab;
    touch-action: none;
  }

  .sheet header.paired {
    --corner-room: 3.25rem;
  }

  /* Widened by a chip row's overhang either side, so that row's focus rings fit without the list panning sideways */
  .body {
    flex: 1 1 auto;
    min-height: 0;
    margin: 0 calc(-1 * var(--space-1));
    padding: 0 var(--space-1) calc(var(--space-6) + env(safe-area-inset-bottom));
    overflow: hidden auto;
    overscroll-behavior: contain;
  }

  /* A phone on its side: the header alone can be taller than the room above the timeline, so the whole panel scrolls */
  @media (max-height: 500px) {
    .panel:not(.sheet) {
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    .panel:not(.sheet) .body {
      flex: none;
      overflow: visible;
    }
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

  /* Buttons beside the heading, and on wide screens close */
  .corner {
    position: absolute;
    top: 0;
    right: 0;
    display: flex;
    gap: var(--space-2);
  }

  .sheet .corner {
    top: var(--space-3);
  }

  .corner :global(.icon) {
    width: 44px;
    justify-content: center;
    padding: 0;
  }

  /* Seen on a phone only when a keyboard reaches it */
  .sheet .close:not(:focus-visible) {
    position: absolute;
    width: 1px;
    min-height: 0;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .safe-probe {
    position: fixed;
    bottom: 0;
    width: 0;
    height: env(safe-area-inset-bottom);
    visibility: hidden;
    pointer-events: none;
  }

  /* The type every panel shares: a kind line, the name, a line of identifiers, then sections */
  .panel :global(.kind) {
    margin: 0 0 var(--space-1);
    font-size: var(--size-label);
    color: var(--muted);
  }

  .panel :global(h2) {
    margin: 0;
    font: 600 var(--size-title) / 1.1 var(--font-display);
    letter-spacing: -0.02em;
    overflow-wrap: anywhere;
  }

  .panel :global(.ids) {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    margin: var(--space-2) 0 var(--space-4);
    font-size: var(--size-label);
    color: var(--muted);
  }

  .panel :global(.figure) {
    font-family: var(--font-data);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
  }

  .panel :global(section) {
    padding: var(--space-4) 0;
    border-top: 1px solid var(--line);
  }

  .panel :global(h3) {
    margin: 0 0 var(--space-3);
    font-size: var(--size-label);
    font-weight: 600;
    color: var(--muted);
  }

  .panel :global(p) {
    margin: 0 0 var(--space-2);
    font-size: 0.9375rem;
    text-wrap: pretty;
  }

  .panel :global(.note) {
    font-size: var(--size-label);
    color: var(--muted);
  }

  .panel :global(dl) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3) var(--space-4);
    margin: 0;
  }

  .panel :global(dl div) {
    min-width: 0;
  }

  .panel :global(dt) {
    font-size: var(--size-label);
    color: var(--muted);
  }

  .panel :global(dd) {
    margin: 0;
    font-size: 0.9375rem;
    overflow-wrap: anywhere;
  }

  .panel :global(.actions) {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: 1px solid var(--line);
  }
</style>
