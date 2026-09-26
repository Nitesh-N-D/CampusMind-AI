from __future__ import annotations

from sqlalchemy.orm import Session

from app.db import models
from app.ingestion.chunker import chunk_pages
from app.ingestion.extractors import ExtractionError, extract_document, file_type_for
from app.core.logging_config import logger
from app.services.ai_provider import AIProviderError
from app.services.embedding_provider import get_embedding_provider
from app.services.trust_engine import score_document


async def process_document(db: Session, document: models.Document) -> None:
    document.status = models.DocumentStatus.PROCESSING
    db.commit()

    try:
        file_type = file_type_for(document.original_filename or document.file_path)
        if file_type is None:
            raise ExtractionError("Unsupported file type.")
        pages = extract_document(document.file_path, file_type)
        # For non-paginated formats this counts sections/sheets instead.
        document.page_count = len(pages)

        raw_chunks = chunk_pages(pages)
        embedder = get_embedding_provider()

        for idx, c in enumerate(raw_chunks):
            # Title and section give the vector the context the chunk text may lack.
            vector = await embedder.embed(f"{document.title}\n{c.heading or ''}\n{c.content}")
            db.add(
                models.DocumentChunk(
                    document_id=document.id,
                    college_id=document.college_id,
                    chunk_index=idx,
                    page_number=c.page_number,
                    heading=c.heading,
                    # section is String(120); Postgres rejects longer values.
                    section=c.heading[:120] if c.heading else None,
                    content=c.content,
                    embedding=vector,
                )
            )

        # Feature 1: trust scoring
        score, level, _ = score_document(document)
        document.trust_score = score
        document.trust_level = level

        # A new version replaces the one it supersedes. The old version stays
        # retrievable (heavily down-weighted) so conflicts between the two
        # still surface on the admin Conflicts page.
        if document.supersedes_id:
            old_doc = (
                db.query(models.Document)
                .filter(
                    models.Document.id == document.supersedes_id,
                    models.Document.college_id == document.college_id,
                )
                .first()
            )
            if old_doc:
                old_doc.status = models.DocumentStatus.ARCHIVED

        document.status = models.DocumentStatus.READY
        db.commit()

    except Exception as exc:  # noqa: BLE001
        # Ingestion failures (corrupt file, OCR failure, provider outage) must
        # never surface as a raw 500 to the admin - report them on the
        # document itself so the upload endpoint still returns cleanly and
        # the admin can see what went wrong and retry.
        db.rollback()
        document.status = models.DocumentStatus.FAILED
        if isinstance(exc, ExtractionError):
            document.processing_error = str(exc)[:500]
        elif isinstance(exc, AIProviderError):
            document.processing_error = f"Couldn't index this document: {exc} The file itself is fine."[:500]
        else:
            # The raw exception is for the server log, not the admin's screen.
            logger.exception("Ingestion failed for document_id=%s", document.id)
            document.processing_error = (
                "Processing failed unexpectedly. Try uploading the file again; "
                "if it keeps failing, re-save it and upload the new copy."
            )
        db.commit()
