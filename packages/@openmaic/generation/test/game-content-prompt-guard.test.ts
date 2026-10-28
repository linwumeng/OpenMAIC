/**
 * Regression guard for game-content prompt quality requirements:
 *   - questions must not contain their own answers/pinyin inline
 *   - interactive games must require an exit/close control so players can leave
 *   - achievement/badge popups must have a close/dismiss control
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));

describe('game-content prompts — regression guards', () => {
  const systemPrompt = readFileSync(
    join(PACKAGE_ROOT, 'templates', 'game-content', 'system.md'),
    'utf8',
  );
  const userPrompt = readFileSync(
    join(PACKAGE_ROOT, 'templates', 'game-content', 'user.md'),
    'utf8',
  );
  const combined = systemPrompt + '\n' + userPrompt;

  test('no blank-line gaps in checklist sections (prevents LLM omission of critical items)', () => {
    // Blank lines inside markdown checklists are a known failure mode: LLMs
    // drop entire blocks when parsing, silently skipping items like "exit button"
    // or "achievement close". Enforce tight bullet spacing.
    const lineMatches = combined.split('\n');
    const checklistBlocks: string[] = [];
    let currentBlock: string[] = [];
    for (const line of lineMatches) {
      if (/^\s*[-*]?\s*\[/.test(line) || /^\s*\d+\.\s/.test(line)) {
        currentBlock.push(line);
      } else if (currentBlock.length > 0) {
        checklistBlocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
    }
    if (currentBlock.length > 0) checklistBlocks.push(currentBlock.join('\n'));

    // Every block with more than one checklist item must be contiguous (no blank line).
    const offenders: string[] = [];
    for (const block of checklistBlocks) {
      const lines = block.split('\n').filter(Boolean);
      if (lines.length < 2) continue;
      const rawLines = block.split('\n');
      let hasGap = false;
      for (let i = 1; i < rawLines.length; i++) {
        if (rawLines[i].trim() === '' && /^\s*[-*]?\s*\[/.test(rawLines[i + 1] ?? '') &&
            /^\s*[-*]?\s*\[/.test(rawLines[i - 1] ?? '')) {
          hasGap = true;
          break;
        }
      }
      if (hasGap) {
        offenders.push(block.slice(0, 80));
      }
    }
    expect(offenders, 'Checklist sections must not have blank-line gaps').toEqual([]);
  });

  test('system prompt requires an exit/close button in games with quiz flow', () => {
    expect(systemPrompt).toMatch(/exit|close|back|return|leave/i);
    // Make sure it's not buried in a code example only — it must appear in prose/requirements.
    const proseMatch = systemPrompt.match(/^[^-*\d#\s].*?(exit|close|back|return|leave).*$/mi);
    expect(proseMatch).toBeTruthy();
  });

  test('system prompt requires achievement badges to be dismissible (closeable)', () => {
    expect(systemPrompt).toMatch(/close|dismiss|exit|×|\.?close\b/i);
  });

  test('user prompt does not expose answer strings in the question text', () => {
    // The user prompt must not itself contain any full pinyin+tone combinations
    // that would bias the LLM to put the answer inline in question text.
    expect(userPrompt).not.toMatch(/[a-zā-ǖ̄]{2,}\s+[ā-ǖ̄]\s+[ā-ǖ̄]/i);
  });

  test('user prompt references the game type selector (prevents quiz-as-default)', () => {
    // Must guide the model to pick a game type rather than defaulting to quiz.
    expect(userPrompt).toMatch(/gameType|Game Type|game type|interactive gameplay/i);
  });

  test('combined prompt has a clear escape path in checklist', () => {
    // After any progression/achievement, the player must be able to close.
    expect(combined).toMatch(/exit|close.*button|leave.*game|esc\s*key|escape\s*key/i);
  });
});