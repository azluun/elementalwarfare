# Remaining art needed

**6 files left** — all of them the defense / recovery cards. Everything else (4 bases, 4 traps, 4 attacks) already has art. ✅

## How to add one

1. Drop a source image in `assets/<id>.jpg` (or `.png`).
2. Run `python3 tools/artgen.py` (or `python3 tools/artgen.py <id>` for just one).
   It removes the background, trims, and writes `public/img/<id>.png` at 128px.
3. Commit + push — Render auto-deploys and the card lights up automatically.

> ⚠️ **Filenames must be lowercase** and must exactly match the `id` in the left column (Linux is case-sensitive). No code changes are ever needed — `glyph()` finds the PNG by id.

## The checklist

| id (filename) | Card name | Current emoji | What it does | Art idea |
|---|---|---|---|---|
| `mountain` | Mountain | ⛰️ | blocks Storm · heal 4 · → Planet | a stone peak / cliff |
| `ward` | Water Ward | 💧 | blocks Firebolt · gives back 🌍 | a glowing water shield / barrier |
| `planet` | Planet | 🌐 | blocks Meteor · gives back 💧 | a small world / globe |
| `life` | Life | 🌿 | blocks Plague · heal 6 | a leaf / sprout / green sigil |
| `hearth` | Hearth | 🕯️ | heal 5 · gives back 💨 | a candle / campfire / hearth flame |
| `dew` | Dew | 💦 | heal 2 · cleanse all disables | dew drops / droplets |

- [ ] `mountain.png`
- [ ] `ward.png`
- [ ] `planet.png`
- [ ] `life.png`
- [ ] `hearth.png`
- [ ] `dew.png`

## Already done (no action needed)

**Bases:** fire, water, earth, air
**Traps:** lava, steam, energy, mud
**Attacks:** storm, firebolt, meteor, plague
