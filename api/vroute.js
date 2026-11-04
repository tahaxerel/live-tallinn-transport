const { vehicleRoute, lineRoutes } = require("../lib/transit");

module.exports = async (req, res) => {
  try {
    const q = req.query;
    // ?mode=line: the whole line (all directions) instead of one vehicle's trip; same function, to stay under Vercel's function cap
    const body = q.mode === "line" ? await lineRoutes(q.type, q.line) : await vehicleRoute(q.type, q.line, q.lat, q.lon, q.heading, q.dest, q.start);
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.status(200).send(body);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
