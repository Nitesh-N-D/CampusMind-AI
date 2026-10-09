"""Memory guards for the heaviest work the server does: reading uploads and
recognising text in pictures. They exist so a small host (512 MB) is not run
out of memory by one large photo, one scanned PDF, or a burst of uploads."""
import asyncio
import io
import threading
import time

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFont

from app.core.config import settings
from app.ingestion import extractors
from app.ingestion.extractors import ExtractionError, ocr_image
from app.services import document_upload


class RecordingEngine:
    """Stands in for the OCR engine: records what it is handed and reports a
    line wherever the picture carries a marker. A marker is a pixel in column
    0 whose red channel is 0 and whose green channel is the marker's id."""

    def __init__(self):
        self.shapes = []
        self.active = 0
        self.peak_active = 0
        self._lock = threading.Lock()

    def __call__(self, array):
        with self._lock:
            self.active += 1
            self.peak_active = max(self.peak_active, self.active)
        try:
            self.shapes.append(array.shape)
            time.sleep(0.01)
            found = []
            for y in np.where(array[:, 0, 0] == 0)[0]:
                x2 = array.shape[1] - 1
                found.append([[[0, int(y)], [x2, int(y)], [x2, int(y) + 2], [0, int(y) + 2]], f"line{array[y, 0, 1]}", 0.9])
            return found, None
        finally:
            with self._lock:
                self.active -= 1


@pytest.fixture
def engine(monkeypatch):
    fake = RecordingEngine()
    monkeypatch.setattr(extractors, "_get_ocr_engine", lambda: fake)
    return fake


def _marked_picture(width, height, rows):
    """White picture with one marker per row in `rows`; marker ids count from 1."""
    array = np.full((height, width, 3), 255, dtype=np.uint8)
    for n, y in enumerate(rows, start=1):
        array[y, 0] = (0, n, 0)
    return Image.fromarray(array)


def test_tall_picture_is_read_in_bounded_bands_and_no_line_is_lost_or_doubled(engine):
    # 1500x1600 is within the side cap, so no resizing blurs the markers.
    band = max(extractors.OCR_BAND_MIN_ROWS, extractors.OCR_BAND_PIXELS // 1500)
    # Markers on, just before and just after every cut, plus the very ends.
    rows = {0, 1599, 1598}
    for cut in (band, 2 * band - extractors.OCR_BAND_OVERLAP):
        rows |= {cut - 61, cut - 60, cut - 1, cut, cut + 1, cut + 60}
    rows = sorted(r for r in rows if 0 <= r < 1600)

    text = ocr_image(_marked_picture(1500, 1600, rows))

    assert len(engine.shapes) > 1  # actually banded
    for height, width, _ in engine.shapes:
        assert width <= extractors.MAX_OCR_SIDE and height <= extractors.MAX_OCR_SIDE
        assert height * width <= max(extractors.OCR_BAND_PIXELS, extractors.OCR_BAND_MIN_ROWS * width)
    assert text.split("\n") == [f"line{n}" for n in range(1, len(rows) + 1)]


def test_huge_picture_is_shrunk_before_recognition_and_left_untouched(engine):
    picture = Image.new("RGB", (6000, 4000), "white")  # 24 MP, within the pixel limit
    ocr_image(picture)

    assert picture.size == (6000, 4000)
    assert all(max(h, w) <= extractors.MAX_OCR_SIDE for h, w, _ in engine.shapes)


def test_pictures_over_the_pixel_limit_are_still_refused(engine):
    too_big = Image.new("L", (7000, 6000))  # 42 MP
    with pytest.raises(ExtractionError, match="too large"):
        ocr_image(too_big)
    assert engine.shapes == []


def test_only_one_recognition_runs_at_a_time(engine):
    picture = Image.new("RGB", (900, 900), "white")
    threads = [threading.Thread(target=ocr_image, args=(picture,)) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(engine.shapes) == 6
    assert engine.peak_active == 1


def test_a_tall_page_in_real_text_is_read_once_across_the_band_cut():
    """Real engine: lines that straddle the cut between bands appear once."""
    words = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet",
             "Kilo", "Lima", "Mike", "November", "Oscar", "Papa"]
    image = Image.new("RGB", (1500, 2400), "white")
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("arial.ttf", 56)
    except OSError:
        font = ImageFont.load_default(size=56)
    for i, word in enumerate(words):
        draw.text((80, 60 + i * 140), f"Notice {word} applies", fill="black", font=font)

    text = ocr_image(image)

    for word in words:
        assert text.count(word) == 1, f"{word} appeared {text.count(word)} times in:\n{text}"


# ---------- upload reading ----------

class FakeUpload:
    filename = "big.pdf"

    def __init__(self, size):
        self.size = size
        self.asked = []

    async def read(self, n=-1):
        self.asked.append(n)
        return b"%PDF-" + b"0" * ((self.size if n < 0 else min(n, self.size)) - 5)


def test_an_oversized_upload_is_rejected_without_reading_all_of_it(monkeypatch):
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    upload = FakeUpload(size=200 * 1024 * 1024)

    with pytest.raises(Exception) as caught:
        asyncio.run(document_upload.read_and_validate(upload))

    assert getattr(caught.value, "status_code", None) == 400
    assert "1MB limit" in caught.value.detail
    assert upload.asked == [1024 * 1024 + 1]


def test_a_file_exactly_at_the_limit_is_still_accepted(monkeypatch):
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    upload = FakeUpload(size=1024 * 1024)

    _, _, file_type, contents = asyncio.run(document_upload.read_and_validate(upload))

    assert file_type == "pdf" and len(contents) == 1024 * 1024


def test_an_oversized_avatar_is_read_only_up_to_the_limit(client, college_and_admin, monkeypatch):
    from starlette.datastructures import UploadFile

    admin_token, _ = college_and_admin
    monkeypatch.setattr(settings, "max_avatar_mb", 1)
    asked = []
    real_read = UploadFile.read

    async def spy(self, size=-1):
        asked.append(size)
        return await real_read(self, size)

    monkeypatch.setattr(UploadFile, "read", spy)

    resp = client.post(
        "/api/profile/me/avatar",
        headers={"Authorization": f"Bearer {admin_token}"},
        files={"file": ("me.png", b"\x89PNG" + b"0" * (3 * 1024 * 1024), "image/png")},
    )

    assert resp.status_code == 400 and "too large" in resp.json()["detail"].lower()
    assert asked == [1024 * 1024 + 1]


# ---------- concurrency ----------

def test_only_a_few_uploads_are_indexed_at_once(monkeypatch):
    running = {"now": 0, "peak": 0, "done": 0}

    async def fake_create(db, admin, file, **fields):
        running["now"] += 1
        running["peak"] = max(running["peak"], running["now"])
        await asyncio.sleep(0.02)
        running["now"] -= 1
        running["done"] += 1
        return object()

    async def burst():
        # Built inside the running loop so it doesn't outlive this test.
        monkeypatch.setattr(document_upload, "_ingestion_slots", asyncio.Semaphore(document_upload.MAX_CONCURRENT_INGESTIONS))
        monkeypatch.setattr(document_upload, "_create_document", fake_create)
        await asyncio.gather(*[document_upload.create_document(None, None, None) for _ in range(8)])

    asyncio.run(burst())

    assert running["done"] == 8  # every upload is served; none are dropped
    assert running["peak"] == document_upload.MAX_CONCURRENT_INGESTIONS


# ---------- notifications ----------

def test_publishing_without_an_attachment_runs_no_ingestion_ocr_embedding_or_ai(
    client, college_and_admin, student_token, monkeypatch
):
    admin_token, _ = college_and_admin

    def forbidden(*args, **kwargs):
        raise AssertionError("heavy work must not run when publishing a plain notice")

    monkeypatch.setattr("app.api.notifications.create_document", forbidden)
    monkeypatch.setattr(document_upload, "process_document", forbidden)
    monkeypatch.setattr(extractors, "_get_ocr_engine", forbidden)
    monkeypatch.setattr("app.ingestion.pipeline.get_embedding_provider", forbidden)
    monkeypatch.setattr("app.api.chat.get_ai_provider", forbidden)

    resp = client.post(
        "/api/notifications",
        headers={"Authorization": f"Bearer {admin_token}"},
        data={"title": "Holiday", "body": "Closed on Friday.", "category": "circular", "audience": "student"},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["title"] == "Holiday"


def test_a_recognition_failure_is_reported_on_the_document_and_leaves_no_temporary_file(
    client, college_and_admin, monkeypatch
):
    """Even a memory error inside text recognition is contained: the notice
    still publishes, the attachment is marked failed with a plain message,
    and no temporary copy is left on disk."""
    import os

    admin_token, _ = college_and_admin
    headers = {"Authorization": f"Bearer {admin_token}"}

    def explode(*args, **kwargs):
        raise MemoryError("simulated out-of-memory while reading the picture")

    monkeypatch.setattr(extractors, "_get_ocr_engine", explode)
    img = io.BytesIO()
    Image.new("RGB", (400, 200), "white").save(img, "PNG")

    resp = client.post(
        "/api/notifications",
        headers=headers,
        data={"title": "Circular", "body": "See attached.", "category": "circular", "audience": "student"},
        files={"file": ("scan.png", img.getvalue(), "image/png")},
    )

    assert resp.status_code == 200, resp.text
    docs = client.get("/api/documents", headers=headers).json()
    assert [d["status"] for d in docs] == ["failed"]
    assert "simulated" not in (docs[0]["processing_error"] or "")  # internals stay in the log
    leftovers = os.listdir(settings.upload_dir) if os.path.isdir(settings.upload_dir) else []
    assert not [f for f in leftovers if f.startswith("tmp-")]
