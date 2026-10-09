const { getStops } = require("../lib/transit");

module.exports = async (req, res) => {
  try {
    const body = await getStops();
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).send(body);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
