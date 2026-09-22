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

    const room = ws.room, me = ws.me;
    if (!room || !me) return;
    const opp = room.players.find((p) => p !== me);
    if (!opp || me.hp <= 0 || opp.hp <= 0) return; // match not live

    if (m.type === "shield") {
      me.shields.push(m.card);
      return pushState(room, `${me.name} raised a shield`);
    }

    if (m.type === "attack") {
      const a = ATTACKS[m.card];
      if (!a) return;
      const i = opp.shields.indexOf(a.counter);
      let log;
      if (i >= 0) {
        opp.shields.splice(i, 1);
        log = `🛡️ ${opp.name} blocked ${me.name}'s ${m.card}!`;
      } else {
        opp.hp = Math.max(0, opp.hp - a.dmg);
        log = `💥 ${me.name}'s ${m.card} hit ${opp.name} for ${a.dmg}`;
      }
      pushState(room, log);
      if (opp.hp <= 0) broadcast(room, { type: "over", winner: me.name });
      return;
    }

    if (m.type === "curse") {
      const bases = ["fire", "water", "earth", "air"];
      const el = bases[(Math.random() * 4) | 0];
      opp.lock = { el, until: Date.now() + LOCK_MS };
      return pushState(room, `🌀 ${me.name} cursed ${opp.name}'s ${el}!`);
    }
  });

  ws.on("close", () => {
    if (waiting && waiting.ws === ws) waiting = null;
    const room = ws.room;
    if (!room) return;
    room.players = room.players.filter((p) => p !== ws.me);
    if (room.players.length === 0) rooms.delete(room.code);
    else broadcast(room, { type: "left" });
  });
});

server.listen(PORT, () => console.log(`\n  Elemental Duel running:  http://localhost:${PORT}\n`));
