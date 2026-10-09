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

// ---------- Journey planning via Transitous (open MOTIS instance, no key) ----------
const TRANSITOUS = "https://api.transitous.org/api/v1";
const T_UA = { "user-agent": "tallinn-live/0.1 (+https://github.com/tahaxerel/live-tallinn-transport)" };

// Google-style encoded polyline → [[lon, lat], ...]
function decodePolyline(str, precision = 7) {
  const factor = Math.pow(10, precision);
  let index = 0, lat = 0, lon = 0;
  const out = [];
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

const MODE = { BUS: "bus", TRAM: "tram", TROLLEY: "troll", TROLLEYBUS: "troll", RAIL: "rail", REGIONAL_RAIL: "rail", SUBWAY: "rail", FERRY: "ferry", WALK: "walk" };
const trimPlace = (p) => ({ name: p.name, lat: p.lat, lon: p.lon, stopId: p.stopId || null });

let planCache = new Map();
async function plan(from, to, time, arriveBy) {
  const ok = (s) => /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(s);
  if (!ok(from) || !ok(to)) throw new Error("from/to must be lat,lon");
  const q = new URLSearchParams({ fromPlace: from, toPlace: to, numItineraries: "5", timetableView: "true", detailedTransfers: "false" });
  if (time) q.set("time", time);
  if (arriveBy) q.set("arriveBy", "true");
  const key = q.toString();
  const c = planCache.get(key);
  if (c && Date.now() - c.at < 20000) return c.body;
  const res = await fetch(`${TRANSITOUS}/plan?${q}`, { headers: T_UA });
  if (!res.ok) throw new Error("plan " + res.status);
  const j = await res.json();
  const itineraries = (j.itineraries || []).map((it) => ({
    duration: it.duration,
    transfers: it.transfers,
    startTime: it.startTime,
    endTime: it.endTime,
    legs: it.legs.map((l) => ({
      mode: MODE[l.mode] || (l.mode === "WALK" ? "walk" : "bus"),
      rawMode: l.mode,
      duration: l.duration,
      distance: l.distance,
      startTime: l.startTime,
      endTime: l.endTime,
      line: l.routeShortName || null,
      headsign: l.headsign || null,
      color: l.routeColor ? "#" + l.routeColor : null,
      from: trimPlace(l.from),
      to: trimPlace(l.to),
      stops: (l.intermediateStops || []).map(trimPlace),
      path: l.legGeometry?.points ? decodePolyline(l.legGeometry.points, l.legGeometry.precision ?? 7) : [],
    })),
  }));
  const body = JSON.stringify({ at: Date.now(), itineraries });
  if (planCache.size > 200) planCache = new Map();
  planCache.set(key, { at: Date.now(), body });
  return body;
}

// Places and stops by name, biased to Tallinn.
async function geocode(text) {
  const t = String(text || "").trim();
  if (t.length < 2) return JSON.stringify({ results: [] });
  const q = new URLSearchParams({ text: t, language: "et", place: "59.437,24.754", placeBias: "0.3" });
  const res = await fetch(`${TRANSITOUS}/geocode?${q}`, { headers: T_UA });
  if (!res.ok) throw new Error("geocode " + res.status);
  const j = await res.json();
  const results = j
    .filter((r) => Math.abs(r.lat - 59.44) < 0.35 && Math.abs(r.lon - 24.75) < 0.7) // greater Tallinn only
    .slice(0, 8)
    .map((r) => {
      const areas = (r.areas || []).filter((a) => a.adminLevel >= 9).map((a) => a.name);
      return { name: r.name, type: r.type, lat: r.lat, lon: r.lon, area: areas[0] || (r.areas || []).find((a) => a.adminLevel === 8)?.name || "", street: r.street || null, houseNumber: r.houseNumber || null, id: r.id || null };
    });
  return JSON.stringify({ results });
}

module.exports = { getVehicles, getStops, getDepartures, plan, geocode, decodePolyline };
