/**
 * Generation input budgets, overridable via environment for long-context
 * deployments.
 *
 * The defaults (a 50 000-character material text budget and 20 vision images
 * per step) keep every generation prompt inside a mid-size context window.
 * A long-context model on a self-hosted deployment can legitimately carry far
 * more — e.g. a whole textbook chapter — so both budgets read
 * `GENERATION_MATERIAL_MAX_CHARS` / `GENERATION_MAX_VISION_IMAGES` at call
 * time. The effective values are also served to the client through the
 * capabilities route so its truncation previews never disagree with what the
 * run actually sends.
 *
 * The override shapes the INPUT only: it is the operator's job to pick a
 * value their model's context window (plus the step's output) can hold. An
 * oversized budget surfaces as a provider context-length error, not silent
 * truncation.
 */
import { createLogger } from '@/lib/logger';
import { MAX_PDF_CONTENT_CHARS, MAX_VISION_IMAGES } from '@/lib/constants/generation';

const log = createLogger('GenerationCaps');

export interface GenerationCaps {
  /** Characters of document text one generation's prompts may carry. */
  maxTextChars: number;
  /** Images sent to the vision model per generation step. */
  maxVisionImages: number;
}

/** A positive integer from the environment, or undefined (unset or invalid). */
function positiveIntFromEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    // A typo'd override must not silently pretend it applied: say so and keep
    // the default, so the truncation notice stays truthful.
    log.warn(`${name}=${JSON.stringify(raw)} is not a positive integer; keeping the default`);
    return undefined;
  }
  return parsed;
}

export function effectiveGenerationCaps(): GenerationCaps {
  return {
    maxTextChars: positiveIntFromEnv('GENERATION_MATERIAL_MAX_CHARS') ?? MAX_PDF_CONTENT_CHARS,
    maxVisionImages: positiveIntFromEnv('GENERATION_MAX_VISION_IMAGES') ?? MAX_VISION_IMAGES,
  };
}
