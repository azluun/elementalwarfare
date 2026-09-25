# Elemental Duel — Card System Design

The living source of truth for the elemental card system. Balance numbers here are
starting points; tune them in `server.js` (authoritative) and mirror in `public/index.html`.

## The Four Elements

🔥 Fire · 💧 Water · 🌍 Earth · 💨 Air — every card is built from these.

## THE LAW OF ELEMENTS

A card's **type** is decided by the *shape* of its recipe — how many base elements it's
made of and whether they match:

| Recipe shape | Type | Colour | Why |
|---|---|---|---|
| **X + X** (matching pair) | **Defense** | 🔵 blue | reinforce one element = a shield |
| **X + Y** (mixed pair) | **Attack** | 🔴 red | clashing elements = aggression |
| **X + X + X** (pure triple) | **Landscape** | 🟣 purple | flood the field with one element = terrain |
| **X + X + Y** (pair + catalyst) | **Spell** | 🟡 yellow | a dominant element focused by a third = a rite |
| **X + Y + Z** (all different) | **Trap** | 🟢 green | three warring elements are unstable — you *rig* them |

Crafting is **pairwise + tiered**: 3-element cards are made by combining a tier-1 card with
a third ingredient (e.g. `Ward (💧💧) + 🌍 → Renewal`, `Meteor (🔥🌍) + 💨 → Backdraft`).

## Blocking

**A Defense blocks any Attack that shares its element.** Attacks are dual-element, so each
can be stopped by *either* of two defenses. The shield is consumed on the block, and the
defender gains a one-shot mana burst (see Mana). No 1:1 counter memorization.

## Mana

- **Baseline**: grows slowly each round (2,2,3,3,4,4…) — the tempo floor.
- **Defensive ramp**: a Defense that actually **blocks** grants the defender a one-shot
  mana burst (+2). It does **not** compound — you get a spike when you defend well, then it's
  gone. This is the *only* ramp; it's tied to being attacked, so it self-corrects.
- **No proactive mana generators.** (hearth/dew are retired.)
- Spells and attacks spend mana. Spells never grant it.
- **Siphon** (a spell) can burn the opponent's banked mana — the anti-ramp answer.

## The Cards (starting numbers)

### Attacks — 6 mixed pairs (dual-element)
| card | recipe | elements | dmg | cost |
|---|---|---|---|---|
| Scald | 🔥+💧 | fire/water | 6 | 2 |
| Storm | 💧+💨 | water/air | 6 | 2 |
| Sandstorm | 🌍+💨 | earth/air | 6 | 2 |
| Mudslide | 💧+🌍 | water/earth | 7 | 3 |
| Wildfire | 🔥+💨 | fire/air | 7 | 3 |
| Meteor | 🔥+🌍 | fire/earth | 9 | 3 |

### Defenses — 4 matching pairs (block + mana burst on block, no heal)
| card | recipe | element | cost |
|---|---|---|---|
| Firewall | 🔥+🔥 | fire | 2 |
| Ward | 💧+💧 | water | 2 |
| Bulwark | 🌍+🌍 | earth | 2 |
| Gale Barrier | 💨+💨 | air | 2 |

### Landscapes — 4 pure triples (one shared slot, +1 to all damage of its element)
| card | recipe | element | cost |
|---|---|---|---|
| Volcano | Firewall+🔥 | fire | 3 |
| Ocean | Ward+💧 | water | 3 |
| Highlands | Bulwark+🌍 | earth | 3 |
| Tempest | Gale Barrier+💨 | air | 3 |

### Spells — flavored triples (resolve instantly, don't persist)
| card | recipe | effect | cost |
|---|---|---|---|
| Renewal | Ward+🌍 | heal 6 | 3 |
| Ember Rite | Firewall+💨 | your next Fire attack +2 | 2 |
| Tide Charm | Ward+💨 | your next Water attack +2 | 2 |
| Stone Rite | Bulwark+🔥 | your next Earth attack +2 | 2 |
| Wind Rite | Gale Barrier+🔥 | your next Air attack +2 | 2 |
| Siphon | Firewall+💧 | burn 2 of enemy's banked mana | 3 |

### Traps — 4 rainbow triples (conditional; spring only when their condition is met)
| card | recipe | condition → effect | cost |
|---|---|---|---|
| Riptide | Mudslide+💨 | opp plays an expensive (cost-3) attack → 5 back | 3 |
| Backdraft | Meteor+💨 | opp heals this round → 6 back | 3 |
| Tempest Snare | Scald+💨 | your HP < 12 → 6 back | 3 |
| Quicksand | Scald+🌍 | opp banked ≥3 mana → 3 back + burn 2 mana | 3 |

## Damage math

`damage = base + (landscape matches either element? +1) + (empower buff for either element)`

Only one landscape can be active (shared slot), so a dual-element attack gets at most +1
from terrain. Empower buffs ("next X attack +2") are one-shot and consumed by a matching attack.

## Buff scope

For now, **damage only** — landscapes and rites affect attack damage, not healing or defense.
