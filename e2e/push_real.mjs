// Real Web Push: a synthetic student in headless Edge subscribes through the
// app's own UI code path; the backend then sends a real push (VAPID from
// backend/.env) to ONLY that browser endpoint. Needs serve_integration.sh + vite.
import { chromium } from "../frontend/node_modules/playwright-core/index.mjs";
const BASE = "http://127.0.0.1:5173", API = "http://127.0.0.1:8000/api", PW = "Passw0rd!x";
const tag = Math.random().toString(36).slice(2, 8), dom = `push${tag}.edu`;
const J = async (path, opt = {}) => { const r = await fetch(API + path, opt); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const post = (p, b, t) => J(p, { method: "POST", headers: { "Content-Type": "application/json", ...(t && { Authorization: "Bearer " + t }) }, body: JSON.stringify(b) });
const res = []; const log = (ok, n, i = "") => { res.push(ok); console.log((ok ? "PASS " : "FAIL ") + n + (ok ? "" : " :: " + String(i).slice(0, 300))); };

const adm = (await post("/auth/register-college", { college_name: "Push " + tag, official_domain: dom, admin_full_name: "Admin Person", admin_email: `a@${dom}`, admin_password: PW })).body.access_token;
await post("/auth/register-student", { email: `s@${dom}`, password: PW, full_name: "Push Student", role: "student", department: "CSE", year: 1, semester: 1, section: "A" });

// A persistent profile (inside tmp/, not committed) is required: an ephemeral
// Playwright context is refused service-worker push registration by Edge.
const ctx = await chromium.launchPersistentContext("tmp/e2e/edge_profile", { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: false, permissions: ["notifications"] });
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto(BASE + "/login");
await page.getByPlaceholder("name@yourcollege.edu").fill(`s@${dom}`);
await page.getByPlaceholder("Enter your password").fill(PW);
await page.locator("form button[type=submit]").first().click();
await page.waitForURL(/\/chat/, { timeout: 15000 });

const out = await page.evaluate(async () => {
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const token = localStorage.getItem("token") || Object.values(localStorage).find((v) => String(v).split(".").length === 3) || "";
    const st = await (await fetch("http://localhost:8000/api/push/status", { headers: { Authorization: "Bearer " + token } })).json();
    const b64 = st.public_key.replace(/-/g, "+").replace(/_/g, "/");
    const key = Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const j = sub.toJSON();
    return { ok: true, endpointHost: new URL(sub.endpoint).host, endpoint: sub.endpoint, keys: j.keys, token, configured: st.configured };
  } catch (e) { return { ok: false, err: String(e) }; }
});
log(out.ok, "browser creates real push subscription with server VAPID key", out.err);
if (out.ok) {
  console.log("  push service host:", out.endpointHost);
  const sid = await post("/push/subscribe", { endpoint: out.endpoint, keys: out.keys }, out.token);
  log(sid.status === 200 && sid.body.subscribed, "subscription registered + persisted", JSON.stringify(sid));
  log((await J("/push/status", { headers: { Authorization: "Bearer " + out.token } })).body.devices === 1, "status shows 1 device");
  const bad = await post("/push/subscribe", { endpoint: "https://evil.example.com/x", keys: out.keys }, out.token);
  log(bad.status === 400, "disallowed push host rejected", bad.status);
  await page.evaluate(() => { window.__pushed = 0; navigator.serviceWorker.addEventListener("message", (e) => { if (e.data?.type === "cm-push") window.__pushed++; }); });
  const form = new FormData();
  for (const [k, v] of Object.entries({ title: "Real push check " + tag, body: "Synthetic notice for push", category: "circular", priority: "important", audience: "student", status: "published" })) form.append(k, v);
  const pub = await fetch(API + "/notifications", { method: "POST", headers: { Authorization: "Bearer " + adm }, body: form });
  log(pub.status === 200, "admin publishes student notice", pub.status);
  let got = 0; for (let i = 0; i < 20 && !got; i++) { await page.waitForTimeout(1000); got = await page.evaluate(() => window.__pushed).catch(() => 0); }
  log(got > 0, "service worker received the real push (cm-push message)", "no push event within 20s");
  const shown = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => n.title));
  console.log("  notifications shown by SW:", JSON.stringify(shown));
  log(shown.some((t) => t.includes("Real push check")), "service worker displayed a notification", JSON.stringify(shown));
  // Closed tab: the app page is closed (a blank tab keeps the browser alive); the
  // worker must still receive and show the push on its own.
  const keep = await ctx.newPage(); await keep.goto("about:blank"); await page.close();
  const form2 = new FormData();
  for (const [k, v] of Object.entries({ title: "Closed tab push " + tag, body: "Synthetic closed-tab notice", category: "circular", priority: "important", audience: "student", status: "published" })) form2.append(k, v);
  await fetch(API + "/notifications", { method: "POST", headers: { Authorization: "Bearer " + adm }, body: form2 });
  const back = await ctx.newPage(); await back.goto(BASE + "/login");
  let shown2 = []; for (let i = 0; i < 20 && !shown2.some((t) => t.includes("Closed tab push")); i++) { await back.waitForTimeout(1000); shown2 = await back.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => n.title)); }
  log(shown2.some((t) => t.includes("Closed tab push")), "push shown by the service worker while no app tab was open", JSON.stringify(shown2));
  const un = await J("/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json", Authorization: "Bearer " + out.token }, body: JSON.stringify({ endpoint: out.endpoint }) });
  log(un.status === 200 && un.body.devices === 0, "unsubscribe removes the device", JSON.stringify(un));
}
console.log(`${res.filter(Boolean).length}/${res.length} passed`);
await ctx.close();
