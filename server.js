// Elemental Duel — one process serves the page AND referees the match.
// Server is authoritative for HP, shields and element-locks so both players agree.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, "public");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".ico": "image/x-icon" };

// --- static file server (public/ only) ---
const server = http.createServer((req, res) => {
  let f = decodeURIComponent(req.url.split("?")[0]);
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
const LOCK_MS = 6000;
const AP_CAP = 5;
const apFor = (round) => Math.min(AP_CAP, round + 1); // mana curve: round 1 = 2 AP, +1 per round, capped
const ATTACKS = { // card id -> effect
  firebolt: { dmg: 6, counter: "ward" },
  meteor:   { dmg: 12, counter: "planet" },
  storm:    { dmg: 8, counter: "mountain" },
  plague:   { dmg: 10, counter: "life" },
};

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
    lock: p.lock && p.lock.until > Date.now() ? p.lock : null,
  }));
}
function pushState(room, log) {
  broadcast(room, { type: "state", players: stateOf(room), log });
}
function addPlayer(ws, room, name) {
  const p = { ws, name: String(name || "Player").slice(0, 16), hp: START_HP, shields: [], lock: null };
  ws.room = room; ws.me = p;
  room.players.push(p);
  send(ws, { type: "joined", slot: room.players.length - 1, code: room.code });
  if (room.players.length === 2) {
    room.players.forEach((x) => { x.hp = START_HP; x.shields = []; x.lock = null; x.plan = null; x.ready = false; });
    room.round = 1;
    broadcast(room, { type: "start", players: stateOf(room), round: room.round, ap: apFor(room.round) });
  } else {
    send(ws, { type: "waiting" });
  }
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
  const [A, B] = room.players;
  const logs = [];
  const of = (p, kind) => (p.plan && p.plan.deploys || []).filter((d) => d.k === kind);
  // 1) shields go up first, so a shield played this round can block an attack played this round
  for (const p of [A, B]) for (const d of of(p, "shield")) { p.shields.push(d.card); logs.push(`🛡️ ${p.name} braces ${d.card}`); }
  // 2) curses
  for (const [me, opp] of [[A, B], [B, A]]) for (const d of of(me, "curse")) {
    const el = ["fire", "water", "earth", "air"][(Math.random() * 4) | 0];
    opp.lock = { el, until: Date.now() + LOCK_MS };
    logs.push(`🌀 ${me.name} curses ${opp.name}'s ${el}`);
  }
  // 3) attacks — both sides land at once (no turn order, so no first-strike edge)
  for (const [me, opp] of [[A, B], [B, A]]) for (const d of of(me, "attack")) {
    const a = ATTACKS[d.card]; if (!a) continue;
    const i = opp.shields.indexOf(a.counter);
    if (i >= 0) { opp.shields.splice(i, 1); logs.push(`🛡️ ${opp.name} blocks ${me.name}'s ${d.card}`); }
    else { opp.hp = Math.max(0, opp.hp - a.dmg); logs.push(`💥 ${me.name}'s ${d.card} hits ${opp.name} for ${a.dmg}`); }
  }
  broadcast(room, { type: "resolve", players: stateOf(room), logs });
  const aDead = A.hp <= 0, bDead = B.hp <= 0;
  if (aDead || bDead) return broadcast(room, { type: "over", winner: aDead && bDead ? null : (aDead ? B.name : A.name) });
  nextRound(room);
}
function nextRound(room) {
  room.players.forEach((p) => { p.plan = null; p.ready = false; });
  room.round++;
  setTimeout(() => { if (rooms.get(room.code)) broadcast(room, { type: "round", players: stateOf(room), round: room.round, ap: apFor(room.round) }); }, 1600);
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.type === "join") {
      const code = String(m.room || "MAIN").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "MAIN";
      let room = rooms.get(code);
      if (!room) { room = { code, players: [] }; rooms.set(code, room); }
      if (room.players.length >= 2) return send(ws, { type: "full" });
      addPlayer(ws, room, m.name);
      return;
    }

    if (m.type === "quickmatch") {
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
      const room = { code: randCode(), players: [], bot: true };
      rooms.set(room.code, room);
      addPlayer(ws, room, m.name); // human = slot 0
      const bot = { ws: { readyState: 3 }, name: "⚙️ Elemental Bot", hp: START_HP, shields: [], lock: null, isBot: true };
      room.players.push(bot); // slot 1
      room.players.forEach((x) => { x.hp = START_HP; x.shields = []; x.lock = null; x.plan = null; x.ready = false; });
      room.round = 1;
      broadcast(room, { type: "start", players: stateOf(room), round: room.round, ap: apFor(room.round) });
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
    if (room.bot) { rooms.delete(room.code); return; } // human left a bot match; pending bot timeouts no-op
    room.players = room.players.filter((p) => p !== ws.me);
    if (room.players.length === 0) rooms.delete(room.code);
    else broadcast(room, { type: "left" });
  });
});

// bind 0.0.0.0 so hosts like Render detect the open port (default bind is IPv6-only)
server.listen(PORT, "0.0.0.0", () => console.log(`Elemental Duel listening on 0.0.0.0:${PORT}`));
