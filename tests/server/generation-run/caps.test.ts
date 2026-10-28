/** The deployment-overridable generation input budgets (env, with sane defaults). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_PDF_CONTENT_CHARS, MAX_VISION_IMAGES } from '@/lib/constants/generation';
import { effectiveGenerationCaps } from '@/lib/server/generation/caps';

describe('effectiveGenerationCaps', () => {
  // The defaults tests assert the unset state; a shell that exports the
  // overrides (developers tuning them locally) must not leak in.
  beforeEach(() => {
    delete process.env.GENERATION_MATERIAL_MAX_CHARS;
    delete process.env.GENERATION_MAX_VISION_IMAGES;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to the built-in budgets when the variables are unset', () => {
    expect(effectiveGenerationCaps()).toEqual({
      maxTextChars: MAX_PDF_CONTENT_CHARS,
      maxVisionImages: MAX_VISION_IMAGES,
    });
  });

  it('reads both overrides for a long-context deployment', () => {
    vi.stubEnv('GENERATION_MATERIAL_MAX_CHARS', '200000');
    vi.stubEnv('GENERATION_MAX_VISION_IMAGES', '30');
    expect(effectiveGenerationCaps()).toEqual({ maxTextChars: 200_000, maxVisionImages: 30 });
  });

  it('keeps each default when only the other variable is set', () => {
    vi.stubEnv('GENERATION_MAX_VISION_IMAGES', '40');
    expect(effectiveGenerationCaps()).toEqual({
      maxTextChars: MAX_PDF_CONTENT_CHARS,
      maxVisionImages: 40,
    });
  });

  it('ignores non-numeric, fractional, zero and negative values', () => {
    for (const value of ['many', '0', '-5', '1.5', '  ']) {
      vi.stubEnv('GENERATION_MATERIAL_MAX_CHARS', value);
      vi.stubEnv('GENERATION_MAX_VISION_IMAGES', value);
      expect(effectiveGenerationCaps()).toEqual({
        maxTextChars: MAX_PDF_CONTENT_CHARS,
        maxVisionImages: MAX_VISION_IMAGES,
      });
    }
  });
});
