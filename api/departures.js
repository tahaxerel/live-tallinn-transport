const { getDepartures } = require("../lib/transit");

module.exports = async (req, res) => {
  try {
    const body = await getDepartures(req.query.ids);
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "public, s-maxage=10, stale-while-revalidate=20");
    res.status(200).send(body);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
