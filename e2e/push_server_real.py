"""Real VAPID-signed delivery attempt against the real FCM service, to a
synthetic, never-registered endpoint (no real device or user can receive it).
Verifies: VAPID keys sign accepted requests, the push service answers, and
the server handles the expired/unknown-endpoint response. Needs the
integration server (e2e/serve_integration.sh)."""
import base64, os, time, uuid, httpx
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization

c = httpx.Client(base_url="http://127.0.0.1:8000/api", timeout=60)
tag = uuid.uuid4().hex[:6]; dom = f"pushs{tag}.edu"; PW = "Passw0rd!x"
H = lambda t: {"Authorization": "Bearer " + t}
adm = c.post("/auth/register-college", json=dict(college_name="PushS " + tag, official_domain=dom, admin_full_name="Admin Person", admin_email=f"a@{dom}", admin_password=PW)).json()["access_token"]
stu = c.post("/auth/register-student", json=dict(email=f"s@{dom}", password=PW, full_name="Push Student", role="student", department="CSE", year=1, semester=1, section="A")).json()["access_token"]
st = c.get("/push/status", headers=H(stu)).json()
print("PASS" if st["configured"] and st["public_key"] else "FAIL", "push configured, public key served; private key in response:", "private" in str(st).lower())
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
k = ec.generate_private_key(ec.SECP256R1())
p256dh = b64(k.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
auth = b64(os.urandom(16))
ep = "https://fcm.googleapis.com/fcm/send/" + b64(os.urandom(48))
r = c.post("/push/subscribe", headers=H(stu), json=dict(endpoint=ep, keys=dict(p256dh=p256dh, auth=auth)))
print("PASS" if r.status_code == 200 and r.json()["devices"] == 1 else "FAIL", "subscribe synthetic endpoint", r.status_code)
r = c.post("/push/subscribe", headers=H(stu), json=dict(endpoint="https://evil.example.com/x", keys=dict(p256dh=p256dh, auth=auth)))
print("PASS" if r.status_code == 400 else "FAIL", "non-push host rejected", r.status_code)
n = c.post("/notifications", headers=H(adm), data=dict(title="Push server check " + tag, body="synthetic", category="circular", priority="important", audience="student", status="published"))
print("PASS" if n.status_code == 200 else "FAIL", "publish triggers send", n.status_code)
time.sleep(8)
d = c.get("/push/status", headers=H(stu)).json()["devices"]
print("RESULT devices after delivery attempt:", d, "(0 = push service reported endpoint gone and server retired it; 1 = still registered)")
