// Shared data layer: fetches and parses the public transport.tallinn.ee feeds.
// Used by server.js (local dev) and the Vercel functions in api/.
const FEED = "https://transport.tallinn.ee/gps.txt";
const STOPS = "https://transport.tallinn.ee/data/stops.txt";
const SIRI = "https://transport.tallinn.ee/siri-stop-departures.php";
const UA = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36 tallinn-live/0.1" };

const TYPES = { 1: "troll", 2: "bus", 3: "tram" };

function parseFeed(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const f = line.split(",");
    if (f.length < 10) continue;
    const type = TYPES[f[0]];
    if (!type) continue;
    out.push({
      id: f[6],
      type,
      line: f[1],
      lon: Number(f[2]) / 1e6,
      lat: Number(f[3]) / 1e6,
      heading: Number(f[5]),
      lowFloor: f[7] === "Z",
      dest: f[9].trim(),
    });
  }
  return out;
}

let vehCache = { at: 0, body: null };
async function getVehicles() {
  const now = Date.now();
  if (vehCache.body && now - vehCache.at < 2000) return vehCache.body;
  const res = await fetch(FEED, { headers: UA });
  if (!res.ok) throw new Error("feed " + res.status);
  const vehicles = parseFeed(await res.text());
  vehCache = { at: now, body: JSON.stringify({ at: now, vehicles }) };
  return vehCache.body;
}

// stops.txt: ';'-separated, lat/lng *1e5. Rows with an empty Name inherit the previous
// row's name/area; 5-field rows are extra platforms of the same stop.
let stopsCache = null;
async function getStops() {
  if (stopsCache) return stopsCache;
  const res = await fetch(STOPS, { headers: UA });
  if (!res.ok) throw new Error("stops " + res.status);
  const text = (await res.text()).replace(/^﻿/, "");
  const lines = text.split("\n").slice(1);
  const out = [];
  let prevName = "", prevArea = "", prevCity = "";
  for (const l of lines) {
    const f = l.split(";");
    if (f.length < 5) continue;
    const name = f[5] || prevName;
    const area = f[8] || prevArea;
    const city = f[9] || prevCity;
    prevName = name; prevArea = area; prevCity = city;
    const lat = Number(f[2]) / 1e5, lon = Number(f[3]) / 1e5;
    if (!lat || !lon) continue;
    if (!f[1]) continue; // aggregate "stop group" rows have no SiriID
    if (!/Tallinna linn/.test(area)) continue; // Tallinn city only
    out.push({ id: f[0], siri: f[1], name, lat, lon });
  }
  stopsCache = JSON.stringify({ stops: out });
  return stopsCache;
}

// SIRI departures: header "Transport,RouteNum,ExpectedTimeInSeconds,ScheduleTimeInSeconds,<nowSecOfDay>,version"
// then "stop,<siriId>" blocks followed by "type,line,expectedSec,scheduledSec,dest,secondsUntil,lowFloor".
async function getDepartures(ids) {
  const clean = String(ids || "").split(",").map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).slice(0, 12);
  if (!clean.length) return JSON.stringify({ now: 0, at: Date.now(), departures: [] });
  const url = `${SIRI}?stopid=${clean.join(",")}&time=${Math.floor(Date.now() / 1000)}`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error("siri " + res.status);
  const lines = (await res.text()).split("\n");
  const head = (lines[0] || "").split(",");
  const nowSec = Number(head[4]) || 0;
  const TYPE = { bus: "bus", trol: "troll", tram: "tram", nightbus: "bus" };
  const out = [];
  let stop = null;
  for (const l of lines.slice(1)) {
    const f = l.split(",");
    if (f[0] === "stop") { stop = f[1]; continue; }
    if (f.length < 6 || !TYPE[f[0]]) continue;
    out.push({
      stop,
      type: TYPE[f[0]],
      line: f[1],
      expected: Number(f[2]),
      scheduled: Number(f[3]),
      dest: f[4],
      inSec: Number(f[5]),
      lowFloor: f[6] === "Z",
    });
  }
  out.sort((a, b) => a.inSec - b.inSec);
  return JSON.stringify({ now: nowSec, at: Date.now(), departures: out });
}

module.exports = { getVehicles, getStops, getDepartures };
