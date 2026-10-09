import { chromium } from "../frontend/node_modules/playwright-core/index.mjs";

const BASE = "http://127.0.0.1:5173";
const PW = "Passw0rd!x";
const out = [];
const log = (ok, name, info = "") => { out.push(ok); console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " :: " + String(info).slice(0, 300))); };

const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const problems = [];
function watch(page, tag) {
  page.on("console", (m) => { if (m.type() === "error") problems.push(`${tag} console: ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => problems.push(`${tag} pageerror: ${String(e).slice(0, 200)}`));
  page.on("requestfailed", (r) => problems.push(`${tag} reqfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => { if (r.status() >= 500) problems.push(`${tag} ${r.status()} ${r.url()}`); });
}

async function login(email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, "login:" + email);
  await page.goto(BASE + "/login");
  await page.getByPlaceholder("name@yourcollege.edu").fill(email);
  await page.getByPlaceholder("Enter your password").fill(PW);
  await page.locator("form button[type=submit], form button:has-text('Sign in')").first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 }).catch(() => {});
  return { ctx, page };
}

// ---- invalid login shows error and stays
{
  const ctx = await browser.newContext(); const page = await ctx.newPage(); watch(page, "badlogin");
  await page.goto(BASE + "/login");
  await page.getByPlaceholder("name@yourcollege.edu").fill("stu@alpha.edu");
  await page.getByPlaceholder("Enter your password").fill("wrongpass1");
  await page.locator("form button[type=submit]").first().click();
  await page.waitForTimeout(1500);
  log(page.url().includes("/login") && (await page.locator("[role=alert], .text-danger, [class*=danger]").count()) > 0, "bad login stays on /login with visible error");
  await page.goto(BASE + "/chat"); await page.waitForTimeout(800);
  log(page.url().includes("/login"), "protected /chat redirects anon to /login", page.url());
  await page.goto(BASE + "/admin"); await page.waitForTimeout(800);
  log(page.url().includes("/login"), "protected /admin redirects anon to /login", page.url());
  await ctx.close();
}

// ---- student journey
const stu = await login("stu@alpha.edu");
log(stu.page.url().includes("/chat"), "student lands on /chat", stu.page.url());
{
  const p = stu.page;
  const box = p.locator("textarea").first();
  await box.fill("What is the minimum attendance required for exams?");
  await box.press("Enter");
  await p.waitForSelector("text=/75%|Offline demo/i", { timeout: 20000 }).catch(() => {});
  const txt = await p.locator("main").innerText();
  log(/75%|attendance/i.test(txt), "student chat answer renders", txt.slice(-200));
  log(/Attendance Policy 2026/.test(txt), "citation source title visible in UI");
  const copy = p.getByRole("button", { name: /copy/i }).first();
  log((await copy.count()) > 0, "copy button present");
  const down = p.getByRole("button", { name: /not helpful|helpful/i });
  log((await down.count()) > 0, "feedback buttons present");
  // admin route as student
  await p.goto(BASE + "/admin"); await p.waitForTimeout(1000);
  log(!p.url().endsWith("/admin"), "student blocked from /admin in UI", p.url());
  await p.goto(BASE + "/notifications"); await p.waitForTimeout(1200);
  const nt = await p.locator("main").innerText();
  log(/Students only/.test(nt) && /For both/.test(nt) && !/Faculty only/.test(nt), "student notifications page targeting", nt.slice(0, 200));
  await p.goto(BASE + "/reminders"); await p.waitForTimeout(1200);
  log(/Fee deadline/.test(await p.locator("main").innerText()), "student reminders page shows reminder");
  await p.goto(BASE + "/profile"); await p.waitForTimeout(1000);
  log((await p.locator("input").count()) > 0, "profile renders inputs");
}

// ---- faculty
const fac = await login("fac@staff.alpha.edu");
{
  const p = fac.page;
  await p.goto(BASE + "/notifications"); await p.waitForTimeout(1200);
  const nt = await p.locator("main").innerText();
  log(/Faculty only/.test(nt) && /For both/.test(nt) && !/Students only/.test(nt), "faculty notifications targeting", nt.slice(0, 200));
  await p.goto(BASE + "/reminders"); await p.waitForTimeout(1200);
  log(!/Fee deadline/.test(await p.locator("main").innerText()), "faculty doesn't see student reminder");
}

// ---- admin
const adm = await login("admin@alpha.edu");
{
  const p = adm.page;
  log(p.url().includes("/admin"), "admin lands in /admin", p.url());
  for (const r of ["/admin", "/admin/documents", "/admin/notifications", "/admin/insights", "/admin/conflicts", "/admin/logins", "/admin/settings"]) {
    await p.goto(BASE + r); await p.waitForTimeout(1200);
    const t = await p.locator("main").innerText().catch(() => "");
    log(p.url().endsWith(r) && t.length > 20, "admin route " + r, p.url() + " " + t.slice(0, 80));
  }
  await p.goto(BASE + "/admin/documents"); await p.waitForTimeout(1000);
  log(/Attendance Policy 2026/.test(await p.locator("main").innerText()), "admin documents list shows uploaded doc");
  await p.goto(BASE + "/admin/insights"); await p.waitForTimeout(1200);
  log(/उपस्थिति|swallow|வருகை/i.test(await p.locator("main").innerText()), "insights shows unanswered questions");
  // user menu / logout
  const menu = p.getByRole("button", { name: /account|user menu|profile/i }).first();
  if (await menu.count()) { await menu.click(); await p.waitForTimeout(300); }
  const lo = p.getByRole("menuitem", { name: /sign out|log ?out/i }).or(p.getByRole("button", { name: /sign out|log ?out/i })).first();
  if (await lo.count()) { await lo.click(); await p.waitForTimeout(1200); log(/\/(login)?$/.test(new URL(p.url()).pathname), "admin logout leaves app", p.url()); }
  else log(false, "logout control found");
  await p.goto(BASE + "/admin"); await p.waitForTimeout(1000);
  log(p.url().includes("/login"), "after logout /admin redirects to login", p.url());
}

// ---- responsive/theme sweep
const widths = [320, 375, 390, 414, 768, 1024, 1280, 1440];
const roleRoutes = [
  [null, ["/", "/login", "/register", "/register-college", "/privacy", "/terms", "/nope"]],
  [stu, ["/chat", "/notifications", "/reminders", "/profile"]],
  [await login("admin@alpha.edu"), ["/admin", "/admin/documents", "/admin/notifications", "/admin/insights", "/admin/conflicts", "/admin/logins", "/admin/settings"]],
];
let overflow = 0, swept = 0;
for (const theme of ["light", "dark"]) {
  for (const [who, routes] of roleRoutes) {
    const ctx = who ? who.ctx : await browser.newContext();
    const page = who ? who.page : await ctx.newPage();
    if (!who) watch(page, "anon");
    await page.emulateMedia({ colorScheme: theme });
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 800 });
      for (const r of routes) {
        await page.goto(BASE + r); await page.waitForTimeout(500);
        const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        swept++;
        if (o > 1) { overflow++; console.log(`FAIL overflow ${theme} ${w}px ${r}: +${o}`); }
      }
    }
  }
}
log(overflow === 0, `no horizontal overflow across ${swept} route/width/theme combos`, overflow + " overflows");

// ---- PWA/SEO assets
{
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  for (const a of ["/favicon.svg", "/favicon.ico", "/favicon-16x16.png", "/favicon-32x32.png", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/site.webmanifest", "/robots.txt", "/sitemap.xml"]) {
    const r = await page.request.get(BASE + a);
    console.log(`  asset ${a} ${r.status()} ${r.headers()["content-type"]}`);
    log(r.status() === 200 && !/text\/html/.test(r.headers()["content-type"] || ""), "asset " + a);
  }
}

console.log("\nconsole/page/request problems:", problems.length);
[...new Set(problems)].slice(0, 25).forEach((p) => console.log("  " + p));
console.log(`\n${out.filter(Boolean).length}/${out.length} browser checks passed`);
await browser.close();
