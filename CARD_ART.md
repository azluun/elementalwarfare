# Card Art — checklist

Just the card art. Every card looks for `img/<id>.png` and falls back to the emoji until the
file exists. Drop a PNG in `public/img/`, commit, push — Render redeploys and it appears.

**Subject art** (the picture in the middle): put the source in `assets/<id>.jpg` and run
`python3 tools/artgen.py <id>` (removes background, trims, 128px). **Frames/backgrounds** are
final transparent PNGs — drop them straight into `public/img/`, don't run artgen.

> Filenames are lowercase and must match the id exactly (Linux is case-sensitive).

---

## Frame + background sets (per type)

Two art files each: an ornate border (`frame-<type>.png`, 172×230, transparent centre) and a
texture behind the content (`cardbg-<type>.png`, 172×230, shown ~70% opacity).

| type | colour | frame | background | status |
|---|---|---|---|---|
| Attack | 🔴 red | `frame-attack.png` | `cardbg-attack.png` | ✅ done |
| Defense | 🔵 blue | `frame-shield.png` | `cardbg-shield.png` | ✅ done |
| Trap | 🟢 green | `frame-trap.png` | `cardbg-trap.png` | ✅ done |
| Spell | 🟡 yellow | `frame-spell.png` | `cardbg-spell.png` | ⬜ needed |
| Landscape | 🟣 purple | `frame-landscape.png` | `cardbg-landscape.png` | ⬜ needed |

---

## Subject art (one per card)

Legend: ✅ has art · ⬜ needs art (emoji fallback for now).

### 🔴 Attacks
| status | file | card | elements | emoji now |
|---|---|---|---|---|
| ⬜ | `scald.png` | Scald | Fire/Water | ♨️ |
| ✅ | `storm.png` | Storm | Water/Air | ⛈️ |
| ⬜ | `sandstorm.png` | Sandstorm | Earth/Air | 🌫️ |
| ⬜ | `mudslide.png` | Mudslide | Water/Earth | 🏞️ |
| ⬜ | `wildfire.png` | Wildfire | Fire/Air | 🔥 |
| ✅ | `meteor.png` | Meteor | Fire/Earth | ☄️ |

### 🔵 Defenses
| status | file | card | element | emoji now |
|---|---|---|---|---|
| ⬜ | `firewall.png` | Firewall | Fire | 🧱 |
| ✅ | `ward.png` | Ward | Water | 🛡️ |
| ⬜ | `bulwark.png` | Bulwark | Earth | ⛰️ |
| ⬜ | `galebarrier.png` | Gale Barrier | Air | 🌬️ |

### 🟡 Spells
| status | file | card | element | emoji now |
|---|---|---|---|---|
| ⬜ | `renewal.png` | Renewal | Water (heal) | 🌿 |
| ⬜ | `ember.png` | Ember Rite | Fire | 🔥 |
| ⬜ | `tide.png` | Tide Charm | Water | 💧 |
| ⬜ | `stone.png` | Stone Rite | Earth | 🪨 |
| ⬜ | `wind.png` | Wind Rite | Air | 🍃 |
| ⬜ | `siphon.png` | Siphon | Fire (mana burn) | 🩸 |

### 🟣 Landscapes
| status | file | card | element | emoji now |
|---|---|---|---|---|
| ⬜ | `volcano.png` | Volcano | Fire | 🌋 |
| ⬜ | `ocean.png` | Ocean | Water | 🌊 |
| ⬜ | `highlands.png` | Highlands | Earth | 🏔️ |
| ⬜ | `tempest.png` | Tempest | Air | 🌪️ |

### 🟢 Traps
| status | file | card | elements | emoji now |
|---|---|---|---|---|
| ⬜ | `riptide.png` | Riptide | Water/Earth/Air | 🫧 |
| ⬜ | `backdraft.png` | Backdraft | Fire/Earth/Air | 💥 |
| ⬜ | `tempestsnare.png` | Tempest Snare | Fire/Water/Air | 🕸️ |
| ⬜ | `quicksand.png` | Quicksand | Fire/Water/Earth | 🕳️ |

---

## Tally
- **Have art:** 3 (storm, meteor, ward)
- **Need subject art:** 21 cards
- **Need frame + background:** 2 types (spell, landscape) = 4 files

## Old art you can recycle
These retired files still sit in `public/img/`. Copy one to a new id to reuse it (or re-run artgen on a fresh source):

| old file | good fit for |
|---|---|
| `lava.png` (🌋) | `volcano.png` |
| `mountain.png` (⛰️) | `bulwark.png` or `highlands.png` |
| `life.png` (🌿) | `renewal.png` |
| `firebolt.png` (🔥) | `wildfire.png` or `ember.png` |
| `steam.png` (♨️) | `scald.png` |
| `mud.png` (🟤) | `mudslide.png` |
| `planet.png` (🌐) | — (no direct match) |
| `dew.png` `hearth.png` `energy.png` `plague.png` | — retired, no direct match |
