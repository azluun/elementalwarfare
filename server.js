// Elemental Duel — one process serves the page AND referees the match.
// Server is authoritative for HP, shields and element-locks so both players agree.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const store = require("./storage");

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, "public");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".ico": "image/x-icon" };

// --- Google Sign-In (optional): if no client id is configured, the game runs guest-only ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
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
      const { idToken, discovered, name } = JSON.parse(body || "{}");
      const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
      const p = ticket.getPayload();
      const profile = store.getProfile(p.sub) || { id: p.sub, name: "", wins: 0, losses: 0, rating: 1000, peak: 1000, title: "", discovered: [] };
      if (typeof name === "string" && name.trim()) profile.name = name.trim().slice(0, 16); // chosen at first login
      if (profile.rating == null) profile.rating = 1000;                 // backfill older profiles
      if (profile.peak == null) profile.peak = profile.rating;
      if (profile.title == null) profile.title = "";
      const merged = new Set([...(profile.discovered || []), ...(Array.isArray(discovered) ? discovered : [])]);
      profile.discovered = [...merged];
      store.saveProfile(profile.id, profile);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ profile, needsName: !profile.name, suggestedName: p.given_name || p.name || "" }));
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
      const prof = store.getProfile(ticket.getPayload().sub);
      if (!prof) throw new Error("no profile");
      const peakTier = tierIndex(prof.peak || prof.rating || 1000);
      if (title === "" || (TITLES[title] && TIER_IDS.indexOf(title) <= peakTier)) {
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

// --- HTTP: config + auth endpoints, then static files from public/ ---
const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/config") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ googleClientId: GOOGLE_CLIENT_ID })); }
  if (url === "/leaderboard") {
    const top = store.allProfiles().filter((p) => p.name)
      .sort((a, b) => (b.rating || 1000) - (a.rating || 1000)).slice(0, 20)
      .map((p) => ({ name: p.name, rating: p.rating || 1000, wins: p.wins || 0, losses: p.losses || 0 }));
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ top }));
  }
  if (url === "/auth" && req.method === "POST") return handleAuth(req, res);
  if (url === "/cosmetic" && req.method === "POST") return handleCosmetic(req, res);
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
const LOCK_ROUNDS = 1; // curse locks a base element for this many upcoming rounds
const AP_CAP = 5;
const apFor = (round) => Math.min(AP_CAP, round + 1); // mana curve: round 1 = 2 AP, +1 per round, capped
const ROUND_SECONDS = 30; // planning clock; a stalled/absent player is auto-resolved after this
const ATTACKS = { // card id -> effect
  firebolt: { dmg: 6, counter: "ward" },
  meteor:   { dmg: 12, counter: "planet" },
  storm:    { dmg: 8, counter: "mountain" },
  plague:   { dmg: 10, counter: "life" },
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
  return room.players.map((p) => ({
    name: p.name,
    hp: p.hp,
    shields: p.shields.slice(),
    lock: (p.lock && room.round != null && p.lock.round >= room.round) ? { el: p.lock.el, round: p.lock.round } : null,
    title: p.title || "",
    rating: p.rating != null ? p.rating : null,
  }));
}
function pushState(room, log) {
  broadcast(room, { type: "state", players: stateOf(room), log });
}
function addPlayer(ws, room, name) {
  const prof = ws.playerId ? store.getProfile(ws.playerId) : null; // pull cosmetics from the saved profile (authoritative)
  const p = { ws, name: String(name || "Player").slice(0, 16), hp: START_HP, shields: [], lock: null,
    playerId: ws.playerId || null, title: prof ? (prof.title || "") : "", rating: prof ? (prof.rating || 1000) : null };
  ws.room = room; ws.me = p;
  room.players.push(p);
  send(ws, { type: "joined", slot: room.players.length - 1, code: room.code });
  if (room.players.length === 2) {
    room.players.forEach((x) => { x.hp = START_HP; x.shields = []; x.lock = null; x.plan = null; x.ready = false; });
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
const BOT_COSTS = { storm: 2, ward: 2, mountain: 2, curse: 2, firebolt: 3, meteor: 3, plague: 3, planet: 3, life: 3 };
function botPlan(room, bot) {
  const deploys = []; let rem = apFor(room.round);
  while (true) {
    const aff = Object.keys(BOT_COSTS).filter((c) => BOT_COSTS[c] <= rem);
    if (!aff.length) break;
    const card = aff[(Math.random() * aff.length) | 0];
    rem -= BOT_COSTS[card];
    if (ATTACKS[card]) deploys.push({ k: "attack", card });
    else if (card === "curse") deploys.push({ k: "curse" });
    else deploys.push({ k: "shield", card });
  }
  bot.plan = { deploys }; bot.ready = true; // ponytail: random-affordable, not strategic
}

// --- simultaneous resolution: both plans revealed and applied together, then the next round opens ---
function resolveRound(room) {
  clearTimeout(room.timer);
  const [A, B] = room.players;
  const slot = (p) => (p === A ? 0 : 1);
  const logs = [], events = []; // events drive the client reveal animation
  const of = (p, kind) => (p.plan && p.plan.deploys || []).filter((d) => d.k === kind);
  // 1) shields go up first, so a shield played this round can block an attack played this round
  for (const p of [A, B]) for (const d of of(p, "shield")) { p.shields.push(d.card); events.push({ t: "shield", who: slot(p), card: d.card }); logs.push(`🛡️ ${p.name} braces ${d.card}`); }
  // 2) curses
  for (const [me, opp] of [[A, B], [B, A]]) for (const d of of(me, "curse")) {
    const el = ["fire", "water", "earth", "air"][(Math.random() * 4) | 0];
    opp.lock = { el, round: room.round + LOCK_ROUNDS }; // locked through this future round
    events.push({ t: "curse", who: slot(me), el });
    logs.push(`🌀 ${me.name} curses ${opp.name}'s ${el}`);
  }
  // 3) attacks — both sides land at once (no turn order, so no first-strike edge)
  for (const [me, opp] of [[A, B], [B, A]]) for (const d of of(me, "attack")) {
    const a = ATTACKS[d.card]; if (!a) continue;
    const i = opp.shields.indexOf(a.counter);
    if (i >= 0) { opp.shields.splice(i, 1); events.push({ t: "attack", who: slot(me), card: d.card, blocked: true, dmg: a.dmg }); logs.push(`🛡️ ${opp.name} blocks ${me.name}'s ${d.card}`); }
    else { opp.hp = Math.max(0, opp.hp - a.dmg); events.push({ t: "attack", who: slot(me), card: d.card, blocked: false, dmg: a.dmg }); logs.push(`💥 ${me.name}'s ${d.card} hits ${opp.name} for ${a.dmg}`); }
  }
  broadcast(room, { type: "resolve", players: stateOf(room), logs, events });
  const aDead = A.hp <= 0, bDead = B.hp <= 0;
  if (aDead || bDead) {
    const draw = aDead && bDead;
    const winner = draw ? null : (aDead ? B : A);
    const loser  = draw ? null : (aDead ? A : B);
    let newRatings = null;
    if (!room.bot && winner) newRatings = applyRanked(winner, loser); // ranked = human vs human only
    return broadcast(room, { type: "over", winner: winner ? winner.name : null, newRatings });
  }
  nextRound(room);
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
  broadcast(room, { type, players: stateOf(room), round: room.round, ap: apFor(room.round), seconds: ROUND_SECONDS });
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
      const bot = { ws: { readyState: 3 }, name: "⚙️ Elemental Bot", hp: START_HP, shields: [], lock: null, isBot: true };
      room.players.push(bot); // slot 1
      room.players.forEach((x) => { x.hp = START_HP; x.shields = []; x.lock = null; x.plan = null; x.ready = false; });
      room.round = 1;
      beginRound(room, "start");
      return;
    }

    const room = ws.room, me = ws.me;
    if (!room || !me) return;
    const opp = room.players.find((p) => p !== me);
    if (!opp || me.hp <= 0 || opp.hp <= 0) return; // match not live

    if (m.type === "plan") {
      if (me.ready) return;                        // already locked in this round
      me.plan = { deploys: Array.isArray(m.deploys) ? m.deploys.slice(0, 16) : [] };
      me.ready = true;
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
server.listen(PORT, "0.0.0.0", () => console.log(`Elemental Duel listening on 0.0.0.0:${PORT}`));
