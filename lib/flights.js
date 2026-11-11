// Tallinn Airport live departures and arrivals.
// Source: airport.ee's own flight board. Its endpoint returns the board as an HTML fragment (both tabs,
// yesterday to tomorrow), so we parse the cards into compact JSON. Status labels come already
// translated by the airport (en: "Departed 15:55", et: "Väljus 15:55").

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const URL_BASE = "https://airport.ee/wp-json/airport/v1/flights?id=18&type=&filter=&lang=";
const MONTHS = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dets"];
const MONTHS_EN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// Kinds the airport marks with a card-flight__tag--<kind> class, most specific first.
const KINDS = ["cancelled", "boarding", "closed", "departing", "departed", "landed", "estimated"];

const decode = (s) => String(s || "")
  .replace(/<[^>]+>/g, "")
  .replace(/&#0?38;|&amp;/g, "&").replace(/&#0?39;|&#8217;/g, "’").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();

// "11. november 2026" / "11. november 2026" (et) → "2026-11-11"
function isoDate(s) {
  const m = /(\d{1,2})\.\s*([a-zäöüõ]+)\s+(\d{4})/i.exec(s || "");
  if (!m) return null;
  const name = m[2].toLowerCase();
  let i = MONTHS_EN.findIndex((p) => name.startsWith(p));
  if (i < 0) i = MONTHS.findIndex((p) => name.startsWith(p));
  if (i < 0) return null;
  return `${m[3]}-${String(i + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function parseBoard(html) {
  const out = { departures: [], arrivals: [] };
  const lists = html.matchAll(/<ul class="flights-list[^"]*" data-type="(departures|arrivals)">([\s\S]*?)<\/ul>/g);
  for (const [, type, body] of lists) {
    let date = null;
    for (const [, cls, c] of body.matchAll(/<li class="([^"]*)">([\s\S]*?)<\/li>/g)) {
      if (!c.includes("card-flight")) { date = isoDate(decode(c)) || date; continue; } // a day header
      if (/\bhistory\b/.test(cls)) continue; // older flights, hidden behind "Show previous flights"
      const g = (re) => { const m = re.exec(c); return m ? decode(m[1]) : ""; };
      const tagCls = g(/card-flight__tag ([^"]*)"/);
      const time = g(/<ins class="card-flight__time">([^<]*)/) || g(/class="card-flight__time">([^<]*)/);
      const url = g(/<a href="(https:\/\/airport\.ee\/[^"]*\?id=\d+[^"]*)"/);
      const id = (/[?&]id=(\d+)/.exec(url) || [])[1] || "";
      out[type].push({
        id,
        date,
        time,                                        // newest known time (estimate / actual)
        sched: g(/card-flight__time--old">([^<]*)/) || time,
        city: g(/card-flight__title">([\s\S]*?)<\/h2>/),
        flight: g(/flight-numbers">([^<]*)/),
        airline: g(/service-providers">([^<]*)/),
        kind: KINDS.find((k) => tagCls.includes(`--${k}`)) || null,
        late: tagCls.includes("--delayed"),
        early: tagCls.includes("--early"),
        status: g(/card-flight__tag [^>]*>([^<]*)/),   // the airport's own wording, in the asked language
        url: url || null,                            // the airport's own page for this flight
      });
    }
  }
  return out;
}

const cache = new Map(); // lang → { at, body }
async function flights(lang) {
  lang = lang === "et" ? "et" : "en";
  const hit = cache.get(lang);
  if (hit && Date.now() - hit.at < 60000) return hit.body;
  const r = await fetch(URL_BASE + lang, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`airport.ee ${r.status}`);
  const j = await r.json();
  const board = parseBoard(j.html || "");
  if (!board.departures.length && !board.arrivals.length) throw new Error("airport.ee: empty board");
  const body = JSON.stringify({ updated: new Date().toISOString(), ...board });
  cache.set(lang, { at: Date.now(), body });
  return body;
}

module.exports = { flights, parseBoard };
