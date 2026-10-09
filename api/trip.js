const { trip } = require("../lib/transit");

module.exports = async (req, res) => {
  try {
    const body = await trip(req.query.id);
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "public, s-maxage=300, stale-while-revalidate=600");
    res.status(200).send(body);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
