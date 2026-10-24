const { plan } = require("../lib/transit");

module.exports = async (req, res) => {
  try {
    const body = await plan(req.query.from, req.query.to, req.query.time, req.query.arriveBy === "1", req.query.n);
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "public, s-maxage=60, stale-while-revalidate=120");
    res.status(200).send(body);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
