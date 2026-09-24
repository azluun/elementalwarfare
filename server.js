// Elemental Duel — one process serves the page AND referees the match.
// Server is authoritative for HP, shields and element-locks so both players agree.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const store = require("./storage");

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, "public");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".ico": "image/x-icon", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif" };

// --- Google Sign-In (optional): if no client id is configured, the game runs guest-only ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const DEV_EMAILS = new Set((process.env.DEV_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)); // accounts that can equip the secret "Developer" title
let googleClient = null;
if (GOOGLE_CLIENT_ID) {
  try { const { OAuth2Client } = require("google-auth-library"); googleClient = new OAuth2Client(GOOGLE_CLIENT_ID); }
  catch (e) { console.error("google-auth-library not installed; sign-in disabled:", e.message); }
}

// verify a Google ID token, then load/create that player's profile (merging any local discoveries)
async function handleAuth(req, res) {
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 1e5) req.destroy(); });
  req.on("end", async () => {
    try {
      if (!googleClient) throw new Error("sign-in not configured");
      const { idToken, discovered, name, tutorialDone } = JSON.parse(body || "{}");
      const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
      const p = ticket.getPayload();
      const profile = (await store.getProfileAsync(p.sub)) || { id: p.sub, name: "", wins: 0, losses: 0, rating: 1000, peak: 1000, title: "", tutorialDone: false, discovered: [], coins: 0, skins: ["default"], cardSkin: "default", icons: ["default"], icon: "default", nameColors: ["default"], nameColor: "default", cardBacks: ["default"], cardBack: "default" };
      let nameTaken = false;
      if (typeof name === "string" && name.trim()) {          // a name was submitted (first login / name prompt)
        const wanted = name.trim().slice(0, 16);
        if (store.nameTaken(wanted, profile.id)) nameTaken = true;  // someone else already uses it — reject
        else profile.name = wanted;                                // unique → claim it
      }
      if (profile.rating == null) profile.rating = 1000;                 // backfill older profiles
      if (profile.peak == null) profile.peak = profile.rating;
      if (profile.title == null) profile.title = "";
      if (profile.tutorialDone == null) profile.tutorialDone = false;
      if (tutorialDone === true) profile.tutorialDone = true;            // client marks it done after the guided match
      if (profile.coins == null) profile.coins = 0;                     // coin wallet + owned/equipped cosmetics
      if (!Array.isArray(profile.skins)) profile.skins = ["default"];
      if (profile.cardSkin == null) profile.cardSkin = "default";
      if (!Array.isArray(profile.icons)) profile.icons = ["default"];
      if (profile.icon == null) profile.icon = "default";
      if (!Array.isArray(profile.nameColors)) profile.nameColors = ["default"];
      if (profile.nameColor == null) profile.nameColor = "default";
      if (!Array.isArray(profile.cardBacks)) profile.cardBacks = ["default"];
      if (profile.cardBack == null) profile.cardBack = "default";
      profile.dev = DEV_EMAILS.has((p.email || "").toLowerCase()); // refresh dev flag each login
      const merged = new Set([...(profile.discovered || []), ...(Array.isArray(discovered) ? discovered : [])]);
      profile.discovered = [...merged];
      store.saveProfile(profile.id, profile);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ profile, needsName: !profile.name, nameTaken, suggestedName: nameTaken ? name.trim().slice(0, 16) : (p.given_name || p.name || "") }));
    } catch (e) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// equip a cosmetic title, but only one the player has unlocked by their peak rating
async function handleCosmetic(req, res) {
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 1e5) req.destroy(); });
  req.on("end", async () => {
    try {
      if (!googleClient) throw new Error("sign-in not configured");
      const { idToken, title } = JSON.parse(body || "{}");
      const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
      const prof = await store.getProfileAsync(ticket.getPayload().sub);
      if (!prof) throw new Error("no profile");
      const peakTier = tierIndex(prof.peak || prof.rating || 1000);
      const okDev = title === "developer" && prof.dev;                            // secret title
      const okTier = TITLES[title] && TIER_IDS.indexOf(title) <= peakTier;         // earned by climbing
      if (title === "" || okDev || okTier) {
        prof.title = title || "";
        store.saveProfile(prof.id, prof);
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ profile: prof }));
      }
      throw new Error("not unlocked");
    } catch (e) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// buy or equip a cosmetic (card skin or profile icon). Coins are spent server-side; no gameplay effect.
async function handleShop(req, res) {
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 1e5) req.destroy(); });
  req.on("end", async () => {
    try {
      if (!googleClient) throw new Error("sign-in not configured");
      const { idToken, action, kind, item, skin, icon, name } = JSON.parse(body || "{}");
      const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
      const prof = await store.getProfileAsync(ticket.getPayload().sub);
      if (!prof) throw new Error("no profile");
      if (prof.coins == null) prof.coins = 0;
      // backfill any missing cosmetic fields
      for (const c of Object.values(COSMETICS)) { if (!Array.isArray(prof[c.owned])) prof[c.owned] = ["default"]; if (prof[c.equip] == null) prof[c.equip] = "default"; }
      if (action === "rename") { // pay coins to change your (unique) name
        const wanted = String(name || "").trim().slice(0, 16);
        if (!wanted) throw new Error("empty name");
        if (prof.coins < RENAME_COST) throw new Error("not enough coins");
        if (store.nameTaken(wanted, prof.id)) throw new Error("name taken");
        prof.coins -= RENAME_COST; prof.name = wanted;
      } else {
        const c = COSMETICS[kind] || COSMETICS.skin; // default kind = card skin (back-compat)
        const it = item != null ? item : (kind === "icon" ? icon : skin); // prefer generic `item`, fall back to legacy fields
        if (action === "buy") {
          const price = c.catalog[it];
          if (price == null) throw new Error("unknown item");
          if (prof[c.owned].includes(it)) throw new Error("already owned");
          if (prof.coins < price) throw new Error("not enough coins");
          prof.coins -= price; prof[c.owned].push(it);
        } else if (action === "equip") {
          if (it !== "default" && !prof[c.owned].includes(it)) throw new Error("not owned");
          if (c.catalog[it] == null) throw new Error("unknown item");
          prof[c.equip] = it;
        } else throw new Error("bad action");
      }
      store.saveProfile(prof.id, prof);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ profile: prof }));
    } catch (e) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// dev-only profile admin: view / repair / normalize profiles. Gated by DEV_EMAILS (a signed-in dev account).
async function handleAdmin(req, res) {
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 2e5) req.destroy(); });
  req.on("end", async () => {
    try {
      if (!googleClient) throw new Error("sign-in not configured");
      const { idToken, action, id, profile } = JSON.parse(body || "{}");
      const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
      const email = (ticket.getPayload().email || "").toLowerCase();
      if (!DEV_EMAILS.has(email)) throw new Error("not authorized"); // only listed dev accounts
      const ok = (obj) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (action === "list") {
        const rows = store.allProfiles().map((p) => ({ id: p.id, name: p.name || "", rating: p.rating || 1000, wins: p.wins || 0, losses: p.losses || 0, coins: p.coins || 0 }));
        return ok({ profiles: rows, storage: store.mode });
      }
      if (action === "get") { return ok({ profile: await store.getProfileAsync(id) }); }
      if (action === "normalizeAll") { // re-save every profile as a clean single-line JSON string
        let n = 0; for (const p of store.allProfiles()) { store.saveProfile(p.id, p); n++; }
        return ok({ normalized: n });
      }
      if (action === "set") {
        if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("profile must be an object");
        const pid = String(profile.id || id || "").trim();
        if (!pid) throw new Error("missing id");
        profile.id = pid;
        store.saveProfile(pid, profile); // writes via HSET JSON.stringify -> normalizes format
        return ok({ ok: true, profile });
      }
      throw new Error("bad action");
    } catch (e) {
      res.writeHead(e.message === "not authorized" ? 403 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// --- HTTP: config + auth endpoints, then static files from public/ ---
const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/config") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ googleClientId: GOOGLE_CLIENT_ID, storage: store.mode, profiles: store.count() })); }
  if (url === "/leaderboard") {
    const top = store.allProfiles().filter((p) => p.name)
      .sort((a, b) => (b.rating || 1000) - (a.rating || 1000)).slice(0, 20)
      .map((p) => ({ name: p.name, rating: p.rating || 1000, wins: p.wins || 0, losses: p.losses || 0, icon: p.icon || "default", nameColor: p.nameColor || "default" }));
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ top }));
  }
  if (url === "/auth" && req.method === "POST") return handleAuth(req, res);
  if (url === "/cosmetic" && req.method === "POST") return handleCosmetic(req, res);
  if (url === "/shop" && req.method === "POST") return handleShop(req, res);
  if (url === "/admin" && req.method === "POST") return handleAdmin(req, res);
  let f = decodeURIComponent(url);
  if (f === "/") f = "/index.html";
  const fp = path.join(PUB, path.normalize(f).replace(/^(\.\.[/\\])+/, ""));
  if (!fp.startsWith(PUB)) { res.writeHead(403); return res.end("no"); }
  fs.readFile(fp, (e, data) => {
    if (e) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": MIME[path.extname(fp)] || "text/plain" });
    res.end(data);
  });
});

// --- authoritative combat rules (client mirrors these for its own UI) ---
const START_HP = 30;
const DISABLE_ROUNDS = 1; // an unblocked attack disables an enemy base element for this many upcoming rounds
// mana economy: base mana grows +1 every 2 rounds. On EVEN rounds you may carry exactly ONE
// unspent mana over from the previous (odd) round; on ODD rounds nothing carries and base
// "catches up" to the max. So max = base on odd rounds, base+1 on even rounds.
const baseMana = (round) => 2 + Math.floor((round - 1) / 2); // 2,2,3,3,4,4,5,5,6,6…
const carryCap = (round) => (round % 2 === 0 ? 1 : 0);       // carry 1 mana, and only INTO an even round
const ROUND_SECONDS = 30; // planning clock; a stalled/absent player is auto-resolved after this
// attacks: damage + disable one enemy base element for a round (blocking the attack negates both)
const ATTACKS = {
  firebolt: { dmg: 6,  counter: "ward",     disable: "water" },
  meteor:   { dmg: 12, counter: "planet",   disable: "earth" },
  storm:    { dmg: 8,  counter: "mountain", disable: "air" },
  plague:   { dmg: 10, counter: "life",     disable: "fire" },
};
// defenses: a played card can block its attack, heal HP, and/or restore (cleanse) disabled element(s)
const DEFENSE = {
  mountain: { blocks: "storm",    heal: 4 },
  ward:     { blocks: "firebolt", restore: "earth" }, // water ward blocks fire AND gives back earth
  planet:   { blocks: "meteor",   restore: "water" },
  life:     { blocks: "plague",   heal: 6 },
  hearth:   { heal: 5, restore: "air" },   // no block — pure recovery
  dew:      { restoreAll: true, heal: 2 }, // cleanse every disable
};
// traps: the old "ingredient" cards are now playable. A trap fires only if the opponent attacks you this round.
const TRAPS = {
  lava:   { retaliate: 6 },              // 🌋 Volcano — erupt for 6 back
  steam:  { heal: 6 },                   // ♨️ Steam — vent, heal 6
  energy: { disable: "random" },         // ⚡ Energy — shock: disable a random enemy element next round
  mud:    { retaliate: 3, heal: 3 },     // 🟤 Mud — quagmire: a little of both
};
// total mana (craft + play) each card costs — drives the bot's budget and the coin reward
const COST = { storm:2, firebolt:3, meteor:3, plague:4, ward:2, mountain:2, planet:3, life:3, hearth:2, dew:2, lava:2, steam:2, energy:2, mud:2 };
// cosmetic card-background skins unlocked with coins (value = price; 0 = free default). No gameplay effect.
const SKINS = { default:0, ember:5, ocean:5, forest:8, royal:12, rose:15, gold:20 };
// cosmetic profile icons (avatars), also coin-unlocked; purely visual
const ICONS = { default:0, flame:5, droplet:5, terra:8, gale:8, comet:12, dragon:15, monarch:20, archmage:25 };
const NAME_COLORS = { default:0, crimson:8, azure:8, mint:8, gold:10, violet:12, rose:12, sunset:15, rainbow:25 }; // recolour your name
const CARD_BACKS = { default:0, pulse:8, shimmer:12, ember:15, aurora:20 };                                       // animated face-down card backs opponents see
const RENAME_COST = 20;
// every coin-priced cosmetic catalog, keyed by shop `kind`
const COSMETICS = {
  skin:  { catalog: SKINS,        owned: "skins",      equip: "cardSkin"  },
  icon:  { catalog: ICONS,        owned: "icons",      equip: "icon"      },
  color: { catalog: NAME_COLORS,  owned: "nameColors", equip: "nameColor" },
  back:  { catalog: CARD_BACKS,   owned: "cardBacks",  equip: "cardBack"  },
};
// cosmetic progression: each tier (by rating) unlocks a title. Purely visual — no gameplay effect.
const TIER_IDS = ["wood", "bronze", "silver", "gold", "platinum", "diamond", "champion"];
const TIER_MIN = [0, 900, 1050, 1200, 1350, 1500, 1700];
const TITLES = { bronze: "Kindling", silver: "Duelist", gold: "Elementalist", platinum: "Stormcaller", diamond: "Unblockable", champion: "Grandmaster" };
function tierIndex(rating) { let i = 0; for (let k = 0; k < TIER_MIN.length; k++) if (rating >= TIER_MIN[k]) i = k; return i; }

const wss = new WebSocketServer({ server });
const rooms = new Map(); // code -> { code, players:[player] }
let waiting = null;       // one socket sitting in the matchmaking queue
const randCode = () => { let s = ""; for (let i = 0; i < 4; i++) s += "ABCDEFGHJKLMNPQRSTUVWXYZ"[(Math.random() * 24) | 0]; return s; };

const send = (ws, obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
const broadcast = (room, obj) => room.players.forEach((p) => send(p.ws, obj));
function stateOf(room) {
  return room.players.map((p) => {
    const disabled = [];
    if (p.disabled && room.round != null) for (const el in p.disabled) if (p.disabled[el] >= room.round) disabled.push(el);
    return {
      name: p.name,
      hp: p.hp,
      shields: p.shields.slice(),
      disabled,                        // base elements currently disabled on this player
      title: p.title || "",
      icon: p.icon || "default",
      nameColor: p.nameColor || "default",
      back: p.cardBack || "default",
      rating: p.rating != null ? p.rating : null,
    };
  });
}
function pushState(room, log) {
  broadcast(room, { type: "state", players: stateOf(room), log });
}
function addPlayer(ws, room, name) {
  const prof = ws.playerId ? store.getProfile(ws.playerId) : null; // pull cosmetics from the saved profile (authoritative)
  const p = { ws, name: String(name || "Player").slice(0, 16), hp: START_HP, shields: [], disabled: {}, manaSpent: 0, leftover: 0, mana: 0,
    playerId: ws.playerId || null, title: prof ? (prof.title || "") : "", icon: prof ? (prof.icon || "default") : "default",
    nameColor: prof ? (prof.nameColor || "default") : "default", cardBack: prof ? (prof.cardBack || "default") : "default", rating: prof ? (prof.rating || 1000) : null };
  ws.room = room; ws.me = p;
  room.players.push(p);
  send(ws, { type: "joined", slot: room.players.length - 1, code: room.code });
  if (room.players.length === 2) {
    room.players.forEach((x) => { x.hp = START_HP; x.shields = []; x.disabled = {}; x.manaSpent = 0; x.leftover = 0; x.plan = null; x.ready = false; });
    room.round = 1;
    beginRound(room, "start");
  } else {
    send(ws, { type: "waiting" });
  }
}

function leaveRoom(ws) { // used when a socket starts a new match (rematch) or disconnects
  if (waiting && waiting.ws === ws) waiting = null;
  const room = ws.room;
  if (!room) return;
  clearTimeout(room.timer);
  if (room.bot) { rooms.delete(room.code); }
  else {
    room.players = room.players.filter((p) => p !== ws.me);
    if (room.players.length === 0) rooms.delete(room.code);
    else broadcast(room, { type: "left" });
  }
  ws.room = null; ws.me = null;
}

// --- bot: builds a plan for the round out of its AP budget (each card costs craft + deploy) ---
function botPlan(room, bot) {
  const deploys = []; let rem = bot.mana != null ? bot.mana : baseMana(room.round);
  while (true) {
    const aff = Object.keys(COST).filter((c) => COST[c] <= rem);
    if (!aff.length) break;
    const card = aff[(Math.random() * aff.length) | 0];
    rem -= COST[card];
    deploys.push({ k: ATTACKS[card] ? "attack" : TRAPS[card] ? "trap" : "shield", card });
  }
  bot.plan = { deploys }; bot.ready = true; // random-affordable, not strategic
}

// --- simultaneous resolution: both plans revealed and applied together, then the next round opens ---
function resolveRound(room) {
  clearTimeout(room.timer);
  const [A, B] = room.players;
  const slot = (p) => (p === A ? 0 : 1);
  const logs = [], events = []; // events drive the client reveal animation
  const of = (p, kind) => (p.plan && p.plan.deploys || []).filter((d) => d.k === kind);
  // tally the mana each side spent this round (for coin rewards)
  for (const p of [A, B]) {
    const dep = (p.plan && p.plan.deploys) || [];
    const spent = dep.reduce((s, d) => s + (COST[d.card] || 1), 0);
    p.manaSpent = (p.manaSpent || 0) + spent;
    // banking uses the client's reported unspent mana (which also counts crafting); bot falls back to plays-only
    const left = p.reportedLeft != null ? p.reportedLeft : ((p.mana || 0) - spent);
    p.leftover = Math.max(0, Math.min(p.mana || 0, left)); // unspent mana banks toward next round
  }
  // 1) defenses go first, so a shield played this round blocks an attack played this round; heals + restores apply now too
  for (const p of [A, B]) for (const d of of(p, "shield")) {
    const def = DEFENSE[d.card] || {};
    const ev = { t: "defense", who: slot(p), card: d.card, block: !!def.blocks, heal: 0, restore: null, restoreAll: !!def.restoreAll };
    const bits = [];
    if (def.blocks) { p.shields.push(d.card); bits.push(`raises ${d.card}`); }
    if (def.heal) { const before = p.hp; p.hp = Math.min(START_HP, p.hp + def.heal); ev.heal = p.hp - before; if (ev.heal) bits.push(`heals ${ev.heal}`); }
    if (def.restore) { if (p.disabled) delete p.disabled[def.restore]; ev.restore = def.restore; bits.push(`restores ${def.restore}`); }
    if (def.restoreAll) { p.disabled = {}; bits.push(`cleanses all`); }
    events.push(ev);
    logs.push(`🛡️ ${p.name} ${bits.join(" · ") || d.card}`);
  }
  // 2) attacks — both sides land at once (no turn order, so no first-strike edge); an unblocked hit also disables an element
  for (const [me, opp] of [[A, B], [B, A]]) for (const d of of(me, "attack")) {
    const a = ATTACKS[d.card]; if (!a) continue;
    const i = opp.shields.indexOf(a.counter);
    if (i >= 0) { opp.shields.splice(i, 1); events.push({ t: "attack", who: slot(me), card: d.card, blocked: true, dmg: a.dmg }); logs.push(`🛡️ ${opp.name} blocks ${me.name}'s ${d.card}`); }
    else {
      opp.hp = Math.max(0, opp.hp - a.dmg);
      let disable = null;
      if (a.disable) { opp.disabled = opp.disabled || {}; opp.disabled[a.disable] = room.round + DISABLE_ROUNDS; disable = a.disable; }
      events.push({ t: "attack", who: slot(me), card: d.card, blocked: false, dmg: a.dmg, disable });
      logs.push(`💥 ${me.name}'s ${d.card} hits ${opp.name} for ${a.dmg}${disable ? ` (disables ${disable})` : ""}`);
    }
  }
  // 3) traps — fire only if the opponent attacked you this round (they "walked into" it)
  for (const [me, opp] of [[A, B], [B, A]]) {
    const sprung = of(opp, "attack").length > 0;
    for (const d of of(me, "trap")) {
      const tr = TRAPS[d.card]; if (!tr) continue;
      const ev = { t: "trap", who: slot(me), card: d.card, triggered: sprung, retaliate: 0, heal: 0, disable: null };
      if (sprung) {
        if (tr.retaliate) { opp.hp = Math.max(0, opp.hp - tr.retaliate); ev.retaliate = tr.retaliate; }
        if (tr.heal) { const before = me.hp; me.hp = Math.min(START_HP, me.hp + tr.heal); ev.heal = me.hp - before; }
        if (tr.disable) { const el = tr.disable === "random" ? ["fire","water","earth","air"][(Math.random() * 4) | 0] : tr.disable; opp.disabled = opp.disabled || {}; opp.disabled[el] = room.round + DISABLE_ROUNDS; ev.disable = el; }
        logs.push(`🪤 ${me.name}'s ${d.card} trap springs on ${opp.name}!`);
      } else logs.push(`🪤 ${me.name}'s ${d.card} trap goes unsprung`);
      events.push(ev);
    }
  }
  broadcast(room, { type: "resolve", players: stateOf(room), logs, events });
  const aDead = A.hp <= 0, bDead = B.hp <= 0;
  if (aDead || bDead) {
    const draw = aDead && bDead;
    const winner = draw ? null : (aDead ? B : A);
    const loser  = draw ? null : (aDead ? A : B);
    let newRatings = null;
    if (!room.bot && winner) newRatings = applyRanked(winner, loser); // ranked = human vs human only
    const coins = winner ? awardCoins(room, winner) : null;           // coins for any win (bot matches included)
    return broadcast(room, { type: "over", winner: winner ? winner.name : null, newRatings, coins });
  }
  nextRound(room);
}
// small coin reward for a win, scaled to reward long, hard-fought grinds (server-authoritative)
function awardCoins(room, winner) {
  if (!winner.playerId) return null;                     // the bot can't earn coins
  const prof = store.getProfile(winner.playerId);
  if (!prof) return null;
  const rounds = room.round;                             // game length in turns
  const dmgTaken = START_HP - Math.max(0, winner.hp);
  const mana = winner.manaSpent || 0;
  let c = 1;                                             // base
  c += rounds >= 10 ? 3 : rounds >= 7 ? 2 : rounds >= 4 ? 1 : 0; // the longer the duel, the more
  c += dmgTaken >= 20 ? 2 : dmgTaken >= 10 ? 1 : 0;             // survived a real beating
  c += mana >= 20 ? 2 : mana >= 12 ? 1 : 0;                    // poured mana into the fight
  prof.coins = (prof.coins || 0) + c;
  store.saveProfile(prof.id, prof);
  return { id: prof.id, amount: c, total: prof.coins };
}
// ELO update + W/L for a finished ranked match; returns each player's new rating + delta
function applyRanked(winner, loser) {
  const wp = winner.playerId && store.getProfile(winner.playerId);
  const lp = loser.playerId && store.getProfile(loser.playerId);
  if (!wp || !lp) { // one side isn't a saved profile — just record the result we can
    if (wp) { wp.wins = (wp.wins || 0) + 1; store.saveProfile(wp.id, wp); }
    if (lp) { lp.losses = (lp.losses || 0) + 1; store.saveProfile(lp.id, lp); }
    return null;
  }
  const K = 32, wr = wp.rating || 1000, lr = lp.rating || 1000;
  const expWin = 1 / (1 + Math.pow(10, (lr - wr) / 400));
  const wd = Math.round(K * (1 - expWin)), ld = -Math.round(K * (1 - expWin));
  wp.rating = wr + wd; wp.wins = (wp.wins || 0) + 1;
  lp.rating = Math.max(0, lr + ld); lp.losses = (lp.losses || 0) + 1;
  wp.peak = Math.max(wp.peak || 1000, wp.rating); lp.peak = Math.max(lp.peak || 1000, lp.rating); // peak unlocks cosmetics
  store.saveProfile(wp.id, wp); store.saveProfile(lp.id, lp);
  return { [wp.id]: { rating: wp.rating, delta: wd }, [lp.id]: { rating: lp.rating, delta: ld } };
}
function nextRound(room) {
  room.players.forEach((p) => { p.plan = null; p.ready = false; });
  room.round++;
  setTimeout(() => { if (rooms.get(room.code)) beginRound(room, "round"); }, 2800); // leave room for the reveal animation
}
function beginRound(room, type) {
  const round = room.round, base = baseMana(round), cap = carryCap(round), nextCap = carryCap(round + 1);
  for (const p of room.players) {
    const carried = Math.min(p.leftover || 0, cap); // bank up to the cap; any excess is lost
    p.mana = base + carried;
    p.carriedIn = carried;
    p.leftover = 0; p.reportedLeft = null; // recomputed at resolve from whatever is left unspent
  }
  // each player gets their OWN mana budget (it depends on what they personally banked)
  for (const p of room.players) send(p.ws, { type, players: stateOf(room), round, ap: p.mana, base, carried: p.carriedIn, nextCap, seconds: ROUND_SECONDS });
  clearTimeout(room.timer);
  room.timer = setTimeout(() => forceResolve(room), (ROUND_SECONDS + 2) * 1000); // safety net if a client never answers
}
function forceResolve(room) {
  if (room.players.length < 2) return;
  room.players.forEach((p) => { if (!p.ready) { if (p.isBot) botPlan(room, p); else { p.plan = p.plan || { deploys: [] }; p.ready = true; } } });
  resolveRound(room);
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.type === "join") {
      leaveRoom(ws); // in case this is a rematch on an existing socket
      ws.playerId = m.playerId || null;
      const code = String(m.room || "MAIN").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "MAIN";
      let room = rooms.get(code);
      if (!room) { room = { code, players: [] }; rooms.set(code, room); }
      if (room.players.length >= 2) return send(ws, { type: "full" });
      addPlayer(ws, room, m.name);
      return;
    }

    if (m.type === "quickmatch") {
      leaveRoom(ws);
      ws.playerId = m.playerId || null;
      if (waiting && waiting.ws !== ws && waiting.ws.readyState === 1) {
        const room = { code: randCode(), players: [] };
        rooms.set(room.code, room);
        const other = waiting; waiting = null;
        addPlayer(other.ws, room, other.name); // pairs the two into a fresh room -> start
        addPlayer(ws, room, m.name);
      } else {
        waiting = { ws, name: m.name };
        send(ws, { type: "searching" });
      }
      return;
    }

    if (m.type === "botmatch") {
      leaveRoom(ws);
      ws.playerId = m.playerId || null;
      const room = { code: randCode(), players: [], bot: true };
      rooms.set(room.code, room);
      addPlayer(ws, room, m.name); // human = slot 0
      const bot = { ws: { readyState: 3 }, name: "⚙️ Elemental Bot", hp: START_HP, shields: [], disabled: {}, manaSpent: 0, leftover: 0, mana: 0, isBot: true };
      room.players.push(bot); // slot 1
      room.players.forEach((x) => { x.hp = START_HP; x.shields = []; x.disabled = {}; x.manaSpent = 0; x.leftover = 0; x.plan = null; x.ready = false; });
      room.round = 1;
      beginRound(room, "start");
      return;
    }

    const room = ws.room, me = ws.me;
    if (!room || !me) return;
    const opp = room.players.find((p) => p !== me);
    if (!opp || me.hp <= 0 || opp.hp <= 0) return; // match not live

    if (m.type === "field") {
      if (me.ready) return;                        // once locked in, the count is frozen
      const n = Math.max(0, Math.min(16, (m.n | 0))); // how many cards we currently have on the field
      send(opp.ws, { type: "foeField", n });        // relay the live count (backs only, never the cards)
      return;
    }

    if (m.type === "plan") {
      if (me.ready) return;                        // already locked in this round
      me.plan = { deploys: Array.isArray(m.deploys) ? m.deploys.slice(0, 16) : [] };
      me.reportedLeft = Math.max(0, m.left | 0);   // client's true unspent mana (counts crafts, not just plays)
      me.ready = true;
      // tell the opponent HOW MANY cards were committed (face-down backs) — never which cards
      send(opp.ws, { type: "oppReady", count: me.plan.deploys.length });
      if (opp.isBot) botPlan(room, opp);
      if (room.players.every((p) => p.ready)) resolveRound(room);
    }
  });

  ws.on("close", () => {
    if (waiting && waiting.ws === ws) waiting = null;
    const room = ws.room;
    if (!room) return;
    clearTimeout(room.timer);
    if (room.bot) { rooms.delete(room.code); return; } // human left a bot match; pending bot timeouts no-op
    room.players = room.players.filter((p) => p !== ws.me);
    if (room.players.length === 0) rooms.delete(room.code);
    else broadcast(room, { type: "left" });
  });
});

// bind 0.0.0.0 so hosts like Render detect the open port (default bind is IPv6-only)
store.ready.then(() => server.listen(PORT, "0.0.0.0", () => console.log(`Elemental Duel listening on 0.0.0.0:${PORT}`)));
