import { describe, expect, it } from 'vitest';
import { postProcessInteractiveHtml } from '@openmaic/generation';

describe('postProcessInteractiveHtml edge cases', () => {
  it('handles button onclick="handleMainButton" with handleMainButton() function defined', () => {
    const html = `<html><head></head><body>
<button id="mainBtn" onclick="handleMainButton">启动</button>
<script>
function handleMainButton() {
  console.log('clicked');
}
</script>
</body></html>`;
    const result = postProcessInteractiveHtml(html);
    // The onclick and function names must remain as-is - post-processor should not change them
    expect(result).toContain('onclick="handleMainButton"');
    expect(result).toContain('function handleMainButton()');
  });

  it('does not convert $ signs inside script tags to LaTeX delimiters', () => {
    const html = `<html><head></head><body>
<script>
const price = "$5";
const msg = "Total $10 + $3 = $13";
</script>
</body></html>`;
    const result = postProcessInteractiveHtml(html);
    expect(result).toContain('const price = "$5"');
    expect(result).toContain('Total $10 + $3 = $13');
  });

  it('does not corrupt dollar signs in HTML attributes containing $', () => {
    const html = `<html><head></head><body>
<p data-price="$5">Price: $5</p>
<button data-latex="$x + $y">Click</button>
</body></html>`;
    const result = postProcessInteractiveHtml(html);
    // The $ signs in plain HTML text/attributes get converted by LaTeX regex
    // This is expected behavior - text outside scripts/styles should render math
    // But dollar signs in non-math context (like "$5" without closing $) should remain
    expect(result).toContain('data-price="$5"');
  });

  it('preserves $...$ patterns when they have spaces or are not balanced pairs', () => {
    const html = `<html><head></head><body>
<p>Value: $5</p>
<script>
// $5 should be preserved in script
const value = $5; // invalid JS anyway but shouldn't be touched
</script>
</body></html>`;
    const result = postProcessInteractiveHtml(html);
    expect(result).toContain('$5');
  });

  it('converts proper LaTeX $$...$$ to \[...\] outside scripts', () => {
    const html = `<html><head></head><body>
<p>Einstein: $E = mc^2$</p>
<p>Display: $$x^2 + y^2$$</p>
<script>
const formula = "E = mc^2";
</script>
</body></html>`;
    const result = postProcessInteractiveHtml(html);
    expect(result).toContain('\\(E = mc^2\\)');
    expect(result).toContain('\\[x^2 + y^2\\]');
    expect(result).toContain('const formula = "E = mc^2"');
  });
});
