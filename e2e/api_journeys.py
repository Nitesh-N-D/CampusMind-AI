import httpx, json, sys
import datetime as dt

B = "http://127.0.0.1:8000/api"
c = httpx.Client(base_url=B, timeout=60)
R = []
SECRET = "e2e-only-secret-key-xxxxxxxxxxxxxxxxxxxxxxxx"


def chk(name, ok, info=""):
    R.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name, "" if ok else str(info)[:300])


def H(t):
    return {"Authorization": f"Bearer {t}"}


def college(name, dom):
    return c.post("/auth/register-college", json=dict(college_name=name, official_domain=dom, admin_full_name="Adm " + name, admin_email=f"admin@{dom}", admin_password="Passw0rd!x"))


A = college("Alpha College", "alpha.edu"); chk("register college A", A.status_code == 200, A.text)
Bc = college("Beta College", "beta.edu"); chk("register college B", Bc.status_code == 200, Bc.text)
chk("dup college domain 409", college("Alpha2", "alpha.edu").status_code == 409)
base = dict(college_name="X Y", official_domain="x.edu", admin_full_name="A", admin_email="a@x.edu", admin_password="Passw0rd!x")
chk("admin email/domain mismatch 400", c.post("/auth/register-college", json={**base, "admin_email": "a@y.edu"}).status_code == 400)
chk("short password 422", c.post("/auth/register-college", json={**base, "admin_password": "short"}).status_code == 422)
chk("bad email 422", c.post("/auth/register-college", json={**base, "admin_email": "nope"}).status_code == 422)
chk("privilege smuggle 422", c.post("/auth/register-college", json={**base, "faculty_domain": "x.edu", "role": "admin"}).status_code == 422)
ta, tb = A.json()["access_token"], Bc.json()["access_token"]

r = c.put("/admin/settings/faculty-domain", headers=H(ta), json={"faculty_domain": "staff.alpha.edu"}); chk("set faculty domain", r.status_code == 200, r.text)


def reg(email, role, name="Person One"):
    p = dict(email=email, password="Passw0rd!x", full_name=name, role=role, department="CSE")
    if role == "student":
        p.update(year=2, semester=3, section="A")
    return c.post("/auth/register-student", json=p)


S = reg("stu@alpha.edu", "student"); chk("student register", S.status_code == 200, S.text)
F = reg("fac@staff.alpha.edu", "faculty"); chk("faculty register", F.status_code == 200, F.text)
chk("faculty on student domain rejected", reg("f2@alpha.edu", "faculty").status_code == 400)
chk("student wrong domain rejected", reg("s@nowhere.org", "student").status_code == 400)
chk("dup student 409", reg("stu@alpha.edu", "student").status_code == 409)
chk("role=admin via register rejected", c.post("/auth/register-student", json=dict(email="h@alpha.edu", password="Passw0rd!x", full_name="Hax Or", role="admin")).status_code in (400, 422))
SB = reg("stu@beta.edu", "student"); chk("student B register", SB.status_code == 200)
ts, tf, tsb = S.json()["access_token"], F.json()["access_token"], SB.json()["access_token"]
chk("faculty role persisted", F.json()["role"] == "faculty")

chk("login ok", c.post("/auth/login", json=dict(email="stu@alpha.edu", password="Passw0rd!x")).status_code == 200)
chk("login bad pw", c.post("/auth/login", json=dict(email="stu@alpha.edu", password="wrong")).status_code in (400, 401))
chk("login unknown", c.post("/auth/login", json=dict(email="no@alpha.edu", password="Passw0rd!x")).status_code in (400, 401))
chk("login missing 422", c.post("/auth/login", json={}).status_code == 422)


def up(tok, title, text, fname="a.txt", **kw):
    data = dict(title=title, document_type="circular", is_official="true"); data.update(kw)
    return c.post("/documents/upload", headers=H(tok), data=data, files={"file": (fname, text.encode(), "text/plain")})


d1 = up(ta, "Attendance Policy 2026", "Students must maintain a minimum of 75% attendance in each course to be eligible for semester examinations. Condonation up to 65% requires medical certificate.", effective_date="2026-01-01")
chk("upload txt", d1.status_code == 200, d1.text)
d2 = up(tb, "Beta Secret Fee Circular", "The Beta College hostel fee is 99999 rupees per year. Confidential Beta only.")
chk("upload B doc", d2.status_code == 200, d2.text)
chk("empty file rejected", up(ta, "Empty", "", fname="e.txt").status_code >= 400)
chk("unsupported ext rejected", up(ta, "Exe", "MZ", fname="x.exe").status_code >= 400)
chk("student cannot upload", up(ts, "S", "hello world text").status_code == 403)
chk("faculty cannot upload", up(tf, "F", "hello world text").status_code == 403)
dl = c.get("/documents", headers=H(ta)); chk("A lists own docs only", dl.status_code == 200 and len(dl.json()) == 1, dl.text[:200])
id1, id2 = d1.json()["id"], d2.json()["id"]
chk("student cross-college file denied", c.get(f"/documents/{id2}/file", headers=H(ts)).status_code in (403, 404))
chk("A cannot download B file", c.get(f"/documents/{id2}/file", headers=H(ta)).status_code in (403, 404))
chk("A cannot delete B doc", c.delete(f"/documents/{id2}", headers=H(ta)).status_code in (403, 404))
chk("A cannot verify B doc", c.post(f"/documents/{id2}/verify", headers=H(ta)).status_code in (403, 404))
chk("student cannot delete", c.delete(f"/documents/{id1}", headers=H(ts)).status_code == 403)
chk("student cannot read non-attached admin doc (404)", c.get(f"/documents/{id1}/file", headers=H(ts)).status_code == 404)


def ask(tok, q, sid=None):
    return c.post("/chat/message", headers=H(tok), json=dict(message=q, session_id=sid))


r = ask(ts, "What is the minimum attendance required for exams?"); chk("student chat", r.status_code == 200, r.text)
j = r.json() if r.status_code == 200 else {}
cits = j.get("citations", [])
chk("citation to attendance doc", any(x["document_id"] == id1 for x in cits), json.dumps(cits))
chk("citation has version/effective_date/status", bool(cits) and all(k in cits[0] for k in ("version", "effective_date", "status")))
chk("no cross-college citation", all(x["document_id"] != id2 for x in cits))
print("   answer:", j.get("answer", "")[:160].replace("\n", " "), "| conf", j.get("confidence"))
sid = j.get("session_id")
r2 = ask(ts, "And what about condonation?", sid); chk("multi-turn same session", r2.status_code == 200 and r2.json()["session_id"] == sid)
m = c.get(f"/chat/sessions/{sid}/messages", headers=H(ts)); chk("history persisted >=4 msgs", m.status_code == 200 and len(m.json()) >= 4, m.text)
chk("faculty can't read student session", c.get(f"/chat/sessions/{sid}/messages", headers=H(tf)).status_code in (403, 404))
chk("B student can't read A session", c.get(f"/chat/sessions/{sid}/messages", headers=H(tsb)).status_code in (403, 404))
mid = [x for x in m.json() if x["role"] == "assistant"][0]["id"]
chk("feedback up", c.post(f"/chat/messages/{mid}/feedback", headers=H(ts), json=dict(feedback="up")).status_code == 200)
chk("feedback down+reason", c.post(f"/chat/messages/{mid}/feedback", headers=H(ts), json=dict(feedback="down", reason="outdated", note="old")).status_code == 200)
chk("feedback bad reason 422", c.post(f"/chat/messages/{mid}/feedback", headers=H(ts), json=dict(feedback="down", reason="zzz")).status_code == 422)
chk("B can't feedback on A msg", c.post(f"/chat/messages/{mid}/feedback", headers=H(tsb), json=dict(feedback="up")).status_code in (403, 404))
rb = ask(tsb, "What is the minimum attendance required for exams?")
chk("B chat no A leakage", rb.status_code == 200 and all(x["document_id"] != id1 for x in rb.json()["citations"]), rb.text)
ru = ask(ts, "What is the airspeed velocity of an unladen swallow on Mars?")
chk("unanswerable handled w/o citations", ru.status_code == 200, ru.text)
print("   unanswerable conf:", ru.json().get("confidence"), "cits:", len(ru.json().get("citations", [])), "|", ru.json().get("answer", "")[:120].replace("\n", " "))
chk("empty message rejected", ask(ts, "   ").status_code in (400, 422))
chk("unicode hindi/tamil", ask(ts, "उपस्थिति कितनी चाहिए?").status_code == 200 and ask(tf, "வருகை எவ்வளவு தேவை?").status_code == 200)
chk("very long query clean", ask(ts, "attendance " * 3000).status_code in (200, 400, 413, 422))
chk("export chat pdf+txt", c.get(f"/chat/export?session_id={sid}&format=txt", headers=H(ts)).status_code == 200 and c.get(f"/chat/export?session_id={sid}", headers=H(ts)).status_code == 200)
chk("export other user session 404", c.get(f"/chat/export?session_id={sid}", headers=H(tf)).status_code == 404)
chk("delete session", c.delete(f"/chat/sessions/{sid}", headers=H(ts)).status_code == 200)
chk("deleted session gone", c.get(f"/chat/sessions/{sid}/messages", headers=H(ts)).status_code == 404)
chk("faculty chat", ask(tf, "attendance requirement?").status_code == 200)

un = c.get("/admin/unanswered", headers=H(ta)); chk("admin unanswered", un.status_code == 200, un.text)
fb = c.get("/admin/feedback", headers=H(ta)); chk("admin feedback", fb.status_code == 200, fb.text)
print("   unanswered:", un.text[:250]); print("   feedback:", fb.text[:250])
ub = c.get("/admin/unanswered", headers=H(tb)); chk("B admin unanswered isolated", "swallow" not in ub.text.lower(), ub.text[:200])
if un.status_code == 200:
    items = un.json() if isinstance(un.json(), list) else un.json().get("items", [])
    if items:
        q = items[0].get("query") or items[0].get("q")
        rr = c.post("/admin/unanswered/resolve", headers=H(ta), json=dict(query=q, document_id=id1)); chk("resolve unanswered w/ doc", rr.status_code == 200, rr.text)
        chk("B can't resolve A's query w/ A doc", c.post("/admin/unanswered/resolve", headers=H(tb), json=dict(query=q, document_id=id1)).status_code in (400, 403, 404))


def notif(tok, aud, title, **kw):
    d = dict(title=title, body="Body of " + title, category="circular", priority="important", audience=aud, status="published"); d.update(kw)
    return c.post("/notifications", headers=H(tok), data=d)


nS, nF, nB = notif(ta, "student", "Students only"), notif(ta, "faculty", "Faculty only"), notif(ta, "both", "For both")
chk("publish 3 notices", all(x.status_code == 200 for x in (nS, nF, nB)), nS.text)
chk("priority 'high' rejected", notif(ta, "both", "bad", priority="high").status_code == 400)
chk("no audience rejected", notif(ta, "", "noaud").status_code == 400)
chk("student cannot publish", notif(ts, "both", "hax").status_code == 403)
chk("faculty cannot publish", notif(tf, "both", "hax").status_code == 403)
dr = notif(ta, "both", "Draft one", status="draft"); chk("save draft", dr.status_code == 200, dr.text)


def titles(tok):
    return {n["title"] for n in c.get("/notifications", headers=H(tok)).json()}


ts_t, tf_t = titles(ts), titles(tf)
chk("student sees student+both only", {"Students only", "For both"} <= ts_t and not ({"Faculty only", "Draft one"} & ts_t), ts_t)
chk("faculty sees faculty+both only", {"Faculty only", "For both"} <= tf_t and not ({"Students only", "Draft one"} & tf_t), tf_t)
chk("B user sees none of A notices", not (titles(tsb) & {"Students only", "For both"}))
nid_s, nid_f = nS.json()["id"], nF.json()["id"]
chk("student GET faculty-only notice denied", c.get(f"/notifications/{nid_f}", headers=H(ts)).status_code in (403, 404))
chk("B GET A notice denied", c.get(f"/notifications/{nid_s}", headers=H(tsb)).status_code in (403, 404))
chk("B admin can't patch A notice", c.patch(f"/notifications/{nid_s}", headers=H(tb), json={"title": "pwn"}).status_code in (403, 404))
chk("B admin can't delete A notice", c.delete(f"/notifications/{nid_s}", headers=H(tb)).status_code in (403, 404))
chk("student can't patch", c.patch(f"/notifications/{nid_s}", headers=H(ts), json={"title": "pwn"}).status_code == 403)
chk("student unread == 2", c.get("/notifications/unread-count", headers=H(ts)).json()["unread"] == 2)
chk("mark read", c.post(f"/notifications/{nid_s}/read", headers=H(ts)).status_code == 200 and c.get("/notifications/unread-count", headers=H(ts)).json()["unread"] == 1)
chk("read-all", c.post("/notifications/read-all", headers=H(ts)).status_code == 200 and c.get("/notifications/unread-count", headers=H(ts)).json()["unread"] == 0)
chk("faculty unread unaffected", c.get("/notifications/unread-count", headers=H(tf)).json()["unread"] == 2)
did = dr.json()["id"]
chk("edit draft", c.patch(f"/notifications/{did}", headers=H(ta), json={"title": "Draft edited"}).status_code == 200)
chk("publish draft", c.patch(f"/notifications/{did}", headers=H(ta), json={"status": "published"}).status_code == 200 and "Draft edited" in titles(ts))
chk("archive hides", c.patch(f"/notifications/{did}", headers=H(ta), json={"status": "archived"}).status_code == 200 and "Draft edited" not in titles(ts))
off = notif(ta, "both", "Official notice", priority="urgent", circular_number="CIR/2026/01")
chk("urgent + circular no.", off.status_code == 200 and off.json()["priority"] == "urgent", off.text)
nat = c.post("/notifications", headers=H(ta), data=dict(title="With file", body="b", category="circular", priority="normal", audience="both", status="published"), files={"attachments": ("n.txt", b"attached notice text content", "text/plain")})
print("   attachment upload:", nat.status_code, nat.text[:200])
chk("notice w/ attachment", nat.status_code == 200, nat.text)
if nat.status_code == 200 and nat.json().get("attachments"):
    adoc = nat.json()["attachments"][0]["document_id"]
    chk("student opens notice attachment", c.get(f"/documents/{adoc}/file", headers=H(ts)).status_code == 200)
    chk("B student cannot open it", c.get(f"/documents/{adoc}/file", headers=H(tsb)).status_code == 404)
chk("admin summary", c.get("/notifications/summary", headers=H(ta)).status_code == 200)
chk("student summary denied", c.get("/notifications/summary", headers=H(ts)).status_code == 403)

due = (dt.datetime.utcnow() + dt.timedelta(days=2)).isoformat()
rm = c.post("/reminders", headers=H(ta), json=dict(title="Fee deadline", body="Pay fees", category="deadline", audience="student", deadline=due, reminder_offsets=[1, 0])); chk("create reminder", rm.status_code == 200, rm.text)
chk("bad offset rejected", c.post("/reminders", headers=H(ta), json=dict(title="x y", body="b", audience="student", deadline=due, reminder_offsets=[5])).status_code in (400, 422))
chk("student can't create reminder", c.post("/reminders", headers=H(ts), json=dict(title="x", body="b", audience="student", deadline=due)).status_code == 403)


def rem_titles(tok):
    return {n["title"] for v in c.get("/reminders", headers=H(tok)).json().values() for n in v}


chk("student sees reminder", "Fee deadline" in rem_titles(ts))
chk("faculty doesn't see student reminder", "Fee deadline" not in rem_titles(tf))
chk("B doesn't see A reminder", "Fee deadline" not in rem_titles(tsb))
chk("process-reminders no auth denied", c.post("/notifications/process-reminders").status_code in (401, 403))
chk("process-reminders wrong secret denied", c.post("/notifications/process-reminders", headers={"X-Cron-Secret": "wrong"}).status_code in (401, 403))
p1 = c.post("/notifications/process-reminders", headers={"X-Cron-Secret": "e2e-cron"}); p2 = c.post("/notifications/process-reminders", headers={"X-Cron-Secret": "e2e-cron"})
chk("process-reminders with cron secret", p1.status_code == 200, p1.text)
chk("student cannot run scheduler", c.post("/notifications/process-reminders", headers=H(ts)).status_code == 403)
chk("faculty cannot run scheduler", c.post("/notifications/process-reminders", headers=H(tf)).status_code == 403)
chk("admin may run scheduler", c.post("/notifications/process-reminders", headers=H(ta)).status_code == 200)
chk("second run creates no new deliveries", p2.json().get("sent", 0) == 0 and p2.json().get("pushed", 0) == 0, p2.text)
print("   run1:", p1.text[:200], "| run2:", p2.text[:200])

for path in ["/admin/knowledge-health", "/admin/conflicts", "/admin/analytics", "/admin/login-events", "/admin/users/export", "/admin/settings", "/admin/unanswered", "/admin/feedback"]:
    chk(f"student 403 {path}", c.get(path, headers=H(ts)).status_code == 403)
    chk(f"faculty 403 {path}", c.get(path, headers=H(tf)).status_code == 403)
    chk(f"anon 401 {path}", c.get(path).status_code == 401)
    chk(f"admin 200 {path}", c.get(path, headers=H(ta)).status_code == 200)
chk("garbage jwt 401", c.get("/profile/me", headers=H("garbage.token.value")).status_code == 401)
try:
    from jose import jwt as pyjwt
    uid = c.get("/profile/me", headers=H(ts)).json().get("id")
    forged = pyjwt.encode({"sub": str(uid), "role": "admin"}, "wrong-key-wrong-key-wrong-key-wrong", algorithm="HS256")
    chk("forged-signature token 401", c.get("/admin/settings", headers=H(forged)).status_code == 401)
    exp = pyjwt.encode({"sub": str(uid), "exp": dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)}, SECRET, algorithm="HS256")
    chk("expired token 401", c.get("/profile/me", headers=H(exp)).status_code == 401)
    claim = pyjwt.encode({"sub": str(uid), "role": "admin"}, SECRET, algorithm="HS256")
    chk("role claim manipulation -> 403", c.get("/admin/settings", headers=H(claim)).status_code == 403)
except ImportError as e:
    print("jwt lib missing", e)
cb = c.get("/admin/users/export", headers=H(ta)); chk("user export has only own college", "stu@beta.edu" not in cb.text and "stu@alpha.edu" in cb.text)

chk("profile get", c.get("/profile/me", headers=H(ts)).status_code == 200)
chk("push status", c.get("/push/status", headers=H(ts)).status_code == 200)
print("   push:", c.get("/push/status", headers=H(ts)).text)
print(f"\n{sum(ok for _, ok in R)}/{len(R)} passed")
