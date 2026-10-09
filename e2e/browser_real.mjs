// Real-browser workflows against the integration backend (real Gemini, real RAG,
// real Cloudinary, isolated SQLite). Start with e2e/serve_integration.sh + Vite.
import { chromium } from "../frontend/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
const BASE = "http://127.0.0.1:5173", PW = "Passw0rd!x";
const tag = Math.random().toString(36).slice(2, 8), dom = `ui${tag}.edu`;
const res = []; const log = (ok, n, i = "") => { res.push(ok); console.log((ok ? "PASS " : "FAIL ") + n + (ok ? "" : " :: " + String(i).slice(0, 300))); };
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const problems = [];
const mk = async () => { const c = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p = await c.newPage();
  p.on("pageerror", e => problems.push("pageerror " + String(e).slice(0, 150)));
  p.on("console", m => { if (m.type() === "error") problems.push("console " + m.text().slice(0, 150)); });
  p.on("response", r => { if (r.status() >= 500) problems.push(r.status() + " " + r.url()); }); return p; };
fs.mkdirSync("tmp/e2e", { recursive: true });
fs.writeFileSync("tmp/e2e/ui_policy.txt", `Hostel Curfew Policy ${tag}\nStudents must return to the hostel by 9:30 PM on weekdays. Late entry needs written warden approval.\n`);

// admin registers a college through the UI
const a = await mk();
await a.goto(BASE + "/register-college");
await a.getByPlaceholder("Madras Institute of Technology").fill("UI College " + tag);
await a.getByPlaceholder("mitindia.edu").fill(dom);
await a.getByPlaceholder("Dr. Jane Doe").fill("Admin Person");
await a.locator("#admin_email").fill(`admin@${dom}`);
await a.getByPlaceholder("At least 8 characters").fill(PW);
await a.locator("form button[type=submit]").click();
await a.waitForURL(u => !u.pathname.startsWith("/register-college"), { timeout: 20000 }).catch(() => {});
log(a.url().includes("/admin"), "admin registers college via UI and lands on /admin", a.url());

// admin uploads a document via the UI
await a.goto(BASE + "/admin/documents"); await a.waitForTimeout(800);
await a.getByRole("button", { name: /^upload documents$/i }).first().click();
await a.locator("input[type=file]").setInputFiles("tmp/e2e/ui_policy.txt");
await a.getByRole("button", { name: /upload and process/i }).click();
await a.waitForSelector("text=/Hostel Curfew|ready|done|indexed/i", { timeout: 120000 }).catch(() => {});
await a.waitForTimeout(3000);
await a.reload(); await a.waitForTimeout(1500);
{ const mt = await a.locator("main").innerText(); log(/ui policy|ui_policy/i.test(mt), "document upload via UI appears in list", mt.slice(0, 300)); }

// admin publishes a notice via the UI
await a.goto(BASE + "/admin/notifications"); await a.waitForTimeout(1000);
await a.getByRole("button", { name: /^new notification$/i }).click();
await a.locator("#n-title").fill("Library closed " + tag);
await a.locator("textarea").first().fill("The library is closed on Friday for stock-taking.");
const pub = a.getByRole("button", { name: /publish notice/i }).first();
if (await pub.count()) { await pub.click(); await a.waitForTimeout(2500); }
await a.reload(); await a.waitForTimeout(1200);
log(new RegExp("Library closed " + tag).test(await a.locator("main").innerText()), "notice published via UI is listed");

// student registers via UI and chats with real Gemini
const s = await mk();
await s.goto(BASE + "/register");
await s.getByPlaceholder("Vijay Sethupathi").fill("UI Student");
await s.getByPlaceholder("you@yourcollege.edu").fill(`stu@${dom}`);
await s.getByPlaceholder("At least 8 characters").fill(PW);
await s.getByPlaceholder("CSE").fill("CSE");
await s.locator("#section").fill("A");
await s.getByPlaceholder("Computer Science and Engineering").fill("Computer Science and Engineering").catch(() => {});
await s.locator("form button[type=submit]").click();
await s.waitForURL(u => !u.pathname.startsWith("/register"), { timeout: 20000 }).catch(() => {});
log(s.url().includes("/chat"), "student registers via UI and lands on /chat", s.url());
const box = s.locator("textarea").first();
await box.fill("What time must I be back in the hostel on weekdays?"); await box.press("Enter");
await s.waitForSelector("text=/9:30/", { timeout: 120000 }).catch(() => {});
const t = await s.locator("main").innerText();
log(/9:30/.test(t), "real Gemini answer rendered in UI with the correct fact", t.slice(-200));
log(/ui policy/i.test(t), "citation to uploaded document visible");
const up = s.getByRole("button", { name: /^helpful|thumbs? up|good answer/i }).first();
if (await up.count()) { await up.click(); await s.waitForTimeout(800); log(true, "feedback click works"); } else log(false, "feedback button");
await s.getByRole("button", { name: /copy/i }).first().click().catch(() => {});
// notification visible to student
await s.goto(BASE + "/notifications"); await s.waitForTimeout(1500);
log(new RegExp("Library closed " + tag).test(await s.locator("main").innerText()), "student sees the published notice");
// theme switching persists
await s.goto(BASE + "/privacy"); await s.waitForTimeout(800);
const dark = s.getByRole("radio", { name: /dark/i }).first();
if (await dark.count()) { await dark.click(); await s.reload(); await s.waitForTimeout(500);
  log(await s.evaluate(() => document.documentElement.classList.contains("dark") || document.documentElement.dataset.theme === "dark"), "dark theme applies and persists after reload"); }
else log(false, "theme radio not found on /privacy");
// logout and bad-session handling
await s.evaluate(() => localStorage.clear()); await s.goto(BASE + "/chat"); await s.waitForTimeout(1000);
log(s.url().includes("/login"), "cleared session redirects to /login");
await s.screenshot({ path: "tmp/e2e/ui_final.png" });

console.log("problems:", [...new Set(problems)].slice(0, 10));
console.log(`${res.filter(Boolean).length}/${res.length} real-browser checks passed`);
await browser.close();
