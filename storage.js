// Player-profile persistence.
// JSON-file implementation for now. The whole rest of the app only touches
// getProfile / saveProfile / allProfiles — swap this file's body for Redis or
// Postgres later (durable across Render redeploys) and nothing else changes.
const fs = require("fs");
const path = require("path");

const FILE = process.env.DATA_FILE || path.join(__dirname, "data", "profiles.json");
let cache = {};
try { cache = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { cache = {}; }

let writeTimer = null;
function scheduleWrite() {
  if (writeTimer) return; // debounce bursts of saves into one write
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(cache));
    } catch (e) { console.error("profile write failed:", e.message); }
  }, 400);
}

module.exports = {
  getProfile(id) { return cache[id] ? JSON.parse(JSON.stringify(cache[id])) : null; },
  saveProfile(id, data) { cache[id] = data; scheduleWrite(); },
  allProfiles() { return Object.values(cache); },
};
// ponytail: file store is wiped by Render's free-tier redeploys; swap for a managed DB when stats must survive deploys
