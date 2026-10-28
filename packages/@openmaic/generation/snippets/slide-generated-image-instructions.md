#### AI-Generated Images (`gen_img_*`)

If the scene outline includes image entries in `mediaGenerations`, you may use those generated image placeholders:

- `src` can be a generated image ID like `"gen_img_1"`, `"gen_img_2"`, etc.
- These placeholders will be replaced with actual generated images after slide creation
- Use the same positioning rules as source images

**Default Aspect Ratio**: 16:9 (`height = width / 1.778`) unless the content topic calls for a different ratio (e.g., a portrait diagram benefits from 3:4).

**Generated Image Layout Rules**:

- A generated image represents a full visual concept — it should be the **dominant element** on the slide, taking **40–55%** of the canvas area.
- Minimum generated image width: **320px**. Smaller images will still render but may be hard to see clearly.
- Maximum generated image width: **650px** on a standard 1000×562 canvas. Larger images leave too little room for annotations.
- Always reserve a caption text element below the image (20–40px gap) — a generated image without context is confusing.
- Text-to-image spacing: **25–35px** vertically and **30–40px** horizontally when placing multiple media elements side by side.
- Do NOT place other elements (text, shapes, charts) inside the image's bounding box. The image is a self-contained visual.
- If the generation fails (500 error), the element will show a retry button — design the rest of the slide so it remains useful even if the image is missing.
