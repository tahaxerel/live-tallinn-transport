// Tallinn Live — tiny zero-dependency local dev server.
// Serves ./public and the same three endpoints that run as Vercel functions in api/.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { getVehicles, getStops, getDepartures, plan, geocode, trip } = require("./lib/transit");

const PORT = process.env.PORT || 5180;
const PUBLIC = path.join(__dirname, "public");

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
      const json = async (body, cache) => {
        res.writeHead(200, { "content-type": "application/json", "cache-control": cache });
        res.end(await body);
      };
      if (url.pathname === "/api/vehicles") return json(getVehicles(), "no-store");
      if (url.pathname === "/api/stops") return json(getStops(), "no-cache");
      if (url.pathname === "/api/departures") return json(getDepartures(url.searchParams.get("ids")), "no-store");
      if (url.pathname === "/api/plan") return json(plan(url.searchParams.get("from"), url.searchParams.get("to"), url.searchParams.get("time"), url.searchParams.get("arriveBy") === "1"), "no-store");
      if (url.pathname === "/api/geocode") return json(geocode(url.searchParams.get("q")), "no-cache");
      if (url.pathname === "/api/trip") return json(trip(url.searchParams.get("id")), "no-cache");

      let p = url.pathname === "/" ? "/index.html" : url.pathname;
      if (p === "/install") p = "/install.html";
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
