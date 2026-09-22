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

- **Bases** 🔥💧🌍💨 are always available. Combine two → the result lands in your
  **inventory** as an element you own.
- **Advance**: click an owned element to drop it back into the combiner — deeper
  cards need intermediates (Lava, Energy, Mud, Steam, Mountain). Combining spends
  the ingredients.
- **Deploy**: an element with a role has a button — **Attack**, **Set shield**, or
  **Cast** — which spends one from your inventory.
- **Shields** wait in your defense and eat the one attack they counter, then they're
  spent. **Curse** 🌀 locks a random enemy element for 6s.
- First to 0 HP (of 30) loses.

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

## Tweak it

- **Damage, HP, lock time, counters** → top of `server.js` (`START_HP`, `ATTACKS`, `LOCK_MS`). Server is authoritative, so this is the real balance.
- **Recipes, card art/text, craft cooldown** → `CARDS` and `CD_MS` in `public/index.html`.
- Keep the two `ATTACKS`/`CARDS` tables in sync when you add a card.

## Not built yet (add when you want)

- Server-authoritative crafting/cooldown (right now the client is trusted for its own hand — fine for friends, not for strangers).
- Matchmaking / lobby list, reconnect, spectators.
- More cards, multi-target attacks, an economy instead of a flat cooldown.
