/**
 * Slide layout normalization: the geometry repair pass for slide elements.
 *
 * The model emits absolutely-positioned elements on a 1000×562.5 design
 * canvas. Three defect classes survive generation and reach the renderer,
 * where text is never clipped, so they read as occlusion:
 *
 *   1. content sticking out of its background card (10–60px misalignment);
 *   2. two content blocks occupying the same rectangle;
 *   3. elements past the canvas edge, cut off by the slide frame.
 *
 * `normalizeSlideLayout` repairs all three. Shapes and lines are treated as
 * background: each content block that mostly sits inside a background shape
 * becomes that container's member and is snapped into the container's inner
 * box (stacked vertically when two members collide, the container growing
 * downward when needed). Content that still overlaps other content — or
 * crosses a background it does not belong to — is pushed apart with real
 * clearance, preferentially downward so reading order is preserved; a
 * full-width label that cannot be pushed is narrowed back to its column.
 * Background-on-background overlap is left alone: content renders above
 * shapes, so it never occludes anything.
 *
 * The pass never drops content, is idempotent, and is a strict no-op for
 * slides that are already clean.
 */
import { noopGenerationLogger, type GenerationLogger } from './logger.js';

/**
 * Any slide element this pass can repair: geometry plus a type tag. The
 * generation pipeline's model-output surface satisfies it structurally, and
 * so does the editor's `PPTElement` union (whose line variant simply has no
 * height — lines are skipped by every rule below).
 */
export interface SlideLayoutElement {
  id?: string;
  type: string;
  left: number;
  top: number;
  width: number;
  height?: number;
}

export const SLIDE_CANVAS_WIDTH = 1000;
export const SLIDE_CANVAS_HEIGHT = 562.5;
const MARGIN = 50;
/** Clearance left between two pushed-apart blocks. */
const GAP = 12;
/** Inset for content snapped inside a card-sized container. */
const CARD_PAD = 14;
/** Inset for content snapped inside a smaller container (chips, header bands). */
const SMALL_PAD = 6;
/** Vertical gap when stacking colliding members inside one container. */
const STACK_GAP = 10;
/** A shape at least this big is a card; smaller ones are chips/bands. */
const CARD_MIN_WIDTH = 160;
const CARD_MIN_HEIGHT = 90;
/** Fraction of an element's area inside a container that makes it a member. */
const MEMBER_COVERAGE = 0.25;
/** Images half-on a card are collisions, not membership. */
const IMAGE_MEMBER_COVERAGE = 0.55;
/** Lefts within this distance are considered the same column. */
const COLUMN_TOLERANCE = 48;
/** Minimum width a narrowed label may keep. */
const NARROW_MIN_WIDTH = 180;
const MAX_RESOLVE_ROUNDS = 8;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ElementGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SlideLayoutResult<T> {
  elements: T[];
  /** How many elements had their geometry repaired. */
  fixed: number;
  /** Overlap pairs that could not be resolved within the canvas. */
  remainingOverlaps: number;
}

const box = (e: ElementGeometry): Box => ({
  left: e.left,
  top: e.top,
  right: e.left + e.width,
  bottom: e.top + e.height,
});

/** Lines carry no height; every other element does. */
const geoOf = (e: SlideLayoutElement): Box & ElementGeometry => ({
  left: e.left,
  top: e.top,
  width: e.width,
  height: e.height ?? 0,
  right: e.left + e.width,
  bottom: e.top + (e.height ?? 0),
});

const intersectionArea = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** Shapes and lines render below everything: they are background, not content. */
const isBackground = (e: SlideLayoutElement) => e.type === 'shape' || e.type === 'line';
/** Thin shapes (accent bars, dividers) are decoration: they own no content. */
const isDecorShape = (e: SlideLayoutElement) =>
  e.type === 'shape' && (e.width <= 24 || (e.height ?? 0) <= 24);
const isContainer = (e: SlideLayoutElement) => e.type === 'shape' && !isDecorShape(e);
const isContent = (e: SlideLayoutElement) => !isBackground(e);
const isCardSized = (e: SlideLayoutElement) => e.width >= CARD_MIN_WIDTH && (e.height ?? 0) >= CARD_MIN_HEIGHT;
const padOf = (container: SlideLayoutElement) => (isCardSized(container) ? CARD_PAD : SMALL_PAD);

const clampToCanvas = (e: ElementGeometry): ElementGeometry => {
  const width = Math.max(1, Math.min(e.width, SLIDE_CANVAS_WIDTH - 2 * MARGIN));
  const height = Math.max(1, Math.min(e.height, SLIDE_CANVAS_HEIGHT - 2 * MARGIN));
  return {
    width,
    height,
    left: Math.max(MARGIN, Math.min(e.left, SLIDE_CANVAS_WIDTH - MARGIN - width)),
    top: Math.max(MARGIN, Math.min(e.top, SLIDE_CANVAS_HEIGHT - MARGIN - height)),
  };
};

const withGeometry = <T extends SlideLayoutElement>(e: T, g: ElementGeometry): T => ({
  ...e,
  left: g.left,
  top: g.top,
  width: g.width,
  height: g.height,
}) as T;

/**
 * Repair the geometry of one slide's elements. Pure: returns new element
 * objects, never mutates the input, never drops an element.
 */
export function normalizeSlideLayout<T extends SlideLayoutElement>(
  elements: T[],
  log: GenerationLogger = noopGenerationLogger,
): SlideLayoutResult<T> {
  if (elements.length === 0) return { elements, fixed: 0, remainingOverlaps: 0 };

  // Recover from garbage geometry first — the repair path reads stored JSON.
  let els = elements.map((e) => {
    const geometry = { left: Number(e.left), top: Number(e.top), width: Number(e.width), height: Number(e.height ?? 0) };
    if (
      !Number.isFinite(geometry.left) ||
      !Number.isFinite(geometry.top) ||
      !Number.isFinite(geometry.width) ||
      !Number.isFinite(geometry.height)
    ) {
      log.warn(`Slide element ${e.id} has non-finite geometry; resetting to defaults`);
      return withGeometry(e, { left: MARGIN, top: MARGIN, width: 300, height: 100 });
    }
    return e;
  });

  // Phase A — canvas bounds. Everything later assumes in-bounds rectangles.
  let fixed = 0;
  els = els.map((e) => {
    if (e.type === 'line') return e; // no height to clamp; decoration anyway
    const clamped = clampToCanvas(geoOf(e));
    if (clamped.left !== e.left || clamped.top !== e.top || clamped.width !== e.width || clamped.height !== e.height) {
      fixed++;
      log.info(`Clamped ${e.type} element ${e.id} into the canvas: (${e.left},${e.top},${e.width},${e.height}) -> (${clamped.left},${clamped.top},${clamped.width},${clamped.height})`);
      return withGeometry(e, clamped);
    }
    return e;
  });

  // Phase B — assign each content element to the background shape that holds
  // most of it (best coverage wins).
  const containerIndices: number[] = [];
  els.forEach((e, i) => {
    if (isContainer(e)) containerIndices.push(i);
  });
  const memberOf = new Map<number, number>(); // element index → container index
  if (containerIndices.length > 0) {
    els.forEach((e, i) => {
      if (!isContent(e)) return;
      const eArea = e.width * (e.height ?? 0);
      if (eArea <= 0) return;
      const threshold = e.type === 'image' ? IMAGE_MEMBER_COVERAGE : MEMBER_COVERAGE;
      let bestContainer = -1;
      let bestCoverage = 0;
      for (const c of containerIndices) {
        const coverage = intersectionArea(geoOf(e), geoOf(els[c])) / eArea;
        // Text centered inside its background shape (Rule 5) is never wider
        // than the shape; a full-width body line that merely crosses a card
        // must not be claimed as the card's content — unless the box is
        // effectively inside it anyway (an over-declared width).
        if (e.width > els[c].width * 1.05 && coverage < 0.9) continue;
        if (coverage > bestCoverage) {
          bestCoverage = coverage;
          bestContainer = c;
        }
      }
      if (bestCoverage >= threshold) memberOf.set(i, bestContainer);
    });
  }

  const membersOfContainer = (containerIdx: number): number[] => {
    const out: number[] = [];
    memberOf.forEach((container, member) => {
      if (container === containerIdx) out.push(member);
    });
    return out.sort((a, b) => els[a].top - els[b].top || els[a].left - els[b].left);
  };

  const setGeometry = (i: number, patch: Partial<ElementGeometry>) => {
    const e = els[i];
    els[i] = withGeometry(e, { left: e.left, top: e.top, width: e.width, height: e.height ?? 0, ...patch });
  };

  const growContainerForMembers = (containerIdx: number) => {
    const container = els[containerIdx];
    const members = membersOfContainer(containerIdx);
    if (members.length === 0) return;
    let bottom = -Infinity;
    for (const m of members) bottom = Math.max(bottom, els[m].top + (els[m].height ?? 0));
    const pad = padOf(container);
    // Growth stops at the frame: a member that overflows the card's bottom
    // edge beats a card that walks off the canvas (and, on re-runs, keeps
    // walking — Phase A would clamp it back, so the pass would not converge).
    const wantedHeight = Math.min(
      bottom + pad - container.top,
      SLIDE_CANVAS_HEIGHT - MARGIN - container.top,
    );
    if (wantedHeight > (container.height ?? 0)) {
      setGeometry(containerIdx, { height: wantedHeight });
      fixed++;
      log.info(`Extended shape ${container.id} height ${Math.round(container.height ?? 0)} -> ${Math.round(wantedHeight)} to fit its content`);
    }
  };

  // Phase C1 — snap every member into its container's inner box. Members are
  // nudged, never resized (the renderer does not clip text, so an understated
  // box would still paint over its neighbors); a container that is too small
  // grows downward instead.
  for (const containerIdx of containerIndices) {
    const container = els[containerIdx];
    const pad = padOf(container);
    const innerLeft = container.left + pad;
    const innerTop = container.top + pad;
    const innerRight = container.left + container.width - pad;
    for (const m of membersOfContainer(containerIdx)) {
      const e = els[m];
      let { left, top, width } = e;
      const innerWidth = innerRight - innerLeft;
      if (width > innerWidth) {
        // A member wider than the inner box anchors at the inner left and
        // wraps (the renderer reflows text) rather than painting past the
        // card. The readability floor never widens the box and never pushes
        // its right edge past the frame, so the snap converges.
        left = innerLeft;
        const canvasSpace = SLIDE_CANVAS_WIDTH - MARGIN - innerLeft;
        const floor = Math.min(NARROW_MIN_WIDTH, canvasSpace);
        width = Math.min(width, Math.max(floor, Math.min(innerWidth, canvasSpace)));
      } else if (innerLeft - left > 0) {
        left = innerLeft;
      } else if (left + width - innerRight > 0) {
        left = innerRight - width;
      }
      // Never snap a member past the frame — an overlap inside the card
      // beats content clipped off the canvas (the same trade C2 makes).
      if (innerTop - top > 0) top = Math.min(innerTop, SLIDE_CANVAS_HEIGHT - MARGIN - (e.height ?? 0));
      const clamped = clampToCanvas({ left, top, width, height: e.height ?? 0 });
      left = clamped.left;
      top = clamped.top;
      width = clamped.width;
      if (left !== e.left || top !== e.top || width !== e.width) {
        setGeometry(m, { left, top, width });
        fixed++;
        log.info(`Snapped element ${e.id} into shape ${container.id}: (${Math.round(e.left)},${Math.round(e.top)}) -> (${Math.round(left)},${Math.round(top)})`);
      }
    }
    growContainerForMembers(containerIdx);
  }

  // Phase C2 — stack members that still collide inside the same container.
  for (const containerIdx of containerIndices) {
    const members = membersOfContainer(containerIdx);
    const colliding = new Set<number>();
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        if (intersectionArea(geoOf(els[members[i]]), geoOf(els[members[j]])) > 4) {
          colliding.add(members[i]);
          colliding.add(members[j]);
        }
      }
    }
    if (colliding.size === 0) continue;
    const cluster = members.filter((m) => colliding.has(m));
    const container = els[containerIdx];
    const pad = padOf(container);
    let y = Math.max(container.top + pad, Math.min(...cluster.map((m) => els[m].top)));
    for (const m of cluster) {
      const e = els[m];
      const width = Math.min(e.width, container.width - pad * 2);
      const left = Math.max(container.left + pad, Math.min(e.left, container.left + container.width - pad - width));
      // Never stack a member past the frame — an overlap inside the card
      // beats content clipped off the canvas.
      const top = Math.min(y, SLIDE_CANVAS_HEIGHT - MARGIN - (e.height ?? 0));
      if (e.top !== top || e.left !== left || e.width !== width) {
        setGeometry(m, { top, left, width });
        fixed++;
        log.info(`Stacked colliding element ${e.id} inside shape ${container.id} at y=${Math.round(top)}`);
      }
      y = top + (els[m].height ?? 0) + STACK_GAP;
    }
    growContainerForMembers(containerIdx);
  }

  // Phase D — push apart everything that still overlaps. The pair list is
  // recomputed every round, so a move that creates a new overlap is caught
  // by the next round (the historical bug: it was computed once).
  const overlapsOnce = (): Array<[number, number]> => {
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < els.length; i++) {
      if (!isContent(els[i])) continue;
      for (let j = i + 1; j < els.length; j++) {
        // A member sitting inside its own container is intentional
        // containment; two backgrounds never occlude content.
        if (!isContent(els[j]) || memberOf.get(i) === j || memberOf.get(j) === i) continue;
        if (intersectionArea(geoOf(els[i]), geoOf(els[j])) > 4) pairs.push([i, j]);
      }
    }
    return pairs;
  };

  const readKey = (i: number) => els[i].top * 10000 + els[i].left;

  for (let round = 0; round < MAX_RESOLVE_ROUNDS; round++) {
    const pairs = overlapsOnce();
    if (pairs.length === 0) break;

    // Resolve reading-order-first: the pair whose staying element comes
    // first in reading order is repaired first.
    pairs.sort((p, q) => Math.min(readKey(p[0]), readKey(p[1])) - Math.min(readKey(q[0]), readKey(q[1])));

    let moved = false;
    for (const [i, j] of pairs) {
      // Decide who stays. Backgrounds never move for content. In a
      // same-column pair of text/latex the shorter block is the heading —
      // the body moves below it. Otherwise the upper block stays.
      let stay = i;
      let go = j;
      const a = els[i];
      const b = els[j];
      const isTitleBand = (e: T) =>
        e.type === 'text' && e.width >= 780 && e.top <= 140;
      const pick = (stayIdx: number, goIdx: number) => {
        stay = stayIdx;
        go = goIdx;
      };
      if (isBackground(b) && !isBackground(a)) {
        pick(j, i);
      } else if (memberOf.has(i) !== memberOf.has(j)) {
        // Card content is anchored to its container; free content yields.
        pick(memberOf.has(i) ? i : j, memberOf.has(i) ? j : i);
      } else if (isTitleBand(a) || isTitleBand(b)) {
        // A full-width top text is the slide title: content yields to it.
        pick(isTitleBand(a) ? i : j, isTitleBand(a) ? j : i);
      } else if (
        Math.abs(a.left - b.left) <= COLUMN_TOLERANCE &&
        (a.type === 'text' || a.type === 'latex') &&
        (b.type === 'text' || b.type === 'latex')
      ) {
        // Same column. A much shorter block that starts level with a tall
        // one is its heading — the body drops below it. Otherwise the upper
        // block keeps its place.
        const ha = a.height ?? 0;
        const hb = b.height ?? 0;
        const aIsHeading = ha * 1.6 <= hb && Math.abs(a.top - b.top) <= 40;
        const bIsHeading = hb * 1.6 <= ha && Math.abs(a.top - b.top) <= 40;
        if (aIsHeading && !bIsHeading) pick(i, j);
        else if (bIsHeading && !aIsHeading) pick(j, i);
        else if (readKey(j) < readKey(i)) pick(j, i);
      } else if (readKey(j) < readKey(i)) {
        pick(j, i);
      }

      const s = els[stay];
      const g = els[go];
      const sBox = geoOf(s);

      // A member of another container has a home — put it back there instead
      // of pushing it into the wilderness.
      const homeContainer = memberOf.get(go);
      if (homeContainer !== undefined && homeContainer !== stay) {
        const container = els[homeContainer];
        const pad = padOf(container);
        const left = Math.max(container.left + pad, Math.min(g.left, container.left + container.width - pad - g.width));
        const top = Math.max(container.top + pad, Math.min(g.top, container.top + (container.height ?? 0) - pad - (g.height ?? 0)));
        if (left !== g.left || top !== g.top) {
          setGeometry(go, { left, top });
          fixed++;
          moved = true;
          log.info(`Returned element ${g.id} into its shape ${container.id}`);
        }
        continue;
      }

      const inCanvas = (geometry: ElementGeometry): boolean => {
        const clamped = clampToCanvas(geometry);
        return (
          Math.abs(clamped.left - geometry.left) <= 0.5 &&
          Math.abs(clamped.top - geometry.top) <= 0.5 &&
          Math.abs(clamped.width - geometry.width) <= 0.5 &&
          Math.abs(clamped.height - geometry.height) <= 0.5
        );
      };

      const buildCandidates = (
        stayer: T,
        mover: T,
      ): Array<{ geometry: ElementGeometry; why: string }> => {
        const candidates: Array<{ geometry: ElementGeometry; why: string }> = [];
        const geo = geoOf(mover);
        const stayerBox = geoOf(stayer);
        // Prefer downward (preserves reading order)…
        const down = stayerBox.bottom + GAP - mover.top;
        if (down > 0) candidates.push({ geometry: { ...geo, top: mover.top + down }, why: 'Pushed' });
        // …squishing a formula slightly rather than shoving it sideways (the
        // latex renderer scales content to fit its box)…
        if (down > 0 && mover.type === 'latex') {
          const top = mover.top + down;
          const height = SLIDE_CANVAS_HEIGHT - MARGIN - top;
          if (height >= (mover.height ?? 0) * 0.45) {
            candidates.push({ geometry: { ...geo, top, height }, why: 'Compressed' });
          }
        }
        const right = stayerBox.right + GAP - mover.left;
        if (right > 0) candidates.push({ geometry: { ...geo, left: mover.left + right }, why: 'Pushed' });
        const leftShift = stayerBox.left - GAP - (mover.left + mover.width);
        if (leftShift > 0) candidates.push({ geometry: { ...geo, left: mover.left + leftShift }, why: 'Pushed' });
        const up = stayerBox.top - GAP - (mover.top + (mover.height ?? 0));
        if (up > 0) candidates.push({ geometry: { ...geo, top: mover.top + up }, why: 'Pushed' });
        // Narrowing keeps a label readable when a plain push will not fit:
        // end it before the stayer starts, or slot it to the stayer's right.
        const narrowable =
          mover.type === 'text' || mover.type === 'latex' || mover.type === 'table' || mover.type === 'chart';
        const shrinkLeft = stayerBox.left - GAP - mover.left;
        if (shrinkLeft >= NARROW_MIN_WIDTH && narrowable) {
          candidates.push({ geometry: { ...geo, width: shrinkLeft }, why: 'Narrowed' });
        }
        const rightSlot = SLIDE_CANVAS_WIDTH - MARGIN - (stayerBox.right + GAP);
        if (rightSlot >= NARROW_MIN_WIDTH && narrowable && mover.left + mover.width > stayerBox.right) {
          candidates.push({
            geometry: { ...geo, left: stayerBox.right + GAP, width: rightSlot },
            why: 'Narrowed',
          });
        }
        return candidates;
      };

      // A candidate placement is only accepted when it clears the stayer AND
      // lands on nobody else — pushing a block out of one overlap straight
      // into another just moves the defect around.
      const landsCleanFor = (moverIdx: number, stayIdx: number, candidate: ElementGeometry): boolean => {
        const cBox = box(candidate);
        for (let k = 0; k < els.length; k++) {
          if (k === moverIdx || k === stayIdx) continue;
          if (!isContent(els[k])) continue;
          if (intersectionArea(cBox, geoOf(els[k])) > 4) return false;
        }
        return true;
      };

      const apply = (
        moverIdx: number,
        next: ElementGeometry,
        why: string,
        stayer: T,
      ): boolean => {
        const mover = els[moverIdx];
        if (!landsCleanFor(moverIdx, stay, next)) return false;
        setGeometry(moverIdx, clampToCanvas(next));
        fixed++;
        moved = true;
        log.info(`${why} element ${mover.id} (${mover.type}) clear of ${stayer.id}: (${Math.round(mover.left)},${Math.round(mover.top)}) -> (${Math.round(next.left)},${Math.round(next.top)})`);
        return true;
      };

      const trySeparate = (stayer: T, mover: T, moverIdx: number): boolean => {
        const stayerBox = geoOf(stayer);
        return buildCandidates(stayer, mover).some(
          (c) =>
            intersectionArea(box(c.geometry), stayerBox) <= 4 &&
            inCanvas(c.geometry) &&
            apply(moverIdx, c.geometry, c.why, stayer),
        );
      };

      // When a full-gap column does not fit, retry the cascade with tighter
      // gaps: a cramped 4px seam beats overlapping text.
      const CASCADE_GAPS = [GAP, 6, 4];
      const cascadeDown = (moverIdx: number, stayIdx: number): boolean => {
        const stayerBox = geoOf(els[stayIdx]);
        // Members belong to their containers; the cascade moves free content
        // only (a pushed member would tear it out of its card or band).
        if (memberOf.has(moverIdx)) return false;
        for (const gap of CASCADE_GAPS) {
          const verdict = cascadeAttempt(moverIdx, stayIdx, stayerBox, gap);
          if (verdict === 'ok') return true;
          if (verdict === 'hard') return false;
          // 'canvas' — the chain only fails to fit: retry with a smaller gap.
        }
        return false;
      };

      const cascadeAttempt = (
        moverIdx: number,
        stayIdx: number,
        stayerBox: ReturnType<typeof geoOf>,
        gap: number,
      ): 'ok' | 'canvas' | 'hard' => {
        const targetTop = stayerBox.bottom + gap;
        if (targetTop + (els[moverIdx].height ?? 0) > SLIDE_CANVAS_HEIGHT - MARGIN + 0.5) {
          return 'canvas';
        }
        const tops = new Map<number, number>([[moverIdx, targetTop]]);
        const growBy = new Map<number, number>(); // container idx → extra height
        const topOf = (k: number) => tops.get(k) ?? els[k].top;
        const bottomOf = (k: number) => topOf(k) + (els[k].height ?? 0);
        const containerBottomOf = (k: number): number => {
          const c = memberOf.get(k);
          if (c === undefined) return -Infinity;
          return els[c].top + (els[c].height ?? 0) + (growBy.get(c) ?? 0);
        };
        const overlapPx = (a: number, b: number): number => {
          const x = Math.max(0, Math.min(els[a].left + els[a].width, els[b].left + els[b].width) - Math.max(els[a].left, els[b].left));
          const y = Math.max(0, Math.min(bottomOf(a), bottomOf(b)) - Math.max(topOf(a), topOf(b)));
          return x * y;
        };
        // Push a card/band member down inside its container, growing the
        // container downward when the member would otherwise exit it. The
        // growth is staged and only applied on success.
        const seatMember = (lower: number, newTop: number): 'ok' | 'canvas' | 'hard' => {
          const newBottom = newTop + (els[lower].height ?? 0);
          if (newBottom <= containerBottomOf(lower) - SMALL_PAD) return 'ok';
          const c = memberOf.get(lower)!;
          const needed = newBottom + SMALL_PAD - (els[c].top + (els[c].height ?? 0));
          if (els[c].top + (els[c].height ?? 0) + needed > SLIDE_CANVAS_HEIGHT - MARGIN + 0.5) {
            return 'canvas';
          }
          growBy.set(c, Math.max(growBy.get(c) ?? 0, needed));
          return 'ok';
        };
        let settled = false;
        while (!settled) {
          settled = true;
          // Keep scanning while nothing has changed; a push resets `settled`,
          // aborts this pass, and the while-loop starts a fresh full rescan.
          for (let a = 0; a < els.length && settled; a++) {
            if (!isContent(els[a])) continue;
            for (let b = a + 1; b < els.length; b++) {
              if (!isContent(els[b])) continue;
              // Only pairs a moved element takes part in; unrelated overlaps
              // elsewhere on the slide are not this cascade's business.
              if (!tops.has(a) && !tops.has(b)) continue;
              if (overlapPx(a, b) <= 4) continue;
              const [lower] = topOf(a) <= topOf(b) ? [b] : [a];
              if (lower === stayIdx) return 'hard'; // would move the stayer
              const newTop = bottomOf(lower === b ? a : b) + gap;
              if (newTop + (els[lower].height ?? 0) > SLIDE_CANVAS_HEIGHT - MARGIN + 0.5) {
                return 'canvas';
              }
              if (memberOf.has(lower)) {
                const seated = seatMember(lower, newTop);
                if (seated !== 'ok') return seated;
              }
              if (topOf(lower) < newTop) {
                tops.set(lower, newTop);
                settled = false;
                break;
              }
              return 'hard'; // overlap that cannot be pushed further
            }
          }
        }
        // A moved element must land on nobody — including card members the
        // settling loop above never scans.
        for (const [k, top] of tops) {
          for (let j = 0; j < els.length; j++) {
            if (j === k || !isContent(els[j])) continue;
            const x = Math.max(0, Math.min(els[k].left + els[k].width, els[j].left + els[j].width) - Math.max(els[k].left, els[j].left));
            const y = Math.max(0, Math.min(top + (els[k].height ?? 0), topOf(j) + (els[j].height ?? 0)) - Math.max(top, topOf(j)));
            if (x * y > 4) return 'hard';
          }
        }
        tops.forEach((top, k) => {
          setGeometry(k, clampToCanvas({ ...geoOf(els[k]), top }));
        });
        growBy.forEach((extra, c) => {
          setGeometry(c, { ...geoOf(els[c]), height: (els[c].height ?? 0) + extra });
        });
        fixed++;
        moved = true;
        log.info(
          `Cascaded ${tops.size} element(s) down to seat ${els[moverIdx].id} below ${els[stayIdx].id}` +
            (gap < GAP ? ` (squeezed to ${gap}px gaps)` : ''),
        );
        return 'ok';
      };

      if (!trySeparate(s, g, go)) {
        // The chosen mover has nowhere to go — try shifting the column
        // below it, then let the other element try, before giving up.
        if (!cascadeDown(go, stay) && !trySeparate(g, s, stay)) {
          log.warn(`Could not separate elements ${s.id} and ${g.id} within the canvas; leaving the overlap`);
        }
      }
    }

    if (!moved) break;
  }

  // Phase E — report what is left.
  const remaining = overlapsOnce();

  return { elements: els, fixed, remainingOverlaps: remaining.length };
}

/** Render order: shapes (bottom) → images → lines → charts/tables/… → latex → text (top). */
const TYPE_LAYER_PRIORITY: Record<string, number> = {
  shape: 10,
  image: 20,
  line: 30,
  chart: 40,
  table: 40,
  video: 40,
  code: 40,
  latex: 50,
  text: 60,
};

/**
 * Stable layer sort: even if the model emits text before shapes, shapes end
 * up underneath. Preserves relative order within a layer.
 */
export function applySlideLayerOrder<T extends SlideLayoutElement>(elements: T[]): T[] {
  const order = new Map(elements.map((e, i) => [e, i]));
  return elements.slice().sort((a, b) => {
    const pa = TYPE_LAYER_PRIORITY[a.type] ?? 50;
    const pb = TYPE_LAYER_PRIORITY[b.type] ?? 50;
    if (pa !== pb) return pa - pb;
    return (order.get(a) ?? 0) - (order.get(b) ?? 0);
  });
}
