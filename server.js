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
    room.players.forEach((x) => { x.hp = START_HP; x.shields = []; x.lock = null; });
    broadcast(room, { type: "start", players: stateOf(room) });
  } else {
    send(ws, { type: "waiting" });
  }
}

// --- combat actions, shared by the ws message handler and the bot driver ---
function resolveAttack(room, me, cardId) {
  const a = ATTACKS[cardId];
  const opp = room.players.find((p) => p !== me);
  if (!a || !opp || me.hp <= 0 || opp.hp <= 0) return;
  const i = opp.shields.indexOf(a.counter);
  let log;
  if (i >= 0) { opp.shields.splice(i, 1); log = `🛡️ ${opp.name} blocked ${me.name}'s ${cardId}!`; }
  else { opp.hp = Math.max(0, opp.hp - a.dmg); log = `💥 ${me.name}'s ${cardId} hit ${opp.name} for ${a.dmg}`; }
  pushState(room, log);
  if (opp.hp <= 0) { broadcast(room, { type: "over", winner: me.name }); stopBot(room); }
}
function resolveShield(room, me, cardId) {
  if (me.hp <= 0) return;
  me.shields.push(cardId);
  pushState(room, `${me.name} raised a shield`);
}
function resolveCurse(room, me) {
  const opp = room.players.find((p) => p !== me);
  if (!opp || me.hp <= 0 || opp.hp <= 0) return;
  const el = ["fire", "water", "earth", "air"][(Math.random() * 4) | 0];
  opp.lock = { el, until: Date.now() + LOCK_MS };
  pushState(room, `🌀 ${me.name} cursed ${opp.name}'s ${el}!`);
}

// --- AI bot: a server-driven "player" that acts on a timer (fills the queue, tests balance) ---
const BOT_SHIELDS = ["ward", "mountain", "planet", "life"];
const BOT_ATTACKS = ["firebolt", "storm", "firebolt", "storm", "plague", "meteor"]; // weighted toward cheap ones
function startBot(room, bot) {
  room.botTimer = setInterval(() => {
    const human = room.players.find((p) => p !== bot);
    if (!human || bot.hp <= 0 || human.hp <= 0) return stopBot(room);
    const r = Math.random();
    if (r < 0.30) resolveShield(room, bot, BOT_SHIELDS[(Math.random() * BOT_SHIELDS.length) | 0]);
    else if (r < 0.42) resolveCurse(room, bot);
    else resolveAttack(room, bot, BOT_ATTACKS[(Math.random() * BOT_ATTACKS.length) | 0]);
  }, 2400); // ponytail: fixed cadence offsets the bot's zero craft-cost; lower it for a harder bot, raise for easier
}
function stopBot(room) { if (room.botTimer) { clearInterval(room.botTimer); room.botTimer = null; } }

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
      room.players.forEach((x) => { x.hp = START_HP; x.shields = []; x.lock = null; });
      broadcast(room, { type: "start", players: stateOf(room) });
      startBot(room, bot);
      return;
    }

    const room = ws.room, me = ws.me;
    if (!room || !me) return;
    const opp = room.players.find((p) => p !== me);
    if (!opp || me.hp <= 0 || opp.hp <= 0) return; // match not live

    if (m.type === "shield") return resolveShield(room, me, m.card);
    if (m.type === "attack") return resolveAttack(room, me, m.card);
    if (m.type === "curse")  return resolveCurse(room, me);
  });

  ws.on("close", () => {
    if (waiting && waiting.ws === ws) waiting = null;
    const room = ws.room;
    if (!room) return;
    if (room.bot) { stopBot(room); rooms.delete(room.code); return; } // human left a bot match
    room.players = room.players.filter((p) => p !== ws.me);
    if (room.players.length === 0) rooms.delete(room.code);
    else broadcast(room, { type: "left" });
  });
});

// bind 0.0.0.0 so hosts like Render detect the open port (default bind is IPv6-only)
server.listen(PORT, "0.0.0.0", () => console.log(`Elemental Duel listening on 0.0.0.0:${PORT}`));
