const { station } = require("../lib/transit");

module.exports = async (req, res) => {
  try {
    const body = await station(req.query.name, req.query.lat, req.query.lon);
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "public, s-maxage=30, stale-while-revalidate=60");
    res.status(200).send(body);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
