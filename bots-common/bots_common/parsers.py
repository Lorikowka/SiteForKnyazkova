"""Разбор текстовых команд ботов (/add, /block, /unblock)."""

from __future__ import annotations

import re

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^\d{2}:\d{2}$")


def parse_add_command(text: str) -> dict[str, str] | None:
    """Разбирает ``/add ДАТА ВРЕМЯ | Имя | Телефон | [услуга] | [комментарий]``."""
    body = text.strip()
    if not body.lower().startswith("/add"):
        return None

    parts = [part.strip() for part in body[4:].strip().split("|")]
    if len(parts) < 3:
        return None

    date_time = parts[0].split()
    if len(date_time) < 2:
        return None

    session_date, session_time = date_time[0], date_time[1]
    if not DATE_RE.match(session_date) or not TIME_RE.match(session_time):
        return None

    payload = {
        "sessionDate": session_date,
        "sessionTime": session_time,
        "clientName": parts[1],
        "clientPhone": parts[2],
        "serviceId": parts[3] if len(parts) > 3 and parts[3] else "consult-online",
    }
    if len(parts) > 4 and parts[4]:
        payload["comment"] = parts[4]
    return payload


def parse_block_command(text: str) -> tuple[str, str] | None:
    """Разбирает ``/block YYYY-MM-DD [причина]`` (и русский алиас)."""
    for prefix in ("/block", "/выходной"):
        if text.lower().startswith(prefix):
            parts = text.split(maxsplit=2)
            if len(parts) < 2 or not DATE_RE.match(parts[1]):
                return None
            return parts[1], (parts[2] if len(parts) > 2 else "")
    return None


def parse_unblock_command(text: str) -> str | None:
    """Разбирает ``/unblock YYYY-MM-DD`` (и русский алиас)."""
    for prefix in ("/unblock", "/открыть"):
        if text.lower().startswith(prefix):
            parts = text.split(maxsplit=1)
            if len(parts) < 2:
                return None
            date_str = parts[1].strip()
            return date_str if DATE_RE.match(date_str) else None
    return None
