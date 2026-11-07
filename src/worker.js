// Lock In: API, AI proxy, Web Push and scheduled check-ins on Cloudflare Workers + D1.
// The app's static files are bundled into the Worker (see [[rules]] in wrangler.toml).
import INDEX from "../public/index.html";
import SW from "../public/sw.js";
import MANIFEST from "../public/manifest.webmanifest";
import ICON192 from "../public/icon-192.png";
import ICON512 from "../public/icon-512.png";
import ICONMASK from "../public/icon-maskable-512.png";
import APPLE from "../public/apple-touch-icon.png";
import BADGE from "../public/badge-96.png";

const STATIC = {
  "/": [INDEX, "text/html; charset=utf-8", "no-cache"],
  "/index.html": [INDEX, "text/html; charset=utf-8", "no-cache"],
  "/sw.js": [SW, "text/javascript; charset=utf-8", "no-cache"],
  "/manifest.webmanifest": [MANIFEST, "application/manifest+json", "public, max-age=3600"],
  "/icon-192.png": [ICON192, "image/png", "public, max-age=3600"],
  "/icon-512.png": [ICON512, "image/png", "public, max-age=3600"],
  "/icon-maskable-512.png": [ICONMASK, "image/png", "public, max-age=3600"],
  "/apple-touch-icon.png": [APPLE, "image/png", "public, max-age=3600"],
  "/badge-96.png": [BADGE, "image/png", "public, max-age=3600"],
};
function serveStatic(url) {
  const hit = STATIC[url.pathname] || STATIC["/"];
  const [body, type, cache] = hit;
  return new Response(body, { headers: { "content-type": type, "cache-control": cache, "x-content-type-options": "nosniff" } });
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/* ---------------- auth: one passcode, signed cookie ---------------- */
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
async function makeToken(env) {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 365;
  return `${exp}.${await hmac(env.SESSION_SECRET, String(exp))}`;
}
async function authed(req, env) {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)li=([^;]+)/);
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return sig === await hmac(env.SESSION_SECRET, exp);
}
function safeEqual(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

/* ---------------- nutrition maths (mirrors the app) ---------------- */
const EXAMPLE = { sex: "m", age: 21, units: "metric", h: 178, w: 79, gw: 74, bf: 20.1, tee: 2667, act: "1.55", goal: "-0.5" };
function targets(p) {
  const kg = p.units === "imperial" ? p.w * 0.453592 : p.w;
  const bmr = 10 * kg + 6.25 * p.h - 5 * p.age + (p.sex === "m" ? 5 : -161);
  const tdee = Number(p.tee) > 0 ? Number(p.tee) : bmr * Number(p.act);
  const floor = p.sex === "m" ? 1500 : 1200;
  const kcal = Math.round(Math.max(tdee + Number(p.goal) * 1100, floor) / 10) * 10;
  const protein = Math.round(kg * (Number(p.goal) < 0 ? 2.0 : 1.8));
  return { kcal, protein, sodium: 2000, sugar: 25 };
}
const sumOf = list => list.reduce((a, e) => { const q = e.qty || 1; a.k += e.kcal * q; a.p += e.p * q; a.na += (e.na || 0) * q; a.sug += (e.sug || 0) * q; return a; }, { k: 0, p: 0, na: 0, sug: 0 });
function localNow(env) { return new Date(Date.now() + Number(env.TZ_OFFSET_MIN || 0) * 60000); }
function dayKey(d) { return d.toISOString().slice(0, 10); }
function currentDay(env) { const d = localNow(env); d.setUTCHours(d.getUTCHours() - Number(env.DAY_START_HOUR || 6)); return dayKey(d); }
function shiftDay(k, n) { const d = new Date(k + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return dayKey(d); }

async function getDoc(env, k) {
  const row = await env.DB.prepare("SELECT v FROM docs WHERE k = ?").bind(k).first();
  return row ? JSON.parse(row.v) : null;
}

/* What the notification should say right now (null = nothing worth saying). */
async function buildNotice(env) {
  const p = (await getDoc(env, "profile")) || EXAMPLE, t = targets(p);
  const hour = localNow(env).getUTCHours();
  const today = currentDay(env);
  if (hour >= 6 && hour < 14) {
    const yk = shiftDay(today, -1), list = (await getDoc(env, "log-" + yk)) || [];
    if (!list.length) return null;
    const s = sumOf(list), left = Math.round(t.kcal - s.k), pg = Math.round(t.protein - s.p);
    const bits = [
      left >= -150 && left <= 400 ? "calories on target" : left > 400 ? `${left} kcal under` : `${-left} kcal over`,
      pg <= 0 ? "protein hit" : `${pg} g protein short`,
    ];
    if (s.na > 2000) bits.push(`sodium ${Math.round(s.na - 2000)} mg over`);
    if (s.sug > 25) bits.push(`sugar ${Math.round(s.sug - 25)} g over`);
    return { title: "Yesterday's summary", body: bits.join(" · ") + ". Tap for tips.", url: "/?summary=1", tag: "summary-" + yk };
  }
  const list = (await getDoc(env, "log-" + today)) || [];
  const s = sumOf(list), left = Math.round(t.kcal - s.k), pg = Math.round(t.protein - s.p);
  if (pg > 5) {
    const scoops = Math.max(1, Math.ceil(pg / 24 - 0.15)), chicken = Math.max(50, Math.ceil(pg / 0.23 / 25) * 25);
    return { title: `${pg} g protein to go`, body: `${left > 0 ? left + " kcal left. " : ""}Try ${scoops} scoop${scoops > 1 ? "s" : ""} of whey or ${chicken} g chicken breast. Tap to log it.`, url: "/?checkin=1", tag: "checkin-" + today };
  }
  if (left > 400) return { title: `${left} kcal left today`, body: "Protein is done. Add rice, fruit or an egg so you're not too far under.", url: "/?checkin=1", tag: "checkin-" + today };
  return null;
}

/* ---------------- Web Push (no payload; the service worker fetches /api/notice) ---------------- */
async function vapidAuth(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || "mailto:admin@example.com" })));
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE_JWK), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}
async function pushAll(env) {
  const { results } = await env.DB.prepare("SELECT endpoint FROM subs").all();
  let sent = 0;
  for (const { endpoint } of results) {
    const r = await fetch(endpoint, { method: "POST", headers: { Authorization: await vapidAuth(env, endpoint), TTL: "3600", Urgency: "high", "Content-Length": "0" } });
    if (r.status === 404 || r.status === 410) await env.DB.prepare("DELETE FROM subs WHERE endpoint = ?").bind(endpoint).run();
    else if (r.ok) sent++;
  }
  return sent;
}

/* ---------------- AI proxy ---------------- */
async function askClaude(env, prompt, image, maxTokens = 1200) {
  const content = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.type, data: image.data } });
  content.push({ type: "text", text: prompt });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.AI_MODEL || "claude-sonnet-5-5", max_tokens: maxTokens, messages: [{ role: "user", content }] }),
  });
  if (r.status === 429) throw { code: "rate_limited" };
  if (!r.ok) throw { code: "ai_error", detail: (await r.text()).slice(0, 300) };
  const out = await r.json();
  return (out.content || []).filter(b => b.type === "text").map(b => b.text).join("");
}

/* ---------------- router ---------------- */
async function api(req, env, url) {
  const path = url.pathname;
  if (path === "/api/login" && req.method === "POST") {
    const { passcode } = await req.json().catch(() => ({}));
    if (!env.APP_PASSCODE || !safeEqual(passcode || "", env.APP_PASSCODE)) return json({ error: "Wrong passcode" }, 401);
    return json({ ok: true }, 200, { "set-cookie": `li=${encodeURIComponent(await makeToken(env))}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000` });
  }
  if (!(await authed(req, env))) return json({ error: "Sign in first" }, 401);

  if (path === "/api/me") return json({ ok: true, ai: !!env.ANTHROPIC_API_KEY, push: !!env.VAPID_PUBLIC_KEY, vapid: env.VAPID_PUBLIC_KEY || null });

  const m = path.match(/^\/api\/doc\/(profile|log-\d{4}-\d{2}-\d{2})$/);
  if (m) {
    if (req.method === "GET") { const v = await getDoc(env, m[1]); return v === null ? json({ v: null }, 404) : json({ v }); }
    if (req.method === "PUT") {
      const body = await req.text();
      if (body.length > 200000) return json({ error: "Too large" }, 413);
      const { v } = JSON.parse(body);
      await env.DB.prepare("INSERT INTO docs (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated")
        .bind(m[1], JSON.stringify(v), Date.now()).run();
      return json({ ok: true });
    }
  }
  if (path === "/api/subscribe" && req.method === "POST") {
    const sub = await req.json();
    if (!sub?.endpoint?.startsWith("https://")) return json({ error: "Bad subscription" }, 400);
    await env.DB.prepare("INSERT OR REPLACE INTO subs (endpoint, sub, created) VALUES (?, ?, ?)").bind(sub.endpoint, JSON.stringify(sub), Date.now()).run();
    return json({ ok: true });
  }
  if (path === "/api/unsubscribe" && req.method === "POST") {
    const { endpoint } = await req.json();
    await env.DB.prepare("DELETE FROM subs WHERE endpoint = ?").bind(endpoint || "").run();
    return json({ ok: true });
  }
  if (path === "/api/notice") return json((await buildNotice(env)) || { title: "Lock In", body: "You're on track. Nice work.", url: "/", tag: "ok" });
  if (path === "/api/test-push" && req.method === "POST") return json({ sent: await pushAll(env) });

  if (path === "/api/ai" && req.method === "POST") {
    if (!env.ANTHROPIC_API_KEY) return json({ code: "ai_off" }, 501);
    const { prompt, image, maxTokens } = await req.json();
    if (typeof prompt !== "string" || prompt.length > 20000) return json({ code: "bad_request" }, 400);
    if (image && (!/^image\/(jpeg|png|webp|gif)$/.test(image.type) || image.data.length > 7_000_000)) return json({ code: "image_rejected" }, 400);
    try { return json({ text: await askClaude(env, prompt, image, Math.min(Number(maxTokens) || 1200, 2000)) }); }
    catch (e) { return json({ code: e.code || "ai_error" }, e.code === "rate_limited" ? 429 : 502); }
  }
  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await api(req, env, url); }
      catch (e) { return json({ error: "Server error" }, 500); }
    }
    return serveStatic(url);
  },
  async scheduled(event, env, ctx) {
    if (!env.VAPID_PRIVATE_JWK) return;
    if (await buildNotice(env)) ctx.waitUntil(pushAll(env));
  },
};
