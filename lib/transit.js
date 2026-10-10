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

// ---------- Elron trains (elron.ee live map feed) ----------
const ELRON_MAP = "https://elron.ee/map_data.json";
const ELRON_STOPS = "https://elron.ee/stops_data.json";
let trainCache = { at: 0, list: [] };
async function getTrains() {
  const now = Date.now();
  if (now - trainCache.at < 3000) return trainCache.list;
  try {
    const res = await fetch(`${ELRON_MAP}?nocache=${now}`, { headers: UA });
    if (!res.ok) throw new Error("elron " + res.status);
    const j = await res.json();
    const list = [];
    for (const t of j.data || []) {
      const lat = Number(t.latitude), lon = Number(t.longitude);
      if (!lat || !lon) continue;
      const route = String(t.liin || "").trim();
      const parts = route.split("-").map((x) => x.trim()).filter(Boolean);
      const dest = parts[parts.length - 1] || route;
      const delay = parseInt(t.erinevus_plaanist, 10);
      list.push({
        id: "E" + t.reis,
        type: "train",
        line: String(t.reis),          // train number, for identity
        label: dest,                   // what the pill shows
        route,                         // "Tartu-Tallinn"
        lon, lat,
        heading: Number(t.rongi_suund) || 0,
        speed: Number(t.kiirus) || 0,
        delay: Number.isFinite(delay) ? delay : 0,
        status: t.reisi_staatus || "",
        lastStop: t.viimane_peatus || "",
        note: (t.lisateade || "").trim(),
        start: t.reisi_algus_aeg || "", end: t.reisi_lopp_aeg || "",
        lowFloor: true,
        dest,
      });
    }
    trainCache = { at: now, list };
  } catch (e) {
    // Keep the last good list; trains must never break the bus feed.
    trainCache.at = now;
  }
  return trainCache.list;
}
let stationCache = null;
async function getStations() {
  if (stationCache) return stationCache;
  const res = await fetch(`${ELRON_STOPS}?nocache=${Date.now()}`, { headers: UA });
  if (!res.ok) throw new Error("elron stops " + res.status);
  const j = await res.json();
  stationCache = (j.data || []).map((st, i) => ({ id: "elron-" + i, siri: null, name: st.peatus, lat: Number(st.latitude), lon: Number(st.longitude), train: true, note: (st.teade || "").trim() })).filter((x) => x.lat && x.lon);
  return stationCache;
}

let vehCache = { at: 0, body: null };
async function getVehicles() {
  const now = Date.now();
  if (vehCache.body && now - vehCache.at < 2000) return vehCache.body;
  const [res, trains] = await Promise.all([fetch(FEED, { headers: UA }), getTrains()]);
  if (!res.ok) throw new Error("feed " + res.status);
  const vehicles = parseFeed(await res.text()).concat(trains);
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
  let stations = [];
  try { stations = await getStations(); } catch {}
  stopsCache = JSON.stringify({ stops: out.concat(stations) });
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
  // County / regional buses (SEBE, Harju lines 116, 178, 335 …) are not in the city SIRI feed.
  // Fill them in from the national timetable via Transitous, attributed to the same platform ids.
  try {
    const extra = await timetableDepartures(clean, out, nowSec);
    out.push(...extra);
  } catch {}
  out.sort((a, b) => a.inSec - b.inSec);
  return JSON.stringify({ now: nowSec, at: Date.now(), departures: out });
}

// Seconds since local midnight (Europe/Tallinn) for an ISO instant, matching SIRI's clock.
function localSecOfDay(iso) {
  const t = new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/Tallinn", hour12: false });
  const [h, m, sec] = t.split(":").map(Number);
  return h * 3600 + m * 60 + (sec || 0);
}
let ttCache = new Map();
async function timetableDepartures(ids, have, nowSec) {
  const key = ids.join(",");
  const c = ttCache.get(key);
  if (c && Date.now() - c.at < 20000) return c.rows;
  // One query returns the whole station; each row carries its own platform id.
  const res = await fetch(`${TRANSITOUS}/stoptimes?stopId=ee-tallinn_${ids[0]}&n=30`, { headers: T_UA });
  if (!res.ok) throw new Error("stoptimes " + res.status);
  const j = await res.json();
  const wanted = new Set(ids);
  const now = Date.now();
  const rows = [];
  for (const x of j.stopTimes || []) {
    const platform = String(x.place?.stopId || "").split("_").pop();
    if (!wanted.has(platform)) continue;
    const mode = String(x.mode || "");
    const type = /TRAM/.test(mode) ? "tram" : /RAIL|SUBWAY/.test(mode) ? "train" : "bus";
    const schedIso = x.place.scheduledDeparture || x.place.departure, depIso = x.place.departure || x.place.scheduledDeparture;
    if (!depIso) continue;
    const inSec = Math.round((new Date(depIso).getTime() - now) / 1000);
    if (inSec < -60 || inSec > 3 * 3600) continue;
    const line = x.routeShortName || "";
    const scheduled = localSecOfDay(schedIso), expected = localSecOfDay(depIso);
    // Skip what SIRI already reports live (same line, same minute).
    if (have.some((h) => h.line === line && Math.abs(h.scheduled - scheduled) <= 60)) continue;
    rows.push({ stop: platform, type, line, expected, scheduled, dest: x.headsign || "", inSec, lowFloor: false, timetable: !x.realTime, agency: x.agencyName || "" });
  }
  if (ttCache.size > 300) ttCache = new Map();
  ttCache.set(key, { at: Date.now(), rows });
  return rows;
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

const MODE = { BUS: "bus", TRAM: "tram", TROLLEY: "troll", TROLLEYBUS: "troll", RAIL: "train", REGIONAL_RAIL: "train", REGIONAL_FAST_RAIL: "train", LONG_DISTANCE: "train", SUBWAY: "train", FERRY: "ferry", WALK: "walk" };
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
      tripId: l.tripId || null,
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

// Full stop sequence + timetable of one trip (for live vehicle tracking).
let tripCache = new Map();
async function trip(tripId) {
  const id = String(tripId || "");
  if (!id || id.length > 400) throw new Error("bad tripId"); // Elron trip ids are long
  const c = tripCache.get(id);
  if (c && Date.now() - c.at < 300000) return c.body;
  const res = await fetch(`${TRANSITOUS}/trip?tripId=${encodeURIComponent(id)}`, { headers: T_UA });
  if (!res.ok) throw new Error("trip " + res.status);
  const j = await res.json();
  const l = (j.legs || [])[0];
  if (!l) throw new Error("trip has no legs");
  const siri = (p) => (p.stopId || "").split("_").pop() || null;
  const st = (p, arr, dep) => ({ name: p.name, siri: siri(p), lat: p.lat, lon: p.lon, arr: arr || dep || null, dep: dep || arr || null });
  const stops = [st(l.from, l.from.arrival, l.from.departure), ...(l.intermediateStops || []).map((p) => st(p, p.arrival, p.departure)), st(l.to, l.to.arrival, l.to.departure)];
  const body = JSON.stringify({
    id, line: l.routeShortName || null, headsign: l.headsign || null, mode: MODE[l.mode] || "bus",
    stops, path: l.legGeometry?.points ? decodePolyline(l.legGeometry.points, l.legGeometry.precision ?? 7) : [],
  });
  if (tripCache.size > 300) tripCache = new Map();
  tripCache.set(id, { at: Date.now(), body });
  return body;
}

// ---------- Train station departures (Transitous stoptimes on the Elron stop) ----------
const stationIdCache = new Map(); // "name|lat|lon" -> transitous stop id
let stationDepCache = new Map();
const km = (a, b) => Math.hypot((a.lat - b.lat) * 111.32, (a.lon - b.lon) * 111.32 * Math.cos(a.lat * Math.PI / 180));
async function station(name, lat, lon) {
  const nm = String(name || "").trim(); lat = Number(lat); lon = Number(lon);
  if (!nm || !lat || !lon) throw new Error("name, lat, lon required");
  const key = `${nm}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
  const c = stationDepCache.get(key);
  if (c && Date.now() - c.at < 30000) return c.body;
  let id = stationIdCache.get(key);
  if (!id) {
    const res = await fetch(`${TRANSITOUS}/geocode?text=${encodeURIComponent(nm)}&type=STOP`, { headers: T_UA });
    if (!res.ok) throw new Error("geocode " + res.status);
    const cands = (await res.json()).filter((r) => String(r.id).startsWith("ee-elron_")).map((r) => ({ r, d: km({ lat, lon }, r) })).sort((a, b) => a.d - b.d);
    if (!cands.length || cands[0].d > 3) throw new Error("station not found");
    id = cands[0].r.id;
    stationIdCache.set(key, id);
  }
  const q = new URLSearchParams({ stopId: id, n: "10", mode: "RAIL,REGIONAL_RAIL,REGIONAL_FAST_RAIL,LONG_DISTANCE" });
  const res = await fetch(`${TRANSITOUS}/stoptimes?${q}`, { headers: T_UA });
  if (!res.ok) throw new Error("stoptimes " + res.status);
  const j = await res.json();
  const departures = (j.stopTimes || []).map((x) => ({
    line: x.routeShortName || "",
    headsign: x.headsign || "",
    dep: x.place.departure || x.place.scheduledDeparture || null,
    sched: x.place.scheduledDeparture || x.place.departure || null,
    realtime: !!x.realTime,
    cancelled: !!x.cancelled,
    tripId: x.tripId || null,
  })).filter((x) => x.dep);
  const body = JSON.stringify({ id, at: Date.now(), departures });
  if (stationDepCache.size > 300) stationDepCache = new Map();
  stationDepCache.set(key, { at: Date.now(), body });
  return body;
}

module.exports = { getVehicles, getStops, getDepartures, plan, geocode, trip, station, decodePolyline };
