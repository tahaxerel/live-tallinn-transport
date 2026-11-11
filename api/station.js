const { station } = require("../lib/transit");
const { flights } = require("../lib/flights");

// /api/station?name=…&lat=…&lon=…  train station board
// /api/station?airport=1&lang=et|en  Tallinn Airport departures and arrivals
// (one function for both: the Hobby plan allows 12 and the airport board is just another station board)
module.exports = async (req, res) => {
  try {
    const airport = req.query.airport != null;
    const body = airport ? await flights(req.query.lang) : await station(req.query.name, req.query.lat, req.query.lon);
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", airport ? "public, s-maxage=60, stale-while-revalidate=120" : "public, s-maxage=30, stale-while-revalidate=60");
    res.status(200).send(body);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
