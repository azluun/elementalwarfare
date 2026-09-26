// Elemental Duel — one process serves the page AND referees the match.
// Server is authoritative for HP, shields and element-locks so both players agree.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const store = require("./storage");

// keep the single game process alive: one bad message or rejected promise must not drop everyone's live matches
process.on("uncaughtException", (e) => console.error("uncaughtException:", (e && e.stack) || e));
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", (e && e.stack) || e));

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, "public");
// list every image in public/img (cached) so the client can preload them all on boot
let _imgManifest = null;
function imgManifest() {
  if (_imgManifest) return _imgManifest;
  try { _imgManifest = fs.readdirSync(path.join(PUB, "img")).filter((f) => /\.(png|webp|jpg|jpeg|gif|svg)$/i.test(f)); }
  catch { _imgManifest = []; }
  return _imgManifest;
}
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".ico": "image/x-icon", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif", ".json": "application/json", ".webmanifest": "application/manifest+json" };

// --- lightweight per-IP rate limiter for the write endpoints (a public URL can be hammered) ---
const postHits = new Map(); // ip -> recent timestamps
function rateLimited(req, max = 40, windowMs = 10000) {
  const ip = String(req.headers["x-forwarded-for"] || (req.socket && req.socket.remoteAddress) || "?").split(",")[0].trim();
  const now = Date.now();
  let arr = postHits.get(ip); if (!arr) { arr = []; postHits.set(ip, arr); }
  while (arr.length && now - arr[0] > windowMs) arr.shift();
  if (arr.length >= max) return true;
  arr.push(now);
  if (postHits.size > 5000) for (const [k, v] of postHits) if (!v.length || now - v[v.length - 1] > windowMs) postHits.delete(k); // prune stale IPs
  return false;
}
// --- presence: clients heartbeat via /stats so the menu can show a live "online" count ---
const presence = new Map(); // clientId -> lastSeen ms
function prunePresence(now) { for (const [k, t] of presence) if (now - t > 20000) presence.delete(k); }

// --- Google Sign-In (optional): if no client id is configured, the game runs guest-only ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const DEV_EMAILS = new Set((process.env.DEV_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)); // accounts that can equip the secret "Developer" title
let googleClient = null;
if (GOOGLE_CLIENT_ID) {
  try { const { OAuth2Client } = require("google-auth-library"); googleClient = new OAuth2Client(GOOGLE_CLIENT_ID); }
  catch (e) { console.error("google-auth-library not installed; sign-in disabled:", e.message); }
}
// Verify a Google ID token, returning its payload. Auth failures (missing/expired/invalid token, or
// sign-in not configured) are tagged status 401 so handlers can tell them apart from business errors
// (e.g. "not enough coins"), letting the client silently refresh the token and retry.
async function verifyToken(idToken) {
  if (!googleClient) { const e = new Error("sign-in not configured"); e.status = 401; throw e; }
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    return ticket.getPayload();
  } catch (e) { e.status = 401; throw e; }
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
      const { idToken, title } = JSON.parse(body || "{}");
      const payload = await verifyToken(idToken);
      const prof = await store.getProfileAsync(payload.sub);
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
      res.writeHead(e.status || 400, { "content-type": "application/json" });
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
      const { idToken, action, kind, item, skin, icon, name } = JSON.parse(body || "{}");
      const payload = await verifyToken(idToken);
      const prof = await store.getProfileAsync(payload.sub);
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
      res.writeHead(e.status || 400, { "content-type": "application/json" });
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
      const { idToken, action, id, profile } = JSON.parse(body || "{}");
      const payload = await verifyToken(idToken);
      const email = (payload.email || "").toLowerCase();
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
      res.writeHead(e.message === "not authorized" ? 403 : (e.status || 400), { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// --- HTTP: config + auth endpoints, then static files from public/ ---
const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/config") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ googleClientId: GOOGLE_CLIENT_ID, storage: store.mode, profiles: store.count() })); }
  if (url === "/manifest") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" }); return res.end(JSON.stringify({ img: imgManifest() })); }
  if (url === "/stats") { // heartbeat + live counts for the menu's "online" badge
    const c = new URLSearchParams(req.url.split("?")[1] || "").get("c");
    const now = Date.now();
    if (c) presence.set(String(c).slice(0, 40), now);
    prunePresence(now);
    let inGame = 0; for (const r of rooms.values()) inGame += (r.players || []).filter((p) => !p.isBot).length;
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" });
    return res.end(JSON.stringify({ online: presence.size, searching: waiting ? 1 : 0, inGame }));
  }
  if (req.method === "POST" && (url === "/auth" || url === "/cosmetic" || url === "/shop" || url === "/admin") && rateLimited(req)) {
    res.writeHead(429, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "rate limited — slow down" }));
  }
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
// See DESIGN.md for the full system. THE LAW OF ELEMENTS decides a card's type by its recipe shape:
//   X+X = Defense · X+Y = Attack · X+X+X = Landscape · X+X+Y = Spell · X+Y+Z = Trap.
const START_HP = 30;
// mana economy: base mana grows +1 every 2 rounds. On EVEN rounds you may carry exactly ONE
// unspent mana over from the previous (odd) round; on ODD rounds nothing carries and base
// "catches up" to the max. So max = base on odd rounds, base+1 on even rounds.
const baseMana = (round) => 2 + Math.floor((round - 1) / 2); // 2,2,3,3,4,4,5,5,6,6…
const carryCap = (round) => (round % 2 === 0 ? 1 : 0);       // carry 1 mana, and only INTO an even round
const ROUND_SECONDS = 30; // planning clock; a stalled/absent player is auto-resolved after this
const DEF_MANA_ON_BLOCK = 2; // one-shot, non-compounding ramp: a defense that BLOCKS charges the defender

// every card's base-element composition — the single source of truth for blocking, terrain, and empower.
const ELEM = {
  // attacks (two distinct elements)
  scald: ["fire","water"], storm: ["water","air"], sandstorm: ["earth","air"],
  mudslide: ["water","earth"], wildfire: ["fire","air"], meteor: ["fire","earth"],
  // defenses (a matching pair → one element)
  firewall: ["fire"], ward: ["water"], bulwark: ["earth"], galebarrier: ["air"],
  // landscapes (a pure triple → one element)
  volcano: ["fire"], ocean: ["water"], highlands: ["earth"], tempest: ["air"],
  // spells (a pair + a catalyst; tag = the doubled element)
  renewal: ["water"], ember: ["fire"], tide: ["water"], stone: ["earth"], wind: ["air"], siphon: ["fire"],
  // traps (three different elements)
  riptide: ["water","earth","air"], backdraft: ["fire","earth","air"],
  tempestsnare: ["fire","water","air"], quicksand: ["fire","water","earth"],
};
// attacks: pure damage. A defense sharing EITHER element blocks it (see resolveRound). Two cost tiers.
const ATTACKS = {
  scald:    { dmg: 6 }, storm:   { dmg: 6 }, sandstorm: { dmg: 6 },  // cheap (cost 2)
  mudslide: { dmg: 7 }, wildfire:{ dmg: 7 }, meteor:    { dmg: 9 },  // expensive (cost 3)
};
// defenses: block any attack sharing their element; on a successful block the defender gets a mana burst. No heal.
const DEFENSE = { firewall: {}, ward: {}, bulwark: {}, galebarrier: {} };
// spells: resolve instantly and do NOT persist. heal, empower (next attack of an element +amt), or mana burn.
const SPELLS = {
  renewal: { heal: 6 },
  ember:   { empower: "fire",  amt: 2 },
  tide:    { empower: "water", amt: 2 },
  stone:   { empower: "earth", amt: 2 },
  wind:    { empower: "air",   amt: 2 },
  siphon:  { burn: 2 },
};
// landscapes: one shared terrain slot; +1 to ALL damage of its element (both players). Persists until replaced.
const LANDSCAPES = { volcano: "fire", ocean: "water", highlands: "earth", tempest: "air" };
// traps: conditional — a set trap springs only when its condition is met this round.
//   expensiveAttack: opp played a cost-3 attack · oppHealed: opp gained HP · lowHp: my HP < LOW_HP · oppRich: opp banked >= RICH mana
const TRAPS = {
  riptide:      { retaliate: 5, cond: "expensiveAttack" },
  backdraft:    { retaliate: 6, cond: "oppHealed" },
  tempestsnare: { retaliate: 6, cond: "lowHp" },
  quicksand:    { retaliate: 3, burn: 2, cond: "oppRich" },
};
const LOW_HP = 12, RICH = 3;
// total mana (craft + play) each card costs — cheap (2) vs expensive (3)
const COST = {
  scald:2, storm:2, sandstorm:2, mudslide:3, wildfire:3, meteor:3,
  firewall:2, ward:2, bulwark:2, galebarrier:2,
  renewal:3, ember:2, tide:2, stone:2, wind:2, siphon:3,
  volcano:3, ocean:3, highlands:3, tempest:3,
  riptide:3, backdraft:3, tempestsnare:3, quicksand:3,
};
// id -> gameplay kind, so the bot and relays can classify any card
const KINDOF = {};
for (const k in ATTACKS)    KINDOF[k] = "attack";
for (const k in DEFENSE)    KINDOF[k] = "shield";
for (const k in SPELLS)     KINDOF[k] = "spell";
for (const k in LANDSCAPES) KINDOF[k] = "landscape";
for (const k in TRAPS)      KINDOF[k] = "trap";
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
      skin: p.cardSkin || "default",    // card-background skin, so the reveal showcase can use the owner's skin
      traps: p.traps ? p.traps.slice() : [], // set traps that persist until they spring (foe's shown anonymously)
      empower: Object.assign({}, p.empower || {}), // pending "next X attack +N" buffs (own display)
      rating: p.rating != null ? p.rating : null,
    };
  }).map((s, i) => (s.landscape = room.landscape || null, s.landscapeCard = room.landscapeCard || null, s));
}
function pushState(room, log) {
  broadcast(room, { type: "state", players: stateOf(room), log });
}
function addPlayer(ws, room, name) {
  const prof = ws.playerId ? store.getProfile(ws.playerId) : null; // pull cosmetics from the saved profile (authoritative)
  const p = { ws, name: String(name || "Player").slice(0, 16), hp: START_HP, shields: [], traps: [], empower: {}, disabled: {}, manaSpent: 0, leftover: 0, mana: 0,
    playerId: ws.playerId || null, title: prof ? (prof.title || "") : "", icon: prof ? (prof.icon || "default") : "default",
    nameColor: prof ? (prof.nameColor || "default") : "default", cardBack: prof ? (prof.cardBack || "default") : "default",
    cardSkin: prof ? (prof.cardSkin || "default") : "default", rating: prof ? (prof.rating || 1000) : null };
  ws.room = room; ws.me = p;
  room.players.push(p);
  send(ws, { type: "joined", slot: room.players.length - 1, code: room.code });
  if (room.players.length === 2) {
    room.players.forEach((x) => { x.hp = START_HP; x.shields = []; x.traps = []; x.empower = {}; x.disabled = {}; x.manaSpent = 0; x.leftover = 0; x.plan = null; x.ready = false; });
    room.landscape = null; room.landscapeCard = null;
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
  let traps = 0, lands = 0;
  while (true) {
    let aff = Object.keys(COST).filter((c) => COST[c] <= rem);
    if (traps >= 1) aff = aff.filter((c) => KINDOF[c] !== "trap");         // cap one trap per turn (matches the rule)
    if (lands >= 1) aff = aff.filter((c) => KINDOF[c] !== "landscape");    // no point stacking terrain in one turn
    if (!aff.length) break;
    const card = aff[(Math.random() * aff.length) | 0];
    rem -= COST[card];
    const k = KINDOF[card] || "attack";
    if (k === "trap") traps++; if (k === "landscape") lands++;
    deploys.push({ k, card });
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
  for (const p of [A, B]) { p.healedThisRound = false; p.empower = p.empower || {}; }
  // 1) defenses raise their shields (they now do nothing on their own — they pay off by BLOCKING, phase 3)
  for (const p of [A, B]) for (const d of of(p, "shield")) {
    if (!DEFENSE[d.card]) continue;
    p.shields.push(d.card);
    events.push({ t: "defense", who: slot(p), card: d.card });
    logs.push(`🛡️ ${p.name} raises ${d.card}`);
  }
  // 2) spells + landscapes resolve instantly (before attacks, so a rite/terrain buffs this round's attack too)
  for (const p of [A, B]) {
    for (const d of of(p, "spell")) {
      const sp = SPELLS[d.card]; if (!sp) continue;
      const opp = p === A ? B : A;
      const ev = { t: "spell", who: slot(p), card: d.card, heal: 0, empower: null, amt: 0, burn: 0 };
      if (sp.heal) { const before = p.hp; p.hp = Math.min(START_HP, p.hp + sp.heal); ev.heal = p.hp - before; if (ev.heal) p.healedThisRound = true; }
      if (sp.empower) { p.empower[sp.empower] = (p.empower[sp.empower] || 0) + sp.amt; ev.empower = sp.empower; ev.amt = sp.amt; }
      if (sp.burn) { opp.manaBonus = (opp.manaBonus || 0) - sp.burn; ev.burn = sp.burn; }
      events.push(ev);
      logs.push(`✨ ${p.name} casts ${d.card}`);
    }
    for (const d of of(p, "landscape")) {
      const el = LANDSCAPES[d.card]; if (!el) continue;
      room.landscape = el; room.landscapeCard = d.card; // one shared slot; a new terrain replaces the old
      events.push({ t: "landscape", who: slot(p), card: d.card, element: el });
      logs.push(`🟣 ${p.name} shapes the field → ${d.card}`);
    }
  }
  // 3) attacks — both land at once. A defense sharing EITHER element blocks (consumed) and charges the defender.
  //    Damage = base + terrain(+1 if landscape matches an element) + empower(one-shot "next X attack" buffs).
  for (const [me, opp] of [[A, B], [B, A]]) for (const d of of(me, "attack")) {
    const a = ATTACKS[d.card]; if (!a) continue;
    const els = ELEM[d.card] || [];
    const bi = opp.shields.findIndex((s) => els.includes((ELEM[s] || [])[0])); // shield element matches an attack element
    if (bi >= 0) {
      const by = opp.shields[bi];
      opp.shields.splice(bi, 1);
      opp.manaBonus = (opp.manaBonus || 0) + DEF_MANA_ON_BLOCK; // one-shot defensive ramp
      events.push({ t: "attack", who: slot(me), card: d.card, blocked: true, dmg: a.dmg, mana: DEF_MANA_ON_BLOCK, by });
      logs.push(`🛡️ ${opp.name} blocks ${me.name}'s ${d.card} (+${DEF_MANA_ON_BLOCK} mana)`);
      continue;
    }
    const land = (room.landscape && els.includes(room.landscape)) ? 1 : 0;
    let emp = 0; for (const e of els) if (me.empower[e]) { emp += me.empower[e]; delete me.empower[e]; } // consume matching buffs
    const dmg = a.dmg + land + emp;
    opp.hp = Math.max(0, opp.hp - dmg);
    events.push({ t: "attack", who: slot(me), card: d.card, blocked: false, dmg, land: !!land, emp });
    logs.push(`💥 ${me.name}'s ${d.card} hits ${opp.name} for ${dmg}${land ? " (+terrain)" : ""}${emp ? ` (+${emp} rite)` : ""}`);
  }
  // 4) traps — set traps persist face-down until their CONDITION is met, then spring. One new trap may be set per round.
  for (const p of [A, B]) for (const d of of(p, "trap").slice(0, 1)) if (TRAPS[d.card]) p.traps.push(d.card);
  for (const [me, opp] of [[A, B], [B, A]]) {
    const oppAttacks = of(opp, "attack");
    const met = {
      expensiveAttack: oppAttacks.some((d) => (COST[d.card] || 0) >= 3),
      oppHealed: !!opp.healedThisRound,
      lowHp: me.hp < LOW_HP,
      oppRich: (me === A ? A : B) && (opp.reportedLeft != null ? opp.reportedLeft : opp.leftover || 0) >= RICH,
    };
    me.traps = me.traps.filter((card) => {
      const tr = TRAPS[card]; if (!tr) return false;
      if (!met[tr.cond]) return true; // condition unmet — stays set on the board
      const ev = { t: "trap", who: slot(me), card, triggered: true, retaliate: 0, burn: 0, cond: tr.cond };
      if (tr.retaliate) { opp.hp = Math.max(0, opp.hp - tr.retaliate); ev.retaliate = tr.retaliate; }
      if (tr.burn) { opp.manaBonus = (opp.manaBonus || 0) - tr.burn; ev.burn = tr.burn; }
      events.push(ev);
      logs.push(`🪤 ${me.name}'s ${card} springs on ${opp.name}!`);
      return false; // consumed
    });
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
    const bonus = p.manaBonus || 0;                 // defensive-block ramp (+) or siphon burn (−) from last round
    p.mana = Math.max(0, base + carried + bonus);   // siphon can drive the bonus negative; never below 0
    p.carriedIn = carried; p.bonusIn = bonus; p.manaBonus = 0;
    p.leftover = 0; p.reportedLeft = null; // recomputed at resolve from whatever is left unspent
  }
  // each player gets their OWN mana budget (it depends on what they personally banked)
  for (const p of room.players) send(p.ws, { type, players: stateOf(room), round, ap: p.mana, base, carried: p.carriedIn, bonus: p.bonusIn || 0, nextCap, seconds: ROUND_SECONDS });
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
    const now = Date.now();                         // per-socket flood guard: drop anything past ~60 msgs / 2s
    ws._mt = ws._mt || []; ws._mt.push(now);
    while (ws._mt.length && now - ws._mt[0] > 2000) ws._mt.shift();
    if (ws._mt.length > 60) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    try {  // one malformed/unexpected message must never take the server (and everyone's matches) down

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
      const bot = { ws: { readyState: 3 }, name: "⚙️ Elemental Bot", hp: START_HP, shields: [], traps: [], empower: {}, disabled: {}, manaSpent: 0, leftover: 0, mana: 0, isBot: true };
      room.players.push(bot); // slot 1
      room.players.forEach((x) => { x.hp = START_HP; x.shields = []; x.traps = []; x.empower = {}; x.disabled = {}; x.manaSpent = 0; x.leftover = 0; x.plan = null; x.ready = false; });
      room.landscape = null; room.landscapeCard = null;
      room.round = 1;
      beginRound(room, "start");
      return;
    }

    const room = ws.room, me = ws.me;
    if (!room || !me) return;
    const opp = room.players.find((p) => p !== me);
    if (!opp || me.hp <= 0 || opp.hp <= 0) return; // match not live

    if (m.type === "field") {
      if (me.ready) return;                        // once locked in, the set is frozen
      const KIND = (k) => (k === "attack" || k === "shield" || k === "trap" || k === "spell" || k === "landscape") ? k : "attack";
      const kinds = Array.isArray(m.kinds) ? m.kinds.slice(0, 16).map(KIND) : []; // per-card KIND only — never the card itself
      send(opp.ws, { type: "foeField", kinds });   // opponent sees oriented face-down backs (shields sideways), never identities
      return;
    }

    if (m.type === "forfeit") {                    // concede a live match — you fall, opponent stands
      me.hp = 0;
      clearTimeout(room.timer);
      const winner = opp, loser = me;
      const newRatings = room.bot ? null : applyRanked(winner, loser); // ranked = human vs human only
      const coins = winner.isBot ? null : awardCoins(room, winner);    // bot can't earn; a human opponent does
      broadcast(room, { type: "over", winner: winner.name, newRatings, coins, forfeit: true });
      return;
    }

    if (m.type === "unready") {                    // retract a lock-in while the round is still open
      if (!me.ready) return;                       // (if both had readied, the round would already have resolved)
      me.ready = false; me.plan = null; me.reportedLeft = null;
      send(opp.ws, { type: "foeField", kinds: [] }); // clear the opponent's "locked in" indicator
      send(ws, { type: "unreadyOk" });
      return;
    }

    if (m.type === "plan") {
      if (me.ready) return;                        // already locked in this round
      // validate the plan: only real cards, whose declared kind matches the card, and never more cards than your AP
      const raw = Array.isArray(m.deploys) ? m.deploys : [];
      const valid = raw.filter((d) => d && typeof d.card === "string" && KINDOF[d.card] && d.k === KINDOF[d.card]);
      const cap = Math.max(0, Math.min(16, me.mana || 0)); // each play costs >=1 AP, so plays can't exceed the round's mana
      me.plan = { deploys: valid.slice(0, cap) };
      me.reportedLeft = Math.max(0, Math.min(me.mana || 0, m.left | 0)); // clamp banked mana to what you actually had
      me.ready = true;
      // tell the opponent the KIND of each committed card (for orientation) — never which card
      const KIND = (k) => (k === "attack" || k === "shield" || k === "trap" || k === "spell" || k === "landscape") ? k : "attack";
      const kinds = me.plan.deploys.map((d) => KIND(d.k));
      send(opp.ws, { type: "oppReady", count: kinds.length, kinds });
      if (opp.isBot) botPlan(room, opp);
      if (room.players.every((p) => p.ready)) resolveRound(room);
    }
    } catch (err) { console.error("ws message handler error:", (err && err.stack) || err); }
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
