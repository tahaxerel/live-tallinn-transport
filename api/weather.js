const { weather } = require("../lib/transit");

module.exports = async (req, res) => {
  try {
    const body = await weather(req.query.city);
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "public, s-maxage=600, stale-while-revalidate=1800");
    res.status(200).send(body);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
