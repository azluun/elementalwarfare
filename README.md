# Elemental Duel

Online 1v1: combine the four elements into cards, then **attack** or **defend**.
Attacking consumes the card — you have to craft it again. Shields auto-counter
their matching attack. One Node process serves the game *and* referees the match.

## Run it

```bash
cd elemental-duel
npm install
npm start
```

Open **http://localhost:3000**. Two ways to start a match:

- **⚔️ Find match** — matchmaking. You join a queue; the next person who clicks it
  is paired with you into a fresh room automatically. No code to share.
- **Create room / Join room** — play a *specific* friend with a shared code + link.

> Don't open `index.html` by double-clicking it — the game needs the server. Always go through `localhost:3000`.

## Do I need a separate server for matchmaking?

**No.** Matchmaking is just a waiting queue inside this same `server.js` — one
player waits, the next to click **Find match** gets paired. Nothing extra to run.

What matchmaking *does* need is for your server to be at an address strangers can
reach. Two levels:

1. **Testing right now** — a free tunnel to your PC (below). Fine while your PC is on.
2. **Always-on for real** — deploy this exact project to a free host so it has a
   stable URL that survives your PC sleeping:
   - **Render** / **Railway** / **Fly.io** — free tier, `npm start`, done. Easiest.
   - **Cloudflare** — needs the WebSocket part ported to Durable Objects (more work).

   The server code doesn't change — you just run it *there* instead of your PC, and
   everyone opens that URL. (In-memory queue means one server instance only; that's
   plenty until you have lots of concurrent players.)

## Play over the internet without deploying (tunnel)

Your PC isn't reachable from outside by default, so expose it with a free tunnel:

```bash
# option A — Cloudflare (no signup)
cloudflared tunnel --url http://localhost:3000

# option B — ngrok (free account)
ngrok http 3000
```

Either prints a public `https://…` URL. Create a room in your browser, then send
your friend **that public URL with your room code**, e.g.
`https://something.trycloudflare.com/?room=ABCD`. They open it, land straight in
your room, and the duel starts when you're both in.

## How a match works

**Simultaneous rounds with a mana curve.** Each round both players *secretly* plan
their action points, hit **Ready**, and both plans reveal and resolve **at once** —
no turn order, so there's no first-strike advantage. AP ramps each round
(round 1 = 2 AP, +1 per round, capped at 5), so early rounds are for building and
late rounds swing hard.

- **Craft = 1 AP, stage a card = 1 AP.** Spend up to your AP, then **Ready**.
- **A round clock (30s)** stops stalling: at 0 your current plan is auto-submitted,
  and a server-side net resolves the round even if a client vanishes entirely.
- **Bases** 🔥💧🌍💨 are always available. Combine two → the result lands in your
  **inventory** as an element you own (carries across rounds).
- **Advance**: click an owned element to drop it back into the combiner — deeper
  cards need intermediates (Lava, Energy, Mud, Steam, Mountain).
- **Stage** (1 AP): Attack / Shield / Curse go into your hidden plan for this round
  (click the ✕ to cancel before you Ready).
- **The reveal is animated**: both plans flip face-up, then each attack plays out —
  shields brace first (so a shield staged this round blocks an attack thrown this
  round), then attacks land blow by blow with damage pops and HP ticking down. Both
  sides' attacks land together (mutual damage is possible). **Curse** 🌀 locks a
  random enemy base element for the whole next round (can't craft with it).
- Game over gives you **Rematch** (same opponent/mode, fresh match) or **Back to menu**.
- First to 0 HP (of 30) loses. Both to 0 in the same round = a draw.

Since you can't see their plan, the counter chart becomes a read: *will they Meteor?
stage Planet.* A big attack still costs its whole build (Meteor = Lava + Meteor +
Attack = 3 AP), so you commit a round to it and hope it isn't blocked.

**Discovery.** You learn recipes by crafting them. The in-match **📖 Guide** shows
only the recipes you've crafted before (saved per browser), with the rest as
"🔒 undiscovered". The lobby's **📖 Recipe Book** is the full reference — every
recipe and counter, spoilers and all.

Two-tier tree — the same element (e.g. Mountain) is either a shield **or** a step up:

| Element | Recipe | Role |
|---------|--------|------|
| Steam | fire + water | ingredient → Life |
| Lava | fire + earth | ingredient → Meteor |
| Energy | fire + air | ingredient → Firebolt, Plague |
| Mud | water + earth | ingredient → Plague |
| Storm | water + air | attack 8 · blocked by Mountain |
| Mountain | earth + air | shield (blocks Storm) **or** → Planet |
| Water Ward | water + water | shield (blocks Firebolt) |
| Firebolt | energy + fire | attack 6 · blocked by Ward |
| Meteor | lava + fire | attack 12 · blocked by Planet |
| Planet | mountain + earth | shield (blocks Meteor) |
| Plague | mud + energy | attack 10 · blocked by Life |
| Life | steam + air | shield (blocks Plague) |
| Curse | air + air | locks an enemy element 6s |

## Player accounts & saved data (optional)

Sign-in is **off by default** — the game runs guest-only (type a name, no saved stats)
until you give it a Google client id. When configured, players **Sign in with Google**
and the server keeps a profile per player: **name, W/L record (ranked = human vs
human only), and discovered recipes**, saved through `storage.js`.

**Where data lives:** a JSON file at `data/profiles.json`, behind a tiny
`getProfile / saveProfile` seam. ⚠️ Render's **free tier wipes the filesystem on every
redeploy**, so stats won't survive a deploy yet — swap `storage.js`'s body for a free
managed DB (Upstash Redis / Neon Postgres) when you want durable persistence. Nothing
else in the app changes.

**Turn it on — make a Google client id (~5 min, free):**
1. [console.cloud.google.com](https://console.cloud.google.com) → create a project.
2. **APIs & Services → OAuth consent screen** → External → fill the basics → add
   yourself under **Test users** (or Publish).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   **Web application**.
4. Under **Authorized JavaScript origins** add both:
   - `http://localhost:3000`
   - `https://elementalwarfare.onrender.com`
5. Copy the **Client ID** (it's public — no secret needed for this flow).
6. Set it as an env var, locally and on Render:
   - Local (Git Bash): `GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com npm start`
   - Render: **Environment → Add** `GOOGLE_CLIENT_ID` = your client id → redeploy.

That's it — the sign-in button appears automatically once the id is set.

> Trust note: a client tells the server its `playerId` when a match starts, so stats
> aren't cheat-proof — fine for friends. A signed session token would harden it later.

## Tweak it

- **Damage, HP, the mana curve, lock time, counters** → top of `server.js` (`START_HP`, `AP_CAP`, `apFor`, `ATTACKS`, `LOCK_MS`, `BOT_COSTS`). Server is authoritative, so this is the real balance.
- **Recipes, card art/text** → `CARDS` in `public/index.html`.
- Keep the two `ATTACKS`/`CARDS` tables in sync when you add a card.

## Not built yet (add when you want)

- Server-authoritative crafting/cooldown (right now the client is trusted for its own hand — fine for friends, not for strangers).
- Matchmaking / lobby list, reconnect, spectators.
- More cards, multi-target attacks, an economy instead of a flat cooldown.
