// Faculty journey against real Gemini + real RAG, isolated SQLite DB, synthetic accounts.
// Needs e2e/serve_integration.sh (port 8000) and Vite (port 5173).
import { chromium } from "../frontend/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
const API = "http://127.0.0.1:8000/api", BASE = "http://127.0.0.1:5173", PW = "Passw0rd!x";
const tag = Math.random().toString(36).slice(2, 8), dom = `fac${tag}.edu`, fdom = `staff.${dom}`;
const res = []; const log = (ok, n, i = "") => { res.push(!!ok); console.log((ok ? "PASS " : "FAIL ") + n + (ok ? "" : " :: " + String(i).slice(0, 300))); };
const j = (r) => r.json();
const post = (p, body, tok) => fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json", ...(tok && { Authorization: "Bearer " + tok }) }, body: JSON.stringify(body) });
const form = (p, fields, tok) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return fetch(API + p, { method: "POST", headers: { Authorization: "Bearer " + tok }, body: f }); };

const adm = (await j(await post("/auth/register-college", { college_name: "Fac College " + tag, official_domain: dom, admin_full_name: "Admin Person", admin_email: `admin@${dom}`, admin_password: PW }))).access_token;
await fetch(API + "/admin/settings/faculty-domain", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + adm }, body: JSON.stringify({ faculty_domain: fdom }) });
const fac = await post("/auth/register-student", { email: `prof@${fdom}`, password: PW, full_name: "Prof Synthetic", role: "faculty", department: "CSE" });
log(fac.status === 200, "synthetic faculty registers on the faculty domain", await fac.clone().text());
const f = new FormData(); f.append("file", new Blob(["Faculty leave policy: faculty may take up to 12 casual leaves per academic year. Leave must be applied for 3 days in advance."], { type: "text/plain" }), "leave.txt");
for (const [k, v] of Object.entries({ title: "Faculty Leave Policy " + tag, document_type: "regulation", is_official: "true" })) f.append(k, v);
const up = await fetch(API + "/documents/upload", { method: "POST", headers: { Authorization: "Bearer " + adm }, body: f });
log(up.status === 200, "admin uploads the faculty policy (real embeddings)", await up.clone().text());
const iso = (d) => new Date(Date.now() + d * 864e5).toISOString().replace(/\.\d+Z$/, "Z");
for (const [t, aud, extra] of [["FacOnly " + tag, "faculty", {}], ["StuOnly " + tag, "student", {}], ["Both " + tag, "both", {}], ["FacDeadline " + tag, "faculty", { category: "deadline", deadline: iso(10), reminder_offsets: "1" }]]) {
  const r = await form("/notifications", { title: t, body: "Synthetic notice body.", category: "general", priority: "normal", audience: aud, ...extra }, adm);
  if (r.status !== 200) log(false, "publish " + t, await r.text());
}

const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const p = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const problems = [];
p.on("pageerror", (e) => problems.push("pageerror " + String(e).slice(0, 150)));
p.on("console", (m) => { if (m.type() === "error") problems.push("console " + m.text().slice(0, 150)); });
p.on("response", (r) => { if (r.status() >= 500) problems.push(r.status() + " " + r.url()); });

await p.goto(BASE + "/login");
await p.getByPlaceholder("name@yourcollege.edu").fill(`prof@${fdom}`);
await p.getByPlaceholder("Enter your password").fill(PW);
await p.locator("form button[type=submit]").click();
await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {});
log(p.url().includes("/chat"), "faculty logs in and lands on /chat", p.url());

const box = p.locator("textarea").first();
await box.fill("How many casual leaves can faculty take in a year?"); await box.press("Enter");
await p.waitForSelector("text=/12/", { timeout: 120000 }).catch(() => {});
const t = await p.locator("main").innerText();
log(/12/.test(t) && /casual/i.test(t), "real Gemini RAG answer has the correct fact (12 casual leaves)", t.slice(-250));
log(new RegExp("Faculty Leave Policy " + tag).test(t), "citation names the uploaded faculty policy");
const fb = p.getByRole("button", { name: /^helpful|thumbs? up|good answer/i }).first();
let fbOk = false;
if (await fb.count()) { await fb.click(); await p.waitForTimeout(800); fbOk = true; }
log(fbOk, "feedback submitted from the UI");

await p.goto(BASE + "/notifications"); await p.waitForTimeout(1500);
const nt = await p.locator("main").innerText();
log(new RegExp("FacOnly " + tag).test(nt) && new RegExp("Both " + tag).test(nt), "faculty sees the faculty-only and shared notices");
log(!new RegExp("StuOnly " + tag).test(nt), "faculty does NOT see the student-only notice");
await p.goto(BASE + "/reminders"); await p.waitForTimeout(1500);
const rt = await p.locator("main").innerText();
log(new RegExp("FacDeadline " + tag).test(rt), "faculty sees the faculty-targeted reminder", rt.slice(0, 200));

// the reverse direction, through the API, for a synthetic student
const stu = (await j(await post("/auth/register-student", { email: `s@${dom}`, password: PW, full_name: "Syn Student", role: "student", department: "CSE", year: 1, semester: 1, section: "A" }))).access_token;
const sn = JSON.stringify(await j(await fetch(API + "/notifications", { headers: { Authorization: "Bearer " + stu } })));
log(sn.includes("StuOnly " + tag) && sn.includes("Both " + tag) && !sn.includes("FacOnly " + tag), "student sees student+shared and NOT faculty-only");

// logout
const menu = p.getByRole("button", { name: /account|user menu|profile/i }).first();
if (await menu.count()) { await menu.click(); await p.waitForTimeout(300); }
const lo = p.getByRole("menuitem", { name: /sign out|log ?out/i }).or(p.getByRole("button", { name: /sign out|log ?out/i })).first();
if (await lo.count()) await lo.click();
await p.waitForTimeout(1200);
await p.goto(BASE + "/chat"); await p.waitForTimeout(1000);
log(p.url().includes("/login"), "after logout /chat redirects to /login", p.url());
console.log("problems:", [...new Set(problems)].slice(0, 8));
console.log(`${res.filter(Boolean).length}/${res.length} faculty checks passed`);
await browser.close();
