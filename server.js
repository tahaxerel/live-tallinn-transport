// Tallinn Live — tiny zero-dependency server.
// Serves ./public and proxies transport.tallinn.ee/gps.txt as JSON (the feed has no CORS).
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 5180;
const FEED = "https://transport.tallinn.ee/gps.txt";
const STOPS = "https://transport.tallinn.ee/data/stops.txt";
const SIRI = "https://transport.tallinn.ee/siri-stop-departures.php";
const UA = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36 tallinn-live/0.1" };
const PUBLIC = path.join(__dirname, "public");

const TYPES = { 1: "troll", 2: "bus", 3: "tram" };

let cache = { at: 0, body: null };
let stopsCache = null;

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

async function getVehicles() {
  const now = Date.now();
  if (cache.body && now - cache.at < 2000) return cache.body;
  const res = await fetch(FEED, { headers: UA });
  if (!res.ok) throw new Error("feed " + res.status);
  const vehicles = parseFeed(await res.text());
  cache = { at: now, body: JSON.stringify({ at: now, vehicles }) };
  return cache.body;
}

// stops.txt: ';'-separated, lat/lng *1e5, empty Name/Area/City inherits the previous row.
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
    if (f.length < 5) continue; // 5-field rows are extra platforms inheriting the previous name
    const name = f[5] || prevName;
    const area = f[8] || prevArea;
    const city = f[9] || prevCity;
    prevName = name; prevArea = area; prevCity = city;
    const lat = Number(f[2]) / 1e5, lon = Number(f[3]) / 1e5;
    if (!lat || !lon) continue;
    // Rows without a SiriID are aggregate "stop group" rows, not real platforms.
    if (!f[1]) continue;
    // Only Tallinn city stops keep the map light.
    if (!/Tallinna linn/.test(area)) continue;
    out.push({ id: f[0], siri: f[1], name, lat, lon });
  }
  stopsCache = JSON.stringify({ stops: out });
  return stopsCache;
}

// SIRI departures: header "Transport,RouteNum,ExpectedTimeInSeconds,ScheduleTimeInSeconds,<nowSecOfDay>,version"
// then "stop,<siriId>" blocks followed by "type,line,expectedSec,scheduledSec,dest,secondsUntil,lowFloor".
async function getDepartures(ids) {
  const clean = ids.split(",").map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).slice(0, 12);
  if (!clean.length) return JSON.stringify({ now: 0, departures: [] });
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

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    try {
      if (url.pathname === "/api/vehicles") {
        const body = await getVehicles();
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        return res.end(body);
      }
      if (url.pathname === "/api/departures") {
        const body = await getDepartures(url.searchParams.get("ids") || "");
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        return res.end(body);
      }
      if (url.pathname === "/api/stops") {
        const body = await getStops();
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" });
        return res.end(body);
      }
      let p = url.pathname === "/" ? "/index.html" : url.pathname;
      p = path.normalize(p).replace(/^(\.\.[\/\\])+/, "");
      const file = path.join(PUBLIC, p);
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end("not found");
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  })
  .listen(PORT, () => console.log(`Tallinn Live → http://localhost:${PORT}`));
