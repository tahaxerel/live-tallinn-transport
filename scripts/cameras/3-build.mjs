// Build public/cameras.json: Tallinn city traffic cameras grouped into map sites (one dot per junction).
import fs from "node:fs";
const DIR = new URL(".", import.meta.url).pathname;
const auto = JSON.parse(fs.readFileSync(DIR + "geo-auto.json", "utf8"));
const OUT = process.argv[2];

// Hand-resolved positions (OSM landmarks, Photon addresses, corridor order). approx = best estimate, not a surveyed junction.
const M = {};
const put = (ids, lat, lon, approx = false) => ids.split(" ").forEach((id) => (M[id] = { lat, lon, approx }));
put("cam103 cam104", 59.43696, 24.75352);                 // Viru väljak (OSM highway)
put("cam056 cam057 cam055", 59.4349, 24.74835);           // Pärnu mnt by Eesti Draamateater
put("cam065", 59.43304, 24.74551);                        // Vabaduse väljak
put("cam141", 59.44318, 24.74941);                        // Suur-Rannavärava
put("cam200 cam201", 59.44149, 24.74464, true);           // Suurtüki tram track
put("cam187", 59.44313, 24.795, true);                    // Pirita tee by its Narva mnt junction
put("cam195 cam196", 59.46619, 24.83243, true);           // Merivälja tee between Rummu and Kloostrimetsa
put("cam045", 59.42778, 24.77426);                        // Lastekodu, at the Odra junction
put("cam234 cam233 cam026 cam030", 59.4043, 24.73673);    // Järvevana level crossing (Delta Plaza)
put("cam024 cam046 cam050 cam237", 59.42, 24.7667, true); // Järvevana under the Tartu railway bridge
put("cam238 cam239", 59.42129, 24.77064);                 // Järvevana by the Filtri tunnel
put("cam109", 59.41957, 24.75717);                        // Tehnika × Veskiposti (cluster nearest Järvevana)
put("cam058 cam059", 59.3765, 24.7465);                   // Viljandi mnt × Valdeku
put("cam093 cam094", 59.360869, 24.629857);               // Pärnu mnt × Vabaduse pst (Laagri end)
put("cam098", 59.44246, 24.90422, true);                  // Peterburi tee nearest Rahu tee
put("cam129 cam130", 59.4025, 24.72568);                  // Alajaama viadukt
put("cam199", 59.40223, 24.71391);                        // Tammsaare tee at K-Rauta Tondi
put("cam221", 59.42144, 24.64245);                        // Paldiski mnt at K-Rauta Haabersti
put("cam165 cam166", 59.46045, 24.90535);                 // Narva mnt × Pärnamäe tee
put("cam167 cam168", 59.43025, 24.7795, true);            // Laagna tee, west end
put("cam073 cam074 cam075", 59.38759, 24.68364);          // Nõmme keskus
put("cam101 cam016 cam017 cam102", 59.40911, 24.73517);   // Kalev P&R
put("cam175 cam161", 59.41063, 24.73593);                 // Tondi P&R
put("cam190 cam021", 59.46718, 24.83204);                 // Pirita 1 P&R
put("cam189 cam020", 59.4673, 24.8317);                   // Pirita 2 P&R
put("cam192 cam022 cam191", 59.41294, 24.63541);          // Väike-Õismäe P&R
put("cam023", 59.44288, 24.80395);                        // Oru P&R
put("cam171 cam172", 59.35543, 24.62843);                 // Laagri P&R
put("cam157 cam158 cam159 cam160", 59.43163, 24.78258);   // Gonsiori P&R
put("cam124", 59.43665, 24.7505, true);                   // Viru tn bollard
put("cam240", 59.44208, 24.73834, true);                  // Vana-Kalamaja bollard

// Sites whose cameras share no common street name.
const NAME = { cam234: "Järvevana tee raudteeülesõit", cam024: "Järvevana tee tunnel", cam190: "Pirita P&R, Jõesuu tee 5" };
const rad = Math.PI / 180;
const dist = (a, b) => Math.hypot((b.lon - a.lon) * rad * Math.cos(a.lat * rad), (b.lat - a.lat) * rad) * 6371000;
const clean = (s) => s.replace(/Sõruse/g, "Sõpruse").replace(/\*/g, "").replace(/\s+/g, " ").trim();
const base = (name) => clean(name.replace(/\)\s*\d+\s*\*?\s*$/, ")").replace(/\([^)]*\)/g, " ")).replace(/\s+[-–]\s*|\s*[-–]\s+|(?<=\b(?:tee|tn|pst|mnt))-/g, " – ").replace(/\s+,/g, ",");
const view = (name) => { const d = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => clean(m[1])); const n = name.match(/\)\s*(\d+)\s*\*?\s*$/); return d.join(", ") + (n ? " " + n[1] : ""); };

const sites = [];
const missing = [];
for (const r of auto) {
  const p = M[r.id] || (r.lat && { lat: r.lat, lon: r.lon, approx: false });
  if (!p) { missing.push(r.id); continue; }
  const cam = { id: r.id, view: view(r.name) || null, title: clean(r.name) };
  let s = sites.find((s) => dist(s, p) < 35);
  if (!s) { s = { lat: p.lat, lon: p.lon, name: base(r.name), approx: !!p.approx, district: r.district.filter((d) => d !== "Pargi ja reisi")[0] || null, cams: [] }; sites.push(s); }
  else if (!p.approx) s.approx = false; // an exact camera at the same spot pins it
  s.cams.push(cam);
}
if (missing.length) { console.error("MISSING", missing); process.exit(1); }
// Name multi-camera sites after their shortest base name ("Viru väljak", "Kalev P&R, Pärnu mnt 150").
for (const s of sites) {
  const names = [...new Set(s.cams.map((c) => base(c.title)))];
  s.name = NAME[s.cams[0].id] || names.sort((a, b) => a.length - b.length)[0];
  // One label per view: the direction, prefixed by the camera's own street when the site is named otherwise.
  for (const c of s.cams) { const b = base(c.title); c.label = b !== s.name ? b + (c.view ? " · " + c.view : "") : c.view || ""; delete c.title; delete c.view; }
  s.lat = +s.lat.toFixed(5); s.lon = +s.lon.toFixed(5);
}
const out = { source: "https://ristmikud.tallinn.ee", img: "https://ristmikud.tallinn.ee/last/{id}.jpg", built: new Date().toISOString().slice(0, 10), sites };
fs.writeFileSync(OUT, JSON.stringify(out));
console.log("sites", sites.length, "cams", sites.reduce((n, s) => n + s.cams.length, 0), "approx sites", sites.filter((s) => s.approx).length, "bytes", fs.statSync(OUT).size);
sites.filter((s) => s.cams.length > 3).forEach((s) => console.log(" big:", s.name, s.cams.length, s.cams.map((c) => c.view || c.title).join(" / ")));
