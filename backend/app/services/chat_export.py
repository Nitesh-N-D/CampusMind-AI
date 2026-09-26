"""
Chat history downloads (PDF and plain text) for a user's own conversations.

Timestamps are stored in UTC; the caller passes the reader's UTC offset in
minutes so every message shows the time the user actually saw.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta
from typing import List

from fpdf import FPDF
from fpdf.enums import XPos, YPos

from app.db import models

FONT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "fonts")

# Design-system colours (frontend/src/index.css, light theme).
NAVY_900 = (20, 33, 61)
INK_900 = (18, 23, 43)
INK_500 = (84, 95, 130)
VIOLET_600 = (75, 70, 150)
LINE = (221, 216, 204)
PAPER_100 = (246, 244, 238)


def _offset_label(tz_offset: int) -> str:
    sign = "+" if tz_offset >= 0 else "-"
    hours, minutes = divmod(abs(tz_offset), 60)
    return f"UTC{sign}{hours:02d}:{minutes:02d}"


def _local(ts: datetime | None, tz_offset: int) -> str:
    if ts is None:
        return "time not recorded"
    return (ts + timedelta(minutes=tz_offset)).strftime("%d %b %Y, %H:%M")


def _citation_line(c: dict) -> str:
    where = f"page {c['page']}" if c.get("page") else (c.get("section") or "")
    trust = c.get("trust_score")
    parts = [c.get("document_title") or "Untitled document"]
    if where:
        parts.append(where)
    line = ", ".join(parts)
    if trust is not None:
        line += f" (trust {round(trust)}/100)"
    return line


def _plain(text: str) -> str:
    # Answers use light Markdown; turn it into plain prose and bullets.
    text = re.sub(r"^(\s*)[*-] ", "\\1\u2022 ", text or "", flags=re.MULTILINE)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    return re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"\1", text)


def _file_stem(sessions: List[models.ChatSession], tz_offset: int) -> str:
    stamp = (datetime.utcnow() + timedelta(minutes=tz_offset)).strftime("%Y-%m-%d")
    if len(sessions) == 1:
        slug = re.sub(r"[^a-z0-9]+", "-", (sessions[0].title or "").lower()).strip("-")[:40]
        return f"campusmind-chat-{slug or 'conversation'}-{stamp}"
    return f"campusmind-chats-{len(sessions)}-conversations-{stamp}"


def build_txt(user: models.User, sessions: List[models.ChatSession], tz_offset: int) -> tuple[bytes, str]:
    tz = _offset_label(tz_offset)
    lines = [
        "CampusMind AI - chat history",
        f"Name:     {user.full_name}",
        f"College:  {user.college.name if user.college else ''}",
        f"Exported: {_local(datetime.utcnow(), tz_offset)} ({tz})",
        f"Conversations: {len(sessions)}",
        "",
    ]
    for s in sessions:
        lines += ["=" * 72, s.title or "Conversation", f"Started {_local(s.created_at, tz_offset)} ({tz})", "=" * 72, ""]
        for m in s.messages:
            label = "Question" if m.role == "user" else "Answer"
            lines.append(f"[{_local(m.created_at, tz_offset)}] {label}")
            lines.append(m.content if m.role == "user" else _plain(m.content))
            if m.role != "user" and m.citations:
                lines.append("Sources:")
                lines += [f"  [{i}] {_citation_line(c)}" for i, c in enumerate(m.citations, start=1)]
            lines.append("")
    lines.append("Answers come from your college's uploaded documents. Verify time-sensitive details with the college office.")
    return ("\n".join(lines) + "\n").encode("utf-8"), _file_stem(sessions, tz_offset) + ".txt"


class _ChatPdf(FPDF):
    def __init__(self, header_text: str):
        super().__init__(format="A4")
        self.header_text = header_text
        self.add_font("Plex", "", os.path.join(FONT_DIR, "IBMPlexSans-Regular.ttf"))
        self.add_font("Plex", "B", os.path.join(FONT_DIR, "IBMPlexSans-SemiBold.ttf"))
        self.add_font("PlexMono", "", os.path.join(FONT_DIR, "IBMPlexMono-Regular.ttf"))
        # Tamil and Hindi answers: glyphs Plex lacks come from Noto, shaped
        # by HarfBuzz so conjuncts and vowel signs render correctly.
        self.add_font("NotoTamil", "", os.path.join(FONT_DIR, "NotoSansTamil-Regular.ttf"))
        self.add_font("NotoDevanagari", "", os.path.join(FONT_DIR, "NotoSansDevanagari-Regular.ttf"))
        self.set_fallback_fonts(["NotoTamil", "NotoDevanagari"], exact_match=False)
        self.set_text_shaping(True)
        self.set_auto_page_break(True, margin=18)
        self.set_margins(18, 18, 18)

    def header(self):
        if self.page_no() == 1:
            return
        self.set_font("PlexMono", "", 8)
        self.set_text_color(*INK_500)
        self.cell(0, 6, self.header_text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(2)

    def footer(self):
        self.set_y(-12)
        self.set_font("PlexMono", "", 8)
        self.set_text_color(*INK_500)
        self.cell(0, 6, f"Page {self.page_no()} of {{nb}}", align="R")


def build_pdf(user: models.User, sessions: List[models.ChatSession], tz_offset: int) -> tuple[bytes, str]:
    tz = _offset_label(tz_offset)
    college = user.college.name if user.college else ""
    pdf = _ChatPdf(f"{user.full_name} - {college} - CampusMind AI chat history")
    pdf.set_title("CampusMind AI chat history")
    pdf.set_author(user.full_name)
    pdf.set_creator("CampusMind AI")
    pdf.add_page()
    width = pdf.epw

    # Title block
    pdf.set_font("Plex", "B", 20)
    pdf.set_text_color(*NAVY_900)
    pdf.cell(0, 10, "Chat history", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font("Plex", "", 10)
    pdf.set_text_color(*INK_900)
    for label, value in [
        ("Name", user.full_name),
        ("College", college),
        ("Exported", f"{_local(datetime.utcnow(), tz_offset)} ({tz})"),
        ("Conversations", str(len(sessions))),
    ]:
        pdf.set_text_color(*INK_500)
        pdf.cell(30, 6, label)
        pdf.set_text_color(*INK_900)
        pdf.multi_cell(width - 30, 6, value, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(3)

    for s in sessions:
        pdf.set_draw_color(*LINE)
        pdf.line(pdf.l_margin, pdf.get_y(), pdf.l_margin + width, pdf.get_y())
        pdf.ln(4)
        pdf.set_font("Plex", "B", 13)
        pdf.set_text_color(*NAVY_900)
        pdf.multi_cell(width, 7, s.title or "Conversation", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_font("PlexMono", "", 8)
        pdf.set_text_color(*INK_500)
        pdf.cell(0, 5, f"Started {_local(s.created_at, tz_offset)} ({tz})", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(3)

        for m in s.messages:
            is_question = m.role == "user"
            pdf.set_font("PlexMono", "", 8)
            pdf.set_text_color(*(NAVY_900 if is_question else VIOLET_600))
            pdf.cell(0, 5, f"{'QUESTION' if is_question else 'ANSWER'}  {_local(m.created_at, tz_offset)}",
                     new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_font("Plex", "B" if is_question else "", 10.5)
            pdf.set_text_color(*INK_900)
            if is_question:
                pdf.set_fill_color(*PAPER_100)
                pdf.multi_cell(width, 6, m.content or "", fill=True, padding=(2, 3), align="L",
                               new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            else:
                pdf.multi_cell(width, 6, _plain(m.content), align="L", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                if m.citations:
                    pdf.ln(1)
                    pdf.set_font("PlexMono", "", 8)
                    pdf.set_text_color(*INK_500)
                    pdf.cell(0, 5, "SOURCES", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                    pdf.set_font("Plex", "", 9)
                    for i, c in enumerate(m.citations, start=1):
                        pdf.multi_cell(width, 5, f"[{i}] {_citation_line(c)}", align="L",
                                       new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.ln(4)

    pdf.set_font("Plex", "", 8)
    pdf.set_text_color(*INK_500)
    pdf.multi_cell(width, 5, "Answers come from your college's uploaded documents. "
                             "Verify time-sensitive details with the college office.")
    return bytes(pdf.output()), _file_stem(sessions, tz_offset) + ".pdf"
