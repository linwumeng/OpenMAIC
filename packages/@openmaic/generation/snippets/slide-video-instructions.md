### VideoElement

```json
{
  "id": "video_001",
  "type": "video",
  "left": 100,
  "top": 150,
  "width": 500,
  "height": 281,
  "mediaRef": "<VIDEO_MEDIA_REF_FROM_ASSIGNED_MEDIA>",
  "autoplay": false
}
```

**Required Fields**: `id`, `type`, `left`, `top`, `width`, `height`, `mediaRef` (generated video media ref copied exactly from the assigned media list), `autoplay` (boolean)

**Video Sizing Rules**:

- `mediaRef` must be copied exactly from the assigned video media list
- Default aspect ratio: 16:9 -> `height = width / 1.778`
- Typical video width: 400–550px (prominent on slide)
- Position video as a focal element, usually centered or in the main content area
- Leave space for a title and optional caption text

**Video Layout Rules**:

- A video should occupy **no more than 55%** of the canvas area. Videos larger than this crowd out annotations and captions.
- Minimum video width: **320px**. Smaller videos are difficult to watch meaningfully.
- Always set `autoplay: false` — video content is instructional and requires explicit play action.
- Reserve at least **40px** below the video for a caption explaining what the viewer should focus on.
- If the video has a natural start point (e.g., a formula derivation beginning), mention the starting timestamp in the caption.
- Do NOT place text elements inside the video's bounding box. The video is a self-contained visual block.
- If multiple videos are assigned, place them side by side only if their combined width ≤ 950px; otherwise stack them vertically.
