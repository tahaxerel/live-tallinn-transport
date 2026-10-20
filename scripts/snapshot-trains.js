// Builds data/train-boards.json: the next ~26 h of rail departures for every Elron station,
// fetched from Transitous. The API falls back to this file when Transitous is unreachable.
// Run: node scripts/snapshot-trains.js   (a GitHub Action runs it daily)
const fs = require("fs");
const path = require("path");
const TRANSITOUS = "https://api.transitous.org/api/v1";
const UA = { "user-agent": "tallinn-live/0.1 (+https://github.com/tahaxerel/live-tallinn-transport)" };
const ids = require("../data/elron-stations.json");

async function board(name, id) {
  const q = new URLSearchParams({ stopId: id, n: "60", mode: "RAIL,REGIONAL_RAIL,REGIONAL_FAST_RAIL,LONG_DISTANCE" });
  const res = await fetch(`${TRANSITOUS}/stoptimes?${q}`, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  const j = await res.json();
  const horizon = Date.now() + 26 * 3600 * 1000;
  return (j.stopTimes || [])
    .map((x) => ({ line: x.routeShortName || "", headsign: x.headsign || "", dep: x.place.scheduledDeparture || x.place.departure || null }))
    .filter((x) => x.dep && new Date(x.dep).getTime() < horizon);
}

(async () => {
  const names = Object.keys(ids);
  const out = { generated: new Date().toISOString(), stations: {} };
  const queue = [...names];
  let failed = [];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const n = queue.shift();
      try { out.stations[n] = await board(n, ids[n]); } catch (e) { failed.push(n); }
    }
  }));
  const file = path.join(__dirname, "..", "data", "train-boards.json");
  // Keep the previous snapshot for stations that failed this time.
  try { const prev = require(file); for (const n of failed) if (prev.stations?.[n]) out.stations[n] = prev.stations[n]; } catch {}
  fs.writeFileSync(file, JSON.stringify(out));
  const total = Object.values(out.stations).reduce((a, b) => a + b.length, 0);
  console.log(`snapshot: ${Object.keys(out.stations).length} stations, ${total} departures, failed: ${failed.length ? failed.join(", ") : "none"}`);
  if (Object.keys(out.stations).length < names.length / 2) process.exit(1);
})();
