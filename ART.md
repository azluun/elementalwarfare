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

## Gameplay glyphs — the new elemental card set

The card system was rebuilt around **THE LAW OF ELEMENTS** (see `DESIGN.md`). Add a PNG at
`img/<id>.png` for any card and it replaces the emoji fallback. Base elements + `mana` already
have art; the rest currently fall back to emoji.

- **Bases (have art):** `fire water earth air` · plus `mana`.
- **Attacks (🔴):** `scald ♨️` · `storm ⛈️` · `sandstorm 🌫️` · `mudslide 🏞️` · `wildfire 🔥` · `meteor ☄️`
- **Defenses (🔵):** `firewall 🧱` · `ward 🛡️` · `bulwark ⛰️` · `galebarrier 🌬️`
- **Spells (🟡):** `renewal 🌿` · `ember 🔥` · `tide 💧` · `stone 🪨` · `wind 🍃` · `siphon 🩸`
- **Landscapes (🟣):** `volcano 🌋` · `ocean 🌊` · `highlands 🏔️` · `tempest 🌪️`
- **Traps (🟢):** `riptide 🫧` · `backdraft 💥` · `tempestsnare 🕸️` · `quicksand 🕳️`

> Old ids (`firebolt plague mountain planet life hearth dew lava steam energy mud`) are retired —
> their PNGs, if present, are simply unused now.

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

### 3. Card border / frame art — attack/defense/trap done · **2 new types needed**
Ornate per-type frames (172×230, transparent centre) overlay every big card.
Done: `frame-attack.png` · `frame-shield.png` · `frame-trap.png`
- [ ] `frame-spell.png` — 🟡 yellow, to match the Spell type
- [ ] `frame-landscape.png` — 🟣 purple, to match the Landscape type

### 4. Card background art — attack/defense/trap done · **2 new types needed**
Per-type textures behind the card content (~70% opacity).
Done: `cardbg-attack.png` · `cardbg-shield.png` · `cardbg-trap.png`
- [ ] `cardbg-spell.png` — a soft yellow/parchment texture
- [ ] `cardbg-landscape.png` — a soft purple/terrain texture

> The code hooks for both are already wired — drop the PNGs into `public/img/` and they appear.

---

## Full emoji inventory (every emoji in the game)

Everything the game draws with an emoji, grouped by where it lives. **Has art** = already a
custom PNG. **Hookable** = a drop-in slot exists (add the file). **Not hooked** = still plain
emoji; I can put any of these on the same drop-in system on request.

### Gameplay glyphs — bases have art, cards fall back to emoji
Bases 🔥 `fire` · 💧 `water` · 🌍 `earth` · 💨 `air` and ⚡ `mana` have art. Every card id
and its emoji fallback is listed under **Gameplay glyphs — the new elemental card set** at the
top of this file. Drop `img/<id>.png` to give any card real art.

Mana also shows the ⚡→orb everywhere (`img/mana.png`, done).

### Profile avatars — Hookable (`img/icon-<id>.png`)
🙂 default · 🔥 flame · 💧 droplet · 🌍 terra · 🌪️ gale · ☄️ comet · 🐉 dragon · 👑 monarch · 🧙 archmage

### Rank tiers — Hookable (`img/tier-<id>.png`)
🪵 wood · 🥉 bronze · 🥈 silver · 🏅 gold · 💠 platinum · 💎 diamond · 👑 champion

All three groups below are now **Hookable** — every one has a slot at `img/ui-<id>.png` and
falls back to its emoji until you add the file. Drop the final PNG straight into `public/img/`
(these are UI icons, not subject-on-background, so **don't** run them through `artgen`). ~64–128px.

### Combat / effect icons — `img/ui-<id>.png`
| emoji | id | | emoji | id |
|---|---|---|---|---|
| 🛡️ | `ui-shield` | | ✨ | `ui-spark` |
| 💥 | `ui-damage` | | ➡️ | `ui-arrow` |
| 💚 | `ui-heal` | | ♻️ | `ui-recycle` |
| ⚔️ | `ui-swords` | | 🎯 | `ui-target` |
| 🪤 | `ui-trap` | | ✋ | `ui-hand` |
| ⛔ | `ui-ban` | | 🔒 | `ui-lock` |

### Result banners — `img/ui-<id>.png`
🏆 `ui-trophy` (also Leaderboard) · ☠️ `ui-defeat` · ⚖️ `ui-draw`

### Menu & UI buttons — `img/ui-<id>.png`
| emoji | id | | emoji | id |
|---|---|---|---|---|
| 🪙 | `ui-coins` | | 🏳 | `ui-flag` (Forfeit) |
| 🎨 | `ui-skins` | | 🤖 | `ui-bot` |
| 🖼️ | `ui-icons` | | ❔ | `ui-help` |
| 🎖️ | `ui-titles` | | 🔎 | `ui-search` |
| 🔤 | `ui-namecolor` | | ↩ | `ui-undo` |
| 📖 | `ui-book` (Guide/Recipes) | | ⏱ | `ui-clock` |
| 📜 | `ui-scroll` (Patch Notes) | | ⚙️ | `ui-gear` (bot) |
| 🏆 | `ui-trophy` | | 🧹 | `ui-broom` (dev) |
| 🛠 / 🛠️ | `ui-tools` (dev) | | ✏️ | `ui-pencil` (Rename) |
| ⚠ | `ui-warn` | | | |

### Changelog / decorative (inside Patch Notes text — not hooked, low value)
🌀 · 🔷 · 🃏 · 📱 · 👋 — plain emoji in historical changelog entries; ask if you want them too.
