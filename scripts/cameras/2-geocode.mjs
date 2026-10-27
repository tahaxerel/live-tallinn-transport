// Resolve ristmikud.tallinn.ee camera names to intersection coordinates using OSM street geometry.
import fs from "node:fs";
const DIR = new URL(".", import.meta.url).pathname;
const cams = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const osm = JSON.parse(fs.readFileSync(DIR + "osm.json", "utf8")).elements;

const TYPES = /\b(tänav|tn|maantee|mnt\.?|puiestee|pst|tee|väljak|põik|trammitee|ringristmik)\b/g;
const ALIAS = { kreutzwald: "kreutzwaldi", türnpuu: "türnpu", sõruse: "sõpruse", laagna: "laagna", ristiku: "ristiku", baltijaam: "balti jaam", paljasaare: "paljassaare" };
const core = (s) => {
  let c = s.toLowerCase().replace(/\b[a-zõäöü]{1,3}\.\s*/g, "").replace(TYPES, "").replace(/[^a-zõäöüšž\- ]/g, "").replace(/\s+/g, " ").trim();
  c = c.split(" ").filter(Boolean).pop() || c; // OSM spells out given names: "Jüri Vilmsi", "Juhan Smuuli tee"
  return ALIAS[c] || c;
};

// index OSM ways by core name
const byCore = new Map();
for (const w of osm) {
  const n = w.tags?.name; if (!n || !w.geometry) continue;
  const k = core(n);
  if (!byCore.has(k)) byCore.set(k, []);
  byCore.get(k).push(w);
}

const R = 6371000, rad = Math.PI / 180;
const dist = (a, b) => { const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad), y = (b.lat - a.lat) * rad; return Math.hypot(x, y) * R; };
const key = (p) => p.lat.toFixed(7) + "," + p.lon.toFixed(7);

function meet(A, B) {
  const wa = byCore.get(A) || [], wb = byCore.get(B) || [];
  if (!wa.length || !wb.length) return { err: `no OSM street: ${!wa.length ? A : ""} ${!wb.length ? B : ""}`.trim() };
  const set = new Map();
  for (const w of wa) for (const p of w.geometry) set.set(key(p), p);
  const shared = [];
  for (const w of wb) for (const p of w.geometry) if (set.has(key(p))) shared.push(p);
  if (shared.length) return { pts: shared, how: "shared" };
  // nearest approach (bridges, tunnels, roads that end just short)
  let best = null;
  for (const x of wa) for (const p of x.geometry) for (const y of wb) for (const q of y.geometry) {
    const d = dist(p, q); if (!best || d < best.d) best = { d, p: { lat: (p.lat + q.lat) / 2, lon: (p.lon + q.lon) / 2 } };
  }
  return best && best.d < 120 ? { pts: [best.p], how: `near ${best.d.toFixed(0)}m` } : { err: `streets ${A}/${B} never meet (closest ${best?.d.toFixed(0)}m)` };
}

function cluster(pts) {
  // group points within 150 m, return clusters sorted by size
  const cl = [];
  for (const p of pts) { const c = cl.find((c) => dist(c.c, p) < 150); if (c) { c.p.push(p); c.c = { lat: c.p.reduce((s, q) => s + q.lat, 0) / c.p.length, lon: c.p.reduce((s, q) => s + q.lon, 0) / c.p.length }; } else cl.push({ c: p, p: [p] }); }
  return cl.sort((a, b) => b.p.length - a.p.length);
}

function parse(name) {
  const dirs = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim());
  const base = name.replace(/\([^)]*\)/g, " ").replace(/\d+$/, "").replace(/\*/g, "");
  const streets = base.split(/\s+[-–]\s*|\s*[-–]\s+|(?<=\b(?:tee|tn|pst|mnt))-/).map((s) => s.trim()).filter(Boolean);
  return { dirs, streets };
}

const out = [];
for (const c of cams) {
  const { dirs, streets } = parse(c.name);
  const cores = streets.map(core);
  const r = { id: c.id, name: c.name, streets: cores, dirs, district: c.district, corridor: c.corridor };
  if (cores.length >= 2) {
    const pts = []; const notes = [];
    for (let i = 0; i < cores.length; i++) for (let j = i + 1; j < cores.length; j++) { const m = meet(cores[i], cores[j]); if (m.pts) { pts.push(...m.pts); notes.push(`${cores[i]}×${cores[j]} ${m.how} ${m.pts.length}`); } else notes.push(m.err); }
    const cl = cluster(pts);
    if (cl.length) { r.lat = +cl[0].c.lat.toFixed(6); r.lon = +cl[0].c.lon.toFixed(6); r.clusters = cl.length; r.spread = cl.length > 1 ? Math.round(dist(cl[0].c, cl[1].c)) : 0; }
    r.notes = notes.join("; ");
  } else r.notes = "single street";
  out.push(r);
}
fs.writeFileSync(DIR + "geo-auto.json", JSON.stringify(out, null, 1));
const ok = out.filter((r) => r.lat && r.clusters === 1), amb = out.filter((r) => r.lat && r.clusters > 1), bad = out.filter((r) => !r.lat);
console.log("resolved", ok.length, "ambiguous", amb.length, "unresolved", bad.length);
console.log("\n--- ambiguous"); amb.forEach((r) => console.log(r.id, r.name, "|", r.clusters, "clusters, 2nd at", r.spread, "m |", r.notes));
console.log("\n--- unresolved"); bad.forEach((r) => console.log(r.id, r.name, "|", r.notes));
