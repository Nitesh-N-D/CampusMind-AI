"""Document-scoped chat: a question tied to one document may only be answered
from that document's chunks."""
import asyncio

from app.db import models
from app.db.database import get_db
from app.main import app


def TestingSessionLocal():
    """A session on the same in-memory database the test client uses."""
    return next(app.dependency_overrides[get_db]())


NO_INFO = "The selected document does not contain enough information to answer this question."


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _upload_text(client, token, title, text, **fields):
    resp = client.post(
        "/api/documents/upload",
        headers=_auth(token),
        files={"file": (f"{title}.txt", text.encode(), "text/plain")},
        data={"title": title, "document_type": "general_notice", "is_official": "true", **fields},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _ask(client, token, message, document_id=None):
    body = {"message": message, "session_id": None, "language": "en"}
    if document_id is not None:
        body["document_id"] = document_id
    return client.post("/api/chat/message", headers=_auth(token), json=body)


def _two_docs(client, admin_token):
    a = _upload_text(client, admin_token, "Doc Alpha", "The project code is ALPHA-101.")
    b = _upload_text(
        client, admin_token, "Doc Beta", "The project code is BETA-202.\n\nThe cafeteria opens at 8 AM daily."
    )
    return a, b


def test_a_selecting_document_a_answers_from_a_only(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    a, _b = _two_docs(client, admin_token)
    resp = _ask(client, student_token, "What is the project code?", a["id"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "ALPHA-101" in body["answer"]
    assert "BETA-202" not in body["answer"]
    assert {c["document_id"] for c in body["citations"]} == {a["id"]}


def test_b_switching_to_document_b_changes_scope(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    a, b = _two_docs(client, admin_token)
    body = _ask(client, student_token, "What is the project code?", b["id"]).json()
    assert "BETA-202" in body["answer"]
    assert "ALPHA-101" not in body["answer"]
    assert {c["document_id"] for c in body["citations"]} == {b["id"]}


def test_c_question_only_other_document_answers_is_declined(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    a, _b = _two_docs(client, admin_token)
    body = _ask(client, student_token, "When does the cafeteria open?", a["id"]).json()
    assert body["answer"] == NO_INFO
    assert body["citations"] == []
    assert body["abstained"] is True


def test_d_unanswerable_question_is_not_fabricated(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    a, _b = _two_docs(client, admin_token)
    body = _ask(client, student_token, "Who won the football world cup in 2018?", a["id"]).json()
    assert body["answer"] == NO_INFO
    assert body["citations"] == []


def test_e_many_documents_keep_their_own_chunks(client, college_and_admin):
    admin_token, _ = college_and_admin
    ids = {}
    for n in range(5):
        doc = _upload_text(client, admin_token, f"Doc {n}", f"Marker token ZZ{n}QQ appears here.\n\nMore text {n}.")
        ids[doc["id"]] = f"ZZ{n}QQ"
    assert len(ids) == 5
    db = TestingSessionLocal()
    try:
        for doc_id, marker in ids.items():
            chunks = db.query(models.DocumentChunk).filter_by(document_id=doc_id).all()
            assert chunks
            joined = " ".join(c.content for c in chunks)
            assert marker in joined
            for other_id, other_marker in ids.items():
                if other_id != doc_id:
                    assert other_marker not in joined
    finally:
        db.close()


def test_f_retrieval_only_returns_selected_document_chunks(client, college_and_admin):
    from app.rag.pipeline import retrieve

    admin_token, _ = college_and_admin
    a, b = _two_docs(client, admin_token)
    db = TestingSessionLocal()
    try:
        college_id = db.get(models.Document, a["id"]).college_id
        for doc in (a, b):
            results = asyncio.run(retrieve(db, college_id, "What is the project code?", document_id=doc["id"]))
            assert results
            assert {r.document.id for r in results} == {doc["id"]}
        unscoped = asyncio.run(retrieve(db, college_id, "What is the project code?"))
        assert {r.document.id for r in unscoped} == {a["id"], b["id"]}
    finally:
        db.close()


def test_g_user_cannot_query_unauthorized_document(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    # Another college's document, and another department's document.
    other = client.post(
        "/api/auth/register-college",
        json={
            "college_name": "Other College",
            "official_domain": "other.edu",
            "admin_email": "admin@other.edu",
            "admin_full_name": "Other Admin",
            "admin_password": "adminpass123",
        },
    ).json()["access_token"]
    foreign = _upload_text(client, other, "Foreign", "The project code is GAMMA-303.")
    mech = _upload_text(client, admin_token, "Mech Only", "The lab code is MECH-9.", department="MECH")

    for doc in (foreign, mech):
        resp = _ask(client, student_token, "What is the code?", doc["id"])
        assert resp.status_code == 404
        assert "GAMMA" not in resp.text and "MECH-9" not in resp.text
    assert _ask(client, student_token, "What is the code?", 999999).status_code == 404

    listed = client.get("/api/chat/documents", headers=_auth(student_token)).json()
    assert foreign["id"] not in {d["id"] for d in listed}
    assert mech["id"] not in {d["id"] for d in listed}


def test_h_failed_processing_leaves_other_documents_intact(client, college_and_admin, monkeypatch):
    from app.ingestion import pipeline
    from app.services.embedding_provider import get_embedding_provider

    admin_token, _ = college_and_admin
    good = _upload_text(client, admin_token, "Good Doc", "The project code is ALPHA-101.")

    real = get_embedding_provider()

    class Boom:
        is_semantic = real.is_semantic

        async def embed(self, text):
            raise RuntimeError("embedding outage")

    monkeypatch.setattr(pipeline, "get_embedding_provider", lambda: Boom())
    resp = client.post(
        "/api/documents/upload",
        headers=_auth(admin_token),
        files={"file": ("Bad Doc.txt", b"The project code is BETA-202.", "text/plain")},
        data={"title": "Bad Doc", "document_type": "general_notice", "is_official": "true"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "failed"

    db = TestingSessionLocal()
    try:
        bad = db.query(models.Document).filter_by(title="Bad Doc").one()
        assert bad.status == models.DocumentStatus.FAILED
        assert db.query(models.DocumentChunk).filter_by(document_id=bad.id).count() == 0
        assert db.get(models.Document, good["id"]).status == models.DocumentStatus.READY
        assert db.query(models.DocumentChunk).filter_by(document_id=good["id"]).count() >= 1
    finally:
        db.close()


def test_unready_document_gives_clear_error(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    a, _b = _two_docs(client, admin_token)
    db = TestingSessionLocal()
    try:
        db.get(models.Document, a["id"]).status = models.DocumentStatus.PROCESSING
        db.commit()
    finally:
        db.close()
    resp = _ask(client, student_token, "What is the project code?", a["id"])
    assert resp.status_code == 409
    assert "still being processed" in resp.json()["detail"]


def test_reprocessing_does_not_duplicate_or_touch_other_documents(client, college_and_admin):
    from app.ingestion.pipeline import process_document

    admin_token, _ = college_and_admin
    a, b = _two_docs(client, admin_token)
    db = TestingSessionLocal()
    try:
        before_b = db.query(models.DocumentChunk).filter_by(document_id=b["id"]).count()
        before_a = db.query(models.DocumentChunk).filter_by(document_id=a["id"]).count()
        asyncio.run(process_document(db, db.get(models.Document, a["id"])))
        assert db.query(models.DocumentChunk).filter_by(document_id=a["id"]).count() == before_a
        assert db.query(models.DocumentChunk).filter_by(document_id=b["id"]).count() == before_b
    finally:
        db.close()


def test_deleting_document_leaves_no_orphan_chunks(client, college_and_admin):
    admin_token, _ = college_and_admin
    a, b = _two_docs(client, admin_token)
    assert client.delete(f"/api/documents/{a['id']}", headers=_auth(admin_token)).status_code == 200
    db = TestingSessionLocal()
    try:
        assert db.query(models.DocumentChunk).filter_by(document_id=a["id"]).count() == 0
        assert db.query(models.DocumentChunk).filter_by(document_id=b["id"]).count() >= 1
    finally:
        db.close()
