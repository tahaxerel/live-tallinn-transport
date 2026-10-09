const { getVehicles } = require("../lib/transit");

module.exports = async (req, res) => {
  try {
    const body = await getVehicles();
    res.setHeader("content-type", "application/json");
    // Let Vercel's edge share one upstream fetch across all phones for a couple of seconds.
    res.setHeader("cache-control", "public, s-maxage=2, stale-while-revalidate=8");
    res.status(200).send(body);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
