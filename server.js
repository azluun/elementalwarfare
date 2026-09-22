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
const TURN_AP = 3; // action points per turn: craft = 1, deploy = 1
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
  broadcast(room, { type: "state", players: stateOf(room), turn: room.turn, ap: room.ap, log });
}
function addPlayer(ws, room, name) {
  const p = { ws, name: String(name || "Player").slice(0, 16), hp: START_HP, shields: [], lock: null };
  ws.room = room; ws.me = p;
  room.players.push(p);
  send(ws, { type: "joined", slot: room.players.length - 1, code: room.code });
  if (room.players.length === 2) {
    room.players.forEach((x) => { x.hp = START_HP; x.shields = []; x.lock = null; });
    room.turn = 0; room.ap = TURN_AP;
    broadcast(room, { type: "start", players: stateOf(room), turn: room.turn, ap: room.ap });
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
  if (opp.hp <= 0) broadcast(room, { type: "over", winner: me.name });
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

// --- turns: server owns whose turn it is and how many action points remain ---
function endTurn(room) {
  if (room.players.length < 2) return;
  if (!room.players.every((p) => p.hp > 0)) return; // match already decided
  room.turn = 1 - room.turn;
  room.ap = TURN_AP;
  pushState(room, `— ${room.players[room.turn].name}'s turn —`);
  const cur = room.players[room.turn];
  if (cur.isBot) botTurn(room, cur);
}

// --- AI bot: plays out its own 3-AP turn. Each card "costs" what a human pays to craft + deploy it. ---
const BOT_COSTS = { storm: 2, ward: 2, mountain: 2, curse: 2, firebolt: 3, meteor: 3, plague: 3, planet: 3, life: 3 };
function botTurn(room, bot) {
  let ap = TURN_AP;
  const step = () => {
    const human = room.players.find((p) => p !== bot);
    if (!human || bot.hp <= 0 || human.hp <= 0) return;         // match over
    const affordable = Object.keys(BOT_COSTS).filter((c) => BOT_COSTS[c] <= ap);
    if (!affordable.length) return endTurn(room);
    const card = affordable[(Math.random() * affordable.length) | 0];
    ap -= BOT_COSTS[card];
    if (ATTACKS[card]) resolveAttack(room, bot, card);
    else if (card === "curse") resolveCurse(room, bot);
    else resolveShield(room, bot, card);                        // ward / mountain / planet / life
    if (bot.hp <= 0 || human.hp <= 0) return;
    setTimeout(step, 700); // ponytail: pauses so the human can read each bot move; picks are random-affordable, not strategic
  };
  setTimeout(step, 700);
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
      room.players.forEach((x) => { x.hp = START_HP; x.shields = []; x.lock = null; });
      room.turn = 0; room.ap = TURN_AP; // human (slot 0) goes first
      broadcast(room, { type: "start", players: stateOf(room), turn: room.turn, ap: room.ap });
      return;
    }

    const room = ws.room, me = ws.me;
    if (!room || !me) return;
    const opp = room.players.find((p) => p !== me);
    if (!opp || me.hp <= 0 || opp.hp <= 0) return;     // match not live
    if (room.turn !== room.players.indexOf(me)) return; // not your turn

    if (m.type === "endturn") return endTurn(room);
    if (room.ap <= 0) return;                            // out of action points
    if (m.type === "craft")  { room.ap--; pushState(room, null); if (room.ap <= 0) endTurn(room); return; }
    if (m.type === "shield") { room.ap--; resolveShield(room, me, m.card); if (room.ap <= 0) endTurn(room); return; }
    if (m.type === "attack") { room.ap--; resolveAttack(room, me, m.card); if (room.ap <= 0) endTurn(room); return; }
    if (m.type === "curse")  { room.ap--; resolveCurse(room, me);          if (room.ap <= 0) endTurn(room); return; }
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
