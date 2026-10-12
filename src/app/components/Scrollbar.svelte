<script lang="ts">
  /**
   * A faceted scrollbar drawn beside a list that scrolls, whose own scrollbar is hidden: drag the thumb, press the
   * track to page, or turn the wheel over it. Assistive tech and keyboards scroll the list itself.
   */
  let {
    target,
    offset = 10,
    top = 0,
    bottom = 12,
  }: {
    target: HTMLElement | undefined;
    /** From the list's right edge to the bar's centre line, px; negative is inside the list. */
    offset?: number;
    /** How far the track stops short of the list's top and foot, px. */
    top?: number;
    bottom?: number;
  } = $props();

  const MIN_THUMB = 32;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let box = $state({ x: 0, y: 0, height: 0 });
  let thumb = $state({ y: 0, height: 0 });
  let grab = $state<{ y: number; scroll: number } | null>(null);

  function measure() {
    const list = target;
    if (!list) return;
    const range = list.scrollHeight - list.clientHeight;
    const track = list.clientHeight - top - bottom;
    const length = Math.max(MIN_THUMB, (track * list.clientHeight) / list.scrollHeight);
    box = { x: list.offsetLeft + list.offsetWidth + offset, y: list.offsetTop + top, height: range > 1 ? track : 0 };
    thumb = { y: range > 0 ? (list.scrollTop / range) * (track - length) : 0, height: length };
  }

  $effect(() => {
    const list = target;
    if (!list) return;
    measure();
    // The list's contents change size as they arrive, so each child is watched as well as the list
    const sized = new ResizeObserver(measure);
    const watch = () => {
      sized.observe(list);
      for (const child of list.children) sized.observe(child);
      measure();
    };
    const changed = new MutationObserver(watch);
    watch();
    changed.observe(list, { childList: true });
    list.addEventListener('scroll', measure, { passive: true });
    return () => {
      sized.disconnect();
      changed.disconnect();
      list.removeEventListener('scroll', measure);
    };
  });

  function onDown(event: PointerEvent) {
    const list = target;
    if (!list || event.button !== 0) return;
    const y = event.clientY - (event.currentTarget as HTMLElement).getBoundingClientRect().top;
    // Pressed beside the thumb: a page towards the press
    if (y < thumb.y || y > thumb.y + thumb.height) {
      list.scrollBy({ top: Math.sign(y - thumb.y) * list.clientHeight * 0.9, behavior: reducedMotion ? 'instant' : 'smooth' });
      return;
    }
    grab = { y: event.clientY, scroll: list.scrollTop };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onMove(event: PointerEvent) {
    const list = target;
    const travel = box.height - thumb.height;
    if (!grab || !list || travel <= 0) return;
    list.scrollTop = grab.scroll + ((event.clientY - grab.y) / travel) * (list.scrollHeight - list.clientHeight);
  }

  function onWheel(event: WheelEvent) {
    const list = target;
    if (!list) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientHeight : 1;
    list.scrollBy({ top: event.deltaY * unit });
  }
</script>

{#if box.height}
  <!-- Pressing it never takes focus from a field the list belongs to -->
  <div
    class="scrollbar"
    class:held={grab !== null}
    role="presentation"
    aria-hidden="true"
    style:left="{box.x - 8}px"
    style:top="{box.y}px"
    style:height="{box.height}px"
    onmousedown={(e) => e.preventDefault()}
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={() => (grab = null)}
    onpointercancel={() => (grab = null)}
    onwheel={onWheel}
  >
    <div class="thumb" style:translate="0 {thumb.y}px" style:height="{thumb.height}px"></div>
  </div>
{/if}

<style>
  /* 16 px to aim at; what shows is a hairline track and a narrow thumb */
  .scrollbar {
    position: absolute;
    z-index: 1;
    width: 16px;
    touch-action: none;
  }

  .scrollbar::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 7px;
    width: 2px;
    background: var(--line);
  }

  /* A narrow facet, its ends cut on the slant like the sheet's grip; amber while held */
  .thumb {
    position: absolute;
    top: 0;
    left: 5px;
    width: 6px;
    background: var(--muted);
    opacity: 0.6;
    clip-path: polygon(0 4px, 100% 0, 100% calc(100% - 4px), 0 100%);
    transition:
      opacity 0.2s,
      background-color 0.2s,
      left 0.2s,
      width 0.2s;
  }

  .scrollbar:hover .thumb,
  .held .thumb {
    left: 4px;
    width: 8px;
    opacity: 1;
  }

  .held .thumb {
    background: var(--glint);
  }
</style>
