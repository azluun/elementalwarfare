# Art guide — what's done and what you can still add

All art is **file-driven**: the game looks for a PNG at a known path and falls back to an
emoji (or nothing) if it isn't there. So you never touch code — you just add image files.

## How to add art

**Pixel-art on a solid background** (elements, cards, mana, avatars, tier badges):
1. Drop the source photo in `assets/<exact-name>.jpg` (or `.png`).
2. Run `python3 tools/artgen.py` (processes all) or `python3 tools/artgen.py <name>` (one).
   It removes the background, trims, squares and scales to 128px.
3. Commit + push — Render redeploys and it appears.

**Full-card textures** (card borders / backgrounds — see below): these are *not* subject-on-a-plain-
background, so **don't** run them through `artgen`. Export them as final transparent PNGs and drop them
straight into `public/img/` at the size noted.

> ⚠️ Filenames are **lowercase** and must match the id exactly (Linux is case-sensitive).

---

## ✅ Done — every gameplay glyph
Elements: `fire water earth air` · Attacks: `storm firebolt meteor plague` ·
Defenses: `mountain ward planet life hearth dew` · Traps: `lava steam energy mud` · plus `mana`.
Nothing here falls back to emoji anymore.

---

## 🎨 Optional — still emoji / plain (add any you want)

### 1. Profile avatars — `assets/icon-<id>.jpg` → `img/icon-<id>.png`
Shown next to player names, in the leaderboard, and the icon shop. Small (128px, like the card art).

| id | now | id | now |
|---|---|---|---|
| `icon-default` | 🙂 Rookie | `icon-comet` | ☄️ Comet |
| `icon-flame` | 🔥 Flame | `icon-dragon` | 🐉 Dragon |
| `icon-droplet` | 💧 Droplet | `icon-monarch` | 👑 Monarch |
| `icon-terra` | 🌍 Terra | `icon-archmage` | 🧙 Archmage |
| `icon-gale` | 🌪️ Gale | | |

- [ ] icon-default · [ ] icon-flame · [ ] icon-droplet · [ ] icon-terra · [ ] icon-gale
- [ ] icon-comet · [ ] icon-dragon · [ ] icon-monarch · [ ] icon-archmage

*(Flame / Droplet / Terra could just reuse your existing `fire` / `water` / `earth` art if you want.)*

### 2. Rank tier badges — `assets/tier-<id>.jpg` → `img/tier-<id>.png`
Shown next to ratings everywhere. Small (128px).

| id | now | id | now |
|---|---|---|---|
| `tier-wood` | 🪵 | `tier-platinum` | 💠 |
| `tier-bronze` | 🥉 | `tier-diamond` | 💎 |
| `tier-silver` | 🥈 | `tier-champion` | 👑 |
| `tier-gold` | 🏅 | | |

- [ ] tier-wood · [ ] tier-bronze · [ ] tier-silver · [ ] tier-gold
- [ ] tier-platinum · [ ] tier-diamond · [ ] tier-champion

### 3. Card border / frame art — drop straight into `public/img/`
A decorative frame overlaid on the big card (hover / drag / reveal). **Transparent centre**, edges only.
Size **172 × 230 px**. One per card type; add only the ones you want.

- [ ] `frame-attack.png` · [ ] `frame-shield.png` · [ ] `frame-trap.png`

### 4. Card background art — drop straight into `public/img/`
A texture shown *behind* the card content (rendered at ~55% opacity so text stays readable).
Size **172 × 230 px**. One per card type.

- [ ] `cardbg-attack.png` · [ ] `cardbg-shield.png` · [ ] `cardbg-trap.png`

---

## Not yet hooked up (say the word and I'll wire them)
Effect/UI emojis — ⚔️ the field · 🛡️ block · 💥 damage · 💚 heal · 🪤 trap · 🏆 leaderboard · 🪙 coins.
These are still plain emoji; I can put them on the same drop-in system if you want them custom.
