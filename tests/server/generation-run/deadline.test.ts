/** A step's budget: a timeout is a retryable failure; the run's own abort is an abort. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAbortError } from '@openmaic/generation';

import {
  materialAnalysisDeadlineMs,
  StepTimeoutError,
  withDeadline,
} from '@/lib/server/generation/run/deadline';
import { withRouteRetry } from '@/lib/server/generation/run/retry';

describe('step deadlines', () => {
  it('fails a call that outlives its budget, even one that ignores its signal', async () => {
    const run = new AbortController();
    let seen: AbortSignal | undefined;
    const pending = withDeadline('scene:0:actions', 20, run.signal, (signal) => {
      seen = signal;
      return new Promise<never>(() => undefined);
    });
    await expect(pending).rejects.toBeInstanceOf(StepTimeoutError);
    expect(seen?.aborted).toBe(true);
  });

  it("rejects as an abort when the run's own signal aborts", async () => {
    const run = new AbortController();
    const pending = withDeadline(
      'scene:0:content',
      60_000,
      run.signal,
      (signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('cancelled'))),
        ),
    );
    run.abort();
    const error = await pending.catch((reason: unknown) => reason);
    expect(isAbortError(error)).toBe(true);
  });

  it('is retried, and the retry reports what failed', async () => {
    const causes: string[] = [];
    let attempts = 0;
    const result = await withRouteRetry(
      () =>
        withDeadline('step', 10, new AbortController().signal, async () => {
          attempts += 1;
          if (attempts === 1) return new Promise<string>(() => undefined);
          return 'ok';
        }),
      {
        label: 'step',
        maxRetries: 2,
        refusalStatus: 500,
        sleep: async () => undefined,
        onRetry: (event) => {
          causes.push(event.cause);
        },
      },
    );
    expect(result).toBe('ok');
    expect(causes).toEqual(['StepTimeoutError: step did not finish within 0.01 s']);
  });
});

describe('materialAnalysisDeadlineMs', () => {
  // The default test asserts the unset state; a shell exporting the override
  // (the knob this diff ships for slow-OCR deployments) must not leak in.
  beforeEach(() => {
    delete process.env.MATERIAL_ANALYSIS_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to the step deadline when the variable is unset', () => {
    expect(materialAnalysisDeadlineMs()).toBe(300_000);
  });

  it('reads MATERIAL_ANALYSIS_TIMEOUT_MS for slow OCR deployments', () => {
    vi.stubEnv('MATERIAL_ANALYSIS_TIMEOUT_MS', '7200000');
    expect(materialAnalysisDeadlineMs()).toBe(7_200_000);
  });

  it('ignores non-numeric, zero and negative values', () => {
    for (const value of ['soon', '0', '-5', '  ']) {
      vi.stubEnv('MATERIAL_ANALYSIS_TIMEOUT_MS', value);
      expect(materialAnalysisDeadlineMs()).toBe(300_000);
    }
  });

  it('clamps an above-setTimeout-limit override instead of letting Node turn it into 1 ms', () => {
    vi.stubEnv('MATERIAL_ANALYSIS_TIMEOUT_MS', '5000000000');
    expect(materialAnalysisDeadlineMs()).toBe(2_147_483_647);
  });
});
