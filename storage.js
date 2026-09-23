// Player-profile persistence.
// Durable backend: Upstash Redis over REST (no dependency, just fetch) when UPSTASH_REDIS_REST_URL
// and UPSTASH_REDIS_REST_TOKEN are set — survives Render redeploys. Otherwise a local JSON file
// (fine for dev; wiped by Render's free-tier redeploys). Either way an in-memory cache serves
// getProfile/allProfiles synchronously and writes fan out to the backend.
const fs = require("fs");
const path = require("path");

const RURL = process.env.UPSTASH_REDIS_REST_URL;
const RTOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useRedis = !!(RURL && RTOKEN);

let cache = {};
let ready = Promise.resolve();
let scheduleFileWrite = () => {};

async function redis(cmd) {
  const r = await fetch(RURL, {
    method: "POST",
    headers: { Authorization: `Bearer ${RTOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

if (useRedis) {
  // load every profile into the cache once at boot (HGETALL returns [field, value, field, value, …])
  ready = (async () => {
    try {
      const arr = (await redis(["HGETALL", "profiles"])) || [];
      for (let i = 0; i < arr.length; i += 2) { try { cache[arr[i]] = JSON.parse(arr[i + 1]); } catch {} }
      console.log(`Loaded ${Object.keys(cache).length} profiles from Upstash Redis`);
    } catch (e) { console.error("Upstash load failed (starting empty):", e.message); }
  })();
} else {
  const FILE = process.env.DATA_FILE || path.join(__dirname, "data", "profiles.json");
  try { cache = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { cache = {}; }
  let t = null;
  scheduleFileWrite = () => { // debounce bursts of saves into one write
    if (t) return;
    t = setTimeout(() => {
      t = null;
      try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(cache)); }
      catch (e) { console.error("profile write failed:", e.message); }
    }, 400);
  };
}

module.exports = {
  ready,
  getProfile(id) { return cache[id] ? JSON.parse(JSON.stringify(cache[id])) : null; },
  saveProfile(id, data) {
    cache[id] = data;
    if (useRedis) redis(["HSET", "profiles", id, JSON.stringify(data)]).catch((e) => console.error("profile save failed:", e.message));
    else scheduleFileWrite();
  },
  allProfiles() { return Object.values(cache); },
};
