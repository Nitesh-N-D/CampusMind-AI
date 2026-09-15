from __future__ import annotations

from sqlalchemy.orm import Session

from app.db import models
from app.ingestion.chunker import chunk_pages
from app.ingestion.pdf_processor import extract_pdf
from app.services.ai_provider import get_ai_provider
from app.services.change_detector import detect_changes
from app.services.embedding_provider import get_embedding_provider
from app.services.event_extractor import extract_events
from app.services.trust_engine import score_document


async def process_document(db: Session, document: models.Document) -> None:
    document.status = models.DocumentStatus.PROCESSING
    db.commit()

    try:
        pages = extract_pdf(document.file_path)
        document.page_count = len(pages)

        raw_chunks = chunk_pages(pages)
        embedder = get_embedding_provider()

        for idx, c in enumerate(raw_chunks):
            vector = await embedder.embed(c.content)
            db.add(
                models.DocumentChunk(
                    document_id=document.id,
                    college_id=document.college_id,
                    chunk_index=idx,
                    page_number=c.page_number,
                    heading=c.heading,
                    section=c.heading,
                    content=c.content,
                    embedding=vector,
                )
            )

        # Feature 1: trust scoring
        score, level, _ = score_document(document)
        document.trust_score = score
        document.trust_level = level

        db.flush()

        # Feature 6: event/deadline extraction
        full_text_by_page = {p.page_number: p.text for p in pages}
        for page_num, text in full_text_by_page.items():
            for candidate in extract_events(text):
                db.add(
                    models.ExtractedEvent(
                        college_id=document.college_id,
                        document_id=document.id,
                        title=candidate.title,
                        category=candidate.category,
                        event_date=candidate.event_date,
                        department=document.department,
                        source_snippet=candidate.snippet,
                    )
                )

        # Feature 7: what-changed diffing, if this document explicitly
        # supersedes an earlier one
        change_logs = []
        if document.supersedes_id:
            old_doc = db.query(models.Document).get(document.supersedes_id)
            if old_doc:
                ai = get_ai_provider()
                change_logs = await detect_changes(db, old_doc, document, ai)
                old_doc.status = models.DocumentStatus.ARCHIVED

        document.status = models.DocumentStatus.READY

        # Notify students: either "what changed" (if this replaces something
        # they may already know) or a plain new-document notice.
        if change_logs:
            summary = change_logs[0].impact_summary
            db.add(
                models.Notification(
                    college_id=document.college_id,
                    user_id=None,
                    target_role="student",
                    title=f"Updated: {document.title}",
                    body=f"This replaces an earlier version. {summary}",
                    category="regulation_change",
                )
            )
        else:
            db.add(
                models.Notification(
                    college_id=document.college_id,
                    user_id=None,
                    target_role="student",
                    title=f"New document: {document.title}",
                    body=f"A new {document.document_type.replace('_', ' ')} is now available in CampusMind AI.",
                    category="new_document",
                )
            )

        db.commit()

    except Exception as exc:  # noqa: BLE001
        # Ingestion failures (corrupt PDF, OCR failure, provider outage) must
        # never surface as a raw 500 to the admin - report them on the
        # document itself so the upload endpoint still returns cleanly and
        # the admin dashboard can show what went wrong and let them retry.
        db.rollback()
        document.status = models.DocumentStatus.FAILED
        document.processing_error = str(exc)[:500]
        db.commit()
