"""
Admin export of student and faculty accounts (CSV and Excel).

Only account metadata leaves the server - never password hashes, profile
details, or chat content.
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List, Optional

from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font

from app.db import models


@dataclass
class AccountRow:
    full_name: str
    email: str
    role: str
    status: str
    signed_up: Optional[datetime]
    last_login: Optional[datetime]


def account_status(user: models.User) -> str:
    if not user.is_active or user.status == models.UserStatus.SUSPENDED:
        return "disabled"
    if user.status == models.UserStatus.PENDING:
        return "pending"
    return "active"


def _offset_label(tz_offset: int) -> str:
    sign = "+" if tz_offset >= 0 else "-"
    hours, minutes = divmod(abs(tz_offset), 60)
    return f"UTC{sign}{hours:02d}:{minutes:02d}"


def _headers(tz_offset: int) -> List[str]:
    tz = _offset_label(tz_offset)
    return ["Name", "Email", "Role", "Account status", f"Signed up ({tz})", f"Last login ({tz})"]


def _local(ts: Optional[datetime], tz_offset: int) -> Optional[datetime]:
    return ts + timedelta(minutes=tz_offset) if ts else None


def _safe(value: str) -> str:
    # Spreadsheet apps execute cells starting with these as formulas; names
    # and emails are user-supplied, so neutralise them.
    return "'" + value if value[:1] in ("=", "+", "-", "@", "\t", "\r") else value


def build_csv(rows: List[AccountRow], tz_offset: int) -> bytes:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(_headers(tz_offset))
    for r in rows:
        signed_up, last_login = _local(r.signed_up, tz_offset), _local(r.last_login, tz_offset)
        writer.writerow([
            _safe(r.full_name),
            _safe(r.email),
            r.role,
            r.status,
            signed_up.strftime("%Y-%m-%d %H:%M") if signed_up else "",
            last_login.strftime("%Y-%m-%d %H:%M") if last_login else "Never",
        ])
    # BOM so Excel opens non-ASCII names (Tamil, Hindi) correctly.
    return ("﻿" + out.getvalue()).encode("utf-8")


def build_xlsx(rows: List[AccountRow], tz_offset: int) -> bytes:
    wb = Workbook(write_only=True)
    ws = wb.create_sheet("Accounts")
    for col, width in zip("ABCDEF", (28, 34, 10, 16, 22, 22)):
        ws.column_dimensions[col].width = width
    ws.freeze_panes = "A2"

    header = []
    for title in _headers(tz_offset):
        cell = WriteOnlyCell(ws, value=title)
        cell.font = Font(bold=True)
        header.append(cell)
    ws.append(header)

    for r in rows:
        dates = []
        for ts, missing in ((_local(r.signed_up, tz_offset), ""), (_local(r.last_login, tz_offset), "Never")):
            cell = WriteOnlyCell(ws, value=ts or missing)
            if ts:
                cell.number_format = "yyyy-mm-dd hh:mm"
            dates.append(cell)
        ws.append([_safe(r.full_name), _safe(r.email), r.role, r.status, *dates])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
