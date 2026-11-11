// Contact form: forwards a message to the owner's inbox through Resend.
// The inbox address never reaches the browser: it lives only in the CONTACT_TO environment variable.
// Without a domain of our own, Resend sends from onboarding@resend.dev, which may only deliver to the
// address the Resend account was opened with — exactly what we want here.

const MAX = { name: 80, email: 120, message: 3000 };
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

// Best-effort rate limit per IP. Serverless instances do not share memory, so this only stops a single
// client hammering one warm instance; the honeypot and Resend's own limits do the rest.
const WINDOW_MS = 10 * 60 * 1000, PER_WINDOW = 3;
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= PER_WINDOW) { hits.set(ip, recent); return true; }
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

class ContactError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

// body: { name, email, message, website, lang } — `website` is a honeypot real people never see.
async function sendContact(body, ip = "?") {
  body = body && typeof body === "object" ? body : {};
  const clean = (k) => String(body[k] ?? "").trim().slice(0, MAX[k] ?? 0);
  if (String(body.website ?? "").trim()) return { ok: true }; // a bot filled the hidden field: pretend it worked
  const name = clean("name"), email = clean("email"), message = clean("message");
  if (message.length < 5) throw new ContactError(400, "empty");
  if (email && !EMAIL_RE.test(email)) throw new ContactError(400, "email");
  if (limited(ip)) throw new ContactError(429, "rate");

  const key = process.env.RESEND_API_KEY, to = process.env.CONTACT_TO;
  if (!key || !to) {
    if (process.env.CONTACT_DRY_RUN === "1") { console.log("[contact] dry run:", { name, email, message }); return { ok: true }; }
    throw new ContactError(503, "config");
  }
  const text = `${message}\n\n— ${name || "(no name)"}${email ? ` <${email}>` : ""}\nLanguage: ${body.lang === "et" ? "et" : "en"}`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: "Tallinn Live <onboarding@resend.dev>",
      to: [to],
      subject: `Tallinn Live: message from ${name || "a user"}`,
      text,
      ...(email ? { reply_to: email } : {}),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) {
    console.error("[contact] resend", r.status, (await r.text()).slice(0, 300));
    throw new ContactError(502, "send");
  }
  return { ok: true };
}

module.exports = { sendContact, ContactError };
