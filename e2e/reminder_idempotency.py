"""A reminder that genuinely becomes due (created ~45s ahead, then we wait; the
clock is never changed) is processed twice via the real scheduler endpoint.
Against the integration server (CRON_SECRET=int-cron)."""
import datetime as dt, time, uuid, httpx
c = httpx.Client(base_url="http://127.0.0.1:8000/api", timeout=60)
tag = uuid.uuid4().hex[:6]; dom = f"rem{tag}.edu"; PW = "Passw0rd!x"
H = lambda t: {"Authorization": "Bearer " + t}
adm = c.post("/auth/register-college", json=dict(college_name="Rem " + tag, official_domain=dom, admin_full_name="Admin Person", admin_email=f"a@{dom}", admin_password=PW)).json()["access_token"]
stu = c.post("/auth/register-student", json=dict(email=f"s@{dom}", password=PW, full_name="Rem Student", role="student", department="CSE", year=1, semester=1, section="A")).json()["access_token"]
now = dt.datetime.utcnow()
r = c.post("/reminders", headers=H(adm), json=dict(title="Idem " + tag, body="due soon", category="deadline", audience="student",
    deadline=(now + dt.timedelta(days=3)).isoformat(), reminder_date=(now + dt.timedelta(seconds=40)).isoformat()))
print("create:", r.status_code, r.text[:120] if r.status_code != 200 else "ok")
cron = {"X-Cron-Secret": "int-cron"}
p0 = c.post("/notifications/process-reminders", headers=cron).json(); print("run before due:", p0)
unread0 = c.get("/notifications/unread-count", headers=H(stu)).json()["unread"]
time.sleep(50)
p1 = c.post("/notifications/process-reminders", headers=cron).json(); print("run 1 (due):", p1)
u1 = c.get("/notifications/unread-count", headers=H(stu)).json()["unread"]
p2 = c.post("/notifications/process-reminders", headers=cron).json(); print("run 2:", p2)
p3 = c.post("/notifications/process-reminders", headers=H(adm)).json(); print("run 3 (admin):", p3)
u2 = c.get("/notifications/unread-count", headers=H(stu)).json()["unread"]
ok = [p0["sent"] == 0, p1["sent"] == 1, p2["sent"] == 0, p3["sent"] == 0, u2 == u1]
print("PASS" if all(ok) else "FAIL", "idempotency checks", ok, "| unread before/after run1/after run2/3:", unread0, u1, u2)
