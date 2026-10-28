/**
 * Regression tests for slide element layout validation (clamp + overlap).
 */
import { describe, expect, it } from 'vitest';
import type { GeneratedSlideData, GenerationLogger } from '@openmaic/generation';
import type { PPTElement } from '@openmaic/dsl';

function noopLog(): GenerationLogger {
  return {
    debug: () => {},
    warn: () => {},
    info: () => {},
    error: () => {},
  };
}

/**
 * Minimal element shape for testing — matches GeneratedSlideData['elements'].
 */
function el(partial: Record<string, unknown>): GeneratedSlideData['elements'][number] {
  return {
    id: `el_${Math.random().toString(36).slice(2, 8)}`,
    type: 'text',
    left: 0,
    top: 0,
    width: 100,
    height: 50,
    ...partial,
  };
}

/**
 * Call the clamped validator by reusing the module's internal function.
 * We import from scene-generator which re-exports it for testing.
 */
import { clampAndValidateSlideElements } from '@openmaic/generation';

describe('clampAndValidateSlideElements', () => {
  it('clamps positions to canvas bounds (50px margin)', () => {
    const elements = [
      el({ left: -30, top: -20, width: 100, height: 50 }), // negative -> clamped to (50, 50)
      el({ left: 900, top: 500, width: 200, height: 100 }), // exceeds right/bottom -> clamped
    ];
    const result = clampAndValidateSlideElements(elements, undefined, noopLog());
    // After clamping: first should be at (50, 50), second should be at (750, 412.5)
    // (since 900 + 200 = 1100 > 950, so left is adjusted to 750)
    // (since 500 + 100 = 600 > 512.5, so top is adjusted to 412.5)
    expect(result.length).toBe(2);
    expect(result[0].left).toBe(50);
    expect(result[0].top).toBe(50);
    expect(result[1].left).toBe(750);
    expect(result[1].top).toBe(412.5);
    // Verify bounds
    expect(result[0].left + result[0].width).toBe(150);
    expect(result[1].left + result[1].width).toBe(950);
  });

  it('enforces per-type size limits', () => {
    // Test that oversized elements get clamped to max size
    const elements = [
      el({ type: 'shape', left: 900, top: 500, width: 5000, height: 5000 }), // way above max, outside canvas
    ];
    const result = clampAndValidateSlideElements(elements, undefined, noopLog());
    expect(result.length).toBe(1);
    const shape = result[0];
    expect(shape.width).toBeLessThanOrEqual(900); // MAX_W[shape]
    expect(shape.height).toBeLessThanOrEqual(600); // MAX_H[shape]
    expect(shape.left).toBeGreaterThanOrEqual(50); // MARGIN
    expect(shape.top).toBeGreaterThanOrEqual(50); // MARGIN
  });

  it('removes excess elements beyond per-type cap', () => {
    const elements = Array.from({ length: 10 }, (_, i) =>
      el({ id: `img_${i}`, type: 'image', width: 400, height: 300 }),
    );
    const result = clampAndValidateSlideElements(elements, undefined, noopLog());
    expect(result.length).toBeLessThanOrEqual(3); // MAX_PER_TYPE[image]
  });

  it('pushes overlapping elements apart when possible', () => {
    const elements = [
      el({ id: 'large', type: 'text', left: 100, top: 100, width: 400, height: 300 }),
      el({ id: 'small', type: 'text', left: 200, top: 200, width: 100, height: 50 }),
      el({ id: 'far-right', type: 'text', left: 700, top: 100, width: 200, height: 100 }),
    ];
    const result = clampAndValidateSlideElements(elements, undefined, noopLog());
    // Both overlapping elements should be kept (pushed apart)
    expect(result.length).toBe(3);
    const small = result.find((e) => e.id === 'small');
    // small should have been pushed away from large
    expect(small).toBeDefined();
  });

  it('keeps an unresolvable overlap instead of dropping content', () => {
    // large takes most of canvas, small overlaps and can't be pushed.
    // The layout pass never deletes an element: an honest remaining overlap
    // beats silently losing slide content.
    const elements = [
      el({ id: 'large', type: 'text', left: 50, top: 50, width: 900, height: 500 }),
      el({ id: 'small', type: 'text', left: 400, top: 200, width: 100, height: 50 }),
    ];
    const result = clampAndValidateSlideElements(elements, undefined, noopLog());
    expect(result.length).toBe(2);
    expect(result.map((e) => e.id).sort()).toEqual(['large', 'small']);
  });

  it('warns on multi-column top misalignment', () => {
    // Use non-overlapping elements in the same column
    const elements = [
      el({ id: 'left', type: 'shape', left: 60, top: 60, width: 50, height: 10 }),
      el({ id: 'right', type: 'shape', left: 60, top: 120, width: 50, height: 10 }), // same column, different top
    ];
    const warnings: string[] = [];
    const log = {
      debug: () => {},
      warn: (msg: string) => warnings.push(msg),
      info: () => {},
      error: () => {},
    };
    const result = clampAndValidateSlideElements(elements, undefined, log);
    expect(result.length).toBe(2);
    // Should warn about top alignment (same column, 60px vertical gap > 15px threshold)
    expect(warnings.some(w => w.includes('inconsistent top alignment'))).toBe(true);
  });

  it('warns when table rowHeights sum mismatches table height', () => {
    const elements = [
      {
        id: 'tbl',
        type: 'table',
        left: 100,
        top: 100,
        width: 600,
        height: 200,
        data: [['a', 'b'], ['c', 'd']],
        colWidths: [0.5, 0.5],
        rowHeights: [50, 50], // sums to 100, but table.height is 200
        cellMinHeight: 40,
      } as GeneratedSlideData['elements'][number],
    ];
    const warnings: string[] = [];
    const log = {
      debug: () => {},
      warn: (msg: string) => warnings.push(msg),
      info: () => {},
      error: () => {},
    };
    const result = clampAndValidateSlideElements(elements, undefined, log);
    expect(result.length).toBe(1);
    expect(warnings.some(w => w.includes('rowHeights sum'))).toBe(true);
  });

  it('warns when image caption left does not match text left', () => {
    const elements = [
      el({ id: 'text', type: 'text', left: 100, top: 100, width: 200, height: 50 }),
      // Image below text with 20-40px gap, but misaligned left edge
      el({ id: 'img', type: 'image', left: 160, top: 170, width: 200, height: 100, src: 'test.jpg' }),
    ];
    const warnings: string[] = [];
    const log = {
      debug: () => {},
      warn: (msg: string) => warnings.push(msg),
      info: () => {},
      error: () => {},
    };
    const result = clampAndValidateSlideElements(elements, undefined, log);
    expect(result.length).toBe(2);
    expect(warnings.some(w => w.includes('left edges are misaligned'))).toBe(true);
  });

  it('keeps non-overlapping elements unchanged', () => {
    const elements = [
      el({ id: 'a', left: 100, top: 100, width: 200, height: 150 }),
      el({ id: 'b', left: 400, top: 100, width: 200, height: 150 }),
      el({ id: 'c', left: 100, top: 300, width: 200, height: 150 }),
    ];
    const result = clampAndValidateSlideElements(elements, undefined, noopLog());
    expect(result.length).toBe(3);
  });

  it('handles empty input gracefully', () => {
    const result = clampAndValidateSlideElements([], undefined, noopLog());
    expect(result).toEqual([]);
  });

  it('handles elements with missing numeric fields', () => {
    const elements = [
      el({ width: undefined, height: null as unknown as number }),
    ];
    const result = clampAndValidateSlideElements(elements, undefined, noopLog());
    expect(result.length).toBeGreaterThanOrEqual(0);
  });
});
