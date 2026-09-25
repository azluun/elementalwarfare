# Board Border Art — landscape terrain frames

When a **Landscape** is in play, the whole battlefield themes itself to that element. This already
works with **no art** — the board gets a coloured border, an outer glow and an ambient wash
(🔥 red, 💧 teal, 🌍 amber, 💨 pale blue). This doc is for the **optional ornate frame art** that
drops on top to make it look hand-crafted.

## What I need — 4 files

One 9-slice border frame per element. Drop them into `public/img/` (final transparent PNGs —
**do not** run these through `artgen`). They appear the moment the file exists; until then the
colour theme shows on its own.

| file | element | active landscape | theme ideas |
|---|---|---|---|
| `field-fire.png` | 🔥 Fire | Volcano | lava cracks, embers, charred rock, glowing seams |
| `field-water.png` | 💧 Water | Ocean | waves, foam, coral, dripping edges |
| `field-earth.png` | 🌍 Earth | Highlands | stone blocks, moss, roots, pebbled trim |
| `field-air.png` | 💨 Air | Tempest | clouds, wind streaks, pale mist, feathers |

## Format (important — this is a 9-slice border, not a full image)

- **Transparent PNG**, square canvas. **128×128 recommended** (bigger is fine).
- Only the **outer 26 px ring** is shown — the CSS slices 26 px off each side
  (`border-image-slice:26`, `border-width:26px`). The **centre is ignored**, so leave it
  transparent — the cards and HP badges show through it.
- So really you're drawing **4 corners (26×26 each) + 4 edge strips**. Make the edges
  **tileable left↔right and top↔bottom** — they repeat (`border-image-repeat:round`) to fill a
  board of any height/width, so a seam in the middle of an edge will show.
- **Pixel art** — it renders with `image-rendering:pixelated` (crisp, no blur), matching the cards.
- Keep the art mostly on the frame ring; a little inward bleed (vines, dripping water, embers
  licking inward) looks great and is fine since it sits on top of the board edge.

```
 ┌────────────────────────┐   ← top edge strip (tiles horizontally)
 │ C        top         C │   C = 26×26 corner (fixed)
 │                        │
 │ L                    R │   ← left / right edge strips (tile vertically)
 │        (transparent)   │
 │ C       bottom       C │
 └────────────────────────┘
    26px ring is all that shows
```

## Want a chunkier frame?

The ring thickness is set in one place in `index.html`
(`.board[data-terrain]::after{ border-width:26px; border-image-slice:26 }`). If you'd rather have
a thicker, more ornate frame (say 40 px), draw to that and tell me the number — I'll bump both
values to match. Keep `border-width` and `border-image-slice` equal for 1:1 crispness.

## Optional extras (say the word)

- **Full-board background** per element instead of just a border — a faint textured floor behind
  the cards (`field-bg-<element>.png`). More immersive, more art.
- **A short "terrain forms" animation** when the landscape lands (the frame sweeping in), on top
  of the reveal we already play.

## Status
- Colour theme (border + glow + wash): ✅ live now, no art needed.
- Ornate frame art: ⬜ `field-fire.png` · ⬜ `field-water.png` · ⬜ `field-earth.png` · ⬜ `field-air.png`
