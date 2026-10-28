/**
 * Repair the layout of STORED slide scenes: run the generation package's
 * normalizeSlideLayout + applySlideLayerOrder over every slide scene's
 * elements and write the fixed geometry back to document_scenes. The
 * openmaic_bump_scene_revision trigger bumps each updated scene's revision,
 * so open players re-fetch the scene via the manifest diff.
 *
 * Usage:
 *   node scripts/fix-slide-layout.mjs --dry-run          # report only (default)
 *   node scripts/fix-slide-layout.mjs --apply            # write repairs to the DB
 *   node scripts/fix-slide-layout.mjs --apply --stage stage-xxx [stage-yyy ...]
 *
 * --apply first dumps every scene it touches to slide-layout-backup-<n>.json
 * next to this script, so a bad repair can be reverted by re-uploading that
 * JSON.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  applySlideLayerOrder,
  normalizeSlideLayout,
} from '../packages/@openmaic/generation/dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// ON_ERROR_STOP: a failed statement must fail the script, not print an error
// and exit 0 (which execFileSync would read as success).
const PSQL = 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atq -v ON_ERROR_STOP=1';
const CONTAINER = 'openmaic-postgres-1';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const stageFlag = args.indexOf('--stage');
const stageFilter =
  stageFlag >= 0 ? args.slice(stageFlag + 1).filter((a) => !a.startsWith('--')) : null;
if (stageFlag >= 0 && stageFilter.length === 0) {
  console.error('--stage needs at least one stage id (an empty list would build invalid SQL)');
  process.exit(2);
}

const sql = (input) =>
  execFileSync('docker', ['exec', '-i', CONTAINER, 'sh', '-c', PSQL], {
    input,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

const CONTENT_TYPES = new Set([
  'text', 'latex', 'image', 'chart', 'table', 'video', 'audio', 'code',
]);
const geo = (e) => ({
  left: e.left,
  top: e.top,
  right: e.left + (e.width ?? 0),
  bottom: e.top + (e.height ?? 0),
});
const inter = (a, b) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** Content-content overlaps excluding text inside a containing shape. */
function defectCount(elements) {
  const containers = elements
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.type === 'shape' && (e.width ?? 0) > 24 && (e.height ?? 0) > 24);
  const ownerOf = new Map();
  for (const [i, el] of elements.entries()) {
    if (!CONTENT_TYPES.has(el.type)) continue;
    const area = (el.width ?? 0) * (el.height ?? 0);
    if (area <= 0) continue;
    let best = -1;
    let bestCoverage = 0;
    for (const { e: c, i: ci } of containers) {
      const coverage = inter(geo(el), geo(c)) / area;
      if (coverage > bestCoverage) {
        bestCoverage = coverage;
        best = ci;
      }
    }
    if (bestCoverage >= 0.25) ownerOf.set(i, best);
  }
  let overlaps = 0;
  let outOfBounds = 0;
  for (const [i, a] of elements.entries()) {
    if (!CONTENT_TYPES.has(a.type)) continue;
    if (
      a.left < 49.5 || a.top < 49.5 ||
      a.left + (a.width ?? 0) > 950.5 || a.top + (a.height ?? 0) > 513
    ) outOfBounds++;
    for (let j = i + 1; j < elements.length; j++) {
      const b = elements[j];
      if (!CONTENT_TYPES.has(b.type)) continue;
      if (ownerOf.get(i) === j || ownerOf.get(j) === i) continue;
      if (inter(geo(a), geo(b)) > 4) overlaps++;
    }
  }
  return { overlaps, outOfBounds };
}

// ---- read ------------------------------------------------------------------
const where = stageFilter
  ? `AND stage_id IN (${stageFilter.map((s) => `'${s.replace(/'/g, '')}'`).join(', ')})`
  : '';
const rows = sql(
  `SELECT json_build_object('id', id, 'stage_id', stage_id, 'scene_order', scene_order, 'data', data)
     FROM document_scenes
    WHERE data->>'type' = 'slide' ${where}
    ORDER BY stage_id, scene_order;`,
)
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

console.log(
  `${apply ? 'APPLY' : 'DRY-RUN'}: ${rows.length} slide scene(s)${stageFilter ? ` in stage(s) ${stageFilter.join(', ')}` : ''}`,
);

const touched = [];
let totalBefore = 0;
let totalAfter = 0;
let totalFixed = 0;
let totalRemaining = 0;

for (const row of rows) {
  const scene = row.data;
  const elements = scene?.content?.canvas?.elements;
  if (!Array.isArray(elements) || elements.length === 0) continue;

  const before = defectCount(elements);
  const result = normalizeSlideLayout(elements);
  const ordered = applySlideLayerOrder(result.elements);
  const after = defectCount(ordered);

  totalBefore += before.overlaps + before.outOfBounds;
  totalAfter += after.overlaps + after.outOfBounds;
  totalFixed += result.fixed;
  totalRemaining += result.remainingOverlaps;

  const changed =
    result.fixed > 0 ||
    JSON.stringify(ordered) !== JSON.stringify(elements);
  if (!changed) continue;

  touched.push({ ...row, repaired: ordered });

  const note =
    after.overlaps + after.outOfBounds > 0
      ? `  ⚠ ${after.overlaps} overlap(s) unresolvable`
      : '';
  console.log(
    `${row.stage_id} scene ${String(row.scene_order).padStart(2)}: ${before.overlaps}→${after.overlaps} overlaps, ` +
      `${before.outOfBounds}→${after.outOfBounds} out-of-bounds, ${result.fixed} fixed${note}`,
  );
}

console.log(
  `\nTotal defects: ${totalBefore} → ${totalAfter} (${totalFixed} repairs, ${totalRemaining} left) across ${touched.length} scene(s)`,
);

if (!apply) {
  console.log('Dry run — nothing written. Re-run with --apply to repair.');
  process.exit(0);
}

if (touched.length === 0) {
  console.log('Nothing to repair.');
  process.exit(0);
}

// ---- backup + write ----------------------------------------------------------
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupPath = join(HERE, `slide-layout-backup-${stamp}.json`);
writeFileSync(
  backupPath,
  JSON.stringify(touched.map(({ repaired, ...rest }) => ({ ...rest, originalElements: rest.data?.content?.canvas?.elements ?? [] })), null, 1),
  'utf8',
);
console.log(`Backup written: ${backupPath}`);

let written = 0;
for (const row of touched) {
  const scene = row.data;
  scene.content.canvas.elements = row.repaired;
  const json = JSON.stringify(scene);
  if (json.includes('$omaic$')) {
    console.error(`scene ${row.id}: payload contains the dollar-quote tag; skip`);
    continue;
  }
  // RETURNING echoes the id once per updated row: an empty answer means the
  // UPDATE matched nothing, which must not be counted as a repair. Some psql
  // builds append the "UPDATE 1" command tag even under -Atq; ignore it.
  const updated = sql(
    `UPDATE document_scenes SET data = $omaic$${json}$omaic$::jsonb WHERE id = '${row.id.replace(/'/g, '')}' RETURNING id;`,
  )
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^UPDATE \d+$/.test(l));
  if (updated.length !== 1 || updated[0] !== row.id) {
    console.error(`scene ${row.id}: UPDATE returned ${JSON.stringify(updated)} — aborting`);
    process.exit(1);
  }
  written++;
}
console.log(`Repaired ${written} scene(s) in the database (revision trigger will propagate).`);
