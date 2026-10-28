import { describe, expect, it } from 'vitest';

import {
  applySlideLayerOrder,
  normalizeSlideLayout,
} from '../src/slide-layout.js';

/** Every element these fixtures use carries a height (the line variant does not). */
type Fixture = ReturnType<typeof text> | ReturnType<typeof shape> | ReturnType<typeof latex> | ReturnType<typeof image>;

const text = (id: string, left: number, top: number, width: number, height: number) => ({
  id,
  type: 'text',
  left,
  top,
  width,
  height,
  rotate: 0,
  content: `<p>${id}</p>`,
  defaultFontName: 'Microsoft YaHei',
  defaultColor: '#333333',
});

const shape = (id: string, left: number, top: number, width: number, height: number) => ({
  id,
  type: 'shape',
  left,
  top,
  width,
  height,
  rotate: 0,
  viewBox: [1, 1],
  path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z',
  fixedRatio: false,
  fill: '#ffffff',
});

const latex = (id: string, left: number, top: number, width: number, height: number) => ({
  id,
  type: 'latex',
  left,
  top,
  width,
  height,
  rotate: 0,
  latex: id,
});

const image = (id: string, left: number, top: number, width: number, height: number) => ({
  id,
  type: 'image',
  left,
  top,
  width,
  height,
  rotate: 0,
  fixedRatio: true,
  src: 'ast_test',
});

const intersects = (a: Fixture, b: Fixture): boolean => {
  const x = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  return x * y > 4;
};

const byId = (els: Fixture[], id: string): Fixture => {
  const found = els.find((e) => e.id === id);
  if (!found) throw new Error(`element ${id} not found`);
  return found;
};

const contentPairs = (els: Fixture[]): number => {
  let count = 0;
  for (let i = 0; i < els.length; i++) {
    if (els[i].type === 'shape' || els[i].type === 'line') continue;
    for (let j = i + 1; j < els.length; j++) {
      if (els[j].type === 'shape' || els[j].type === 'line') continue;
      if (intersects(els[i], els[j])) count++;
    }
  }
  return count;
};

/**
 * Real stored geometry of stage-FLn6Wrumm9d5 scene 1: the right column's
 * header and body start four pixels apart (header T199 over body T195), and
 * a full-width label crosses the right column.
 */
const scene1Fixture = (): Fixture[] => [
  shape('divider', 500, 50, 20, 462.5),
  text('title', 60, 50, 880, 76),
  text('label1', 60, 140, 880, 49),
  text('leftBody1', 60, 195, 420, 103),
  text('fullLabel', 50, 315, 880, 49),
  text('leftBody2', 60, 370, 420, 130),
  text('header', 520, 199, 420, 49),
  text('body', 520, 195, 420, 202),
];

/** Real stored geometry of stage-FLn6Wrumm9d5 scene 5: two stacked formulas overlap. */
const scene5Fixture = (): Fixture[] => [
  latex('f1', 130, 380, 300, 80),
  latex('f2', 160, 432.5, 300, 80),
  latex('f3', 580, 432.5, 300, 80),
  text('title', 60, 50, 880, 76),
  text('row1', 60, 200, 880, 52),
  text('row2', 60, 260, 880, 52),
  text('row3', 60, 320, 880, 52),
];

describe('normalizeSlideLayout', () => {
  it('separates a same-column header from the body beneath it without losing either', () => {
    const result = normalizeSlideLayout(scene1Fixture());
    expect(result.remainingOverlaps).toBe(0);
    const header = byId(result.elements, 'header');
    const body = byId(result.elements, 'body');
    expect(intersects(header, body)).toBe(false);
    // The body moved below the header, not the other way around.
    expect(body.top).toBeGreaterThanOrEqual(header.top + header.height);
    // The title and the already-clean left column are untouched.
    expect(byId(result.elements, 'title')).toEqual(scene1Fixture()[1]);
    expect(byId(result.elements, 'leftBody1')).toEqual(scene1Fixture()[3]);
  });

  it('narrows a full-width label that crosses into another column', () => {
    const result = normalizeSlideLayout(scene1Fixture());
    const fullLabel = byId(result.elements, 'fullLabel');
    expect(fullLabel.left + fullLabel.width).toBeLessThan(520);
    expect(fullLabel.width).toBeGreaterThanOrEqual(180);
    expect(fullLabel.top).toBe(315);
  });

  it('separates two stacked formulas and never pushes one over a third', () => {
    const result = normalizeSlideLayout(scene5Fixture());
    expect(result.remainingOverlaps).toBe(0);
    const f1 = byId(result.elements, 'f1');
    const f2 = byId(result.elements, 'f2');
    const f3 = byId(result.elements, 'f3');
    expect(intersects(f1, f2)).toBe(false);
    expect(intersects(f2, f3)).toBe(false);
    expect(intersects(f1, f3)).toBe(false);
    for (const f of [f1, f2, f3]) {
      expect(f.top + f.height).toBeLessThanOrEqual(562.5 - 50 + 0.5);
      expect(f.left + f.width).toBeLessThanOrEqual(1000 - 50 + 0.5);
    }
    expect(byId(result.elements, 'row2').top).toBe(260);
  });

  it('snaps a text that hangs outside its card back inside', () => {
    // Real stored geometry of the old whole-book course scene 1: the text
    // starts 60px left of its card.
    const result = normalizeSlideLayout([
      shape('card', 520, 137.5, 420, 375),
      text('stray', 460, 295, 370, 49),
      text('title', 60, 55, 880, 70),
    ]);
    expect(result.remainingOverlaps).toBe(0);
    const stray = byId(result.elements, 'stray');
    const card = byId(result.elements, 'card');
    expect(stray.left).toBeGreaterThanOrEqual(card.left + 14);
    expect(stray.left + stray.width).toBeLessThanOrEqual(card.left + card.width - 14);
    expect(stray.top).toBeGreaterThanOrEqual(card.top);
  });

  it('keeps a heading on its header band instead of pushing it below', () => {
    // Real stored geometry of the old course scene 5: the right column's
    // heading sits on a 72px band (too short to be a card).
    const result = normalizeSlideLayout([
      shape('band', 520, 118, 420, 72),
      text('heading', 540, 118, 380, 48),
      text('title', 60, 50, 880, 58),
    ]);
    expect(result.remainingOverlaps).toBe(0);
    const heading = byId(result.elements, 'heading');
    const band = byId(result.elements, 'band');
    expect(heading.top).toBeLessThan(band.top + band.height);
  });

  it('stacks two members that collide inside one card and grows the card', () => {
    const result = normalizeSlideLayout([
      text('title', 60, 50, 880, 60),
      shape('card', 60, 140, 420, 200),
      text('m1', 80, 160, 380, 80),
      text('m2', 80, 170, 380, 80),
    ]);
    expect(result.remainingOverlaps).toBe(0);
    const card = byId(result.elements, 'card');
    const m1 = byId(result.elements, 'm1');
    const m2 = byId(result.elements, 'm2');
    expect(intersects(m1, m2)).toBe(false);
    expect(m2.top).toBeGreaterThanOrEqual(m1.top + m1.height + 10 - 0.5);
    // The card grew around its stacked members.
    expect(card.height).toBeGreaterThanOrEqual(m2.top + m2.height + 14 - card.top - 0.5);
  });

  it('cascades a column down when the slot below the stayer is occupied', () => {
    // Real stored geometry of stage-FLn6Wrumm9d5 scene 4: the right column
    // stacks header/body/body with the header overlapping the first body, and
    // the plain down-push is blocked by the body below it.
    const result = normalizeSlideLayout([
      text('title', 60, 50, 880, 58),
      shape('divider', 500, 50, 20, 462.5),
      text('X-xza', 520, 220, 420, 49),
      text('Ng9u4', 520, 228, 420, 58),
      text('FloqajR', 520, 285, 420, 58),
    ]);
    expect(result.remainingOverlaps).toBe(0);
    for (const id of ['X-xza', 'Ng9u4', 'FloqajR']) {
      expect(byId(result.elements, id).left).toBe(520);
    }
    // Reading order preserved: body, header, body, each clear of the next.
    const first = byId(result.elements, 'X-xza');
    const header = byId(result.elements, 'Ng9u4');
    const last = byId(result.elements, 'FloqajR');
    expect(intersects(first, header)).toBe(false);
    expect(intersects(header, last)).toBe(false);
    expect(last.top + last.height).toBeLessThanOrEqual(562.5 - 50 + 0.5);
  });

  it('cascades past a band member by growing its band (scene 14 shape)', () => {
    // Title/subtitle overlap; below them a labeled band (shape + member
    // text) and a left-column body. The cascade must seat the subtitle,
    // push the band member down inside a grown band, and drop the body.
    const result = normalizeSlideLayout([
      text('title', 50, 120, 900, 50),
      text('subtitle', 70, 155, 880, 35),
      shape('band', 530, 195, 420, 55),
      text('bandLabel', 530, 200, 420, 35),
      text('leftBody', 70, 195, 400, 130),
    ]);
    expect(result.remainingOverlaps).toBe(0);
    const subtitle = byId(result.elements, 'subtitle');
    const title = byId(result.elements, 'title');
    expect(subtitle.top).toBeGreaterThanOrEqual(title.top + title.height);
    const band = byId(result.elements, 'band');
    const bandLabel = byId(result.elements, 'bandLabel');
    // The label still sits inside its (grown) band.
    expect(bandLabel.top).toBeGreaterThanOrEqual(band.top);
    expect(bandLabel.top + bandLabel.height).toBeLessThanOrEqual(band.top + band.height + 0.5);
    expect(byId(result.elements, 'leftBody').top).toBeGreaterThanOrEqual(subtitle.top + subtitle.height);
  });

  it('squeezes gaps when the column only fits with tighter spacing (scene 15 shape)', () => {
    const result = normalizeSlideLayout([
      text('line1', 60, 367, 880, 49),
      text('line2', 80, 378, 840, 35),
      text('line3', 270, 415, 460, 40),
    ]);
    expect(result.remainingOverlaps).toBe(0);
    for (const id of ['line1', 'line2', 'line3']) {
      const e = byId(result.elements, id);
      expect(e.top + e.height).toBeLessThanOrEqual(562.5 - 50 + 0.5);
    }
  });

  it('never snaps a tall member of a low card off the canvas', () => {
    // The member is fully on-canvas but its card's inner top sits below the
    // space its height needs: the snap must yield, not shove it off-slide —
    // and the card must not grow past the frame either.
    const result = normalizeSlideLayout([
      text('title', 60, 50, 880, 60),
      shape('card', 520, 400, 420, 100),
      text('tall', 540, 212.5, 380, 300),
    ]);
    const tall = byId(result.elements, 'tall');
    expect(tall.top + tall.height).toBeLessThanOrEqual(562.5 - 50 + 0.5);
    const card = byId(result.elements, 'card');
    expect(card.top + card.height).toBeLessThanOrEqual(562.5 - 50 + 0.5);
    // And the pass converges instead of drifting on re-runs.
    const twice = normalizeSlideLayout(result.elements);
    expect(twice.fixed).toBe(0);
    expect(twice.elements).toEqual(result.elements);
  });

  it('never widens a member to fit a narrow container near the canvas edge', () => {
    const result = normalizeSlideLayout([
      shape('chip', 824, 200, 126, 60),
      text('lbl', 826, 210, 120, 30),
    ]);
    const lbl = byId(result.elements, 'lbl');
    expect(lbl.width).toBeLessThanOrEqual(120);
    expect(lbl.left + lbl.width).toBeLessThanOrEqual(1000 - 50 + 0.5);
    const twice = normalizeSlideLayout(result.elements);
    expect(twice.fixed).toBe(0);
    expect(twice.elements).toEqual(result.elements);
  });

  it('is a strict no-op for an already-clean slide', () => {
    const clean = [
      text('title', 60, 50, 880, 76),
      shape('cardA', 60, 150, 420, 300),
      text('a1', 80, 170, 380, 100),
      text('a2', 80, 290, 380, 100),
      shape('cardB', 520, 150, 420, 300),
      text('b1', 540, 170, 380, 100),
      text('b2', 540, 290, 380, 100),
      shape('divider', 500, 50, 20, 462.5),
    ];
    const result = normalizeSlideLayout(clean);
    expect(result.fixed).toBe(0);
    expect(result.remainingOverlaps).toBe(0);
    // Same element objects back — nothing was rebuilt.
    expect(result.elements.every((e, i) => e === clean[i])).toBe(true);
  });

  it('is idempotent on the defective fixtures', () => {
    for (const fixture of [scene1Fixture(), scene5Fixture()]) {
      const once = normalizeSlideLayout(fixture);
      const twice = normalizeSlideLayout(once.elements);
      expect(twice.fixed).toBe(0);
      expect(twice.elements).toEqual(once.elements);
    }
  });

  it('clamps out-of-canvas elements back into the frame', () => {
    const result = normalizeSlideLayout([
      text('runaway', 980, 600, 400, 100),
      text('title', 60, 50, 880, 60),
    ]);
    const runaway = byId(result.elements, 'runaway');
    expect(runaway.left).toBeGreaterThanOrEqual(50);
    expect(runaway.top).toBeGreaterThanOrEqual(50);
    expect(runaway.left + runaway.width).toBeLessThanOrEqual(1000 - 50 + 0.5);
    expect(runaway.top + runaway.height).toBeLessThanOrEqual(562.5 - 50 + 0.5);
  });

  it('resets non-finite geometry instead of producing NaN boxes', () => {
    const garbage = { ...text('bad', Number.NaN, Number.NaN, 300, 100) };
    const result = normalizeSlideLayout([garbage, text('title', 60, 50, 880, 60)]);
    const bad = byId(result.elements, 'bad');
    expect(Number.isFinite(bad.left)).toBe(true);
    expect(Number.isFinite(bad.top)).toBe(true);
  });

  it('never reports more content overlaps than the input had', () => {
    // The historical pass DELETED elements it could not separate; this one
    // may leave an overlap but never removes content.
    const fixtures = [scene1Fixture(), scene5Fixture()];
    for (const fixture of fixtures) {
      const result = normalizeSlideLayout(fixture);
      expect(result.elements.length).toBe(fixture.length);
      expect(result.elements.map((e) => e.id).sort()).toEqual(fixture.map((e) => e.id).sort());
      expect(contentPairs(result.elements)).toBeLessThanOrEqual(contentPairs(fixture));
    }
  });
});

describe('applySlideLayerOrder', () => {
  it('renders shapes beneath text regardless of the model\'s emission order', () => {
    const ordered = applySlideLayerOrder([
      text('t1', 60, 50, 880, 60),
      shape('s1', 60, 150, 420, 300),
      latex('f1', 60, 470, 300, 40),
      shape('s2', 520, 150, 420, 300),
      text('t2', 540, 170, 380, 100),
    ]);
    expect(ordered.map((e) => e.id)).toEqual(['s1', 's2', 'f1', 't1', 't2']);
  });
});
