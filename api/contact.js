const { sendContact, ContactError } = require("../lib/contact");

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") { res.setHeader("allow", "POST"); return res.status(405).json({ error: "method" }); }
  try {
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";
    res.status(200).json(await sendContact(req.body, ip));
  } catch (e) {
    const status = e instanceof ContactError ? e.status : 502;
    res.status(status).json({ error: e instanceof ContactError ? e.code : "send" });
  }
};
