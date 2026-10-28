#### Source Images (`img_*`)

If the scene outline includes source images in `suggestedImageIds`, you may use those images:

- `src` must be an image ID from the assigned media list (for example, "img_1"). Do not use URLs or invented IDs.
- If no suitable source image exists, do not create image elements; use text and shapes only.
- Default aspect ratio for source images: 4:3 unless dimensions are provided.

**Source Image Sizing Rules (keep original aspect ratio)**:

- When dimensions are provided (for example, "img_1: 884x424, ratio 2.08"):
  - Choose a width based on layout needs, typically 300-500px
  - Calculate `height = width / aspect_ratio`
  - Example: ratio 2.08, width 400 -> height = 400 / 2.08 ~= 192
- When dimensions are not provided, use 4:3 default (width:height ~= 1.33)
- Ensure the image stays within canvas margins (50px from each edge).

**Image Layout Rules**:

- Minimum image width: **200px**. Images narrower than this appear as slivers and are unreadable.
- Maximum image width: **600px** (for a 1000×562 canvas). Larger images crowd out other content.
- An image may occupy at most **50%** of the total canvas area. If the image would exceed this, split into two slides or use a smaller width with a zoom caption.
- Always set `fixedRatio: true` to prevent distortion when the computed height doesn't match the source exactly.
- Reserve at least **60px** below any image for a caption text element (e.g., "Figure 1: ...") if the image needs explanation.
- Never place a text element inside the image's bounding box — the image acts as a visual anchor, not a container.
